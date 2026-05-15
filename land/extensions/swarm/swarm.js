// Branch swarm runner.
//
// Parallel inquiry as a primitive. When a mode emits a structured
// `[[BRANCHES]]...[[/BRANCHES]]` block, swarm parses it, creates a child
// node per branch under the project root, and dispatches each branch as
// its own sequence of chat turns in whatever mode the architect names
// (or the caller's default).
//
// Status is tracked in metadata.swarm on each swarm-aware node. Domain
// extensions (code-workspace, research-workspace, etc.) subscribe to
// swarm's lifecycle hooks to run their own validators / write their own
// artifacts / format their own enrichContext. Swarm owns the mechanism
// only; policy lives in the subscribers.
//
// Branch block format (whitespace-tolerant):
//
//   [[BRANCHES]]
//   branch: backend
//     spec: Node.js + Express server with auth, swipe, match endpoints.
//     mode: tree:code-plan     # optional; defaults resolved from position
//     slot: code-plan          # optional; LLM slot hint
//     path: backend
//     files: package.json, server.js, auth.js, db.js
//
//   branch: frontend
//     spec: HTML/CSS/JS frontend with login, swipe deck, chat pane.
//     path: frontend
//   [[/BRANCHES]]
//
// Each branch becomes a child node of the project root (named after
// `branch:`). The runner walks the queue, calling the caller-supplied
// runBranch(...) callback at the branch's position with the spec as the
// initial message.

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { v4 as uuidv4 } from "uuid";
import { startChainStep, finalizeChat, setChatContext, getChatContext } from "../../seed/llm/chatTracker.js";
import { appendSignal } from "./state/signalInbox.js";
import { readMeta, mutateMeta, ensureScopeBookkeeping, initBranchRole } from "./state/meta.js";
import { plan, setBranchStatus } from "./state/planAccess.js";
import { dualWriteBranchStep } from "./state/dualWriteStatus.js";
import { promoteDoneAncestors } from "./project.js";
import { reconcileProject } from "./reconcile.js";
import { SWARM_WS_EVENTS } from "./wsEvents.js";

// [[BRANCHES]] / [[CONTRACTS]] text-emission regexes deleted in phase 3.
// All emission flows through governing-emit-plan / governing-emit-contracts;
// dispatch reads structured emissions via governing.readActivePlanEmission
// and governing.readContracts.

/**
 * Fire a custom swarm lifecycle hook. Handlers registered by domain
 * extensions receive the payload. Errors in handlers are logged but
 * never stop swarm. Returns the payload (handlers may mutate fields
 * like `results` to signal retry needs).
 */
async function fireHook(_core, name, payload) {
  // Always go through the kernel's singleton hook registry. Earlier
  // callers passed a stub `core` (e.g. dispatch.js's
  // { metadata: { setExtMeta } } shim for atomic writes) that had no
  // hooks accessor, and the legacy "prefer core.hooks, fall back to
  // kernel" dance silently no-op'd every swarm lifecycle hook. The
  // _core arg is still accepted for call-site compatibility but the
  // hook registry is a process-wide singleton anyway.
  const { hooks } = await import("../../seed/hooks.js");
  await hooks.fire(name, payload);
  return payload;
}

/**
 * Mirror a branch status transition onto the current AI forensics
 * capture (if treeos-base is loaded). Fire-and-forget.
 */
async function recordBranchEvent({ visitorId, branchName, from, to, reason }) {
  if (!branchName || !to) return;
  try {
    const { getExtension } = await import("../loader.js");
    const tb = getExtension("treeos-base")?.exports;
    if (!tb?.recordBranchEvent) return;
    const chatCtx = getChatContext(visitorId) || {};
    if (!chatCtx.chatId) return;
    tb.recordBranchEvent({
      chatId: chatCtx.chatId,
      branchName,
      from: from || null,
      to,
      reason: reason || null,
    });
  } catch {}
}

/**
 * Validate a parsed [[BRANCHES]] list against the seam rules every
 * compound-task architect output must respect. Returns an array of
 * error strings — empty array means valid.
 *
 * Rules:
 *   1. Every branch MUST declare a path.
 *   2. No two branches may share a path.
 *   3. No branch path may equal the project's own name.
 *   4. Branch name must match its path (case-insensitive).
 */
export function validateBranches(branches, projectName) {
  const errors = [];
  if (!Array.isArray(branches) || branches.length === 0) return { errors };

  const normalize = (s) => String(s || "").trim().toLowerCase();
  const normProject = normalize(projectName);

  const seenNames = new Map();
  for (const b of branches) {
    const nameRaw = b.name || "";
    const nameNorm = normalize(nameRaw);

    if (!nameNorm) {
      errors.push("Branch has no name. Every branch must declare a name field.");
      continue;
    }

    if (normProject && nameNorm === normProject) {
      errors.push(
        `Branch "${nameRaw}" uses the project's own name. ` +
        `Use a name that describes the LAYER (backend, frontend, ui, api, db), ` +
        `not the project name.`
      );
      continue;
    }

    if (seenNames.has(nameNorm)) {
      errors.push(
        `Branch "${nameRaw}" duplicates an earlier branch name. ` +
        `Each branch must have a unique name.`
      );
      continue;
    }

    seenNames.set(nameNorm, nameRaw);
  }

  return { errors };
}

/**
 * BFS the project subtree for a branch-role node by name. Used to find
 * the parent node for nested sub-branches whose parent isn't a direct
 * child of the project root.
 */
async function resolveBranchParentId({ rootProjectId, parentBranchName, hint }) {
  if (!parentBranchName) return rootProjectId;
  if (hint) return hint;

  const visited = new Set([String(rootProjectId)]);
  const queue = [String(rootProjectId)];
  let scanned = 0;
  while (queue.length > 0 && scanned < 200) {
    const currentId = queue.shift();
    scanned++;
    const node = await Node.findById(currentId).select("_id children").lean();
    if (!node?.children?.length) continue;
    const kids = await Node.find({ _id: { $in: node.children } })
      .select("_id name metadata").lean();
    for (const kid of kids) {
      const kidIdStr = String(kid._id);
      if (visited.has(kidIdStr)) continue;
      visited.add(kidIdStr);
      const data = readMeta(kid);
      if (data?.role === "branch" && kid.name === parentBranchName) {
        return kidIdStr;
      }
      queue.push(kidIdStr);
    }
  }
  return rootProjectId;
}

/**
 * Ensure a child node exists under the branch parent for this branch.
 * Reuses an existing node by name if present. Stamps metadata.swarm
 * with role=branch + the branch spec / path / files. Enables cascade
 * so writes inside the branch fire kernel propagation.
 */
async function ensureBranchNode({ rootProjectId, branch, userId, core }) {
  const parent = await Node.findById(rootProjectId).select("_id children");
  if (!parent) throw new Error(`Swarm: parent node ${rootProjectId} not found`);

  let branchNode = null;
  if (Array.isArray(parent.children) && parent.children.length > 0) {
    branchNode = await Node.findOne({
      _id: { $in: parent.children },
      name: branch.name,
    });
  }

  if (!branchNode) {
    if (core?.tree?.createNode) {
      branchNode = await core.tree.createNode({
        parentId: parent._id,
        name: branch.name,
        type: "branch",
        userId,
      });
    } else {
      branchNode = await Node.create({
        _id: uuidv4(),
        name: branch.name,
        type: "branch",
        parent: parent._id,
        status: "active",
      });
      await Node.updateOne({ _id: parent._id }, { $addToSet: { children: branchNode._id } });
    }
  }

  // Swarm-owned execution bookkeeping for the branch (role, parentage,
  // spec/path/files for prompt rendering, aggregatedDetail, inbox).
  // The plan namespace at this branch is independent and gets created
  // lazily when the branch's own decomposition writes to it.
  await initBranchRole({
    nodeId: branchNode._id,
    name: branch.name,
    spec: branch.spec,
    path: branch.path || null,
    files: branch.files || [],
    slot: branch.slot || null,
    mode: branch.mode || null,
    parentProjectId: String(rootProjectId),
    parentBranch: branch.parentBranch || null,
    core,
  });

  // Self-promote the branch node to Ruler. Every branch dispatch creates
  // a sub-Ruler at the child scope. The recursive Planner/Contractor/
  // Worker cycle runs at the new Ruler. Idempotent: re-dispatching an
  // existing branch returns the prior promotion record without changing
  // acceptedAt. See governing/state/role.js and project_recursive_sub_
  // ruler_dispatch memory for the architecture.
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.promoteToRuler) {
      await governing.promoteToRuler({
        nodeId: branchNode._id,
        reason: `parent Ruler declared sub-Ruler "${branch.name}" via swarm`,
        promotedFrom: governing.PROMOTED_FROM?.BRANCH_DISPATCH || "branch-dispatch",
        core,
      });
    }
  } catch (err) {
    log.debug("Swarm", `governing.promoteToRuler skipped on branch ${branch.name}: ${err.message}`);
  }

  // Enable cascade on branch nodes so file writes inside fire propagation.
  try {
    const cascadeData = {
      enabled: true,
      enabledAt: new Date().toISOString(),
      enabledBy: "swarm",
    };
    if (core?.metadata?.setExtMeta) {
      await core.metadata.setExtMeta(branchNode, "cascade", cascadeData);
    } else {
      await Node.updateOne(
        { _id: branchNode._id },
        { $set: { "metadata.cascade": cascadeData } },
      );
    }
  } catch (err) {
    log.warn("Swarm", `Failed to enable cascade on branch ${branch.name}: ${err.message}`);
  }

  return branchNode;
}

/**
 * Resolve the mode key a branch should run in. Priority:
 *   1. branch.mode (explicit in [[BRANCHES]] block)
 *   2. defaultBranchMode (caller-supplied fallback)
 *   3. Walk ancestors for the nearest extension's `-plan` mode via
 *      extensionScope.getModesOwnedBy (same resolution chain the kernel
 *      uses for tool/mode resolution).
 */
async function resolveBranchMode({ branch, defaultBranchMode, branchNodeId }) {
  if (branch.mode) return branch.mode;
  if (defaultBranchMode) return defaultBranchMode;

  // Walk ancestors looking for an extension whose metadata is present
  // at the position. The first ext with a `*-plan` mode wins. Skips
  // governing itself (its mode is `*-planner` not `*-plan`, and
  // governing-planner is what the runRulerCycle dispatches anyway —
  // the fallback we want here is the WORKSPACE worker mode).
  try {
    const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
    let cursor = String(branchNodeId || "");
    let guard = 0;
    while (cursor && guard < 64) {
      const node = await Node.findById(cursor).select("_id parent metadata").lean();
      if (!node) break;
      const md = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      for (const [extName, extData] of Object.entries(md)) {
        if (!extData || typeof extData !== "object") continue;
        if (extName === "governing") continue;
        const planModes = getModesOwnedBy(extName).filter((m) => m.endsWith("-plan"));
        if (planModes.length > 0) return planModes[0];
      }
      if (!node.parent) break;
      cursor = String(node.parent);
      guard++;
    }
  } catch (err) {
    log.debug("Swarm", `resolveBranchMode ancestor walk failed: ${err.message}`);
  }
  // Final fallback: governing-planner. Each branch is a sub-Ruler;
  // governing-planner enters the Ruler cycle and dispatches a Worker
  // for leaf work via the runRulerCycle fallthrough.
  return "tree:governing-planner";
}

/**
 * Retry any failed branches from a first swarm pass. Each failed branch
 * gets ONE retry with an augmented message that includes the original
 * error. Other branches' files / writes are now in place, so the retry
 * benefits from enrichContext (signals, contracts, aggregated detail)
 * that the first attempt didn't have.
 *
 * Capped: each branch gets at most ONE retry. If retry also fails, the
 * branch stays marked failed.
 */
async function retryFailedBranches({
  results, branches, runBranch, rootProjectNode,
  sessionId, userId, username, visitorId, rootId,
  signal, slot, socket, onToolLoopCheckpoint, rootChatId,
  core, emitStatus, rt, defaultBranchMode,
}) {
  const failed = results.filter((r) => r.status === "failed" || r.status === "error");
  if (failed.length === 0) return { retried: 0 };

  // Foreman batch judgment. One Foreman turn sees all failures at
  // once and decides per-branch via foreman-judge-batch. Set-framing
  // matters: per-failure Foreman calls can miss coupling between
  // failures (e.g., several branches failing because they all
  // consumed the same missing contract). The batch tool surfaces the
  // failure list together and lets the Foreman reason about retry
  // ordering — fix the producer first, wait on the consumers, etc.
  //
  // Token cost: 1 Foreman call instead of M. For M=1 the savings are
  // zero; for M=3+ the savings compound. The batch tool description
  // also tells the Foreman that single failures should still use the
  // per-failure tools — judge-batch is gated on "wakeup lists 2 or
  // more failures."
  //
  // Outcome decisions per branch:
  //   "retry"       — retry this branch on the upcoming retry pass
  //   "mark-failed" — leave failed terminally; do NOT retry
  //   "wait"        — defer; revisit next pass after other retries
  //                   finish (handled identically to "mark-failed" for
  //                   the current retry pass — the branch isn't
  //                   retried this time. The "wait" semantic surfaces
  //                   in the audit trail and may inform Pass 3.)
  //
  // If the Foreman picks anything OTHER than judge-batch (escalate /
  // freeze / respond), no retries fire — the Foreman's decision was
  // turn-level and applies to the whole situation.
  let approvedForRetry = null;  // null = no Foreman available (legacy path: retry all)
  try {
    const { runForemanTurn } = await import("../tree-orchestrator/ruling.js");
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (runForemanTurn && governing?.findRulerScope) {
      const rulerScope = await governing.findRulerScope(rootProjectNode._id);
      if (rulerScope) {
        // Build the wakeup payload as a structured failure list so the
        // Foreman can reason about it as a SET.
        const failureList = failed.map((prev) => {
          const errStr = String(prev.error || "(unknown error)").slice(0, 500);
          return `- branch: ${prev.name || prev.rawName}\n  ` +
                 `error: ${errStr}\n  ` +
                 `prior retries: ${prev.retries || 0}`;
        }).join("\n");

        const wakeup = {
          reason: failed.length === 1 ? "branch-failed" : "branch-batch-failed",
          payload:
            `${failed.length} branch failure${failed.length === 1 ? "" : "s"} ` +
            `to judge:\n\n${failureList}\n\n` +
            (failed.length > 1
              ? "Read these as a SET. Are they coupled (shared root cause, " +
                "missing producer, contract mismatch)? Or independent? " +
                "Coupled failures often warrant retrying the producer " +
                "first and waiting on the consumers — use foreman-judge-batch " +
                "with action='wait' for the consumers.\n\n" +
                "REQUIRED EXIT: foreman-judge-batch (preferred) OR " +
                "foreman-mark-failed / foreman-retry-branch / " +
                "foreman-escalate-to-ruler. DO NOT exit on prose alone. " +
                "If you genuinely cannot pick, exit with foreman-escalate-" +
                "to-ruler so the Ruler decides — never silence. The substrate " +
                "treats a no-decision exit as 'mark all failed' to prevent " +
                "work from silently falling on the floor."
              : "Single failure — judge per the standard retry-vs-mark-failed " +
                "matrix in your prompt. REQUIRED EXIT: foreman-retry-branch / " +
                "foreman-mark-failed / foreman-escalate-to-ruler. Prose-only " +
                "exit defaults to mark-failed."),
          // Structured failed-branch list for the substrate fallback.
          // When the Foreman exits without a decision tool, runForemanTurn
          // reads this list and synthesizes a default mark-failed
          // decision per branch — so work doesn't silently fall on
          // the floor when the Foreman talks instead of judging.
          failedBranches: failed.map((p) => ({
            name: p.name || p.rawName,
            error: String(p.error || "(unknown error)").slice(0, 500),
            retries: p.retries || 0,
          })),
        };

        log.info("Swarm",
          `🔁 Foreman batch judgment: ${failed.length} failure${failed.length === 1 ? "" : "s"}`);

        try {
          const foremanResult = await runForemanTurn({
            visitorId,
            message:
              `${failed.length} branch${failed.length === 1 ? "" : "es"} ` +
              `failed during execution. Decide retry / mark-failed / wait per branch, ` +
              `or escalate the whole situation to the Ruler.`,
            username, userId, rootId,
            currentNodeId: String(rulerScope._id),
            signal, slot, socket,
            sessionId, rootChatId, rt,
            readOnly: false, onToolLoopCheckpoint,
            wakeup,
          });

          const decision = foremanResult?._foremanDecision;
          approvedForRetry = new Set();
          if (decision?.kind === "judge-batch" && Array.isArray(decision.decisions)) {
            // Foreman emitted batch decisions. The mark-failed writes
            // already happened inside the judge-batch dispatch case
            // in ruling.js; here we just collect retry approvals.
            // "wait" entries get no immediate action; the branch
            // keeps its failed status and the next pass reconsiders.
            for (const d of decision.decisions) {
              if (d.action === "retry") approvedForRetry.add(d.branchName);
            }
            log.info("Swarm",
              `🔁 Foreman batch: ${decision.decisions.map((d) => `${d.branchName}:${d.action}`).join(", ")}`);
          } else if (decision?.kind === "retry-branch") {
            // Foreman called the single-branch tool — only one
            // failure or Foreman judged this batch as a single case.
            approvedForRetry.add(decision.branchName);
          } else if (decision?.kind === "mark-failed"
                  || decision?.kind === "freeze-record"
                  || decision?.kind === "escalate-to-ruler"
                  || decision?.kind === "cancel-subtree"
                  || decision?.kind === "pause-frame"
                  || decision?.kind === "respond-directly") {
            // Turn-level decision — applies to the whole situation.
            // No retries this pass.
            log.info("Swarm",
              `🔁 Foreman: ${decision.kind} (turn-level); no retries this pass`);
          } else {
            // No decision recognized — treat as no retries (safer
            // than blind-retrying everything when judgment didn't land).
            log.warn("Swarm",
              `🔁 Foreman returned unrecognized decision (${decision?.kind || "(none)"}); ` +
              `no retries this pass`);
          }
        } catch (err) {
          log.warn("Swarm",
            `Foreman batch invocation failed: ${err.message}; falling back to retry-all`);
          approvedForRetry = null;
        }
      }
    }
  } catch (err) {
    log.debug("Swarm", `Foreman bridge unavailable: ${err.message}; falling back to retry-all`);
    approvedForRetry = null;
  }

  log.info("Swarm",
    `🔁 Retry: ${failed.length} failed branch(es); ` +
    (approvedForRetry === null
      ? `legacy unconditional retry`
      : `Foreman approved ${approvedForRetry.size} of ${failed.length}`));

  // Path B: plan steps live on the plan-type child of the project
  // scope. Resolve once for all retries in this batch.
  const p = await plan();
  const rootPlan = await p.ensurePlanAtScope(
    rootProjectNode._id,
    { userId },
    core,
  );
  const rootPlanNodeId = rootPlan ? String(rootPlan._id) : String(rootProjectNode._id);

  for (const prev of failed) {
    if (signal?.aborted) break;
    const branch = branches.find((b) => b.name === prev.name || b.name === prev.rawName);
    if (!branch) continue;

    // Foreman gate: if a Foreman was invoked above, only retry the
    // branches it approved. Branches the Foreman left alone or
    // explicitly mark-failed get skipped here.
    if (approvedForRetry !== null && !approvedForRetry.has(branch.name)) {
      log.info("Swarm",
        `🔁 Skipping retry of "${branch.name}" (Foreman did not approve)`);
      continue;
    }

    emitStatus?.(socket, "intent", `Retry: ${branch.name}`);

    const branchNode = await Node.findOne({
      parent: rootProjectNode._id,
      name: branch.name,
    });
    if (!branchNode) continue;

    const branchMode = await resolveBranchMode({
      branch,
      defaultBranchMode,
      branchNodeId: branchNode._id,
    });
    if (!branchMode) {
      log.warn("Swarm", `Retry: no branch mode resolvable for "${branch.name}", skipping`);
      continue;
    }

    const retryHeaderInput = `[retry ${branch.name}] previous error: ${prev.error || "unknown"}`;
    let retryStep = null;
    if (rt && !rt._cleaned) {
      retryStep = await rt.beginChainStep(branchMode, retryHeaderInput, {
        treeContext: { targetNodeId: branchNode._id },
      });
    }

    const retryMessage =
      `You are retrying a branch that failed on the first pass.\n\n` +
      `Branch: ${branch.name}\n` +
      `Path: ${branch.path || "(project root)"}\n` +
      `Files expected: ${(branch.files || []).join(", ") || "(infer from spec)"}\n\n` +
      `Original spec:\n${branch.spec}\n\n` +
      `Previous error:\n${prev.error || "unknown"}\n\n` +
      `Sibling branches have likely made progress since the first attempt ` +
      `(their writes show up in enrichContext). Apply the fix now. Emit ` +
      `[[DONE]] when the branch is complete.`;

    try {
      const retryResult = await runBranch({
        mode: branchMode,
        message: retryMessage,
        branchNodeId: branchNode._id,
        slot: branch.slot || slot,
        visitorId, username, userId, rootId,
        signal, onToolLoopCheckpoint, socket,
      });

      const idx = results.findIndex((r) => r.name === branch.name || r.rawName === branch.name);
      if (idx >= 0) {
        results[idx] = {
          name: branch.name,
          status: "done",
          answer: (retryResult?.answer || "") + " (retried)",
        };
      }
      await setBranchStatus({ branchNodeId: branchNode._id, status: "done", summary: retryResult?.answer || null, core });
      await dualWriteBranchStep(
        rootPlanNodeId,
        {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: "done",
          summary: truncate(retryResult?.answer || "", 300),
          finishedAt: new Date().toISOString(),
          retries: 1,
        },
        core,
      );
      // Phase E removed the recordBudgetConsumption call (Pass 3
      // budget tracking lived on metadata.plan.steps[]; that field
      // is gone). Retry-side finishChainStep UI tracking also
      // dropped — chatId was read from the legacy step entry.
      // Pass 3 budget tracking lands on execution-record stepStatuses
      // when reputation work resumes.
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "failed", to: "done", reason: "retry succeeded" });
    } catch (err) {
      // Mirror the main per-branch catch's abort handling (line 1619).
      // A user-abort during the retry attempt is NOT a retry failure —
      // it's a pause. Without this check, an aborted retry overwrites
      // the "paused" status from the first attempt with a terminal
      // "failed" + retry-cap consumed, leaving the step dead-on-arrival
      // for resume even though the user just stopped mid-build.
      const parentAborted = signal?.aborted === true;
      const resumableStatus = parentAborted ? "paused" : "failed";
      const errorMsg = parentAborted ? err.message : err.message + " (also failed on retry)";
      log.error("Swarm",
        `Retry ${parentAborted ? "paused (aborted)" : "failed"} for "${branch.name}": ${err.message}`,
      );
      const idx = results.findIndex((r) => r.name === branch.name || r.rawName === branch.name);
      if (idx >= 0) {
        results[idx] = {
          name: branch.name,
          status: resumableStatus,
          error: errorMsg,
        };
      }
      await setBranchStatus({ branchNodeId: branchNode._id, status: resumableStatus, error: errorMsg, core });
      await dualWriteBranchStep(
        rootPlanNodeId,
        {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: resumableStatus,
          error: errorMsg,
          finishedAt: new Date().toISOString(),
          retries: 1,
          ...(parentAborted ? { pausedAt: new Date().toISOString(), abortReason: err.message } : {}),
        },
        core,
      );
      // Phase E: budget consumption + retry finishChainStep UI tracking
      // removed (relied on metadata.plan.steps[]). Pass 3 budget land
      // when reputation work resumes; retry runtime UI degrades cleanly.
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "failed", to: "failed", reason: `retry also failed: ${err.message}` });
    }
  }

  return { retried: failed.length };
}

/**
 * Scout loop: adaptive multi-cycle cross-branch verification phase that
 * runs AFTER all builder branches finish and the standard retry pass
 * concludes. Fires `swarm:runScouts` once per cycle; domain extensions
 * (code-workspace, book-workspace, etc.) subscribe to it and perform
 * their own read-only seam checks — LLM scouts, static analyzers,
 * contract comparisons. Whatever the handlers find gets appended to
 * branch signal inboxes and their result statuses flipped to "failed";
 * swarm detects the flip and re-dispatches only the affected branches.
 * Repeats until no new issues OR the cycle cap is hit.
 *
 * Adaptive policy:
 *   cycle 1: always (if ≥2 branches and at least one listener)
 *   cycle 2: only if cycle 1 found issues
 *   cycle 3: only if ≥5 branches AND cycle 2 still found issues
 *   max:     3 cycles hard-capped
 *   early:   zero issues at any cycle → done clean
 *   stuck:   identical issue signature to prior cycle → stop with "stuck"
 *
 * Handlers receive `scoutPayload.issueSummary` (array) and push
 * `{ branch, kind, detail }` entries for every finding. Swarm uses the
 * length of that array + the set of affected branches to decide
 * whether to re-dispatch, and to build the final reconciliation event.
 *
 * This function emits narration events to the provided socket so the
 * UI renders a distinct phase: "🔍 dispatching scouts... ⚠ scout·menu
 * found mismatch... 📬 routing 2 issues to 2 branches... 🔧
 * redeploying... ✓ swarm reconciled". If no listeners are registered
 * on `swarm:runScouts`, the whole phase is silent.
 */
async function runScoutLoop({
  rootProjectNode, workspaceAnchorNode = null,
  results, branches, core, socket, signal,
  runBranch, sessionId, userId, username, visitorId, rootId,
  slot, onToolLoopCheckpoint, rootChatId, rt, defaultBranchMode,
}) {
  if (!Array.isArray(branches) || branches.length < 2) {
    return { cycles: 0, status: "skipped", totalIssues: 0 };
  }
  if (signal?.aborted) {
    return { cycles: 0, status: "aborted", totalIssues: 0 };
  }

  // No listener → no scouts. Check the kernel singleton so we see
  // every registered handler regardless of what `core` shape the
  // caller handed us (dispatch.js passes a stub without hooks).
  try {
    const { hooks } = await import("../../seed/hooks.js");
    const registered = hooks.list();
    if (!registered["swarm:runScouts"] || registered["swarm:runScouts"].length === 0) {
      return { cycles: 0, status: "no-listeners", totalIssues: 0 };
    }
  } catch {
    return { cycles: 0, status: "no-listeners", totalIssues: 0 };
  }

  const MAX_CYCLES = 3;
  let cycle = 0;
  let totalIssues = 0;
  let prevSignature = "";
  let exitStatus = "clean";

  while (cycle < MAX_CYCLES) {
    if (signal?.aborted) { exitStatus = "aborted"; break; }

    // Adaptive gate for cycle 3: only when the swarm is large enough
    // that a third pass is worth the extra wall time.
    if (cycle === 2 && branches.length < 5) { exitStatus = "capped"; break; }

    cycle++;

    socket?.emit?.(SWARM_WS_EVENTS.SCOUTS_DISPATCHED, {
      cycle,
      branchCount: results.filter((r) => r.status === "done").length,
      projectNodeId: String(rootProjectNode._id),
      projectName: rootProjectNode.name || null,
    });

    const statusesBefore = results.map((r) => `${r.name}:${r.status}`).join("|");
    const scoutPayload = {
      cycle,
      rootProjectNode,
      workspaceAnchorNode,
      results,
      branches,
      core,
      socket,
      visitorId,
      signal,
      // Handlers push { branch, kind, detail, targetBranch? } for every
      // finding. Swarm uses .length + affected branch set for routing.
      issueSummary: [],
    };

    try {
      await fireHook(core, "swarm:runScouts", scoutPayload);
    } catch (err) {
      log.warn("Swarm", `scout cycle ${cycle} hook error: ${err.message}`);
    }
    const statusesAfter = results.map((r) => `${r.name}:${r.status}`).join("|");

    const issuesThisCycle = Array.isArray(scoutPayload.issueSummary)
      ? scoutPayload.issueSummary.length : 0;
    const affected = [...new Set(
      (scoutPayload.issueSummary || []).map((i) => i?.branch).filter(Boolean),
    )];
    totalIssues += issuesThisCycle;

    socket?.emit?.(SWARM_WS_EVENTS.ISSUES_ROUTED, {
      cycle,
      total: issuesThisCycle,
      affectedBranches: affected,
      projectNodeId: String(rootProjectNode._id),
    });

    if (issuesThisCycle === 0) { exitStatus = "clean"; break; }

    // Stuck detection: same findings as last cycle → we're not making
    // progress, stop to avoid burning cycles on an unsolvable mismatch.
    const signatureArr = (scoutPayload.issueSummary || [])
      .map((i) => `${i?.branch || "?"}|${i?.kind || "?"}|${String(i?.detail || "").slice(0, 80)}`)
      .sort();
    const signature = signatureArr.join(";");
    if (cycle > 1 && signature === prevSignature) {
      exitStatus = "stuck";
      break;
    }
    prevSignature = signature;

    // Handlers flipped statuses → re-dispatch the affected branches.
    if (statusesAfter !== statusesBefore) {
      socket?.emit?.(SWARM_WS_EVENTS.REDEPLOYING, {
        cycle,
        branches: affected,
        projectNodeId: String(rootProjectNode._id),
      });
      await retryFailedBranches({
        results, branches, runBranch, rootProjectNode,
        sessionId, userId, username, visitorId, rootId,
        signal, slot, socket, onToolLoopCheckpoint, rootChatId,
        core, emitStatus: () => {}, rt, defaultBranchMode,
      });
    }
  }

  if (cycle >= MAX_CYCLES && exitStatus === "clean") exitStatus = "capped";

  socket?.emit?.(SWARM_WS_EVENTS.SWARM_RECONCILED, {
    cycles: cycle,
    status: exitStatus,
    totalIssues,
    projectNodeId: String(rootProjectNode._id),
    projectName: rootProjectNode.name || null,
  });

  return { cycles: cycle, status: exitStatus, totalIssues };
}

/**
 * Run a whole swarm. Walk branches sequentially, dispatch each at the
 * resolved mode at that branch's tree position, collect results, return
 * a summary. Each branch opens its own chainIndex chat records inside
 * the same session so the dashboard groups the swarm under one
 * conversation.
 *
 * The `runBranch` callback is injected by the caller so this module
 * doesn't depend on any orchestrator. It's a closure that dispatches
 * one branch as a stepped mode run and returns the final result.
 *
 * Fires hooks:
 *   swarm:beforeBranchRun       — before each branch dispatch
 *   swarm:afterBranchComplete   — after each branch terminates
 *   swarm:afterAllBranchesComplete — once, after the final retry pass
 *   swarm:branchRetryNeeded     — when a handler flips results to fail
 *
 * Handlers on afterAllBranchesComplete may mutate results[].status to
 * "failed" and append to signal inboxes. Swarm detects the status flip
 * and re-runs retryFailedBranches to give those branches a fresh shot.
 */
export async function runBranchSwarm({
  branches, rootProjectNode, rootChatId, architectChatId, sessionId,
  visitorId, userId, username, rootId, signal, slot, socket,
  onToolLoopCheckpoint, core, runBranch, emitStatus, userRequest,
  rt, resumeMode = false, defaultBranchMode = null,
  // workspaceAnchorNode: the node whose content-workspace (the
  // filesystem directory that holds files) is the root for file I/O
  // during this swarm run. Distinct from rootProjectNode, which is
  // the PLAN ANCHOR (where metadata.plan and the signal inbox live).
  // They converge at top-level project runs (anchor === rootProject)
  // but diverge for sub-plans (plan anchor = sub-plan scope; workspace
  // anchor = outer project whose workspaceRoot dir holds files) and
  // for cross-cutting plans at LCAs (Pass 2+). Callers that don't
  // specify it inherit resolveWorkspaceRoot(rootProjectNode._id) —
  // walk-up from the plan anchor to the nearest ancestor with a
  // workspace. Pass explicitly when plan anchor and workspace anchor
  // must differ (e.g. Pass 4+ user-context-driven anchors).
  workspaceAnchorNode = null,
}) {
  if (!Array.isArray(branches) || branches.length === 0) {
    return { success: true, summary: "No branches to run." };
  }
  if (!rootProjectNode) {
    throw new Error("runBranchSwarm requires rootProjectNode");
  }

  log.info("Swarm",
    `🌿 ${resumeMode ? "Resuming" : "Dispatching"} ${branches.length} branches under ${rootProjectNode.name || rootProjectNode._id}`,
  );

  // Announce the fanout to live consumers (CLI, web) so they can render
  // the fork UI before individual branches start firing. Labels let the
  // renderer show the list up front: `⎇ swarm: 3 branches [backend,
  // frontend, tests]`. Emission is safe when socket is absent.
  socket?.emit?.(WS.SWARM_DISPATCH, {
    resume: !!resumeMode,
    count: branches.length,
    branches: branches.map((b) => ({
      name: b.name,
      parentBranch: b.parentBranch || null,
      path: b.path || null,
      mode: b.mode || null,
    })),
    projectNodeId: String(rootProjectNode._id),
  });

  // Tree-authoritative reconciliation. User edits to the tree (inserted
  // branches, renamed, deleted, rewrote specs) get absorbed into subPlan
  // before we read it. The tree is ground truth; subPlan is a cache.
  await reconcileProject({ projectNodeId: rootProjectNode._id, core });

  // Path B: plans live on plan-type child nodes of the scope they
  // coordinate. Resolve the root plan once (find-or-create) and cache
  // it; every downstream write for this swarm run uses the cached id.
  // Nested scopes (sub-plans created by nested [[BRANCHES]] emissions)
  // populate the cache lazily via planAtScope().
  const p = await plan();
  const planAtScopeCache = new Map(); // scopeId → planNodeId
  const planAtScope = async (scopeId) => {
    if (!scopeId) return null;
    const key = String(scopeId);
    if (planAtScopeCache.has(key)) return planAtScopeCache.get(key);
    const planNode = await p.ensurePlanAtScope(
      scopeId,
      { userId, systemSpec: userRequest },
      core,
    );
    const planNodeId = planNode ? String(planNode._id) : null;
    if (planNodeId) planAtScopeCache.set(key, planNodeId);
    return planNodeId;
  };

  const rootPlanNodeId = await planAtScope(rootProjectNode._id);

  // Stamp the plan's dispatch event on its ledger. Symmetric with the
  // sub-plan-dispatched / sub-plan-completed / sub-plan-archived
  // entries stamped by dispatchApprovedSubPlan — plans at ANY scope
  // log their lifecycle uniformly so Pass 3's reputation aggregation
  // sees root plans and sub-plans with the same data shape. A stamp
  // fires on every dispatch (initial AND resume) so the ledger shows
  // full session history.
  try {
    if (rootPlanNodeId && p.appendLedger) {
      await p.appendLedger(rootPlanNodeId, {
        event: resumeMode ? "plan-resumed" : "plan-dispatched",
        detail: {
          scopeNodeId: String(rootProjectNode._id),
          scopeName: rootProjectNode.name || null,
          branchCount: branches.length,
          branchNames: branches.map((b) => b.name),
          resume: !!resumeMode,
        },
      }, core);
    }
  } catch (ledgerErr) {
    log.debug("Swarm", `plan-dispatched ledger skipped: ${ledgerErr.message}`);
  }

  if (!resumeMode) {
    // Initialize swarm-mechanism bookkeeping at the scope (signal inbox,
    // aggregatedDetail, events, systemSpec, createdAt). The scope's role
    // is governing's responsibility (Ruler) and was already promoted by
    // runRulerCycle before swarm.runBranchSwarm was called. Plan steps
    // live on rootPlanNodeId, not on the scope node.
    await ensureScopeBookkeeping({
      nodeId: rootProjectNode._id,
      systemSpec: userRequest,
      core,
    });
    await p.initPlan(rootPlanNodeId, { systemSpec: userRequest }, core);

    for (const b of branches) {
      await dualWriteBranchStep(
        rootPlanNodeId,
        {
          name: b.name,
          spec: b.spec,
          path: b.path || null,
          files: b.files || [],
          slot: b.slot || null,
          mode: b.mode || null,
          status: "pending",
        },
        core,
      );
      await recordBranchEvent({ visitorId, branchName: b.name, from: null, to: "pending", reason: "queued" });
    }
  }

  const results = [];
  let fallbackChainIdx = 1;

  const beginBranchHeader = async ({ input, branchNodeId, modeKey }) => {
    // Dispatch marker's parent is the architect chat (the LLM call that
    // emitted [[BRANCHES]]). This makes the node-chats tree render
    // architect → [dispatch marker backend → worker turns, dispatch
    // marker frontend → worker turns, ...] instead of a flat sibling
    // list.
    const markerParent = architectChatId || rootChatId || null;
    if (rt && !rt._cleaned) {
      return rt.beginChainStep(modeKey, input, {
        treeContext: branchNodeId ? { targetNodeId: branchNodeId } : undefined,
        parentChatId: markerParent,
        dispatchOrigin: "branch-swarm",
      });
    }
    const chat = await startChainStep({
      userId, sessionId,
      chainIndex: fallbackChainIdx++,
      rootChatId: rootChatId || null,
      parentChatId: markerParent,
      modeKey,
      source: "swarm-branch",
      dispatchOrigin: "branch-swarm",
      input,
      treeContext: branchNodeId ? { targetNodeId: branchNodeId } : undefined,
    });
    if (!chat) return null;
    return { chatId: chat._id, chainIndex: chat.chainIndex };
  };

  const finishBranchHeader = async (step, { output, stopped = false, modeKey }) => {
    if (!step?.chatId) return;
    if (rt && !rt._cleaned) {
      await rt.finishChainStep(step.chatId, { output, stopped, modeKey });
    } else {
      await finalizeChat({ chatId: step.chatId, content: output, stopped, modeKey }).catch(() => {});
    }
  };

  const queue = branches.map((b) => ({
    ...b,
    parentBranch: b.parentBranch ?? null,
    depth: b.depth ?? 0,
  }));
  let processed = 0;
  const MAX_BRANCHES = 60;
  // Recursive sub-Ruler dispatch is the normal pattern (see project_
  // recursive_sub_ruler_dispatch memory). Depth cap is paranoia only.
  // 32 matches plan/walkUp's guard. Surface real performance / context
  // concerns if they appear under deeper trees.
  const MAX_DEPTH = 32;

  // Foreman halt-marker cache. The Foreman writes pendingCancel /
  // pendingPauseAt / status=cancelled|paused on the active execution-
  // record; this loop reads them between branches to decide whether
  // to halt the queue. A 500ms cache means we don't hammer the
  // metadata read when the loop iterates fast (small leaf branches),
  // but we still pick up halt-markers within half a second of when
  // they're written.
  //
  // User-experienced latency window: from "user types stop" to "queue
  // actually halts" is approximately 1-2 seconds in the worst case.
  // Decomposition: ~0-500ms cache wait + the LLM abort itself (~0.5-1s
  // until the in-flight model call returns AbortError) + Foreman turn
  // shutdown (negligible). The cache is the smallest of these; tighten
  // to 100ms only if profiling shows the cache window dominates.
  // Tightening below ~100ms risks a tight inner loop pinning Mongo.
  const HALT_CACHE_TTL_MS = 500;
  let cachedHaltCheck = null;
  let cachedHaltCheckAt = 0;
  async function readHaltMarkers() {
    const now = Date.now();
    if (cachedHaltCheck && (now - cachedHaltCheckAt) < HALT_CACHE_TTL_MS) {
      return cachedHaltCheck;
    }
    try {
      const { getExtension } = await import("../loader.js");
      const governing = getExtension("governing")?.exports;
      if (!governing?.readActiveExecutionRecord) {
        cachedHaltCheck = { status: null, pendingCancel: null, pendingPauseAt: null };
        cachedHaltCheckAt = now;
        return cachedHaltCheck;
      }
      const record = await governing.readActiveExecutionRecord(rootProjectNode._id);
      cachedHaltCheck = {
        status: record?.status || null,
        pendingCancel: record?.pendingCancel || null,
        pendingPauseAt: typeof record?.pendingPauseAt === "number" ? record.pendingPauseAt : null,
      };
      cachedHaltCheckAt = now;
      return cachedHaltCheck;
    } catch (err) {
      log.debug("Swarm", `halt-marker read skipped: ${err.message}`);
      return { status: null, pendingCancel: null, pendingPauseAt: null };
    }
  }
  // Helper: write the abort-style metadata on the queued branches
  // when we halt. Mirrors the signal.aborted block below — same
  // bookkeeping, different reason text.
  async function markQueuedAsHalted(haltReason) {
    for (const q of queue) {
      const treeScope = await resolveBranchParentId({
        rootProjectId: rootProjectNode._id,
        parentBranchName: q.parentBranch,
        hint: q.parentNodeId,
      });
      const planIdForScope = await planAtScope(treeScope);
      await dualWriteBranchStep(
        planIdForScope,
        {
          name: q.name,
          status: "pending",
          pausedAt: new Date().toISOString(),
          abortReason: haltReason,
        },
        core,
      );
      await recordBranchEvent({
        visitorId, branchName: q.name,
        from: "pending", to: "pending",
        reason: haltReason,
      });
    }
  }

  while (queue.length > 0 && processed < MAX_BRANCHES) {
    if (signal?.aborted) {
      log.warn("Swarm",
        `🛑 Aborted after ${processed} branches (${queue.length} still queued). Queued branches stay "pending"; next message at this project can resume them.`,
      );
      await markQueuedAsHalted("parent session aborted");
      break;
    }

    // Foreman halt-marker check. cancel-subtree / pause-frame write
    // markers on the execution-record; this check halts the queue
    // when any halt-condition is set. The Foreman's writes already
    // froze descendant records and (for cancel) aborted in-flight
    // controllers via abortRegistry; this loop's job is to stop
    // dispatching MORE work.
    const halt = await readHaltMarkers();
    if (halt.status === "cancelled" || halt.pendingCancel) {
      log.warn("Swarm",
        `🛑 Cancelled by Foreman after ${processed} branches (${queue.length} queued). ` +
        `Queued branches marked cancelled.`);
      // Cancelled queued branches go to status=cancelled, not pending —
      // they're not resumable.
      for (const q of queue) {
        const treeScope = await resolveBranchParentId({
          rootProjectId: rootProjectNode._id,
          parentBranchName: q.parentBranch,
          hint: q.parentNodeId,
        });
        const planIdForScope = await planAtScope(treeScope);
        await dualWriteBranchStep(
          planIdForScope,
          {
            name: q.name,
            status: "cancelled",
            finishedAt: new Date().toISOString(),
            abortReason: halt.pendingCancel?.reason || "cancel-subtree",
          },
          core,
        );
        await recordBranchEvent({
          visitorId, branchName: q.name,
          from: "pending", to: "cancelled",
          reason: halt.pendingCancel?.reason || "cancel-subtree",
        });
      }
      break;
    }
    if (halt.status === "paused") {
      log.warn("Swarm",
        `⏸ Paused by Foreman after ${processed} branches (${queue.length} queued). ` +
        `Queued branches stay pending; resume re-dispatches them.`);
      await markQueuedAsHalted("foreman paused execution");
      break;
    }
    // Deferred-pause: pause when the queue is about to dispatch the
    // step indicated by pendingPauseAt. processed+1 is the upcoming
    // (1-based) branch index in the queue's view; comparing to the
    // step boundary is approximate (step indices come from plan
    // emission, branch indices from queue order — they aren't always
    // 1:1 in nested cases). For Phase C we treat them as aligned
    // when the step matches the upcoming branch's parent-step; if
    // the alignment misses, the next iteration's halt check still
    // fires once the Foreman flips status to paused.
    if (halt.pendingPauseAt && halt.pendingPauseAt === processed + 1) {
      log.warn("Swarm",
        `⏸ Deferred-pause boundary reached (step ${halt.pendingPauseAt}); ` +
        `flipping execution-record to paused and halting.`);
      try {
        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;
        if (governing?.readActiveExecutionRecord && governing?.freezeExecutionRecord) {
          const record = await governing.readActiveExecutionRecord(rootProjectNode._id);
          if (record?._recordNodeId) {
            await governing.freezeExecutionRecord({
              recordNodeId: record._recordNodeId,
              nextStatus: "paused",
            });
          }
        }
      } catch (err) {
        log.debug("Swarm", `deferred-pause freeze skipped: ${err.message}`);
      }
      await markQueuedAsHalted("foreman deferred-pause boundary");
      break;
    }

    const branch = queue.shift();
    processed++;
    const totalKnown = processed + queue.length;
    const depthPrefix = branch.parentBranch ? `${branch.parentBranch}/` : "";
    const qualifiedName = depthPrefix + branch.name;

    emitStatus?.(socket, "intent", `Branch ${processed}/${totalKnown}: ${qualifiedName}`);
    socket?.emit?.(WS.BRANCH_STARTED, {
      name: qualifiedName,
      rawName: branch.name,
      parentBranch: branch.parentBranch || null,
      index: processed,
      total: totalKnown,
      mode: branch.mode || null,
      path: branch.path || null,
    });

    let branchNode;
    try {
      const parentId = await resolveBranchParentId({
        rootProjectId: rootProjectNode._id,
        parentBranchName: branch.parentBranch,
        hint: branch.parentNodeId,
      });
      branchNode = await ensureBranchNode({ rootProjectId: parentId, branch, userId, core });
    } catch (err) {
      log.error("Swarm", `Failed to create branch "${qualifiedName}": ${err.message}`);
      results.push({ name: qualifiedName, status: "error", error: err.message, parentBranch: branch.parentBranch });
      continue;
    }

    const branchMode = await resolveBranchMode({
      branch, defaultBranchMode, branchNodeId: branchNode._id,
    });
    if (!branchMode) {
      const err = `No branch mode resolvable for "${qualifiedName}". Declare mode: in the [[BRANCHES]] block, pass defaultBranchMode, or position the project under an extension with a -plan mode.`;
      log.error("Swarm", err);
      results.push({ name: qualifiedName, status: "error", error: err, parentBranch: branch.parentBranch });
      continue;
    }

    const treeScopeId = await resolveBranchParentId({
      rootProjectId: rootProjectNode._id,
      parentBranchName: branch.parentBranch,
      hint: branch.parentNodeId,
    });
    // Path B: resolve the plan-type child of the scope. Branch steps
    // are written to the plan node, not to the scope node itself.
    const planNodeForStep = await planAtScope(treeScopeId);

    await dualWriteBranchStep(
      planNodeForStep,
      {
        name: branch.name,
        nodeId: String(branchNode._id),
        spec: branch.spec,
        path: branch.path || null,
        files: branch.files || [],
        slot: branch.slot || null,
        mode: branchMode,
        status: "running",
        startedAt: new Date().toISOString(),
      },
      core,
    );
    await recordBranchEvent({ visitorId, branchName: branch.name, from: "pending", to: "running" });

    await fireHook(core, "swarm:beforeBranchRun", {
      branchNode, rootProjectNode, branch, branchMode,
    });

    const branchInput = `[${branch.parentBranch ? "sub-branch" : "branch"} ${processed}/${totalKnown}] ${qualifiedName}: ${branch.spec}`;
    const branchHeaderStep = await beginBranchHeader({
      input: branchInput, branchNodeId: branchNode?._id, modeKey: branchMode,
    });

    let branchResult;
    try {
      const branchMessage =
        `You are building ONE branch of a larger project.\n\n` +
        `Branch name: ${qualifiedName}\n` +
        `${branch.parentBranch ? `Parent branch: ${branch.parentBranch}\n` : ""}` +
        `Path: ${branch.path || "(project root)"}\n` +
        `Files expected: ${(branch.files || []).join(", ") || "(infer from spec)"}\n\n` +
        `Spec:\n${branch.spec}\n\n` +
        `Focus only on this branch. Do the work it needs. Do not touch ` +
        `other branches. Emit [[DONE]] when this branch is complete.` +
        `\n\nIf YOUR branch itself splits naturally into sub-components, ` +
        `you may emit a nested [[BRANCHES]]...[[/BRANCHES]] block instead ` +
        `of building directly. Each sub-branch becomes a child node and ` +
        `runs as its own session. ${branch.depth >= MAX_DEPTH - 1 ? "NOTE: near max recursion depth — do NOT spawn further sub-branches." : ""}`;

      const branchAbort = new AbortController();
      let parentAbortListener = null;
      if (signal) {
        if (signal.aborted) {
          branchAbort.abort();
        } else {
          parentAbortListener = () => branchAbort.abort();
          signal.addEventListener("abort", parentAbortListener, { once: true });
        }
      }
      // Register the controller so cancel-subtree can abort in-flight
      // LLM calls under this scope. Deregistration happens in the
      // finally-block.
      let deregisterBranchAbort = () => {};
      try {
        const { registerController } = await import("../tree-orchestrator/abortRegistry.js");
        deregisterBranchAbort = registerController({
          visitorId,
          // Scope is the branch's RULER scope (the branch node itself,
          // since each branch is promoted to Ruler at dispatch time).
          // cancel-subtree from a higher scope walks down and includes
          // this id in its abort set; signal abort propagates here.
          scopeNodeId: branchNode._id,
          branchName: branch.name,
          controller: branchAbort,
        });
      } catch (regErr) {
        log.debug("Swarm", `abortRegistry register skipped: ${regErr.message}`);
      }
      try {
        branchResult = await runBranch({
          mode: branchMode,
          message: branchMessage,
          branchNodeId: branchNode._id,
          slot: branch.slot || slot,
          visitorId, username, userId, rootId,
          signal: branchAbort.signal,
          onToolLoopCheckpoint, socket,
          // Dispatch-marker chatId → worker-turn parent. Nests every
          // continuation of this branch under its own marker card so
          // the chats UI renders the dispatch tree correctly.
          markerChatId: branchHeaderStep?.chatId || null,
        });
      } finally {
        if (parentAbortListener && signal) {
          try { signal.removeEventListener("abort", parentAbortListener); } catch {}
        }
        try { deregisterBranchAbort(); } catch {}
      }

      // Mark done provisionally. Hook subscribers can flip it to failed
      // by appending signals + mutating the result.
      await setBranchStatus({ branchNodeId: branchNode._id, status: "done", summary: branchResult?.answer || null, core });
      const resultEntry = {
        name: qualifiedName,
        rawName: branch.name,
        parentBranch: branch.parentBranch,
        status: "done",
        answer: branchResult?.answer || "",
      };
      results.push(resultEntry);
      await dualWriteBranchStep(
        planNodeForStep,
        {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: "done",
          summary: truncate(branchResult?.answer || "", 300),
          finishedAt: new Date().toISOString(),
        },
        core,
      );
      // Record budget consumption for the completed dispatch. Uses
      // turnsUsed from runSteppedMode when available; otherwise
      // attributes a minimum of 1 turn (every branch consumed at
      // least one LLM turn to emit its terminal marker). Symmetric
      // for root and sub plans — they both dispatch through this
      // code path — so Pass 3's reputation read sees uniform data.
      // Phase E: dispatch-side budget tracking removed (relied on
      // metadata.plan.steps[]). Pass 3 reputation land on
      // execution-record stepStatuses when that work resumes.
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "running", to: "done" });

      // Fire per-branch hook. Handlers (e.g., code-workspace) run
      // their own validators (syntax sweep, smoke, dead-receiver
      // scan). If a handler finds a problem, it can mutate
      // resultEntry.status = "failed" and/or append signals. Swarm
      // checks the status after.
      const branchCompletePayload = {
        branchNode, rootProjectNode, workspaceAnchorNode, branch,
        result: resultEntry,
        branchMode,
      };
      await fireHook(core, "swarm:afterBranchComplete", branchCompletePayload);
      // Declarative validators (Pass 1 strengthening). Run AFTER the
      // kernel hooks so existing hook-based validators keep their
      // current effective order, and the new registry is purely
      // additive. New validators (notably Pass 2's court system) opt
      // in via swarm.registerValidator and get explicit phase + order
      // semantics. See state/validators.js.
      try {
        const { runValidators } = await import("../governing/state/validators.js");
        await runValidators("branch-complete", branchCompletePayload);
      } catch (vErr) {
        log.debug("Swarm", `branch-complete validators skipped: ${vErr.message}`);
      }

      if (resultEntry.status !== "done") {
        // Handler flipped it. Reflect in metadata + subPlan + event log.
        await setBranchStatus({
          branchNodeId: branchNode._id,
          status: resultEntry.status,
          error: resultEntry.error || null,
          summary: null, core,
        });
        await dualWriteBranchStep(
          planNodeForStep,
          {
            name: branch.name,
            nodeId: String(branchNode._id),
            status: resultEntry.status,
            error: resultEntry.error || null,
            finishedAt: new Date().toISOString(),
          },
          core,
        );
        await recordBranchEvent({
          visitorId, branchName: branch.name,
          from: "done", to: resultEntry.status,
          reason: resultEntry.error || "handler override",
        });
        continue;
      }

      // Nested-branch decomposition is handled by recursive sub-Ruler
      // dispatch, not by a swarm-level sub-plan + user-approval layer.
      // When this branch's runRulerCycle ran, the sub-Ruler at
      // branchNode promoted itself, ran its own Planner (which emitted
      // a structured plan), ran its own Contractor if compound, and —
      // if compound — recursively dispatched its own sub-branches via
      // the same runBranchSwarm path that brought us here. The whole
      // sub-plan + SUB_PLAN_PROPOSED + dispatchApprovedSubPlan flow
      // from the pre-Phase-A architecture is gone: re-invocation of
      // the Planner at an existing Ruler scope handles the "missing
      // layer" case the sub-plan flow was originally designed for.
    } catch (err) {
      const parentAborted = signal?.aborted === true;
      const resumableStatus = parentAborted ? "paused" : "failed";
      log.error("Swarm",
        `Branch "${qualifiedName}" ${parentAborted ? "paused (aborted)" : "failed"}: ${err.message}`,
      );
      await setBranchStatus({ branchNodeId: branchNode._id, status: resumableStatus, error: err.message, core });
      await dualWriteBranchStep(
        planNodeForStep,
        {
          name: branch.name,
          nodeId: String(branchNode._id),
          status: resumableStatus,
          error: err.message,
          finishedAt: new Date().toISOString(),
          ...(parentAborted ? { pausedAt: new Date().toISOString(), abortReason: err.message } : {}),
        },
        core,
      );
      await recordBranchEvent({ visitorId, branchName: branch.name, from: "running", to: resumableStatus, reason: err.message });
      results.push({
        name: qualifiedName,
        rawName: branch.name,
        parentBranch: branch.parentBranch,
        // Mirror the branch node + plan step status. Hardcoding "failed"
        // here caused retryFailedBranches to pick up paused branches as
        // failed and re-dispatch them, which then overwrote the
        // "paused" status with a terminal "failed" via the retry catch.
        status: resumableStatus,
        error: err.message,
      });
    }

    if (branchHeaderStep) {
      const done = results[results.length - 1];
      const headerOutput =
        done.status === "done"
          ? `✓ ${qualifiedName}: ${truncate(done.answer || "done", 200)}`
          : `✗ ${qualifiedName}: ${done.error || "failed"}`;
      await finishBranchHeader(branchHeaderStep, {
        output: headerOutput,
        stopped: done.status !== "done",
        modeKey: branchMode,
      });
    }
    const lastResult = results[results.length - 1];
    socket?.emit?.(WS.BRANCH_COMPLETED, {
      name: qualifiedName,
      rawName: branch.name,
      parentBranch: branch.parentBranch || null,
      index: processed,
      total: totalKnown,
      status: lastResult?.status || "unknown",
      error: lastResult?.error || null,
    });
  }

  if (queue.length > 0 && !signal?.aborted && processed >= MAX_BRANCHES) {
    log.warn("Swarm",
      `${queue.length} branches remained queued after MAX_BRANCHES (${MAX_BRANCHES}) cap hit`,
    );
  }

  // First retry pass over anything that failed in the per-branch phase
  if (!signal?.aborted) {
    await retryFailedBranches({
      results, branches, runBranch, rootProjectNode,
      sessionId, userId, username, visitorId, rootId,
      signal, slot, socket, onToolLoopCheckpoint, rootChatId,
      core, emitStatus, rt, defaultBranchMode,
    });
  }

  if (rootChatId && sessionId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  // Promote any branch whose children are all done
  try {
    await promoteDoneAncestors({ projectNodeId: rootProjectNode._id, core });
  } catch (err) {
    log.debug("Swarm", `promoteDoneAncestors skipped: ${err.message}`);
  }

  // Cross-branch hook. Domain extensions run their integration /
  // conformance / seam / behavioral tests here. If any handler flips
  // result statuses to failed, we re-run retry one more time so
  // branches can see the new signals in their next enrichContext.
  if (!signal?.aborted) {
    const statusesBefore = results.map((r) => r.status).join("|");
    const swarmCompletePayload = {
      rootProjectNode, workspaceAnchorNode, results, branches, core, signal,
    };
    await fireHook(core, "swarm:afterAllBranchesComplete", swarmCompletePayload);
    // Declarative validators (Pass 1 strengthening). Same shape as the
    // branch-complete site: run after the kernel hook so existing
    // handlers keep their effective order, and new validators opt in
    // via swarm.registerValidator with explicit phase + order.
    try {
      const { runValidators } = await import("../governing/state/validators.js");
      await runValidators("swarm-complete", swarmCompletePayload);
    } catch (vErr) {
      log.debug("Swarm", `swarm-complete validators skipped: ${vErr.message}`);
    }
    const statusesAfter = results.map((r) => r.status).join("|");

    if (statusesAfter !== statusesBefore) {
      await fireHook(core, "swarm:branchRetryNeeded", {
        rootProjectNode, results, branches,
      });
      log.info("Swarm",
        `🔄 Re-running retry after cross-branch handlers flipped statuses`);
      await retryFailedBranches({
        results, branches, runBranch, rootProjectNode,
        sessionId, userId, username, visitorId, rootId,
        signal, slot, socket, onToolLoopCheckpoint, rootChatId,
        core, emitStatus, rt, defaultBranchMode,
      });
    }
  }

  // Scout phase: extension-provided seam verification. Runs AFTER
  // existing validators have had their shot, so scouts are looking
  // at the "final" state branches produced. Narrated via
  // swarmScoutsDispatched / swarmScoutReport / swarmIssuesRouted /
  // swarmRedeploying / swarmReconciled events. Silent if no
  // swarm:runScouts listener is registered.
  if (!signal?.aborted) {
    try {
      const scoutOutcome = await runScoutLoop({
        rootProjectNode, workspaceAnchorNode,
        results, branches, core, socket, signal,
        runBranch, sessionId, userId, username, visitorId, rootId,
        slot, onToolLoopCheckpoint, rootChatId, rt, defaultBranchMode,
      });
      if (scoutOutcome.cycles > 0) {
        log.info("Swarm",
          `🔍 Scout loop: ${scoutOutcome.cycles} cycle(s), ${scoutOutcome.totalIssues} issue(s), status=${scoutOutcome.status}`);
      }
    } catch (err) {
      log.warn("Swarm", `scout loop error: ${err.message}`);
    }
  }

  const doneCount = results.filter((r) => r.status === "done").length;
  const failCount = results.filter((r) => r.status === "failed" || r.status === "error").length;
  const summaryLines = results.map((r) => {
    const icon = r.status === "done" ? "✓" : "✗";
    return `${icon} ${r.name}${r.answer ? ` — ${truncate(r.answer, 120)}` : r.error ? ` — ${r.error}` : ""}`;
  });

  const summary =
    `Swarm complete: ${doneCount} done, ${failCount} failed, ${results.length} total branches.\n\n` +
    summaryLines.join("\n");

  log.info("Swarm", `🌿 Finished: ${doneCount}/${results.length} branches succeeded`);

  // Stamp plan-completed on the ledger. Symmetric with the sub-plan
  // completion lifecycle — every plan at every scope logs its own
  // start and end events, so Pass 3 reputation sees uniform data.
  try {
    if (rootPlanNodeId && p.appendLedger) {
      const overallStatus = failCount === 0 && results.length > 0
        ? "settled"
        : (doneCount > 0 ? "partial" : "failed");
      await p.appendLedger(rootPlanNodeId, {
        event: "plan-completed",
        detail: {
          scopeNodeId: String(rootProjectNode._id),
          scopeName: rootProjectNode.name || null,
          doneCount,
          failCount,
          total: results.length,
          overallStatus,
        },
      }, core);
    }
  } catch (ledgerErr) {
    log.debug("Swarm", `plan-completed ledger skipped: ${ledgerErr.message}`);
  }

  return { success: failCount === 0, summary, results };
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}
