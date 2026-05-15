// dispatch.js
// Extracted from orchestrator.js — mode dispatch, chain execution, and
// supporting helpers (emitStatus, emitModeResult, resolveLlmProvider).

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import {
  switchMode,
  processMessage,
  getCurrentNodeId,
  setCurrentNodeId,
  getClientForUser,
  resolveRootLlmForMode,
} from "../../seed/llm/conversation.js";
import { setChatContext } from "../../seed/llm/chatTracker.js";
async function swarmExt() {
  const { getExtension } = await import("../loader.js");
  return getExtension("swarm")?.exports || null;
}
import { parsePlan, setPendingPlan } from "./pendingPlan.js";
import {
  pushMemory, formatMemoryContext,
  getActiveRequest, setActiveRequest,
} from "./state.js";
import { runSteppedMode } from "./steppedMode.js";

// Swarm-plan stash. Used to pause dispatch of a multi-branch build
// so the user can review / revise / accept the plan before the swarm
// runs. See land/extensions/swarm/state/pendingSwarmPlan.js.
async function pendingSwarmPlanApi() {
  return import("../swarm/state/pendingSwarmPlan.js");
}
async function swarmWsEvents() {
  const mod = await import("../swarm/wsEvents.js");
  return mod.SWARM_WS_EVENTS;
}

// ─────────────────────────────────────────────────────────────────────────
// EMIT HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit a status event to the frontend. No-op when socket is null — the
 * orchestrator runs legitimately without a socket in background contexts
 * (room-agent delivery, cron-driven chains, batch jobs). Hardening here
 * lets every such caller invoke orchestrateTreeRequest without stubbing.
 */
export function emitStatus(socket, phase, text) {
  if (!socket?.emit) return;
  socket.emit(WS.EXECUTION_STATUS, { phase, text });
}

/**
 * Build the standard progress-callback bundle passed into processMessage /
 * runSteppedMode. Every call site in the tree orchestrator wants the same
 * three things: forward tool results, announce tool calls as they begin,
 * and stream the model's mid-turn reasoning prose. Extracted here so the
 * six+ call sites stay in sync as the event set grows. Returns a frozen
 * object; callers spread it into their ctx.
 *
 * Safe when socket is null — each callback becomes a no-op. Signal check
 * mirrors the old onToolResults guard so an aborted run stops emitting.
 */
export function buildSocketBridge(socket, signal = null, userId = null) {
  // Two emit paths in priority:
  //   1. userId → emitToUser fan-out. Reaches every socket the user
  //      has open right now (browser tabs, CLI, mobile sheet), and
  //      survives the original request's socket closing. This is
  //      what makes the chat panel a live dashboard for the
  //      rulership tree — sub-Ruler events from any depth flow back.
  //   2. socket → direct emit. Fallback when userId is unknown
  //      (older call sites that didn't thread userId). Same shape
  //      as before; events go only to the captured socket.
  //
  // Both paths gated on signal.aborted so a cancelled run stops
  // emitting cleanly.
  let liveEmit = null;
  if (userId) {
    // Lazy-import to avoid bringing seed-ws into module-init order
    // — buildSocketBridge is called per-spawn, the import resolves
    // once and cached.
    let cachedFn = null;
    liveEmit = (event, payload) => {
      if (signal?.aborted) return;
      if (cachedFn) { try { cachedFn(String(userId), event, payload); } catch {} return; }
      import("../../seed/ws/websocket.js").then((m) => {
        cachedFn = m.emitToUser;
        try { cachedFn(String(userId), event, payload); } catch {}
      }).catch(() => {
        // Fall back to direct socket emit if the user-room import
        // fails — preserve the old single-socket behavior rather
        // than dropping the event entirely.
        if (socket?.emit) socket.emit(event, payload);
      });
    };
  } else if (socket?.emit) {
    liveEmit = (event, payload) => {
      if (signal?.aborted) return;
      socket.emit(event, payload);
    };
  }
  if (!liveEmit) {
    return {
      onToolResults: () => {},
      onToolCalled: () => {},
      onThinking: () => {},
    };
  }
  return {
    onToolResults: (results) => {
      for (const r of results) liveEmit(WS.TOOL_RESULT, r);
    },
    onToolCalled: (call) => {
      liveEmit(WS.TOOL_CALLED, call);
    },
    onThinking: (thought) => {
      liveEmit(WS.THINKING, thought);
    },
  };
}

/**
 * Emit an internal mode result to the chat so the user can see what's
 * happening. No-op when socket is null (same rationale as emitStatus).
 */
export function emitModeResult(socket, modeKey, result) {
  if (!socket?.emit) return;
  // Strip internal tracking fields before sending to client
  let sanitized = result;
  if (result && typeof result === "object") {
    const { _llmProvider, _raw, ...rest } = result;
    sanitized = rest;
  }
  socket.emit(WS.ORCHESTRATOR_STEP, {
    modeKey,
    result:
      typeof sanitized === "string"
        ? sanitized
        : JSON.stringify(sanitized, null, 2),
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// BRANCH POSITION PINNING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pin the visitor's current node to a branch and keep it pinned through
 * switchMode. switchMode runs enrichContext synchronously and can take a
 * while; anything that stashes the previous root during that window would
 * otherwise win the race. We set the node, run switchMode, then re-assert.
 *
 * This is load-bearing for branch dispatch: without the re-assert, the AI
 * inside a branch session sometimes writes files at the project root
 * instead of the branch. Anyone kicking off a branch session must go
 * through this helper.
 */
export async function pinBranchPosition(visitorId, branchNodeId, branchMode, {
  username, userId, rootId,
}) {
  const branchIdStr = String(branchNodeId);
  setCurrentNodeId(visitorId, branchIdStr);
  await switchMode(visitorId, branchMode, {
    username, userId, rootId,
    currentNodeId: branchIdStr,
    clearHistory: true,
  });
  setCurrentNodeId(visitorId, branchIdStr);
  log.info("Tree Orchestrator",
    `📌 Branch dispatch position pinned: visitor=${visitorId.slice(0, 32)} branch=${branchIdStr.slice(0, 8)} mode=${branchMode}`,
  );
  return branchIdStr;
}

// ─────────────────────────────────────────────────────────────────────────
// SHARED: RESOLVE LLM PROVIDER
// ─────────────────────────────────────────────────────────────────────────

export async function resolveLlmProvider(userId, rootId, modeKey, slot) {
  try {
    const modeConnectionId = await resolveRootLlmForMode(rootId, modeKey);
    const clientInfo = await getClientForUser(userId, slot, modeConnectionId);
    return {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    return { isCustom: false, model: null, connectionId: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// RECURSIVE RULER CYCLE (Pass 1 cutover)
// ─────────────────────────────────────────────────────────────────────────
//
// At every Ruler scope (root or sub-Ruler), the cycle is:
//   1. Planner (tree:governing-planner) drafts plan + maybe [[BRANCHES]].
//   2. If the structured plan emission has branch steps, Contractor
//      (tree:governing-contractor) drafts contracts shaped around the
//      approved plan via governing-emit-contracts.
//   3. If no branch steps, the original workspace mode dispatches as
//      Worker to do the leaf work.
//
// Source of truth: the structured plan emission (governing-emit-plan
// tool result). runRulerCycle stashes _structuredBranches and
// _structuredContracts on the planner result; the architect-entry
// path (runModeAndReturn) and the swarm dispatch path read those
// directly. The legacy text parsers were deleted in phase 3.
//
// Recursion: each branch dispatched by swarm runs its own runRulerCycle
// at the sub-Ruler scope, producing its own structured emission. swarm
// reads the sub-Ruler's emission back via governing.readActivePlanEmission
// to detect nested compound work.

/**
 * Run the Ruler cycle at a scope. originalMode is the workspace mode the
 * caller wanted (tree:code-plan, tree:book-plan, etc.); used as the
 * Worker fallback when Planner finds leaf work.
 *
 * Returns the result object whose `answer` / `content` / `_allContent`
 * fields carry the merged emission (Contractor's [[CONTRACTS]] block
 * prepended to the Planner's [[BRANCHES]] when compound).
 */
export async function runRulerCycle({
  visitorId, originalMode, message,
  username, userId, rootId, signal, slot,
  readOnly, onToolLoopCheckpoint, socket,
  sessionId, rootChatId, rt,
  skipRespond,
  currentNodeId,
  parentChatId,
  dispatchOrigin,
}) {
  // Architect-entry call sites omit currentNodeId because they treat
  // "the user's request landed at the project root" as the implicit
  // scope. Fall back to rootId so Ruler promotion and trio bootstrap
  // fire there. Branch-swarm and sub-plan call sites pass an explicit
  // currentNodeId for the sub-Ruler scope; this default doesn't reach
  // them.
  if (!currentNodeId) currentNodeId = rootId || null;

  const baseOpts = {
    username, userId, rootId, signal, slot,
    readOnly, onToolLoopCheckpoint, socket,
    sessionId, rootChatId, rt,
    skipRespond,
    currentNodeId,
    parentChatId,
    dispatchOrigin,
  };

  // Self-promote the scope to Ruler before dispatching the Planner. The
  // scope IS the Ruler at this depth. Idempotent: re-entering an
  // already-promoted scope leaves acceptedAt unchanged. ensureBranchNode
  // promotes branch nodes when they are created; this covers the
  // architect-entry case where the user's scope arrives unpromoted.
  //
  // Then materialize the Plan trio member: every Ruler scope, at every
  // depth, gets a plan-type child node with governing role + Planner
  // mode assignment. Phase 1 of the trio migration — structural shape
  // only. The Contracts trio member is created lazily inside
  // setContracts when (and only when) the Contractor emits a
  // [[CONTRACTS]] block, matching Sam's "(when needed)" semantics.
  let governing = null;
  let planTrioNodeId = null;
  if (currentNodeId) {
    try {
      const { getExtension } = await import("../loader.js");
      governing = getExtension("governing")?.exports || null;
      if (governing?.promoteToRuler) {
        await governing.promoteToRuler({
          nodeId: currentNodeId,
          reason: typeof dispatchOrigin === "string" && dispatchOrigin.includes("branch")
            ? `sub-Ruler declared by parent (origin: ${dispatchOrigin})`
            : `user request entered tree at this scope (origin: ${dispatchOrigin || "architect"})`,
          promotedFrom: typeof dispatchOrigin === "string" && dispatchOrigin.includes("branch")
            ? governing.PROMOTED_FROM?.BRANCH_DISPATCH
            : governing.PROMOTED_FROM?.ROOT,
        });
      }
      if (governing?.ensurePlanAtScope && userId) {
        const planNode = await governing.ensurePlanAtScope({
          scopeNodeId: currentNodeId,
          userId,
          systemSpec: typeof message === "string" ? message.slice(0, 500) : null,
          wasAi: false,
          chatId: rootChatId,
          sessionId,
        });
        if (planNode?._id) planTrioNodeId = String(planNode._id);
      }

      // Sub-Ruler lineage. When this Ruler was promoted via branch
      // dispatch (origin "branch-swarm" / "sub-plan" / generic
      // "branch"), capture the upstream chain so courts and re-runs
      // can replay from the parent's plan emission. inferLineageFromParent
      // reconstructs the link by reading the parent's active emission
      // and matching branch entry names; explicit threading from the
      // dispatcher will replace this in phase 2 main once the structured
      // dispatch path lands. Architect-entry calls (root receives user
      // request) skip lineage — there is no parent Ruler.
      const isBranchDispatch = typeof dispatchOrigin === "string" &&
        (dispatchOrigin.includes("branch") || dispatchOrigin === "sub-plan");
      if (isBranchDispatch && governing?.inferLineageFromParent && governing?.writeLineage) {
        try {
          const inferred = await governing.inferLineageFromParent(currentNodeId);
          if (inferred?.parentRulerId) {
            await governing.writeLineage({
              subRulerNodeId: currentNodeId,
              parentRulerId: inferred.parentRulerId,
              parentPlanEmissionId: inferred.parentPlanEmissionId,
              parentStepIndex: inferred.parentStepIndex,
              parentBranchEntryName: inferred.parentBranchEntryName,
              expandingFromSpec: inferred.expandingFromSpec,
            });
            log.info("Tree Orchestrator",
              `🧬 Sub-Ruler lineage stamped at ${String(currentNodeId).slice(0, 8)}: ` +
              `parent=${String(inferred.parentRulerId).slice(0, 8)}` +
              (inferred.parentBranchEntryName ? ` step=${inferred.parentStepIndex}/${inferred.parentBranchEntryName}` : ` (no matching step)`));
          }
        } catch (err) {
          log.debug("Tree Orchestrator", `runRulerCycle lineage stamp skipped: ${err.message}`);
        }
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `runRulerCycle ruler-trio bootstrap skipped: ${err.message}`);
    }
  }

  // Each phase explicitly switches the session's active mode before
  // calling runSteppedMode. processMessage reads the session-stored
  // mode (set by switchMode), not the mode arg passed to runSteppedMode,
  // so without an explicit switch each phase would inherit whatever
  // upstream switchMode set (typically the user's classifier-resolved
  // workspace mode). That bug masked governing-planner's prompt under
  // tree:code-plan's prompt for the entire Ruler cycle.
  const switchOpts = {
    username, userId, rootId,
    currentNodeId: currentNodeId || rootId,
    clearHistory: false,
  };

  // Re-invocation diagnostic. Capture the prior active emission BEFORE
  // the Planner runs, so we can detect whether the Planner emitted a
  // new plan on this cycle. If the Planner failed to call the tool,
  // readActivePlanEmission below would surface the prior emission and
  // we'd silently re-dispatch the same work; the prior-ordinal check
  // catches that.
  let priorEmissionOrdinal = 0;
  let priorEmissionId = null;
  if (governing?.readActivePlanEmission && currentNodeId) {
    try {
      const priorEmission = await governing.readActivePlanEmission(currentNodeId);
      if (priorEmission) {
        priorEmissionOrdinal = priorEmission.ordinal || 0;
        priorEmissionId = priorEmission._emissionNodeId || null;
      }
    } catch {}
  }

  // Phase 1: Planner
  log.info("Tree Orchestrator", `📜 Ruler cycle: Planner phase (originalMode=${originalMode})`);
  await switchMode(visitorId, "tree:governing-planner", switchOpts);
  const plannerResult = await runSteppedMode(
    visitorId, "tree:governing-planner", message, baseOpts);
  let plannerAnswer = plannerResult?._allContent || plannerResult?.answer || "";

  // The Planner emits via governing-emit-plan. The tool persists a
  // plan-emission child node and writes a planApproval entry inline.
  // The Ruler's active plan-emission IS the Planner's binding output;
  // we read it back as the SOLE source for compound vs leaf routing.
  // No legacy text fallback — the tool is the contract.
  let structuredEmission = null;
  if (governing?.readActivePlanEmission && currentNodeId) {
    try {
      structuredEmission = await governing.readActivePlanEmission(currentNodeId);
    } catch (err) {
      log.debug("Tree Orchestrator", `readActivePlanEmission failed: ${err.message}`);
    }
  }

  // Detect whether the Planner produced a new emission on THIS cycle.
  // If the active emission is the same as the prior one, the Planner
  // failed to call the tool — surface as a warning and treat as no
  // emission so we don't re-dispatch stale work.
  const newOrdinal = structuredEmission?.ordinal || 0;
  const newEmissionId = structuredEmission?._emissionNodeId || null;
  const plannerEmittedNewPlan = !!structuredEmission &&
    (newOrdinal > priorEmissionOrdinal ||
     (priorEmissionId && newEmissionId && newEmissionId !== priorEmissionId));

  if (priorEmissionOrdinal > 0 && plannerEmittedNewPlan) {
    log.info("Tree Orchestrator",
      `🔄 Re-invocation: emission-${newOrdinal} supersedes emission-${priorEmissionOrdinal} ` +
      `at ${String(currentNodeId).slice(0, 8)}`);
  } else if (priorEmissionOrdinal > 0 && !plannerEmittedNewPlan) {
    log.warn("Tree Orchestrator",
      `⚠️  Re-invocation: Planner ran at ${String(currentNodeId).slice(0, 8)} but emitted ` +
      `no new plan (still on emission-${priorEmissionOrdinal}). The Planner likely failed ` +
      `to call governing-emit-plan; falling through to leaf work to avoid re-dispatching ` +
      `the prior plan.`);
    structuredEmission = null;
  } else if (!structuredEmission) {
    log.warn("Tree Orchestrator",
      `⚠️  No structured emission at ${String(currentNodeId).slice(0, 8)} after Planner ran. ` +
      `governing-emit-plan was not called; cycle has no plan to dispatch.`);
  }

  const sw = await swarmExt();
  if (!sw) return plannerResult;

  // Compound vs leaf decision. The structured plan emission IS the
  // dispatch source. No [[BRANCHES]] text parsing, no synthesis, no
  // bridge layer.
  let structuredBranchEntries = [];
  if (structuredEmission?.steps?.length) {
    for (const step of structuredEmission.steps) {
      if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
      for (const b of step.branches) {
        if (!b?.name) continue;
        structuredBranchEntries.push({
          name: b.name,
          spec: b.spec || "",
          // Path defaults to name; structured emission folds path into name.
          path: null,
          // Files: structured emission no longer enumerates files at
          // the parent's plan. Sub-Rulers own their file discovery —
          // the architectural shift the trio model makes possible.
          files: [],
          // Slot: kernel slot routing unchanged; per-branch slot
          // pinning is a swarm-era concept the structured shape drops.
          slot: null,
          mode: null,
          parentBranch: null,
        });
      }
    }
  }

  if (structuredBranchEntries.length === 0) {
    // Leaf work. Foreman: create the execution-record FIRST (so the
    // leaf Worker's status writes have a target) then dispatch the
    // workspace mode as Worker. After the Worker returns, mark leaf
    // steps done — the Worker's emission of [[DONE]] is the signal
    // that this scope's leaf work is complete.
    if (governing?.appendExecutionRecord && structuredEmission?._emissionNodeId) {
      try {
        await governing.appendExecutionRecord({
          rulerNodeId: currentNodeId,
          userId,
          core: null,
          planEmissionRef: structuredEmission._emissionNodeId,
          planEmission: structuredEmission,
          contractsEmissionRef: null,
        });
      } catch (err) {
        log.debug("Tree Orchestrator", `runRulerCycle leaf execution-record skipped: ${err.message}`);
      }
    }

    log.info("Tree Orchestrator",
      `🔨 Ruler cycle: Planner found leaf work, dispatching ${originalMode} as Worker`);
    await switchMode(visitorId, originalMode, switchOpts);

    // Flag-queue snapshot around the Worker turn so the classifier
    // can detect a blocking flag emitted by this Worker.
    const flagsBefore = await snapshotFlagQueue(governing, currentNodeId);
    const workerResult = await runSteppedMode(visitorId, originalMode, message, baseOpts);
    const flagsAfter = await snapshotFlagQueue(governing, currentNodeId);

    // Classify what the Worker actually did and write the honest
    // outcome to every still-running leaf in the active record.
    if (currentNodeId) {
      try {
        const outcome = await classifyWorkerOutcome({
          workerResult,
          flagsBefore,
          flagsAfter,
        });
        const marked = await applyLeafOutcomeToRecord({
          governing,
          rulerNodeId: currentNodeId,
          targetIndices: null,
          outcome,
        });
        if (marked > 0) {
          const reasonHint = outcome.reason ? ` (${String(outcome.reason).slice(0, 120)})` : "";
          log.info("Tree Orchestrator",
            `🔧 Leaf cycle: classified ${marked} leaf step(s) at ${String(currentNodeId).slice(0, 8)} as ${outcome.status}${reasonHint}`);
        }
      } catch (err) {
        log.debug("Tree Orchestrator", `leaf-cycle classify skipped: ${err.message}`);
      }
    }

    return workerResult;
  }

  log.info("Tree Orchestrator",
    `📐 Ruler cycle: ${structuredBranchEntries.length} branch entries from emission-${newOrdinal} ` +
    `(${structuredBranchEntries.map((b) => b.name).join(", ")})`);

  // Stash the resolved branches on the planner result so the
  // architect-entry path can reuse them without recomputing. Also stash
  // the FULL structured emission (reasoning + steps + branch rationales)
  // so the PLAN_PROPOSED emit can read from a single source-of-truth that
  // matches the scope where the Planner actually wrote, instead of
  // re-resolving the scope and re-reading downstream.
  plannerResult._structuredEmission = structuredEmission;
  plannerResult._structuredBranches = structuredBranchEntries;
  plannerResult.answer = plannerAnswer;
  plannerResult.content = plannerAnswer;
  if (plannerResult._allContent !== undefined) plannerResult._allContent = plannerAnswer;

  // Approval gate. Top-level user-initiated cycles pause here for the
  // user to approve, modify, or reject the plan. Contractor +
  // execution-record + sub-Ruler dispatch happen AFTER the user
  // accepts, in dispatchSwarmPlan. Sub-Ruler cycles auto-approve and
  // run the full pipeline inline — the parent Ruler's user already
  // approved the parent plan that delegated to this sub-Ruler.
  //
  // dispatchOrigin tells us which case we're in:
  //   undefined / "architect" / "continuation"  → top-level (pause)
  //   "branch-swarm" / "sub-plan"                → sub-Ruler (auto)
  const isTopLevel = !dispatchOrigin
    || dispatchOrigin === "architect"
    || dispatchOrigin === "continuation";

  if (isTopLevel) {
    log.info("Tree Orchestrator",
      `🛑 Top-level Ruler cycle paused for user approval at ` +
      `${String(currentNodeId).slice(0, 8)} — Contractor + dispatch run after Accept`);
    plannerResult._awaitingApproval = true;
    plannerResult._structuredContracts = []; // Contractor not run yet
    return plannerResult;
  }

  // Sub-Ruler path: Contractor + execution-record run inline; swarm
  // dispatches sub-branches in the caller (runBranch closure).
  const branchParse = { branches: structuredBranchEntries, cleaned: plannerAnswer };
  const branchNames = branchParse.branches.map((b) => b.name).join(", ");
  log.info("Tree Orchestrator",
    `📋 Sub-Ruler cycle: ${branchParse.branches.length} sub-domain(s) (${branchNames}); auto-approve, dispatching Contractor`);
  const contractorMessage =
    `The Ruler at this scope approved this plan:\n\n${plannerAnswer}\n\n` +
    `Draft contracts shaped around the approved plan. Identify shared ` +
    `vocabulary (events, storage keys, dom ids, message types, function ` +
    `signatures) the named sub-domains must agree on. Emit one ` +
    `[[CONTRACTS]] block. Validate scope authority against the LCA of ` +
    `named consumers; the dispatcher rejects contracts whose scope ` +
    `exceeds the LCA.`;

  let activeContracts = [];
  try {
    await switchMode(visitorId, "tree:governing-contractor", switchOpts);
    await runSteppedMode(visitorId, "tree:governing-contractor", contractorMessage, baseOpts);
    try {
      if (governing?.readContracts && currentNodeId) {
        activeContracts = await governing.readContracts(currentNodeId);
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Sub-Ruler Contractor active-contracts read skipped: ${err.message}`);
    }
    if (Array.isArray(activeContracts) && activeContracts.length > 0) {
      log.info("Tree Orchestrator",
        `📜 Sub-Ruler cycle: ${activeContracts.length} contract(s) ratified at ${String(currentNodeId).slice(0, 8)}`);
    }
  } catch (err) {
    log.warn("Tree Orchestrator", `Sub-Ruler Contractor dispatch failed: ${err.message}`);
  }

  plannerResult._structuredContracts = activeContracts;

  // Foreman: create execution-record for this sub-Ruler run.
  if (governing?.appendExecutionRecord && structuredEmission?._emissionNodeId) {
    try {
      let contractsEmissionRef = null;
      if (governing.readActiveContractsEmission) {
        const activeEmission = await governing.readActiveContractsEmission(currentNodeId);
        if (activeEmission?._emissionNodeId) {
          contractsEmissionRef = activeEmission._emissionNodeId;
        }
      }
      await governing.appendExecutionRecord({
        rulerNodeId: currentNodeId,
        userId,
        core: null,
        planEmissionRef: structuredEmission._emissionNodeId,
        planEmission: structuredEmission,
        contractsEmissionRef,
      });
    } catch (err) {
      log.debug("Tree Orchestrator", `Sub-Ruler execution-record skipped: ${err.message}`);
    }
  }

  return plannerResult;
}

// ─────────────────────────────────────────────────────────────────────────
// RUN MODE AND RETURN (eliminates copy-pasted switchMode/processMessage)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Switch to a mode, run processMessage, handle memory and status events,
 * return the standard response shape. Every exit path that runs a mode
 * should call this instead of inlining the same 20 lines.
 */
export async function runModeAndReturn(visitorId, mode, message, {
  socket, username, userId, rootId, signal, slot,
  currentNodeId, readOnly = false, clearHistory = false,
  onToolLoopCheckpoint, modesUsed,
  targetNodeId = null,
  sessionId = null, rootChatId = null, rt = null,
  treeCapabilities = null,
  adjectives = null,
  quantifiers = null,
  temporalScope = null,
  fanoutContext = null,
  reroutePrefix = null,
  voice = "active",
  // Place mode — when true, the LLM must stop after tool execution.
  // Prevents wasted cycles generating prose the user will never see.
  skipRespond = false,
}) {
  modesUsed.push(mode);
  emitStatus(socket, "intent", "");

  // Detect Ruler takeover up front so the routing display shows the
  // mode that actually runs, not the classifier's domain pick.
  //
  // Three triggers, in order:
  //   1. A Ruler scope already exists at or above this position →
  //      route through it. The Ruler decides whether the message is
  //      work (hire-planner) or conversational (respond-directly).
  //   2. No Ruler exists yet, but governance should be in charge at
  //      this scope (a workspace is active here, OR governing is
  //      alone-installed in this land). First user message at the
  //      position promotes to Ruler. shouldGovernAtScope checks the
  //      worker-type registry against the scope's ext-allow chain.
  //   3. Neither — the classifier's mode pick runs directly. This
  //      covers home zone, land zone, and tree positions without an
  //      active workspace or governing-alone.
  //
  // Pre-typed-Worker, trigger 2 was approximated by
  // `isWorkspacePlanMode(mode)` — match a `tree:<workspace>-plan`
  // mode key. That broke when workspaces stopped registering -plan
  // modes after the typed-Worker landing. The presence-based check
  // here is correct: governance takes over because the workspace is
  // present, not because the classifier guessed at a mode name.
  let routeThroughRuler = false;
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    const scopeForRuler = currentNodeId || targetNodeId || rootId;
    if (scopeForRuler && governing?.findRulerScope) {
      const existing = await governing.findRulerScope(scopeForRuler);
      if (existing) {
        routeThroughRuler = true;
      } else if (governing?.shouldGovernAtScope) {
        const shouldGovern = await governing.shouldGovernAtScope(scopeForRuler);
        if (shouldGovern) routeThroughRuler = true;
      }
    }
  } catch (err) {
    log.debug("Tree Orchestrator", `Ruler-scope detection failed: ${err.message}`);
  }

  // Surface the actual mode that's running so the UI can show the dispatch
  // hop. The classifier already emits `orchestratorStep` with the intent
  // result, but when grammar/graph routes onward (e.g., food-coach → food-log)
  // or when the Ruler takes over (governing-promoted scope), the client
  // never learns about the destination without this.
  const dispatchMode = routeThroughRuler ? "tree:governing-ruler" : mode;
  emitModeResult(socket, dispatchMode, {
    mode: dispatchMode,
    phase: routeThroughRuler ? "ruler-takeover" : "dispatch",
  });

  // Build conversation memory + grammar modifier injections.
  let memory = formatMemoryContext(visitorId);

  // Reroute prefix injection: when the orchestrator intercepted a correction
  // and substituted the message, tell the AI to open its response with a
  // brief note explaining the reroute. This keeps the chat history readable:
  // the user sees their correction in the history, then the AI's response
  // starts with "↪ Rerouted your previous message to food: ...". Without
  // this, the chat looks like the AI ignored the correction and answered a
  // random question, which is confusing.
  if (reroutePrefix) {
    const rerouteBlock = `[Rerouted] This message was rerouted from another extension. ` +
      `Your response MUST begin with EXACTLY this line on its own, followed by a blank line, ` +
      `then your normal response to the message:\n\n${reroutePrefix}\n\nDo not paraphrase the ` +
      `reroute line. Copy it exactly as shown above.`;
    memory = (memory ? memory + "\n\n" : "") + rerouteBlock;
  }

  // Temporal scope injection: constrains the data window the AI operates on.
  // Time is not tense. Tense = intent. Time = which data to look at.
  if (temporalScope) {
    let timeDesc;
    if (temporalScope.type === "range") timeDesc = `from ${temporalScope.from} to ${temporalScope.to}`;
    else if (temporalScope.type === "since") timeDesc = `since ${temporalScope.from}`;
    else if (temporalScope.type === "duration") timeDesc = `${temporalScope.raw}`;
    else timeDesc = temporalScope.raw;
    const timeBlock = `[Time Scope] The user is asking about a specific time window: ${timeDesc}. ` +
      `Constrain your data queries and analysis to this period. Do not include data outside this window unless comparing.`;
    memory = (memory ? memory + "\n\n" : "") + timeBlock;
  }

  // Voice injection: passive voice means the user is observing, not commanding.
  // The AI should acknowledge, reflect, and suggest rather than execute.
  if (voice === "passive") {
    const voiceBlock = `[Voice: passive] The user is describing something that happened or a state they noticed. ` +
      `Observe and acknowledge. Reflect on what it means. Suggest next steps if relevant. ` +
      `Do not treat this as a command to log or execute.`;
    memory = (memory ? memory + "\n\n" : "") + voiceBlock;
  }

  // Fanout injection: pre-resolved set data replaces generic selection annotation.
  // When FANOUT executed, items are already resolved with real enriched context.
  // When no fanout, fall back to annotation telling the AI to query the set itself.
  if (fanoutContext) {
    memory = (memory ? memory + "\n\n" : "") + fanoutContext;
  } else if (quantifiers && quantifiers.length > 0) {
    const qDescs = quantifiers.map(q => {
      if (q.type === "numeric") return `${q.direction} ${q.count}`;
      if (q.type === "temporal") return `${q.direction} ${q.unit}`;
      if (q.type === "superlative") return `${q.qualifier} ${q.subject}`;
      if (q.type === "comparative") return "compare/contrast";
      if (q.type === "universal") return "all/every";
      return q.type;
    });
    const qBlock = `[Selection] The user is asking about a SET, not a single item: ${qDescs.join(", ")}. Query and aggregate across multiple entries. Do not respond about just the current/latest value.`;
    memory = (memory ? memory + "\n\n" : "") + qBlock;
  }

  // Adjective injection: focus constraints from the parsed message.
  if (adjectives && adjectives.length > 0) {
    const focusLines = adjectives.map(a => {
      const subject = a.subject ? ` ${a.subject}` : "";
      return `${a.qualifier}${subject}`;
    });
    const focusBlock = `[Focus] The user's message emphasizes: ${focusLines.join(", ")}. Prioritize this in your response.`;
    memory = (memory ? memory + "\n\n" : "") + focusBlock;
  }

  try {
    const { getModeOwner } = await import("../../seed/tree/extensionScope.js");
    const extOwner = getModeOwner(mode);
    // Only inject boundary for extension-owned modes (not kernel modes like tree:converse)
    if (extOwner && !mode.startsWith("tree:converse") && !mode.startsWith("tree:fallback")) {
      const { getIndexForRoot } = await import("./routingIndex.js");
      const index = rootId ? getIndexForRoot(rootId) : null;
      const otherDomains = [];
      if (index) {
        for (const [ext, entry] of index) {
          if (ext !== extOwner) otherDomains.push(`${ext} (${entry.path})`);
        }
      }
      const boundary = `[Boundary] You are the ${extOwner} extension. You ONLY handle ${extOwner}. ` +
        `Do not offer to set up, manage, or advise on other domains. ` +
        `You have only ${extOwner}-specific tools.` +
        (otherDomains.length > 0
          ? ` Other domains in this tree: ${otherDomains.join(", ")}. ` +
            `For those, tell the user to navigate there or talk about it at the tree root.`
          : "");
      memory = (memory ? memory + "\n\n" : "") + boundary;
    }
  } catch {}

  await switchMode(visitorId, mode, {
    username, userId, rootId,
    currentNodeId: currentNodeId || targetNodeId,
    conversationMemory: memory,
    clearHistory,
    treeCapabilities,
  });

  // Routing: every user turn at a Ruler scope goes through the Ruler
  // first. The Ruler reads its domain state and decides what to do
  // (hire Planner, route to Foreman, respond directly, revise plan,
  // archive, pause, resume, convene court). Outside Ruler scopes
  // (home zone, land zone, unpromoted tree positions), fall back to
  // direct mode dispatch.
  //
  // Detection happens up front (before emitModeResult) so the routing
  // display surfaces tree:governing-ruler instead of the classifier's
  // domain mode when a Ruler is taking over.
  let result;
  if (routeThroughRuler) {
    const { runRulerTurn } = await import("./ruling.js");
    result = await runRulerTurn({
      visitorId, message,
      username, userId, rootId,
      currentNodeId: currentNodeId || targetNodeId || rootId,
      signal, slot, socket,
      sessionId, rootChatId, rt,
      readOnly, onToolLoopCheckpoint,
      dispatchOrigin: "ruler-turn",
    });
  } else {
    result = await runSteppedMode(visitorId, mode, message, {
      username, userId, rootId, signal, slot,
      readOnly, onToolLoopCheckpoint, socket,
      sessionId, rootChatId, rt,
      skipRespond,
    });
  }

  emitStatus(socket, "done", "");
  let answer = result?._allContent || result?.content || result?.answer || null;

  // Branch swarm detection. The Planner may emit via the
  // governing-emit-plan tool and write no prose — in that case `answer`
  // is empty but `result._structuredBranches` carries the dispatch list.
  // Process the swarm flow whenever there's either prose to read OR a
  // structured emission to dispatch.
  const hasStructuredBranches = Array.isArray(result?._structuredBranches)
    && result._structuredBranches.length > 0;
  if (answer || hasStructuredBranches) {
    const sw = await swarmExt();
    if (!sw) {
      // swarm extension absent: leave the answer unchanged, skip dispatch.
      // A mode emitting [[BRANCHES]] has nothing to dispatch to without swarm.
    } else {
    // The structured emission stashed by runRulerCycle is the source
    // of truth. _structuredBranches comes from the Planner's
    // governing-emit-plan call; _structuredContracts comes from the
    // Contractor's governing-emit-contracts call. Both already
    // persisted on their respective trio nodes. There is no longer
    // a text-parse fallback — phase 3 removed it.
    const structuredBranchesFromResult = Array.isArray(result?._structuredBranches)
      ? result._structuredBranches : [];
    const structuredContractsFromResult = Array.isArray(result?._structuredContracts)
      ? result._structuredContracts : [];

    if (structuredContractsFromResult.length > 0) {
      log.info("Tree Orchestrator",
        `📜 Ruler ratified ${structuredContractsFromResult.length} contract(s) from Contractor emission ` +
        `(${structuredContractsFromResult.map((c) => `${c.kind} ${c.name}`).join(", ")})`);
    }

    const branchParse = { branches: structuredBranchesFromResult, cleaned: answer };
    // architect-entry is the post-mode block that runs after either
    // runRulerTurn or runSteppedMode returns. It checks whether the
    // mode produced structured branches/contracts the swarm should
    // dispatch. When 0/0, this is no-op chatter — the runRulerTurn
    // path (Ruler + tools) handles dispatch itself. The log fires
    // either way so the runtime is traceable; only an emit happens
    // when there's actual structure to forward.
    log.info("Tree Orchestrator",
      `🔍 runModeAndReturn architect-entry: result has _structuredBranches=${structuredBranchesFromResult.length}, ` +
      `_structuredContracts=${structuredContractsFromResult.length}, ` +
      `_awaitingApproval=${result?._awaitingApproval}, mode=${mode}`);
    if (branchParse.branches.length > 0) {
      log.info("Tree Orchestrator",
        `🌿 Ruler accepted ${branchParse.branches.length} branch step(s) from Planner emission ` +
        `(${branchParse.branches.map((b) => b.name).join(", ")})`);
    }
    const parsedContracts = structuredContractsFromResult;
    if (branchParse.branches.length > 0) {
      answer = branchParse.cleaned;
      if (result) {
        result.content = branchParse.cleaned;
        result.answer = branchParse.cleaned;
      }
      log.info("Tree Orchestrator",
        `🌿 Detected ${branchParse.branches.length} branches from ${mode}: ${branchParse.branches.map((b) => b.name).join(", ")}`,
      );

      try {
        const searchNodeId = currentNodeId || targetNodeId || rootId;
        // Find the swarm project anchored at or above this position. If
        // none exists, promote the AI's CURRENT POSITION (not the tree
        // root) so the project lives where the user actually started
        // it. The tree root is the user's parent-of-everything anchor;
        // promoting it would put every branch under the wrong node and
        // pollute the user's whole tree with code-workspace metadata.
        // Falls back to rootId only when there is no current position
        // context (e.g. headless API calls).
        // Resolve the dispatch scope. With recursive sub-Ruler dispatch,
        // the scope IS the user's current position; runRulerCycle has
        // already promoted it via governing.promoteToRuler. We walk up
        // first to find an enclosing Ruler (resume / sub-scope cases);
        // if none exists, the user's position becomes the new Ruler.
        const NodeModel = (await import("../../seed/models/node.js")).default;
        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;
        let projectNode = null;
        if (searchNodeId && governing?.findRulerScope) {
          projectNode = await governing.findRulerScope(searchNodeId);
        }
        if (!projectNode) {
          const promoteId = currentNodeId || targetNodeId || rootId;
          if (promoteId) {
            log.info("Tree Orchestrator",
              `Swarm: no Ruler at position, promoting ${promoteId === rootId ? "tree root" : "current node"} ${promoteId}`);
            // Self-promote the scope to Ruler; governing owns the role
            // taxonomy. swarm.runBranchSwarm initializes mechanism
            // bookkeeping on first dispatch.
            if (governing?.promoteToRuler) {
              await governing.promoteToRuler({
                nodeId: promoteId,
                reason: `user request: ${String(message || "").slice(0, 80)}`,
                promotedFrom: governing.PROMOTED_FROM?.ROOT,
              });
            }
            projectNode = await NodeModel.findById(promoteId).select("_id name metadata").lean();
          }
        }

        if (!projectNode) {
          log.warn("Tree Orchestrator", "Swarm: no Ruler scope resolvable at current position; branches will not run.");
        } else {
          // NOTE: contracts are written AFTER validation + auto-retry
          // passes (see below). Writing them up front was causing
          // dead contracts to persist when validation rejected the
          // plan — a later "continue plan" turn would then find them
          // in enrichContext and have a builder mode generate code
          // against contracts whose branches never existed. Defer
          // until we know the plan is definitely going to be stashed
          // for approval.

          // Validate the Planner's branch shapes against seam rules
          // (name conventions, path collisions, sibling uniqueness).
          // Auto-retry was removed: structured emission has its own
          // validator at tool-call time, and the Planner's prompt
          // enforces the directory rule. If validation still fails
          // here, surface the error to the user; revision goes
          // through the orchestrator's revision branch which
          // re-invokes the Planner.
          let validation = sw.validateBranches(branchParse.branches, projectNode?.name);
          if (validation.errors.length > 0) {
            // Surface validation rejection to the user. The structured
            // emission produced names/shapes that violated seam rules
            // (e.g., suffixes that look like branch labels rather than
            // directory names). The retry path that previously asked
            // the model to re-emit [[BRANCHES]] text is gone — phase 2
            // main emission is via tool only, and a re-emission flows
            // through the user accepting/revising the proposed plan
            // (the revision branch in orchestrator.js re-invokes the
            // Planner cleanly).
            log.warn("Tree Orchestrator",
              `🚫 Plan rejected by seam validator (${validation.errors.length} error(s)):\n  - ${validation.errors.join("\n  - ")}`,
            );
            const errorBlock = [
              "",
              "⚠️ Plan rejected — the Planner emitted branches that violate seam rules:",
              ...validation.errors.map((e) => `  • ${e}`),
              "",
              "Describe how you'd like the plan changed and the Planner will re-emit.",
            ].join("\n");
            answer = (answer || "") + "\n" + errorBlock;
            if (result) {
              result.content = answer;
              result.answer = answer;
            }
            return { success: true, answer, modeKey: mode, modesUsed, rootId, targetNodeId: targetNodeId || currentNodeId };
          }

          // ── Plan-first dispatch: pause here ──
          // Contracts already persisted by governing-emit-contracts at
          // the contracts trio member; the contractApprovals ledger on
          // the Ruler holds the active set. No setContracts call
          // needed here.

          // Instead of calling runBranchSwarm directly, stash the
          // parsed plan and emit a proposal event. The user reviews
          // the plan on their next turn; the orchestrator-level
          // interception (see orchestrator.js handlePendingSwarmPlan)
          // then either accepts → dispatches via dispatchSwarmPlan(),
          // revises → re-invokes the Planner, or pivots → archives.
          //
          // Version handling: if a prior stash exists for this
          // visitor, this re-emit is a REVISION — bump its version.
          // Otherwise it's a fresh proposal → v1. The orchestrator's
          // revision branch pre-bumps version on the old stash before
          // re-invoking the Planner; reading that value here
          // preserves the count across the round-trip.
          const architectChatId = result?._lastChatId || rootChatId || null;
          const { getPendingSwarmPlan, setPendingSwarmPlan } = await pendingSwarmPlanApi();
          const SWARM_WS = await swarmWsEvents();
          const existingStash = getPendingSwarmPlan(visitorId);
          // A prior stash carries `revisionTrigger` when the user asked
          // for a revision (set by orchestrator.js's revision branch).
          // In that case the orchestrator pre-bumped the version, so
          // keep that bumped value; otherwise this is a fresh proposal.
          const isRevisionRoundTrip = !!(existingStash && existingStash.revisionTrigger);
          const planVersion = isRevisionRoundTrip
            ? (existingStash.version || 1)
            : ((existingStash?.version || 0) + 1);

          // Use the structured emission already retrieved by
          // runRulerCycle (single source of truth). Reading it here a
          // second time against projectNode._id risks scope drift —
          // findRulerScope can resolve a different node than the one
          // currentNodeId was promoted to in runRulerCycle, in which
          // case the read returns null and the popup loses reasoning.
          // Fallback: if the stash is absent (some path bypassed
          // runRulerCycle), read against currentNodeId — the scope
          // governing-emit-plan writes against — not projectNode._id.
          let structuredEmission = result?._structuredEmission || null;
          // Two fallback reads when the result didn't carry it. First try
          // currentNodeId (the scope governing-emit-plan writes against);
          // if that misses, try projectNode._id (the resolved Ruler scope
          // — covers the case where the user is at a structural child
          // and the Planner wrote at the parent Ruler).
          if (!structuredEmission && currentNodeId) {
            try {
              const { getExtension } = await import("../loader.js");
              const governing = getExtension("governing")?.exports;
              if (governing?.readActivePlanEmission) {
                structuredEmission = await governing.readActivePlanEmission(currentNodeId);
              }
              if (!structuredEmission && projectNode?._id) {
                structuredEmission = await governing.readActivePlanEmission(projectNode._id);
              }
            } catch (err) {
              log.debug("Tree Orchestrator", `plan-card emission fallback read skipped: ${err.message}`);
            }
          }
          log.info("Tree Orchestrator",
            `🎴 PLAN_PROPOSED payload: emission=${structuredEmission ? `ordinal=${structuredEmission.ordinal}, reasoning=${structuredEmission.reasoning?.length || 0}c, steps=${structuredEmission.steps?.length || 0}` : "NULL"}, ` +
            `branches=${branchParse.branches.length}, projectNode=${String(projectNode._id).slice(0, 8)}`);

          setPendingSwarmPlan(visitorId, {
            branches: branchParse.branches,
            contracts: parsedContracts || [],
            projectNodeId: String(projectNode._id),
            projectName: projectNode.name || null,
            userRequest: message,
            architectChatId,
            rootChatId: rootChatId || null,
            rootId: rootId || null,
            modeKey: mode,
            targetNodeId: targetNodeId || currentNodeId || null,
            version: planVersion,
            cleanedAnswer: answer || "",
            emission: structuredEmission || null,
          });
          const isUpdate = planVersion > 1;
          // Trigger string on PLAN_UPDATED: surface the user's actual
          // revision text (truncated) when this is a revision
          // round-trip. Falls back to a generic "revision" label when
          // the stash doesn't carry it (e.g. nested-expansion emits
          // from swarm.js that reuse this emit path but don't
          // originate from a user message).
          const triggerText = isRevisionRoundTrip
            ? `Revised from: "${String(existingStash.revisionTrigger).slice(0, 200)}"`
            : "revision";
          socket?.emit?.(isUpdate ? SWARM_WS.PLAN_UPDATED : SWARM_WS.PLAN_PROPOSED, {
            version: planVersion,
            projectNodeId: String(projectNode._id),
            projectName: projectNode.name || null,
            branches: branchParse.branches.map((b) => ({
              name: b.name,
              spec: b.spec,
              path: b.path || null,
              files: b.files || [],
              slot: b.slot || null,
              mode: b.mode || null,
              parentBranch: b.parentBranch || null,
            })),
            contracts: parsedContracts || [],
            // Structured plan emission. Renderers (dashboard, CLI)
            // prefer this when present and fall back to the legacy
            // branches list when absent. Carries reasoning, leaf steps,
            // branch rationales — everything the [[BRANCHES]] surface
            // could not express.
            emission: structuredEmission || null,
            ...(isUpdate ? { trigger: triggerText } : {}),
          });

          // Stub a one-line prompt onto the visible answer. The full
          // branch-by-branch detail lives in the WS plan card (rich
          // HTML on dashboard, multi-line ASCII in CLI). Putting the
          // full list here too makes the chat transcript look
          // duplicated when both render. The stub stays in the
          // transcript as a durable record + fallback prompt.
          const stub =
            `\n\n📋 ${isUpdate ? "Updated plan" : "Proposed plan"} (v${planVersion}) — ${branchParse.branches.length} branch${branchParse.branches.length === 1 ? "" : "es"}. ` +
            `Reply "yes" to run, "cancel" to drop, or describe a change.`;
          answer = (answer || "") + stub;
          if (result) {
            result.content = answer;
            result.answer = answer;
          }
          log.info("Tree Orchestrator",
            `📋 Swarm plan proposed: ${branchParse.branches.length} branches (project=${String(projectNode._id).slice(0, 8)}, visitor=${visitorId})`,
          );
          // Early return — DO NOT dispatch. orchestrator.js handles
          // the next turn's affirmative/revise/pivot.
          return {
            success: true,
            answer,
            modeKey: mode,
            modesUsed,
            rootId,
            targetNodeId: targetNodeId || currentNodeId,
          };
        }
      } catch (err) {
        log.error("Tree Orchestrator", `Swarm dispatch failed: ${err.message}`);
        log.error("Tree Orchestrator", err.stack?.split("\n").slice(0, 5).join("\n"));
      }
    }
    }
  }

  // Flat-build scout + summarizer rescue + coach→plan handoff were
  // all coupled to the legacy code-plan/code-log/code-summarize modes.
  // Governance now owns work dispatch: the Ruler routes the user's
  // message → typed Worker → the Ruler synthesizes its own response
  // at the end. Worker bare-[[DONE]] silence is handled by the
  // Ruler's natural exit synthesis, not a post-hoc summarizer mode.
  // Coach is still a direct-chat mode but no longer hands off to a
  // builder; if the user wants the fix applied, the Ruler at the
  // scope picks it up from the next message and routes through
  // hire-planner.

  // Plan capture: if the mode emitted a [[PLAN]]...[[/PLAN]] block, strip it
  // from the visible answer and stash it for the next turn. The next
  // affirmative from this visitor will expand the plan into N sequential
  // runs, one chat per item. Non-affirmative next message clears it.
  if (answer) {
    const { items, cleaned } = parsePlan(answer);
    if (items.length > 0) {
      setPendingPlan(visitorId, items, mode);
      answer = cleaned;
      if (result) {
        result.content = cleaned;
        result.answer = cleaned;
      }
      log.info("Tree Orchestrator",
        `📋 Captured plan: ${items.length} items from ${mode}. Say an affirmative to expand.`,
      );
    }
  }

  if (answer) pushMemory(visitorId, message, answer);

  // Surface write-tool trace as stepSummaries. Place mode (skipRespond)
  // uses these to produce its "Placed on: ..." / "Nothing to place"
  // message. Chat and query ignore them, but including them is cheap.
  const stepSummaries = (result?._writeTrace || []).map((t) => ({
    tool: t.tool,
    hint: t.hint || null,
    summary: t.summary || t.hint || t.tool,
  }));

  return {
    success: true,
    answer,
    modeKey: mode,
    modesUsed,
    rootId,
    targetNodeId: targetNodeId || currentNodeId,
    stepSummaries,
    lastTargetNodeId: targetNodeId || currentNodeId,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// RUN CHAIN (eliminates duplicated chain execution logic)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Execute a multi-extension chain. Each step runs in its own mode,
 * results pass forward as context.
 */
export async function runChain(chain, message, visitorId, {
  socket, username, userId, rootId, signal, slot,
  onToolLoopCheckpoint, modesUsed,
}) {
  emitStatus(socket, "intent", "Chaining extensions...");

  let context = message;
  const chainModes = [];

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const isLast = i === chain.length - 1;

    const stepNodeId = step.targetNodeId || getCurrentNodeId(visitorId) || rootId;
    await switchMode(visitorId, step.mode, {
      username, userId, rootId,
      currentNodeId: stepNodeId,
      conversationMemory: context,
      clearHistory: true,
    });

    const stepResult = await processMessage(visitorId,
      isLast ? context : `${context}\n\nDo this step and return what you produced.`, {
        username, userId, rootId, signal, slot,
        onToolLoopCheckpoint,
        onToolResults(results) {
          if (signal?.aborted) return;
          for (const r of results) socket?.emit?.(WS.TOOL_RESULT, r);
        },
      });

    if (signal?.aborted) return null;

    const stepAnswer = stepResult?.content || stepResult?.answer || "";
    chainModes.push(step.mode);

    if (!isLast) {
      context = `Original request: ${message}\n\nPrevious step (${step.extName}) result:\n${stepAnswer}`;
    } else {
      context = stepAnswer;
    }
  }

  emitStatus(socket, "done", "");
  if (context) pushMemory(visitorId, message, context);
  return { success: true, answer: context, modeKey: chainModes[chainModes.length - 1], modesUsed: [...modesUsed, ...chainModes], rootId };
}

// ─────────────────────────────────────────────────────────────────────────
// STEP-ORDER EXECUTION HELPERS
//
// The Foreman holds call-stack discipline: step N+1 cannot start until
// step N's entire descendant subtree settles. dispatchSwarmPlan walks
// the Planner's emission.steps in plan order, dispatching each as a
// leaf-batch (Worker writes files at this scope) or a branch step
// (sub-Rulers run their own lifecycles in parallel within the step).
//
// Consecutive leaves are batched into one Worker turn — they all live
// at the parent scope, so batching is purely an efficiency. A branch
// step always runs in its plan-order position, blocking subsequent
// steps until all of its sub-Rulers settle.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Group a Planner's emission.steps into ordered execution units.
 * Consecutive leaves of the SAME workerType merge into one group;
 * when the type changes between adjacent leaves, the buffer flushes
 * and a new leaf group starts. Each branch step is always its own
 * group. Returns Array<
 *   { kind: "leaves", workerType: string, steps: [...] }
 *   | { kind: "branch", step: {...} }
 * >.
 *
 * Splitting by workerType means a Build batch and a Refine batch
 * dispatch to different Worker modes — each gets the prompt body
 * appropriate to its cognitive shape rather than a generic Worker
 * prompt averaged across mixed types.
 */
function groupStepsForExecution(steps) {
  const groups = [];
  if (!Array.isArray(steps)) return groups;
  let leafBuf = [];
  let leafType = null;
  const flushLeaves = () => {
    if (leafBuf.length) {
      groups.push({ kind: "leaves", workerType: leafType || "build", steps: leafBuf });
      leafBuf = [];
      leafType = null;
    }
  };
  for (const s of steps) {
    if (s?.type === "leaf") {
      const t = (typeof s.workerType === "string" ? s.workerType : "build") || "build";
      // First leaf in a new buffer: claim the type. Subsequent leaves
      // of a different type flush the buffer and start a fresh group.
      if (leafBuf.length === 0) {
        leafType = t;
        leafBuf.push(s);
      } else if (t === leafType) {
        leafBuf.push(s);
      } else {
        flushLeaves();
        leafType = t;
        leafBuf.push(s);
      }
    } else if (s?.type === "branch") {
      flushLeaves();
      groups.push({ kind: "branch", step: s });
    } else {
      // Unknown step type — flush any pending leaves so order is
      // preserved and the unknown step doesn't silently merge into
      // a leaf batch.
      flushLeaves();
    }
  }
  flushLeaves();
  return groups;
}

// Terminal step statuses (a step in any of these is settled; the
// auto-mark loops skip over them so prior decisions aren't clobbered).
// `blocked` joins the set in the Worker-outcome classification pass —
// a step blocked by a Worker's contract-conflict flag is settled until
// the Foreman or Ruler decides otherwise.
const TERMINAL_LEAF_STATUSES = new Set([
  "done", "failed", "cancelled", "blocked", "advanced", "skipped", "superseded",
]);

/**
 * Classifier import lives in governing/state/workerOutcome.js so the
 * dispatcher, Pass 2 court adjudication, and any future audit surface
 * call the same function. Pure — no tree reads, no state writes.
 *
 * Resolved lazily because dispatch.js loads before governing's exports
 * are wired through getExtension. Cached after the first successful
 * resolution.
 */
let _classifierCache = null;
async function classifyWorkerOutcome(args) {
  if (!_classifierCache) {
    const mod = await import("../governing/state/workerOutcome.js");
    _classifierCache = mod.classifyWorkerOutcome;
  }
  return _classifierCache(args);
}

/**
 * Apply the classification result to every still-running leaf step in
 * the active execution-record at a Ruler scope. Targets the leaf
 * batch's step indices (so an `advanced` outcome from one batch does
 * not affect a different batch). Skips terminal statuses.
 *
 * targetIndices semantics:
 *   • null / undefined — legacy "all pending leaves" mode (runRulerCycle's
 *     single-dispatch leaf path).
 *   • Set with entries  — filter: only leaves whose stepIndex is in the
 *     set get classified.
 *   • Set with zero entries — SUBSTRATE BUG. The caller meant to filter
 *     but lost step identity. Refuse to classify any leaves and log a
 *     warning rather than leaking the batch's outcome onto unrelated
 *     pending leaves (the bug that lit up when emission.steps lacked
 *     stepIndex and targetIndices fell through to an empty set).
 */
async function applyLeafOutcomeToRecord({
  governing,
  rulerNodeId,
  targetIndices,
  outcome,
}) {
  if (!governing?.readActiveExecutionRecord || !governing?.updateStepStatus) return 0;
  if (targetIndices && targetIndices.size === 0) {
    log.warn("Tree Orchestrator",
      `applyLeafOutcomeToRecord: empty targetIndices at ${String(rulerNodeId).slice(0, 8)} — ` +
      `refusing to classify (substrate bug: leaf-batch caller passed Set with no entries; ` +
      `would leak '${outcome?.status}' onto every pending leaf). Marking nothing.`);
    return 0;
  }
  const record = await governing.readActiveExecutionRecord(rulerNodeId);
  if (!record?._recordNodeId) return 0;
  const completedAt = new Date().toISOString();
  let marked = 0;
  for (const step of (record.stepStatuses || [])) {
    if (step?.type !== "leaf") continue;
    if (TERMINAL_LEAF_STATUSES.has(step.status)) continue;
    if (targetIndices && !targetIndices.has(step.stepIndex)) continue;
    const updates = {
      status: outcome.status,
      startedAt: step.startedAt || completedAt,
      completedAt,
    };
    if (outcome.reason) {
      updates.reason = String(outcome.reason).slice(0, 500);
      // Mirror into `error` for failed/blocked so the existing
      // executionStack renderer's "error: ..." line surfaces it
      // without needing a renderer change. Done steps don't get an
      // error field.
      if (outcome.status === "failed" || outcome.status === "blocked") {
        updates.error = String(outcome.reason).slice(0, 500);
      }
    }
    await governing.updateStepStatus({
      recordNodeId: record._recordNodeId,
      stepIndex: step.stepIndex,
      updates,
    });
    marked++;
  }
  return marked;
}

/**
 * Read pending flags off a Ruler scope. Wraps the governing export
 * with a try/catch — flag queue read failure must NEVER break a
 * Worker dispatch.
 */
async function snapshotFlagQueue(governing, rulerNodeId) {
  try {
    if (governing?.readPendingIssues && rulerNodeId) {
      const flags = await governing.readPendingIssues(rulerNodeId);
      return Array.isArray(flags) ? flags : [];
    }
  } catch {}
  return [];
}

/**
 * Resolve the worker mode key for a given workerType at a specific
 * Ruler scope. Three paths, in order:
 *
 *   1. governing.lookupWorkerMode with preferWorkspace inferred from
 *      the scope's ext-allow chain. The workspace currently active
 *      at this scope (code-workspace at a code project, book-workspace
 *      at a book project) wins. Critical: without this, the registry's
 *      insertion-order first-match means whichever workspace loaded
 *      first wins for every leaf, regardless of where dispatch is
 *      happening — a code project at a code-workspace scope would
 *      route every "build" leaf to book-workspace's worker simply
 *      because book-workspace registered first at boot.
 *   2. governing.lookupWorkerMode without preference — first registry
 *      match. Used when no workspace is allowed at the scope (rare,
 *      but it's the fallback for governing-alone lands).
 *   3. governing.WORKER_TYPE_MODE_KEYS — governing's own base typed
 *      modes. Used when no workspace registered for this type at all.
 *
 * Returns null when nothing resolves. Callers MUST handle null with
 * a logged error.
 */
async function resolveWorkerModeForType(workerType, { scopeNodeId } = {}) {
  const type = typeof workerType === "string" ? workerType : "build";

  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;

    // Find the workspace ext-allow'd at this scope so the registry
    // lookup prefers it. Without this, multi-workspace lands route
    // every leaf to whichever workspace happened to register first.
    let preferWorkspace = null;
    if (scopeNodeId && governing?.findActiveWorkspaceAtScope) {
      preferWorkspace = await governing.findActiveWorkspaceAtScope(scopeNodeId);
    }

    if (governing?.lookupWorkerMode) {
      const hit = governing.lookupWorkerMode(type, preferWorkspace ? { preferWorkspace } : {});
      if (hit?.modeKey) return hit.modeKey;
    }
    if (governing?.WORKER_TYPE_MODE_KEYS?.[type]) {
      return governing.WORKER_TYPE_MODE_KEYS[type];
    }
  } catch {}

  return null;
}

/**
 * Run a contiguous leaf-step group at the parent Ruler scope. Marks
 * the corresponding execution-record steps "running" up front, dispatches
 * the workspace mode (e.g. tree:code-plan) as a Worker with the leaf
 * specs explicitly enumerated, then marks the steps "done." The
 * forbidden-paths block lists ALL branch sub-domain names in the plan
 * (not just adjacent ones) so the Worker never writes into a
 * sub-Ruler's territory regardless of when that branch runs.
 */
async function runLeafGroupAtScope({
  leafSteps,
  workerType,
  projectNode,
  visitorId, userId, username, rootId,
  signal, slot, socket, onToolLoopCheckpoint, sessionId, rootChatId, rt,
  stashedPlanText,
  allBranchNames,
}) {
  const resolvedType = typeof workerType === "string" ? workerType : "build";

  // Resolve the worker mode key for this group's type. The active
  // workspace at projectNode's scope determines which workspace's
  // typed Worker handles this leaf (code project → code Workers,
  // book project → book Workers). Falls back to governing base
  // typed modes when no workspace is registered for the type.
  const modeKey = await resolveWorkerModeForType(resolvedType, {
    scopeNodeId: projectNode?._id ? String(projectNode._id) : null,
  });

  log.info("Tree Orchestrator",
    `🔨 runLeafGroupAtScope entered at ${String(projectNode?._id || "?").slice(0, 8)}: ` +
    `type=${resolvedType}, leafSteps=${leafSteps?.length || 0}, ` +
    `modeKey=${modeKey || "(unresolved)"}`);
  if (!leafSteps?.length) {
    log.warn("Tree Orchestrator", `🔨 Leaf group SKIPPED: no leafSteps`);
    return;
  }
  if (!modeKey) {
    log.error("Tree Orchestrator",
      `🔨 Leaf group SKIPPED: no typed Worker mode resolvable for workerType="${resolvedType}". ` +
      `governing.lookupWorkerMode and WORKER_TYPE_MODE_KEYS both returned nothing. ` +
      `This is a substrate misconfiguration — either the governing extension didn't load, ` +
      `or its typed Worker modes weren't registered. Surface immediately.`);
    return;
  }

  const leafSpecs = leafSteps
    .map((s) => (typeof s.spec === "string" ? s.spec.trim() : ""))
    .filter(Boolean);
  if (leafSpecs.length === 0) {
    log.warn("Tree Orchestrator",
      `🔨 Leaf group SKIPPED at ${String(projectNode._id).slice(0, 8)}: no usable specs ` +
      `(leafSteps had no .spec strings)`);
    return;
  }

  // Mark this group's leaf steps "running" so the dashboard reflects
  // live progress. Only updates steps still in "pending"; terminal
  // statuses (done/failed/cancelled/advanced/skipped/superseded)
  // stay where they are.
  const targetIndices = new Set(
    leafSteps.map((s) => s?.stepIndex).filter((i) => Number.isFinite(i)),
  );
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.readActiveExecutionRecord && governing?.updateStepStatus) {
      const record = await governing.readActiveExecutionRecord(projectNode._id);
      if (record?._recordNodeId) {
        const startedAt = new Date().toISOString();
        for (const step of (record.stepStatuses || [])) {
          if (step?.type !== "leaf" || step.status !== "pending") continue;
          if (targetIndices.size > 0 && !targetIndices.has(step.stepIndex)) continue;
          await governing.updateStepStatus({
            recordNodeId: record._recordNodeId,
            stepIndex: step.stepIndex,
            updates: { status: "running", startedAt },
          });
        }
      }
    }
  } catch (err) {
    log.debug("Tree Orchestrator", `auto-mark leaf running skipped: ${err.message}`);
  }

  // Pin position to the Ruler scope so the Worker's writes land here.
  setCurrentNodeId(visitorId, String(projectNode._id));
  await switchMode(visitorId, modeKey, {
    username, userId, rootId,
    currentNodeId: String(projectNode._id),
    clearHistory: false,
  });

  // Type framing block: even if the resolved mode is a legacy
  // workspace mode (no type-specific system prompt body), the
  // dispatch-time message names the cognitive shape explicitly so
  // the Worker reads it inline. When the resolved mode IS one of
  // the typed governing modes, this block is redundant with the
  // system prompt but harmless — both surfaces saying the same
  // thing keeps the boundary obvious to readers and to the model.
  const TYPE_FRAMING = {
    build: "These leaf steps are BUILD work — bring new artifacts into existence at this scope. Realize the smallest correct thing the spec asks for, no more. Don't pre-build for the future, don't scaffold beyond the listed leaves.",
    refine: "These leaf steps are REFINE work — improve existing artifacts. READ each target file FIRST before writing. Make the smallest change that satisfies the spec; preserve unrelated behavior. If the spec is ambiguous about what to refine, surface that rather than guess.",
    review: "These leaf steps are REVIEW work — judge artifacts and produce structured findings WITHOUT modifying them. Read-only discipline: do not call write tools that modify the artifact under review. Output findings as notes attached at this scope, organized by severity, with line-level evidence.",
    integrate: "These leaf steps are INTEGRATE work — tie sibling sub-Ruler outputs into a coherent surface at THIS scope. Read what siblings produced FIRST. Write only top-level integration files (package.json, README, top-level config); do not reach into sibling directories. Use contracted identifiers verbatim.",
  };
  const typeFramingLine = TYPE_FRAMING[resolvedType] || TYPE_FRAMING.build;

  const leafBlock =
    `WORKER TYPE: ${resolvedType.toUpperCase()}\n` +
    `${typeFramingLine}\n\n` +
    `LEAF STEPS YOU MUST REALIZE (one file per spec, no more, no less):\n` +
    leafSpecs.map((s, i) => `  ${i + 1}. ${s}`).join("\n");

  const forbiddenBlock = (allBranchNames?.length || 0) > 0
    ? `FORBIDDEN PATHS (sub-Ruler scopes — DO NOT write inside these):\n` +
      allBranchNames.map((n) => `  • ${n}/  (any path beginning with "${n}/")`).join("\n") +
      `\nThe sub-Rulers below own those directories. Their own Workers ` +
      `will populate them. Writing into ${allBranchNames.map((n) => `"${n}/"`).join(", ")} ` +
      `from this scope is REJECTED by the workspace tool — your write ` +
      `will fail and the user will see the rejection.`
    : "";

  // Build the approval text (prose plan) for the Worker's prompt.
  // Falls back to a structured render of the active emission when the
  // Planner only emitted via tool (no prose).
  let approvalText = stashedPlanText && stashedPlanText.trim()
    ? stashedPlanText.trim()
    : "";
  if (!approvalText) {
    try {
      const { getExtension } = await import("../loader.js");
      const governing = getExtension("governing")?.exports;
      if (governing?.readActivePlanEmission) {
        const emission = await governing.readActivePlanEmission(projectNode._id);
        if (emission) {
          approvalText =
            `## Reasoning\n${emission.reasoning || ""}\n\n## Plan\n` +
            (emission.steps || []).map((s, i) => {
              if (s.type === "leaf") return `${i + 1}. [leaf] ${s.spec || ""}`;
              if (s.type === "branch") {
                const subs = (s.branches || []).map((b) => `   - ${b.name}: ${b.spec || ""}`).join("\n");
                return `${i + 1}. [branch] ${s.rationale || ""}\n${subs}`;
              }
              return "";
            }).filter(Boolean).join("\n\n");
        }
      }
    } catch {}
  }

  const rulerWorkerMessage =
    `The Ruler at this scope approved the following plan:\n\n` +
    `${approvalText}\n\n` +
    `${leafBlock}\n\n` +
    (forbiddenBlock ? `${forbiddenBlock}\n\n` : "") +
    `RULES:\n` +
    `  • Realize ONLY the leaf steps listed above. Do not improvise ` +
    `    additional files (no extra "index.html", no extra README, ` +
    `    no scaffolding outside the listed leaves).\n` +
    `  • Each leaf spec → exactly one file at this scope.\n` +
    ((allBranchNames?.length || 0) > 0
      ? `  • Files inside ${allBranchNames.map((n) => `"${n}/"`).join(", ")} are NOT yours.\n`
      : "") +
    `  • Emit [[DONE]] when ALL listed leaf steps are written. Do not ` +
    `    keep working past the leaf list.`;

  log.info("Tree Orchestrator",
    `🔨 Leaf batch at ${String(projectNode._id).slice(0, 8)}: dispatching ${modeKey} as ${resolvedType} Worker ` +
    `(${leafSpecs.length} leaf step(s); ${(allBranchNames?.length || 0)} forbidden sub-domain(s))`);

  // Capture flag queue + dispatch + classify outcome. The leaf status
  // each step lands in reflects WHAT THE WORKER ACTUALLY DID — not
  // "the Worker's turn ended." See classifyWorkerOutcome above.
  let governing = null;
  try {
    const { getExtension } = await import("../loader.js");
    governing = getExtension("governing")?.exports || null;
  } catch {}
  const flagsBefore = await snapshotFlagQueue(governing, projectNode._id);

  const workerResult = await runSteppedMode(visitorId, modeKey, rulerWorkerMessage, {
    username, userId, rootId, signal, slot,
    readOnly: false, onToolLoopCheckpoint, socket,
    sessionId, rootChatId, rt,
    currentNodeId: String(projectNode._id),
    parentChatId: rootChatId || null,
    dispatchOrigin: `ruler-own-integration-${resolvedType}`,
  });

  const flagsAfter = await snapshotFlagQueue(governing, projectNode._id);
  const outcome = await classifyWorkerOutcome({
    workerResult,
    flagsBefore,
    flagsAfter,
  });

  // Apply the classified outcome to every still-running leaf step in
  // this group. Foreman overrides (advanced) / bypasses (skipped) /
  // prior failures stay where they are — TERMINAL_LEAF_STATUSES guards.
  try {
    const marked = await applyLeafOutcomeToRecord({
      governing,
      rulerNodeId: projectNode._id,
      targetIndices,
      outcome,
    });
    if (marked > 0) {
      const reasonHint = outcome.reason ? ` (${String(outcome.reason).slice(0, 120)})` : "";
      log.info("Tree Orchestrator",
        `🔧 Leaf batch: classified ${marked} leaf step(s) at ${String(projectNode._id).slice(0, 8)} as ${outcome.status}${reasonHint}`);
    }
  } catch (err) {
    log.debug("Tree Orchestrator", `auto-mark leaf classify skipped: ${err.message}`);
  }
}

/**
 * Dispatch the sub-Rulers for one branch step. Calls runBranchSwarm
 * with just this step's branches and waits for them to settle. The
 * sub-branches run in parallel (per the Planner's design); the
 * function returns when all have reached a terminal status.
 *
 * Returns the swarmResult object so the caller can include the
 * summary in any final user-facing report.
 */
async function runBranchStepAtScope({
  branchStep,
  projectNode,
  sw,
  visitorId, userId, username, rootId,
  signal, slot, socket, onToolLoopCheckpoint, sessionId, rootChatId, rt,
  architectChatId, userRequest,
}) {
  const stepBranches = (branchStep?.branches || [])
    .filter((b) => b && typeof b.name === "string" && b.name.trim().length > 0)
    .map((b) => ({
      name: b.name.trim(),
      spec: b.spec || "",
      path: null,
      files: [],
      slot: null,
      mode: null,
      parentBranch: null,
    }));

  if (stepBranches.length === 0) {
    return { summary: "branch step had no usable sub-domains" };
  }

  log.info("Tree Orchestrator",
    `🌿 Branch step ${branchStep.stepIndex ?? "?"} at ${String(projectNode._id).slice(0, 8)}: ` +
    `dispatching ${stepBranches.length} sub-Ruler${stepBranches.length === 1 ? "" : "s"} ` +
    `(${stepBranches.map((b) => b.name).join(", ")})`);

  return await sw.runBranchSwarm({
    branches: stepBranches,
    rootProjectNode: projectNode,
    rootChatId,
    architectChatId,
    sessionId,
    visitorId,
    userId,
    username,
    rootId,
    signal,
    slot,
    socket,
    onToolLoopCheckpoint,
    userRequest: userRequest || "",
    rt,
    // Sub-Ruler dispatch always routes through governing's Planner.
    // The branch is promoted to Ruler at its child node and runs its
    // own Planner/Contractor/Worker cycle from there; the original
    // workspace plan mode (tree:code-plan etc.) is no longer involved
    // in dispatch. swarm uses defaultBranchMode purely for metadata/
    // audit labelling since runBranch (below) bypasses it and calls
    // runRulerTurn directly.
    defaultBranchMode: "tree:governing-planner",
    core: { metadata: { setExtMeta: async (node, ns, data) => {
      const NodeModel = (await import("../../seed/models/node.js")).default;
      await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
    } } },
    emitStatus,
    runBranch: async ({ mode: branchMode, message: branchMessage, branchNodeId, slot: branchSlot, markerChatId }) => {
      setActiveRequest(visitorId, {
        socket, username, userId, signal,
        sessionId,
        rootId,
        rootChatId,
        slot, onToolLoopCheckpoint,
        rt: (getActiveRequest(visitorId) || {}).rt,
      });
      const branchIdStr = await pinBranchPosition(visitorId, branchNodeId, branchMode, {
        username, userId, rootId,
      });
      const { runRulerTurn } = await import("./ruling.js");
      const cycleResult = await runRulerTurn({
        visitorId,
        message: branchMessage,
        username, userId, rootId,
        currentNodeId: branchIdStr,
        signal, slot: branchSlot, socket,
        sessionId, rootChatId, rt,
        readOnly: false, onToolLoopCheckpoint,
        dispatchOrigin: "branch-swarm",
      });
      return cycleResult;
    },
  });
}

/**
 * Roll up a single branch step's parent status from its sub-branch
 * statuses. Called after each branch step settles so the
 * execution-record reflects the branch's terminal state before any
 * subsequent step runs. Deterministic — branch parent status is a
 * function of sub-branch statuses, not a judgment call.
 */
async function rollUpBranchStepStatus(governing, recordNodeId, branchStepIndex) {
  if (!governing?.readActiveExecutionRecord || !governing?.updateStepStatus) return null;
  if (!recordNodeId || !Number.isFinite(branchStepIndex)) return null;
  try {
    const record = await governing.readActiveExecutionRecord(recordNodeId);
    if (!record?.stepStatuses) return null;
    const step = record.stepStatuses.find((s) => s?.stepIndex === branchStepIndex);
    if (!step || step.type !== "branch" || !Array.isArray(step.branches)) return null;

    const PROGRESSED = new Set(["done", "advanced", "skipped"]);
    const subs = step.branches;
    const allProgressed = subs.length > 0 && subs.every((b) => PROGRESSED.has(b.status));
    const allCancelled  = subs.length > 0 && subs.every((b) => b.status === "cancelled");
    const anySubFailed  = subs.some((b) => b.status === "failed");
    const anySubBlocked = subs.some((b) => b.status === "blocked");

    let nextStatus = step.status;
    if (anySubFailed)        nextStatus = "failed";
    else if (anySubBlocked)  nextStatus = "blocked";
    else if (allCancelled)   nextStatus = "cancelled";
    else if (allProgressed)  nextStatus = "done";

    if (nextStatus === step.status) return step.status;
    const completedAt = new Date().toISOString();
    const isTerminal = nextStatus === "done"
      || nextStatus === "failed"
      || nextStatus === "cancelled";
    await governing.updateStepStatus({
      recordNodeId: record._recordNodeId || recordNodeId,
      stepIndex: branchStepIndex,
      updates: {
        status: nextStatus,
        startedAt: step.startedAt || completedAt,
        completedAt: isTerminal ? completedAt : null,
      },
    });
    return nextStatus;
  } catch (err) {
    log.debug("Tree Orchestrator", `rollUpBranchStepStatus(${branchStepIndex}) skipped: ${err.message}`);
    return null;
  }
}

/**
 * Mark every leaf step in a failed batch as "failed" with a captured
 * error and timestamps. Steps already in a terminal status stay where
 * they are — Foreman overrides (advanced / skipped) and explicit
 * earlier failures are authoritative.
 *
 * Called from the leaf-batch failure path so the dashboard, snapshot,
 * and Pass 2 readers see the precise leaf that broke (vs. the whole
 * record going silently stale).
 */
async function markLeafBatchFailed(recordNodeId, leafSteps, error) {
  if (!recordNodeId || !Array.isArray(leafSteps) || leafSteps.length === 0) return;
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.readActiveExecutionRecord || !governing?.updateStepStatus) return;
    const record = await governing.readActiveExecutionRecord(recordNodeId);
    if (!record?._recordNodeId && !recordNodeId) return;
    const recId = record?._recordNodeId || recordNodeId;
    const TERMINAL_LEAF = new Set([
      "done", "failed", "cancelled", "advanced", "skipped", "superseded",
    ]);
    const targetIndices = new Set(
      leafSteps.map((s) => s?.stepIndex).filter((i) => Number.isFinite(i)),
    );
    const errMsg = String(error?.message || error || "leaf batch failed").slice(0, 500);
    const completedAt = new Date().toISOString();
    for (const step of (record.stepStatuses || [])) {
      if (step?.type !== "leaf") continue;
      if (TERMINAL_LEAF.has(step.status)) continue;
      if (targetIndices.size > 0 && !targetIndices.has(step.stepIndex)) continue;
      await governing.updateStepStatus({
        recordNodeId: recId,
        stepIndex: step.stepIndex,
        updates: {
          status: "failed",
          startedAt: step.startedAt || completedAt,
          completedAt,
          error: errMsg,
        },
      });
    }
    log.info("Tree Orchestrator",
      `🚨 Marked ${targetIndices.size} leaf step(s) failed (batch error: ${errMsg.slice(0, 80)})`);
  } catch (err) {
    log.debug("Tree Orchestrator", `markLeafBatchFailed skipped: ${err.message}`);
  }
}

/**
 * Wake the Foreman when a leaf batch fails. Payload carries the
 * workerType + step indices + error so the Foreman reads the
 * cognitive shape of the failure alongside the snapshot, not just
 * "something broke."
 */
async function wakeForemanForLeafFailure({
  projectNode, recordNodeIdForRollup,
  workerType, leafSteps, error,
  visitorId, username, userId, rootId,
  signal, slot, socket, onToolLoopCheckpoint, sessionId, rootChatId, rt,
}) {
  if (!projectNode?._id) return;
  try {
    const { runForemanTurn } = await import("./ruling.js");
    const stepIndices = leafSteps
      .map((s) => s?.stepIndex)
      .filter((i) => Number.isFinite(i));
    const errMsg = String(error?.message || error || "(no message)").slice(0, 500);
    const summary =
      `Leaf batch failure. workerType=${workerType}, ` +
      `step${stepIndices.length === 1 ? "" : "s"}=${stepIndices.join(",")}. ` +
      `Error: ${errMsg}. ` +
      `Decide whether to retry the leaves at this scope, mark them failed, ` +
      `or escalate to the Ruler for re-planning. The leaf shape was ` +
      `${workerType} — failures in this category typically mean ` +
      (workerType === "build" ? "the spec underspecified what to create."
        : workerType === "refine" ? "the target artifact wasn't readable or the change was rejected."
        : workerType === "review" ? "the artifact under review couldn't be loaded or interpreted."
        : workerType === "integrate" ? "the sibling outputs were incompatible or missing."
        : "(unknown shape)") +
      ` Read the snapshot's WAITING ON entries for the per-step error context.`;
    await runForemanTurn({
      visitorId,
      message: summary,
      username, userId, rootId,
      currentNodeId: String(projectNode._id),
      signal, slot, socket,
      sessionId, rootChatId, rt,
      readOnly: false, onToolLoopCheckpoint,
      wakeup: {
        reason: "leaf-failed",
        workerType,
        stepIndices,
        recordNodeId: recordNodeIdForRollup || null,
        payload: summary,
      },
    });
  } catch (err) {
    log.warn("Tree Orchestrator", `Foreman leaf-failed turn failed: ${err.message}`);
  }
}

/**
 * Wake the Foreman when a branch step settles to "failed" (every
 * sub-branch failed, zero done) or when the branch step itself
 * threw. Payload carries the branch step index + sub-branch names +
 * their workerTypes (where readable) so the Foreman has the full
 * cross-branch context, not just the rollup verdict.
 */
async function wakeForemanForBranchFailure({
  projectNode, recordNodeIdForRollup,
  branchStep, rolledUpStatus, error,
  visitorId, username, userId, rootId,
  signal, slot, socket, onToolLoopCheckpoint, sessionId, rootChatId, rt,
}) {
  if (!projectNode?._id) return;
  try {
    const { runForemanTurn } = await import("./ruling.js");
    const subNames = (branchStep?.branches || [])
      .map((b) => b?.name)
      .filter(Boolean);
    const errMsg = error ? String(error.message || error).slice(0, 500) : null;
    const verdict = rolledUpStatus || (error ? "(dispatch error)" : "(unsettled)");
    const summary =
      `Branch step ${branchStep?.stepIndex ?? "?"} failure. ` +
      `Rollup verdict: ${verdict}. ` +
      `Sub-branches dispatched: ${subNames.join(", ") || "(none readable)"}. ` +
      (errMsg ? `Dispatch error: ${errMsg}. ` : "") +
      `Decide whether to retry one or more sub-branches, mark them failed ` +
      `and continue with the remaining work, cancel the subtree, or escalate ` +
      `to the Ruler for replan. The snapshot shows each sub-Ruler's frame ` +
      `state under "EXECUTION STACK"; failed sub-branches appear under ` +
      `"WAITING ON" with their workerType so you can see what shape the ` +
      `failures took.`;
    await runForemanTurn({
      visitorId,
      message: summary,
      username, userId, rootId,
      currentNodeId: String(projectNode._id),
      signal, slot, socket,
      sessionId, rootChatId, rt,
      readOnly: false, onToolLoopCheckpoint,
      wakeup: {
        reason: "branch-failed",
        stepIndex: branchStep?.stepIndex ?? null,
        subBranchNames: subNames,
        rolledUpStatus,
        recordNodeId: recordNodeIdForRollup || null,
        payload: summary,
      },
    });
  } catch (err) {
    log.warn("Tree Orchestrator", `Foreman branch-failed turn failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DISPATCH A STASHED SWARM PLAN (used by orchestrator.js on affirmative)
//
// `planData` is whatever setPendingSwarmPlan captured for this visitor —
// pure data, no closures. `runtimeCtx` is the current-turn context
// (fresh socket, signal, rt, onToolLoopCheckpoint, etc.) that the
// swarm needs to actually run. Together they reconstruct the same
// call `runModeAndReturn` would have made originally.
//
// Returns the swarm summary string (or "" on failure) so the caller
// can post it as the user-facing answer for the current turn.
// ─────────────────────────────────────────────────────────────────────────

export async function dispatchSwarmPlan(planData, runtimeCtx) {
  const sw = await swarmExt();
  if (!sw) {
    log.warn("Tree Orchestrator", "dispatchSwarmPlan called but swarm extension not loaded.");
    return "";
  }

  const {
    branches, contracts, projectNodeId, userRequest, architectChatId,
    rootChatId: stashedRootChatId, rootId: stashedRootId,
    // The Planner's plan text with [[CONTRACTS]] and [[BRANCHES]] blocks
    // stripped — leaves the ## Reasoning and ## Plan sections. The
    // Ruler's Worker reads this to know which leaf integration files
    // belong to THIS scope (vs. sub-domain branches that get dispatched
    // separately).
    cleanedAnswer: stashedPlanText,
  } = planData || {};

  const {
    visitorId, userId, username, rootId: ctxRootId,
    sessionId, signal, slot, socket, onToolLoopCheckpoint, rt,
    rootChatId: ctxRootChatId,
  } = runtimeCtx || {};

  const rootId = stashedRootId || ctxRootId;
  const rootChatId = ctxRootChatId || stashedRootChatId || null;

  // Note: branches.length === 0 is legitimate for leaf-only plans (the
  // Planner emitted only leaf steps at this scope, no sub-domains). We
  // still need to create the execution record, run the Ruler-own
  // integration phase (Worker writes the leaf-step files), and let the
  // Foreman freeze the record at the end. Only the swarm dispatch
  // itself is skipped when there are no branches.
  if (!Array.isArray(branches)) {
    return "";
  }

  // Resolve the dispatch scope from the stashed id. Walk up to the
  // nearest Ruler scope via governing; if none exists, promote the
  // root to Ruler. The stashed projectNodeId is the user's approved
  // scope; we trust it as the dispatch anchor.
  let projectNode = null;
  try {
    const NodeModel = (await import("../../seed/models/node.js")).default;
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (projectNodeId && governing?.findRulerScope) {
      projectNode = await governing.findRulerScope(projectNodeId);
    }
    if (!projectNode) {
      const fallbackId = projectNodeId || rootId;
      if (fallbackId) {
        if (governing?.promoteToRuler) {
          await governing.promoteToRuler({
            nodeId: fallbackId,
            reason: `swarm dispatch declaring Ruler at scope: ${String(userRequest || "").slice(0, 80)}`,
            promotedFrom: governing.PROMOTED_FROM?.ROOT,
          });
        }
        projectNode = await NodeModel.findById(fallbackId).select("_id name metadata").lean();
      }
    }
  } catch (err) {
    log.warn("Tree Orchestrator", `dispatchSwarmPlan: scope lookup failed: ${err.message}`);
  }

  if (!projectNode) {
    log.warn("Tree Orchestrator", "dispatchSwarmPlan: no Ruler scope resolvable; skipping dispatch.");
    return "";
  }

  // ─────────────────────────────────────────────────────────────────
  // POST-APPROVAL FLOW (top-level user-initiated path)
  //
  // The user just clicked Accept on the proposed plan. The flow now:
  //
  //   1. Hire Contractor at this scope. The Planner's emission was the
  //      input that the Ruler approved; Contractor binds shared
  //      vocabulary between sub-domains based on that plan.
  //      ★ Stage 1 moved Contractor invocation out: governing-hire-
  //      contractor (a Ruler tool) now spawns the Contractor as a
  //      chainstep. By the time dispatchSwarmPlan runs, contracts
  //      should already be ratified at this scope. We verify that
  //      precondition and skip Contractor invocation here.
  //   2. Foreman creates the execution-record tied to the active
  //      plan emission + contracts emission. Step status writes land
  //      here as the run progresses.
  //   3. Ruler-own integration phase: Worker writes the leaf-step
  //      files at this scope (package.json, README, root index.html).
  //   4. swarm.runBranchSwarm dispatches sub-Rulers per branch step.
  //
  // For sub-Ruler dispatch, all of this happens INSIDE runRulerCycle
  // automatically (auto-approve). Only the top-level entry through
  // dispatchSwarmPlan goes through the user-approval pause.
  // ─────────────────────────────────────────────────────────────────

  // Step 1: verify contracts are ratified. Stage 1's hire-contractor
  // Ruler tool is responsible for ratifying contracts before dispatch.
  // If contracts are missing, we surface honestly rather than spawn
  // Contractor inline (which would bypass the Ruler-as-being
  // architecture). The Ruler should call hire-contractor first.
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.readActiveContractsEmission) {
      const cEm = await governing.readActiveContractsEmission(projectNode._id);
      if (!cEm) {
        log.warn("Tree Orchestrator",
          `dispatchSwarmPlan called at ${String(projectNode._id).slice(0, 8)} ` +
          `with no ratified contracts. The Ruler should call hire-contractor ` +
          `before dispatch. Continuing without contracts (sub-Rulers will ` +
          `dispatch under no shared vocabulary; expect coordination drift).`);
      }
    }
  } catch (err) {
    log.debug("Tree Orchestrator", `contract precondition check skipped: ${err.message}`);
  }

  // Step 2: Foreman creates the execution-record. Tied to the active
  // plan emission + the contracts emission the Contractor produced.
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.appendExecutionRecord) {
      const planEmission = governing.readActivePlanEmission
        ? await governing.readActivePlanEmission(projectNode._id)
        : null;
      let contractsEmissionRef = null;
      if (governing.readActiveContractsEmission) {
        const cEm = await governing.readActiveContractsEmission(projectNode._id);
        if (cEm?._emissionNodeId) contractsEmissionRef = cEm._emissionNodeId;
      }
      if (planEmission?._emissionNodeId) {
        const recordOut = await governing.appendExecutionRecord({
          rulerNodeId: projectNode._id,
          userId,
          core: null,
          planEmissionRef: planEmission._emissionNodeId,
          planEmission,
          contractsEmissionRef,
        });
        log.info("Tree Orchestrator",
          `📒 execution-record created at ${String(projectNode._id).slice(0, 8)}: ` +
          `${recordOut?.recordNode?._id ? `node=${String(recordOut.recordNode._id).slice(0, 8)}` : "node=?"}, ` +
          `ordinal=${recordOut?.ordinal ?? "?"}`);
      } else {
        log.warn("Tree Orchestrator",
          `📒 execution-record SKIPPED at ${String(projectNode._id).slice(0, 8)}: ` +
          `no plan emission with _emissionNodeId (planEmission=${!!planEmission})`);
      }
    } else {
      log.warn("Tree Orchestrator",
        `📒 execution-record SKIPPED at ${String(projectNode._id).slice(0, 8)}: governing.appendExecutionRecord unavailable`);
    }
  } catch (err) {
    log.warn("Tree Orchestrator", `📒 execution-record creation FAILED: ${err.message}`);
  }

  try {
  // Step-order execution. Walk the Planner's emission.steps in plan
  // order. Each iteration handles either a leaf-batch (Worker writes
  // files at this scope) or a branch step (sub-Rulers run their own
  // lifecycles in parallel within the step). The Foreman holds
  // call-stack discipline: step N+1 cannot start until step N's
  // entire descendant subtree settles.
  let planSteps = [];
  let allBranchNames = [];
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.readActivePlanEmission) {
      const emission = await governing.readActivePlanEmission(projectNode._id);
      if (emission?.steps?.length) {
        // Hydrate stepIndex (1-based) onto each emission step. The
        // emission itself doesn't carry stepIndex — that field is only
        // written on the execution-record's stepStatuses (see
        // governing/state/foreman.js#buildInitialStepStatuses). Without
        // hydration, runLeafGroupAtScope's targetIndices set is empty
        // and the auto-mark loop falls off its per-batch filter — the
        // first batch's classification then leaks onto every still-
        // pending leaf, regardless of which batch they belong to.
        // Hydrating once at dispatch entry keeps the downstream comment
        // contract ("each group has a 1-based stepIndex") true.
        planSteps = emission.steps.map((s, i) => ({ ...s, stepIndex: i + 1 }));
        allBranchNames = planSteps
          .filter((s) => s?.type === "branch" && Array.isArray(s.branches))
          .flatMap((s) => s.branches.map((b) => b?.name).filter(Boolean));
      }
    }
  } catch (err) {
    log.warn("Tree Orchestrator", `step-loop emission read FAILED: ${err.message}`);
  }

  // The forbidden-paths block lists ALL branch sub-domains in the
  // plan, not just adjacent ones — branches that haven't run yet
  // still own their territories (sub-Rulers promote on first
  // dispatch), so the Worker must never write into them regardless
  // of execution timing.
  const groups = groupStepsForExecution(planSteps);
  const leafBatchCount = groups.filter((g) => g.kind === "leaves").length;
  const branchStepCount = groups.filter((g) => g.kind === "branch").length;
  // Surface the type breakdown per leaf batch so logs make the
  // execution sequence legible at a glance.
  const leafTypeBreakdown = groups
    .filter((g) => g.kind === "leaves")
    .map((g) => `${g.steps.length}${(g.workerType || "build")[0]}`)
    .join("+");
  log.info("Tree Orchestrator",
    `🪜 Step loop at ${String(projectNode._id).slice(0, 8)}: ` +
    `${groups.length} group(s) (${leafBatchCount} leaf batch(es)` +
    (leafTypeBreakdown ? ` [${leafTypeBreakdown}]` : "") +
    `, ${branchStepCount} branch step(s)), ` +
    `planSteps.length=${planSteps.length}`);
  if (groups.length === 0) {
    log.warn("Tree Orchestrator",
      `🪜 Step loop will run NOTHING — planSteps was empty. ` +
      `No work will happen for this dispatch. Check that the plan emission ` +
      `was readable at projectNode._id=${String(projectNode._id).slice(0, 8)}.`);
  }

  let lastSwarmResult = { summary: "leaf-only build (no sub-Ruler dispatch)" };
  let recordNodeIdForRollup = null;
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.readActiveExecutionRecord) {
      const record = await governing.readActiveExecutionRecord(projectNode._id);
      recordNodeIdForRollup = record?._recordNodeId || null;
    }
  } catch {}

  // Foreman halt-marker cache for the step-loop. Mirrors the same
  // pattern in swarm.js (per-branch queue): cache the read briefly
  // so a tight loop doesn't hammer Mongo, but stay tight enough to
  // pick up Foreman writes within ~500ms of when they land.
  //
  // The step-loop reads this BEFORE each group dispatches so a
  // cancel-subtree or pause-frame written during one group's run
  // halts the next group instead of continuing past it. The swarm
  // queue's halt-check (swarm.js) handles in-branch dispatching;
  // this check handles between-step dispatching.
  const HALT_CACHE_TTL_MS = 500;
  let cachedStepHaltCheck = null;
  let cachedStepHaltCheckAt = 0;
  async function readStepHaltMarkers() {
    const now = Date.now();
    if (cachedStepHaltCheck && (now - cachedStepHaltCheckAt) < HALT_CACHE_TTL_MS) {
      return cachedStepHaltCheck;
    }
    try {
      const { getExtension } = await import("../loader.js");
      const governing = getExtension("governing")?.exports;
      if (!governing?.readActiveExecutionRecord) {
        cachedStepHaltCheck = { status: null, pendingCancel: null, pendingPauseAt: null };
        cachedStepHaltCheckAt = now;
        return cachedStepHaltCheck;
      }
      const record = await governing.readActiveExecutionRecord(projectNode._id);
      cachedStepHaltCheck = {
        status: record?.status || null,
        pendingCancel: record?.pendingCancel || null,
        pendingPauseAt: typeof record?.pendingPauseAt === "number" ? record.pendingPauseAt : null,
      };
      cachedStepHaltCheckAt = now;
      return cachedStepHaltCheck;
    } catch (err) {
      log.debug("Tree Orchestrator", `step-loop halt-marker read skipped: ${err.message}`);
      return { status: null, pendingCancel: null, pendingPauseAt: null };
    }
  }

  // Each group has a 1-based stepIndex (leaf groups carry one for
  // each step in the batch; branch groups carry the step's index
  // directly). For pendingPauseAt comparison we use the EARLIEST
  // step index in the upcoming group — the deferred-pause boundary
  // is "stop before dispatching step N," so a leaf batch covering
  // steps 3,4,5 with pendingPauseAt=4 must halt before that batch
  // runs (otherwise step 4 dispatches alongside 3 and the boundary
  // misses). For branch groups, group.step.stepIndex is the boundary.
  function earliestStepIndex(group) {
    if (group.kind === "leaves") {
      return group.steps.reduce((min, s) => {
        const i = Number.isFinite(s?.stepIndex) ? s.stepIndex : Infinity;
        return i < min ? i : min;
      }, Infinity);
    }
    if (group.kind === "branch") {
      return Number.isFinite(group.step?.stepIndex) ? group.step.stepIndex : Infinity;
    }
    return Infinity;
  }

  for (const group of groups) {
    if (signal?.aborted) break;

    // Foreman halt-marker check. The Foreman's cancel-subtree /
    // pause-frame writes markers on the active execution-record;
    // halt the step loop when any halt-condition is set. The
    // Foreman has already frozen descendant records and aborted
    // in-flight controllers; the step loop's job is to stop
    // dispatching MORE work.
    const halt = await readStepHaltMarkers();
    if (halt.status === "cancelled" || halt.pendingCancel) {
      log.warn("Tree Orchestrator",
        `🛑 Step loop cancelled by Foreman at ${String(projectNode._id).slice(0, 8)} ` +
        `(remaining groups skipped)`);
      break;
    }
    if (halt.status === "paused") {
      log.warn("Tree Orchestrator",
        `⏸ Step loop paused by Foreman at ${String(projectNode._id).slice(0, 8)} ` +
        `(remaining groups will resume on foreman-resume-frame)`);
      break;
    }
    // Deferred-pause: halt BEFORE dispatching a group whose earliest
    // step index matches pendingPauseAt. The execution-record gets
    // flipped to "paused" so the Foreman's next wakeup sees the
    // settled state, and the snapshot's resumeAnchors point at the
    // correct re-entry step.
    const upcomingStepIndex = earliestStepIndex(group);
    if (halt.pendingPauseAt && halt.pendingPauseAt === upcomingStepIndex) {
      log.warn("Tree Orchestrator",
        `⏸ Step loop deferred-pause boundary reached (step ${halt.pendingPauseAt}); ` +
        `flipping execution-record to paused and halting.`);
      try {
        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;
        if (recordNodeIdForRollup && governing?.freezeExecutionRecord) {
          await governing.freezeExecutionRecord({
            recordNodeId: recordNodeIdForRollup,
            nextStatus: "paused",
          });
        }
      } catch (err) {
        log.debug("Tree Orchestrator", `deferred-pause freeze skipped: ${err.message}`);
      }
      break;
    }

    if (group.kind === "leaves") {
      let leafBatchError = null;
      try {
        await runLeafGroupAtScope({
          leafSteps: group.steps,
          workerType: group.workerType,
          projectNode,
          visitorId, userId, username, rootId,
          signal, slot, socket, onToolLoopCheckpoint, sessionId, rootChatId, rt,
          stashedPlanText,
          allBranchNames,
        });
      } catch (err) {
        leafBatchError = err;
        log.warn("Tree Orchestrator",
          `Leaf batch failed (workerType=${group.workerType || "build"}): ${err.message}`);
      }
      // Leaf-batch failure → mark the batch's leaf steps "failed" so
      // the dashboard, snapshot, and Pass 2 readers see the precise
      // step that broke, then wake the Foreman with a leaf-failed
      // wakeup carrying the workerType. The Foreman decides retry /
      // mark-failed / escalate; without the wakeup, leaf failures
      // sit silent and the swarm-completed wakeup at the end
      // conflates them with the rest of the rollup.
      if (leafBatchError) {
        await markLeafBatchFailed(
          recordNodeIdForRollup,
          group.steps,
          leafBatchError,
        );
        await wakeForemanForLeafFailure({
          projectNode, recordNodeIdForRollup,
          workerType: group.workerType || "build",
          leafSteps: group.steps,
          error: leafBatchError,
          visitorId, username, userId, rootId,
          signal, slot, socket, onToolLoopCheckpoint, sessionId, rootChatId, rt,
        });
      }
    } else if (group.kind === "branch") {
      let branchStepError = null;
      try {
        lastSwarmResult = await runBranchStepAtScope({
          branchStep: group.step,
          projectNode,
          sw,
          visitorId, userId, username, rootId,
          signal, slot, socket, onToolLoopCheckpoint, sessionId, rootChatId, rt,
          architectChatId, userRequest,
        });
      } catch (err) {
        branchStepError = err;
        log.warn("Tree Orchestrator", `Branch step failed: ${err.message}`);
      }
      // Roll up this branch step's parent status from sub-branches
      // immediately so the next step (and the dashboard) sees it
      // settled before proceeding.
      let rolledUpStatus = null;
      try {
        const { getExtension } = await import("../loader.js");
        const governing = getExtension("governing")?.exports;
        if (recordNodeIdForRollup && Number.isFinite(group.step?.stepIndex)) {
          rolledUpStatus = await rollUpBranchStepStatus(
            governing,
            recordNodeIdForRollup,
            group.step.stepIndex,
          );
        }
      } catch (err) {
        log.debug("Tree Orchestrator", `branch-step rollup skipped: ${err.message}`);
      }
      // Branch step failure → wake the Foreman with a branch-failed
      // wakeup. The trigger is either (a) the step itself threw, or
      // (b) the rollup landed on "failed" (every sub-branch failed
      // and zero done). The Foreman reads the snapshot, sees the
      // sub-branch failures with their workerTypes, and decides
      // retry-branch / mark-failed / cancel-subtree / escalate.
      if (branchStepError || rolledUpStatus === "failed") {
        await wakeForemanForBranchFailure({
          projectNode, recordNodeIdForRollup,
          branchStep: group.step,
          rolledUpStatus,
          error: branchStepError,
          visitorId, username, userId, rootId,
          signal, slot, socket, onToolLoopCheckpoint, sessionId, rootChatId, rt,
        });
      }
    }
  }

  const swarmResult = lastSwarmResult;
  // Restore position to the project root so subsequent chat turns
  // land on the project, not the last-running branch.
  if (projectNode?._id) setCurrentNodeId(visitorId, String(projectNode._id));

    // Foreman judges termination. Roll up branch-step parents from
    // their sub-branches first (deterministic — the sub-branches
    // already reached terminal state via dualWriteBranchStep), then
    // hand the rolled-up state to the Foreman to decide whether the
    // record should freeze "completed" or "failed". The Foreman is
    // the being that decides; the orchestrator just rolls and asks.
    try {
      const { getExtension } = await import("../loader.js");
      const governing = getExtension("governing")?.exports;
      if (governing?.readActiveExecutionRecord
          && governing?.updateStepStatus
          && projectNode?._id) {
        const record = await governing.readActiveExecutionRecord(projectNode._id);
        if (record?._recordNodeId) {
          // Deterministic roll-up: branch-step parent statuses are a
          // function of their sub-branch statuses. Not a judgment call.
          //
          // Priority of bad-news signals:
          //   any sub failed     → parent failed     (tried-and-couldn't dominates)
          //   any sub blocked    → parent blocked    (waiting beats progress)
          //   all subs cancelled → parent cancelled  (operator intent dominates)
          //   all subs progressed (done | advanced | skipped) → parent done
          //
          // "advanced" (Foreman override) and "skipped" (bypassed) both
          // count as terminal-with-progress for rollup purposes — the
          // work is settled, not failed. The parent's status reflects
          // settlement, not strict-success. Consumers that care about
          // the strict-success distinction (artifact validators, file-
          // import readers) check step.status === "done" specifically.
          //
          // "cancelled" requires ALL subs to be cancelled — a partial
          // cancel under a parent whose other subs failed should still
          // surface the failure (operator intent + execution failure
          // should both register; failure is louder). Likewise mixed
          // (some done, some cancelled) → done dominates because the
          // work that DID complete is real progress.
          const PROGRESSED = new Set(["done", "advanced", "skipped"]);
          const completedAt = new Date().toISOString();
          for (const step of (record.stepStatuses || [])) {
            if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
            const subs = step.branches;
            const allProgressed = subs.length > 0 && subs.every((b) => PROGRESSED.has(b.status));
            const allCancelled = subs.length > 0 && subs.every((b) => b.status === "cancelled");
            const anySubFailed = subs.some((b) => b.status === "failed");
            const anySubBlocked = subs.some((b) => b.status === "blocked");
            let nextStatus = step.status;
            if (anySubFailed) nextStatus = "failed";
            else if (anySubBlocked) nextStatus = "blocked";
            else if (allCancelled) nextStatus = "cancelled";
            else if (allProgressed) nextStatus = "done";
            if (nextStatus !== step.status) {
              const isTerminal = nextStatus === "done"
                || nextStatus === "failed"
                || nextStatus === "cancelled";
              await governing.updateStepStatus({
                recordNodeId: record._recordNodeId,
                stepIndex: step.stepIndex,
                updates: {
                  status: nextStatus,
                  startedAt: step.startedAt || completedAt,
                  completedAt: isTerminal ? completedAt : null,
                },
              });
            }
          }

          // Foreman invocation: the judgment is "should this record
          // freeze, and at what terminal status?" The Foreman reads
          // the rolled-up state AND the artifact-evidence block —
          // notes/children/blocking-flags on the tree at this scope —
          // so the freeze decision is grounded in what's actually
          // present, not just step status. Then decides via foreman-
          // freeze-record (or foreman-escalate-to-ruler if the
          // situation needs re-planning).
          const { runForemanTurn } = await import("./ruling.js");
          const post = await governing.readActiveExecutionRecord(projectNode._id);
          const counts = { done: 0, failed: 0, blocked: 0, advanced: 0, pending: 0, running: 0 };
          for (const s of (post?.stepStatuses || [])) {
            counts[s?.status] = (counts[s?.status] || 0) + 1;
          }
          // Per-leaf outcome breakdown — what each step settled to,
          // with the Worker's classification reason. The Foreman uses
          // this alongside the evidence block to judge whether a "done"
          // is real or a status lie.
          const leafLines = [];
          for (const s of (post?.stepStatuses || [])) {
            if (s?.type !== "leaf") continue;
            const wt = s.workerType ? `${s.workerType} ` : "";
            const spec = s.spec ? `: ${String(s.spec).slice(0, 120)}` : "";
            const tail = s.reason
              ? `  → ${String(s.reason).slice(0, 200)}`
              : (s.error ? `  → ${String(s.error).slice(0, 200)}` : "");
            leafLines.push(`  step ${s.stepIndex} [${wt}${s.status}]${spec}${tail}`);
          }
          const leafBlock = leafLines.length > 0
            ? `\nPer-leaf outcomes:\n${leafLines.join("\n")}\n`
            : "";

          let evidenceBlock = "";
          try {
            if (governing?.renderArtifactEvidence) {
              evidenceBlock = await governing.renderArtifactEvidence(projectNode._id);
            }
          } catch (err) {
            log.debug("Tree Orchestrator", `artifact-evidence render skipped: ${err.message}`);
          }

          const summary =
            `Swarm dispatch returned. Step rollup: ${counts.done || 0} done, ` +
            `${counts.failed || 0} failed, ${counts.blocked || 0} blocked, ` +
            `${counts.advanced || 0} advanced, ` +
            `${counts.pending || 0} pending, ${counts.running || 0} running.` +
            leafBlock +
            (evidenceBlock ? `\n${evidenceBlock}\n` : "") +
            `\nDecide whether to freeze the execution-record (and at what status) ` +
            `or escalate to the Ruler. VERIFY artifact existence at children ` +
            `named by leaf specs before freezing as completed — a leaf marked ` +
            `done with no matching artifact above means the Worker ended its ` +
            `turn without producing the promised output.`;
          try {
            await runForemanTurn({
              visitorId,
              message: summary,
              username, userId, rootId,
              currentNodeId: String(projectNode._id),
              signal, slot, socket,
              sessionId, rootChatId, rt,
              readOnly: false, onToolLoopCheckpoint,
              wakeup: { reason: "swarm-completed", payload: summary },
            });
          } catch (err) {
            // Foreman invocation failure is non-fatal — the record
            // stays running and a future turn (or resume) re-evaluates.
            log.warn("Tree Orchestrator", `Foreman swarm-completed turn failed: ${err.message}`);
          }
        }
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `execution-record freeze skipped: ${err.message}`);
    }

    return swarmResult?.summary || "";
  } catch (err) {
    log.error("Tree Orchestrator", `dispatchSwarmPlan failed: ${err.message}`);
    log.error("Tree Orchestrator", err.stack?.split("\n").slice(0, 5).join("\n"));
    return `Swarm dispatch failed: ${err.message}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DISPATCH RESUME PLAN
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sister to dispatchSwarmPlan. Resumes a paused execution-record by
 * walking detectResumableSwarm to find pending branches, then re-
 * dispatching them via runBranchSwarm({resumeMode: true}).
 *
 * Called from foreman-resume-frame's dispatch case. The Foreman has
 * already cleared the pause markers (applyResumeFrame); this function
 * is the work that actually re-queues pending branches and resumes
 * dispatch.
 *
 * Behavior in the empty-resumable case: returns null. The caller
 * (foreman-resume-frame in ruling.js) should then invoke another
 * Foreman turn with wakeup="resume-found-no-work" so the Foreman
 * decides whether to freeze the record completed or escalate.
 *
 * Cancelled and superseded records won't appear in detectResumableSwarm's
 * resumable list (that filter landed in Phase B/C of the cancelled
 * sweep), so resuming a cancelled record is effectively a no-op here.
 */
export async function dispatchResumePlan(rulerScopeNodeId, runtimeCtx) {
  const sw = await swarmExt();
  if (!sw) {
    log.warn("Tree Orchestrator", "dispatchResumePlan called but swarm extension not loaded.");
    return "";
  }
  if (!sw.detectResumableSwarm || !sw.runBranchSwarm) {
    log.warn("Tree Orchestrator", "dispatchResumePlan: swarm helpers unavailable.");
    return "";
  }

  const {
    visitorId, userId, username, rootId,
    sessionId, signal, slot, socket, onToolLoopCheckpoint, rt,
    rootChatId, defaultBranchMode,
  } = runtimeCtx || {};

  const NodeModel = (await import("../../seed/models/node.js")).default;
  const projectNode = await NodeModel.findById(rulerScopeNodeId)
    .select("_id name metadata").lean();
  if (!projectNode) {
    log.warn("Tree Orchestrator",
      `dispatchResumePlan: scope node ${String(rulerScopeNodeId).slice(0, 8)} not found.`);
    return "";
  }

  const resumable = await sw.detectResumableSwarm(projectNode._id);
  if (!resumable || resumable.resumable.length === 0) {
    log.info("Tree Orchestrator",
      `▶️  dispatchResumePlan: no resumable branches at ${String(projectNode._id).slice(0, 8)}; ` +
      `caller should re-invoke Foreman with wakeup=resume-found-no-work`);
    return null;
  }

  log.info("Tree Orchestrator",
    `▶️  dispatchResumePlan: ${resumable.resumable.length} of ${resumable.total} branches resumable ` +
    `at ${String(projectNode._id).slice(0, 8)} (${JSON.stringify(resumable.statusCounts)})`);

  emitStatus(socket, "intent", `Resuming ${resumable.resumable.length} branch(es)...`);

  try {
    const swarmResult = await sw.runBranchSwarm({
      branches: resumable.resumable,
      rootProjectNode: projectNode,
      rootChatId,
      sessionId,
      visitorId,
      userId,
      username,
      rootId,
      signal,
      slot,
      socket,
      onToolLoopCheckpoint,
      userRequest: resumable.systemSpec || "(resumed work)",
      rt,
      resumeMode: true,
      defaultBranchMode: defaultBranchMode || null,
      core: { metadata: { setExtMeta: async (node, ns, data) => {
        const NM = (await import("../../seed/models/node.js")).default;
        await NM.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
      } } },
      emitStatus,
      runBranch: async ({ mode: branchMode, message: branchMessage, branchNodeId, slot: branchSlot, markerChatId }) => {
        setActiveRequest(visitorId, {
          socket, username, userId, signal,
          sessionId, rootId, rootChatId,
          slot, onToolLoopCheckpoint,
          rt: (getActiveRequest(visitorId) || {}).rt,
        });
        const branchIdStr = await pinBranchPosition(visitorId, branchNodeId, branchMode, {
          username, userId, rootId,
        });
        const { runRulerTurn } = await import("./ruling.js");
        return await runRulerTurn({
          visitorId,
          message: branchMessage,
          username, userId, rootId,
          currentNodeId: branchIdStr,
          signal, slot: branchSlot, socket,
          sessionId, rootChatId, rt,
          readOnly: false, onToolLoopCheckpoint,
          dispatchOrigin: "branch-swarm",
        });
      },
    });

    emitStatus(socket, "done", "");
    return swarmResult?.summary || "";
  } catch (err) {
    log.error("Tree Orchestrator", `dispatchResumePlan failed: ${err.message}`);
    log.error("Tree Orchestrator", err.stack?.split("\n").slice(0, 5).join("\n"));
    return `Resume failed: ${err.message}`;
  }
}

