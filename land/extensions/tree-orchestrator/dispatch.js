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
export function buildSocketBridge(socket, signal = null) {
  const isLive = () => socket?.emit && !signal?.aborted;
  return {
    onToolResults: (results) => {
      if (!isLive()) return;
      for (const r of results) socket.emit(WS.TOOL_RESULT, r);
    },
    onToolCalled: (call) => {
      if (!isLive()) return;
      socket.emit(WS.TOOL_CALLED, call);
    },
    onThinking: (thought) => {
      if (!isLive()) return;
      socket.emit(WS.THINKING, thought);
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

  // Surface the actual mode that's running so the UI can show the dispatch
  // hop. The classifier already emits `orchestratorStep` with the intent
  // result, but when grammar/graph routes onward (e.g., food-coach → food-log)
  // the client never learns about the destination without this.
  emitModeResult(socket, mode, { mode, phase: "dispatch" });

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

  const result = await runSteppedMode(visitorId, mode, message, {
    username, userId, rootId, signal, slot,
    readOnly, onToolLoopCheckpoint, socket,
    sessionId, rootChatId, rt,
    skipRespond,
  });

  emitStatus(socket, "done", "");
  let answer = result?._allContent || result?.content || result?.answer || null;

  // Branch swarm detection. If the mode emitted a [[BRANCHES]]...[[/BRANCHES]]
  // block, parse it and dispatch each branch as its own sequence of
  // plan-mode runs at a dedicated child node. This is how a compound
  // project request ("make a tinder app with backend and frontend") turns
  // into a tree of chats that each build one component. The branch runner
  // is sequential in phase 1; the `slot` field on each branch is preserved
  // for when we flip to parallel (per-slot LLM routing).
  if (answer) {
    const sw = await swarmExt();
    if (!sw) {
      // swarm extension absent: leave the answer unchanged, skip dispatch.
      // A mode emitting [[BRANCHES]] has nothing to dispatch to without swarm.
    } else {
    // Parse contracts FIRST so parseBranches sees the cleaned text.
    // Contracts are optional — a simple single-branch build doesn't need
    // them — but when present they become the authoritative wire protocol
    // every branch must implement.
    const contractsParse = sw.parseContracts(answer);
    let parsedContracts = contractsParse.contracts;
    if (parsedContracts.length > 0) {
      answer = contractsParse.cleaned;
      if (result) {
        result.content = contractsParse.cleaned;
        result.answer = contractsParse.cleaned;
      }
      log.info("Tree Orchestrator",
        `📜 Architect declared ${parsedContracts.length} contract(s): ${parsedContracts.map((c) => `${c.kind} ${c.name}`).join(", ")}`,
      );
    }

    log.info("Tree Orchestrator", `🔍 parseBranches input: ${answer?.length || 0} chars, has [[BRANCHES]]: ${answer?.includes?.("[[BRANCHES]]") || false}`);
    const branchParse = sw.parseBranches(answer);
    log.info("Tree Orchestrator", `🔍 parseBranches result: ${branchParse.branches.length} branches`);
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
        let projectNode = searchNodeId ? await sw.findProjectForNode(searchNodeId) : null;
        if (!projectNode) {
          const promoteId = currentNodeId || targetNodeId || rootId;
          if (promoteId) {
            log.info("Tree Orchestrator",
              `Swarm: no project at position, promoting ${promoteId === rootId ? "tree root" : "current node"} ${promoteId}`);
            projectNode = await sw.ensureProject({
              rootId: promoteId,
              systemSpec: message,
              owner: { userId, username },
            });
          }
        }

        if (!projectNode) {
          log.warn("Tree Orchestrator", "Swarm: no project root found at current position; branches will not run.");
        } else {
          // NOTE: contracts are written AFTER validation + auto-retry
          // passes (see below). Writing them up front was causing
          // dead contracts to persist when validation rejected the
          // plan — a later "continue plan" turn would then find them
          // in enrichContext and have a builder mode generate code
          // against contracts whose branches never existed. Defer
          // until we know the plan is definitely going to be stashed
          // for approval.

          // Validate the architect's branch paths. If any branch is
          // broken, try ONE automatic retry with the errors injected
          // as feedback before giving up and showing the user the
          // rejection. Local models routinely flub name↔path on
          // first pass (adding -system / core- suffixes to names)
          // and self-correct cleanly when told exactly what to fix.
          let validation = sw.validateBranches(branchParse.branches, projectNode?.name);
          if (validation.errors.length > 0) {
            log.warn("Tree Orchestrator",
              `🚫 Swarm: plan rejected with ${validation.errors.length} error(s). Auto-retrying architect once.\n  - ${validation.errors.join("\n  - ")}`,
            );

            const retryPrompt =
              `The [[BRANCHES]] block you emitted was REJECTED by validation:\n\n` +
              validation.errors.map((e) => `  • ${e}`).join("\n") + "\n\n" +
              `Re-emit a CORRECTED [[BRANCHES]] block that fixes every error above. ` +
              `Hard rule: each branch's \`path\` MUST equal its \`name\` letter-for-letter, ` +
              `except for the one integration branch at \`path: "."\` (the shell that owns ` +
              `the root entry file). Do NOT add suffixes like -system / -logic / core- to ` +
              `branch names — descriptive labels belong in \`spec:\`, not \`name:\`. ` +
              `Close with [[DONE]].`;

            try {
              const { runChat } = await import("../../seed/llm/conversation.js");
              const retryResult = await runChat({
                userId, username,
                message: retryPrompt,
                mode,
                rootId,
                nodeId: String(projectNode._id),
                // Architect retry — one-shot, default ephemeral session.
                llmPriority: "INTERACTIVE",
                signal,
              });
              const retryAnswer = (retryResult?.answer || retryResult?.content || "").toString();
              const retryParse = sw.parseBranches(retryAnswer);
              if (retryParse.branches.length > 0) {
                const retryValidation = sw.validateBranches(retryParse.branches, projectNode?.name);
                if (retryValidation.errors.length === 0) {
                  // Retry succeeded — swap in the corrected branches
                  // and fall through to the normal stash+emit path.
                  // Also update `answer` / `result` so the text we
                  // append below uses the corrected plan summary.
                  log.info("Tree Orchestrator",
                    `🔁 Architect auto-retry produced valid plan: ${retryParse.branches.map((b) => b.name).join(", ")}`,
                  );
                  branchParse.branches = retryParse.branches;
                  branchParse.cleaned = retryParse.cleaned;
                  answer = retryParse.cleaned || answer;
                  if (result) {
                    result.content = answer;
                    result.answer = answer;
                  }
                  validation = retryValidation; // now clean
                } else {
                  log.warn("Tree Orchestrator",
                    `Auto-retry still invalid: ${retryValidation.errors.join("; ")}`,
                  );
                  validation = retryValidation;
                }
              } else {
                log.warn("Tree Orchestrator",
                  `Auto-retry returned no [[BRANCHES]] block.`,
                );
              }
            } catch (retryErr) {
              log.warn("Tree Orchestrator", `Auto-retry failed: ${retryErr.message}`);
            }

            // If retry didn't fix it, surface the reject to the user.
            if (validation.errors.length > 0) {
              const errorBlock = [
                "",
                "⚠️ BRANCH PLAN REJECTED — the [[BRANCHES]] block violated the seam rules:",
                ...validation.errors.map((e) => `  • ${e}`),
                "",
                "Re-emit the [[BRANCHES]] block with valid paths and [[DONE]] your turn again.",
              ].join("\n");
              answer = (answer || "") + "\n" + errorBlock;
              if (result) {
                result.content = answer;
                result.answer = answer;
              }
              return { success: true, answer, modeKey: mode, modesUsed, rootId, targetNodeId: targetNodeId || currentNodeId };
            }
          }

          // ── Plan-first dispatch: pause here ──
          // Validation passed (possibly after auto-retry). Now — and
          // only now — persist contracts and stash the plan for
          // approval. Writing contracts BEFORE validation caused
          // dead contracts to linger when plans got rejected.
          if (parsedContracts && parsedContracts.length > 0) {
            try {
              // userId is required: setContracts resolves the plan-type
              // child via ensurePlanAtScope, which CREATES it if none
              // exists. Without userId, the helper would fall back to
              // findGoverningPlan and silently no-op when the child
              // hasn't been created yet (which is always true on a
              // first dispatch — the plan child is created lazily).
              await sw.setContracts({
                scopeNodeId: projectNode._id,
                contracts: parsedContracts,
                userId,
                // The originating user request — captured in the
                // plan-created ledger entry if setContracts ends up
                // creating the plan node. Without it the ledger loses
                // the trace from plan → spawning request.
                systemSpec: message,
                // Explicit null: this site (runModeAndReturn) doesn't
                // receive a core in its options, and the `core,`
                // shorthand was a ReferenceError that the try/catch
                // silently swallowed as "core is not defined".
                // setContracts goes through the kernel's unscoped
                // setExtMeta internally, so a null scoped-core is fine.
                core: null,
              });
              log.info("Tree Orchestrator",
                `📜 Contracts stored on plan at scope ${String(projectNode._id).slice(0, 8)} (${parsedContracts.length} entries)`,
              );
            } catch (ctxErr) {
              log.warn("Tree Orchestrator", `Failed to store contracts: ${ctxErr.message}`);
            }
          }

          // Instead of calling runBranchSwarm directly, stash the
          // parsed plan and emit a proposal event. The user reviews
          // the plan on their next turn; the orchestrator-level
          // interception (see orchestrator.js handlePendingSwarmPlan)
          // then either accepts → dispatches via dispatchSwarmPlan(),
          // revises → re-calls the architect, or pivots → archives.
          //
          // Version handling: if a prior stash exists for this
          // visitor, this re-emit is a REVISION — bump its version.
          // Otherwise it's a fresh proposal → v1. The orchestrator's
          // revision branch pre-bumps version on the old stash before
          // asking the architect to re-emit; reading that value here
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

  // Flat-build scout. If the builder wrote files but dispatched no
  // branches, swarm:afterAllBranchesComplete never fired — so the
  // existing cross-branch validators (symbol coherence, behavioral
  // tests, etc.) stayed silent. Ask code-workspace for a one-shot
  // syntax scan across the workspace so obvious broken files surface
  // before the user tries to run the app.
  const SUMMARIZE_MODES = new Set(["tree:code-plan", "tree:code-log", "tree:code-coach"]);
  let flatScoutReport = null;
  if (
    SUMMARIZE_MODES.has(mode) &&
    (result?._writeCount || 0) > 0 &&
    rootId
  ) {
    try {
      const { getExtension } = await import("../loader.js");
      const cw = getExtension("code-workspace")?.exports;
      if (cw?.runFlatBuildScout) {
        flatScoutReport = await cw.runFlatBuildScout({ rootId });
        if (flatScoutReport?.errors?.length > 0) {
          log.warn("Tree Orchestrator",
            `🔍 Flat-build scout: ${flatScoutReport.errors.length} syntax issue(s) across ${flatScoutReport.filesScanned} file(s)`,
          );
        } else if (flatScoutReport?.filesScanned > 0) {
          log.info("Tree Orchestrator",
            `✅ Flat-build scout: ${flatScoutReport.filesScanned} file(s), zero syntax issues`,
          );
        }
      }
    } catch (err) {
      log.warn("Tree Orchestrator", `flat-build scout failed: ${err.message}`);
    }
  }

  // Summarizer rescue. When the builder ends with a bare "[[DONE]]" or
  // empty prose but tools actually ran, the user sees nothing. Fire a
  // one-shot summarizer so the chat doesn't close on silence. Only for
  // modes that opt in (the tree:code-* builder family). Skipped when
  // branches dispatched (they produce their own summary) or the builder
  // already wrote a real reply (>= 80 chars after marker strip).
  if (
    SUMMARIZE_MODES.has(mode) &&
    (result?._writeCount || 0) > 0 &&
    Array.isArray(result?._toolTrace) && result._toolTrace.length > 0 &&
    ((answer || "").trim().length < 80)
  ) {
    try {
      const { runChat } = await import("../../seed/llm/conversation.js");
      const traceLines = result._toolTrace
        .map((t) => `  - ${t.tool}${t.hint ? " (" + t.hint + ")" : ""}`)
        .join("\n");
      const scoutNote = flatScoutReport && flatScoutReport.errors?.length > 0
        ? `\n\nSCOUT FOUND SYNTAX ISSUES:\n${flatScoutReport.errors
            .slice(0, 6)
            .map((e) => `  - ${e.file}${e.line ? ":" + e.line : ""}: ${e.message}`)
            .join("\n")}\n(Mention these to the user — they will need to be fixed before the app runs.)`
        : "";
      const summarizerMsg =
        `ORIGINAL REQUEST:\n${message}\n\n` +
        `TOOL TRACE (${result._toolTrace.length} calls, ${result._writeCount} writes, ${result._readCount || 0} reads):\n${traceLines}\n\n` +
        `BUILDER'S FINAL REPLY: ${((answer || "").trim()) || "(empty)"}` +
        scoutNote +
        `\n\nWrite the user-facing recap now.`;
      const summary = await runChat({
        userId, username,
        message: summarizerMsg,
        mode: "tree:code-summarize",
        rootId,
        signal,
        // Tree-scoped summarizer lane — isolated from the user's chat,
        // chains across repeated summaries on the same tree.
        scope: "tree",
        purpose: "summarize",
        llmPriority: "INTERACTIVE",
      });
      const recap = (summary?.answer || "").trim();
      if (recap && recap.length > 0 && recap !== "No response.") {
        answer = recap;
        if (result) {
          result.content = recap;
          result.answer = recap;
        }
        log.info("Tree Orchestrator", `📝 Summarizer rescued bare [[DONE]] (${recap.length} chars)`);
      }
    } catch (err) {
      log.warn("Tree Orchestrator", `summarizer failed: ${err.message}`);
    }
  }

  // Coach → plan handoff. A diagnose-mode (tree:code-coach) that is
  // confident about a concrete fix emits `[[HANDOFF: <task>]]` on its
  // last line. The orchestrator strips that marker from the visible
  // answer and dispatches a fresh tree:code-plan run at the same node
  // with the task description as its input. Result: one chat turn
  // delivers both the diagnosis and the applied fix, instead of making
  // the user re-prompt.
  if (answer) {
    const handoffMatch = answer.match(/\[\[HANDOFF:\s*([^\]]+?)\s*\]\]/);
    if (handoffMatch) {
      const fixTask = handoffMatch[1].trim();
      answer = answer.replace(/\[\[HANDOFF:[^\]]+\]\]/g, "").trim();
      if (result) {
        result.content = answer;
        result.answer = answer;
      }
      log.info("Tree Orchestrator",
        `🔧 Handoff: coach → plan at ${currentNodeId || rootId} — "${fixTask.slice(0, 80)}${fixTask.length > 80 ? "..." : ""}"`,
      );
      try {
        const { runChat } = await import("../../seed/llm/conversation.js");
        const planRun = await runChat({
          userId, username,
          message: fixTask,
          mode: "tree:code-plan",
          rootId,
          nodeId: currentNodeId || targetNodeId || rootId,
          signal,
          // Tree-scoped handoff lane — coach→plan handoffs chain per tree.
          scope: "tree",
          purpose: "handoff",
          llmPriority: "INTERACTIVE",
        });
        const planAnswer = (planRun?.answer || "").trim();
        if (planAnswer) {
          answer = answer
            ? `${answer}\n\n---\n\n${planAnswer}`
            : planAnswer;
          if (result) {
            result.content = answer;
            result.answer = answer;
          }
          log.info("Tree Orchestrator", `🔧 Handoff plan completed (${planAnswer.length} chars)`);
        }
      } catch (err) {
        log.warn("Tree Orchestrator", `handoff plan failed: ${err.message}`);
        answer = `${answer}\n\n(handoff failed: ${err.message})`;
        if (result) {
          result.content = answer;
          result.answer = answer;
        }
      }
    }
  }

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
  } = planData || {};

  const {
    visitorId, userId, username, rootId: ctxRootId,
    sessionId, signal, slot, socket, onToolLoopCheckpoint, rt,
    rootChatId: ctxRootChatId,
  } = runtimeCtx || {};

  const rootId = stashedRootId || ctxRootId;
  const rootChatId = ctxRootChatId || stashedRootChatId || null;

  if (!Array.isArray(branches) || branches.length === 0) {
    return "";
  }

  // Resolve the project node from the stashed id. Use findProjectForNode
  // as the source of truth — the node may have moved or been renamed.
  let projectNode = null;
  try {
    if (projectNodeId) {
      projectNode = await sw.findProjectForNode(projectNodeId);
    }
    if (!projectNode && rootId) {
      projectNode = await sw.ensureProject({
        rootId,
        systemSpec: userRequest,
        owner: { userId, username },
      });
    }
  } catch (err) {
    log.warn("Tree Orchestrator", `dispatchSwarmPlan: project lookup failed: ${err.message}`);
  }

  if (!projectNode) {
    log.warn("Tree Orchestrator", "dispatchSwarmPlan: no project node resolvable; skipping dispatch.");
    return "";
  }

  // Re-persist contracts in case they changed between proposal and accept.
  // Pass userId through so setContracts → ensurePlanAtScope can create
  // the plan-type child if it doesn't yet exist on this dispatch path.
  if (Array.isArray(contracts) && contracts.length > 0) {
    try {
      await sw.setContracts({
        scopeNodeId: projectNode._id,
        contracts,
        userId,
        systemSpec: userRequest || null,
        core: { metadata: { setExtMeta: async (node, ns, data) => {
          const NodeModel = (await import("../../seed/models/node.js")).default;
          await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
        } } },
      });
    } catch (ctxErr) {
      log.warn("Tree Orchestrator", `dispatchSwarmPlan: contracts write failed: ${ctxErr.message}`);
    }
  }

  try {
    const swarmResult = await sw.runBranchSwarm({
      branches,
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
        return runSteppedMode(visitorId, branchMode, branchMessage, {
          username, userId, rootId, signal, slot: branchSlot,
          currentNodeId: branchIdStr,
          readOnly: false, onToolLoopCheckpoint, socket,
          sessionId, rootChatId, rt,
          parentChatId: markerChatId || rootChatId || null,
          dispatchOrigin: "branch-swarm",
        });
      },
    });

    // Restore position to the project root so subsequent chat turns
    // land on the project, not the last-running branch.
    if (projectNode?._id) setCurrentNodeId(visitorId, String(projectNode._id));

    return swarmResult?.summary || "";
  } catch (err) {
    log.error("Tree Orchestrator", `dispatchSwarmPlan failed: ${err.message}`);
    log.error("Tree Orchestrator", err.stack?.split("\n").slice(0, 5).join("\n"));
    return `Swarm dispatch failed: ${err.message}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SUB-PLAN DISPATCH (Pass 1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Dispatch an approved sub-plan. Called when the user accepts a
 * SUB_PLAN_PROPOSED card at a worker's scope. The sub-plan already
 * exists as a plan-type node (created in swarm.js's nested-BRANCHES
 * rewire); its steps are in "pending-approval" status. This function:
 *
 *   1. Flips pending-approval steps to "pending" on the sub-plan.
 *   2. Derives the branches array from the sub-plan's steps.
 *   3. Calls runBranchSwarm with resumeMode:true so the existing plan
 *      state is preserved (no duplicate re-init of role/steps).
 *   4. Anchors rootProjectNode at the sub-plan's PARENT (the worker's
 *      branch node, which is the scope). runBranchSwarm internally
 *      resolves rootPlanNodeId via ensurePlanAtScope which finds the
 *      existing sub-plan — no new creation.
 *
 * The runtime context (socket, signal, runtime, etc.) comes from the
 * caller (the WS handler reads getActiveRequest for the visitor's
 * live session).
 */
export async function dispatchApprovedSubPlan({ subPlanNodeId, runtimeCtx }) {
  if (!subPlanNodeId) return "";
  const sw = await swarmExt();
  if (!sw) {
    log.warn("Tree Orchestrator", "dispatchApprovedSubPlan: swarm extension not loaded.");
    return "";
  }

  const {
    visitorId, userId, username, rootId, sessionId, signal,
    slot, socket, onToolLoopCheckpoint, rt, rootChatId,
  } = runtimeCtx || {};

  if (!visitorId || !userId) {
    log.warn("Tree Orchestrator", "dispatchApprovedSubPlan: missing visitorId or userId — no active session");
    return "";
  }

  const { getExtension } = await import("../loader.js");
  const planExt = getExtension("plan")?.exports;
  if (!planExt?.readPlan) {
    log.warn("Tree Orchestrator", "dispatchApprovedSubPlan: plan extension not loaded.");
    return "";
  }

  // Read the sub-plan and its scope (plan's parent).
  const NodeModel = (await import("../../seed/models/node.js")).default;
  const subPlanNode = await NodeModel.findById(subPlanNodeId).select("_id name parent type metadata").lean();
  if (!subPlanNode || subPlanNode.type !== "plan") {
    log.warn("Tree Orchestrator", `dispatchApprovedSubPlan: ${subPlanNodeId} is not a plan-type node.`);
    return "";
  }
  const scopeNode = await NodeModel.findById(subPlanNode.parent).lean();
  if (!scopeNode) {
    log.warn("Tree Orchestrator", `dispatchApprovedSubPlan: scope node ${subPlanNode.parent} not found.`);
    return "";
  }

  const subPlan = await planExt.readPlan(subPlanNodeId);
  const pendingApproval = (subPlan?.steps || []).filter(
    (s) => s.kind === "branch" && s.status === "pending-approval",
  );
  if (pendingApproval.length === 0) {
    log.info("Tree Orchestrator", `dispatchApprovedSubPlan: no pending-approval steps on ${subPlanNodeId}; skipping.`);
    return "";
  }

  // Flip pending-approval → pending so runBranchSwarm picks them up.
  for (const step of pendingApproval) {
    await planExt.updateStep(subPlanNodeId, step.id, { status: "pending" }, null);
  }
  await planExt.appendLedger(subPlanNodeId, {
    event: "sub-plan-approved",
    detail: {
      scopeNodeId: String(scopeNode._id),
      scopeName: scopeNode.name || null,
      branchCount: pendingApproval.length,
      approvedBy: username || userId,
    },
  }, null);

  // Compute the sub-plan's depth so dispatched branches know how
  // nested they are. Depth is the length of the plan chain FROM the
  // scope node upward — how many plan-type ancestors sit between
  // this sub-plan and the outermost plan. A top-level root plan has
  // depth 0; its workers emitting nested [[BRANCHES]] create sub-plans
  // whose branches run at depth 1; their nested emissions would be
  // depth 2, etc. The depth cap in swarm.js's emission check rejects
  // emissions where currentDepth >= MAX_SUB_PLAN_DEPTH, so correctly
  // propagating depth ensures deeper nests hit the cap naturally.
  //
  // Implementation: count plan-type ancestors above scopeNode. The
  // scopeNode's parent is where scopeNode lives; its governing plan
  // is the outer one. findGoverningPlanChain walks from scopeNode up
  // through each successive plan parent, returning the chain of
  // plans. Its length IS the depth.
  let parentDepth = 0;
  try {
    if (planExt.findGoverningPlanChain) {
      const chain = await planExt.findGoverningPlanChain(String(scopeNode._id));
      // chain includes the sub-plan we're dispatching (governs scope);
      // depth for its branches is the count of plans governing THIS
      // sub-plan (excluding the sub-plan itself — that's us).
      parentDepth = Math.max(0, (chain?.length || 1) - 1);
    }
  } catch (err) {
    log.debug("Tree Orchestrator", `depth computation skipped: ${err.message}`);
  }
  const subBranchDepth = parentDepth + 1;

  // Build branches array from approved steps, each stamped with its
  // correct depth so the emission check in swarm.js catches further
  // decomposition attempts at the right level.
  const branches = pendingApproval.map((s) => ({
    name: s.title,
    spec: s.spec || "",
    path: s.path || null,
    files: s.files || [],
    slot: s.slot || null,
    mode: s.mode || null,
    parentBranch: s.parentBranch || null,
    parentNodeId: s.childNodeId || null,
    depth: subBranchDepth,
  }));

  // Resolve the workspace anchor: the outer project whose workspace
  // directory holds the actual files. Plan anchor (scopeNode) and
  // workspace anchor are separate concerns — sub-plans inherit their
  // outer project's workspace rather than owning one.
  let workspaceAnchorNode = null;
  try {
    if (sw.findProjectForNode) {
      workspaceAnchorNode = await sw.findProjectForNode(scopeNode._id);
    }
  } catch (err) {
    log.debug("Tree Orchestrator", `workspace anchor lookup skipped: ${err.message}`);
  }

  try {
    const { SWARM_WS_EVENTS } = await import("../swarm/wsEvents.js");
    socket?.emit?.(SWARM_WS_EVENTS.SUB_PLAN_DISPATCHED, {
      subPlanNodeId: String(subPlanNodeId),
      scopeNodeId: String(scopeNode._id),
      scopeName: scopeNode.name || null,
      branchCount: branches.length,
    });
  } catch {}

  try {
    const swarmResult = await sw.runBranchSwarm({
      branches,
      rootProjectNode: scopeNode,
      // Workspace anchor is the outer project, distinct from the
      // plan anchor (scopeNode). Files land at the project workspace;
      // plan state lives on the sub-plan at scopeNode.
      workspaceAnchorNode,
      rootChatId: rootChatId || null,
      architectChatId: null,
      sessionId,
      visitorId,
      userId,
      username,
      rootId,
      signal,
      slot,
      socket,
      onToolLoopCheckpoint,
      userRequest: subPlan?.systemSpec || "",
      rt,
      // Sub-plan dispatch: the sub-plan already exists with its steps;
      // skip the init-project-role + initial-enqueue block so we don't
      // overwrite the worker's branch role.
      resumeMode: true,
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
        return runSteppedMode(visitorId, branchMode, branchMessage, {
          username, userId, rootId, signal, slot: branchSlot,
          currentNodeId: branchIdStr,
          readOnly: false, onToolLoopCheckpoint, socket,
          sessionId, rootChatId, rt,
          parentChatId: markerChatId || rootChatId || null,
          dispatchOrigin: "sub-plan",
        });
      },
    });

    // Restore position to the scope node so subsequent chat turns land
    // on the worker's branch, not the last-running sub-branch.
    setCurrentNodeId(visitorId, String(scopeNode._id));

    // Parent notification: append a SUB_PLAN_COMPLETE signal to the
    // scope node's (the worker's branch) inbox so its next turn sees
    // the rollup of what the decomposition produced. Also fire a WS
    // event so the client can render a status line.
    try {
      const finalPlan = await planExt.readPlan(subPlanNodeId);
      const subBranchesRollup = (finalPlan?.steps || [])
        .filter((s) => s.kind === "branch")
        .map((s) => ({
          name: s.title,
          status: s.status || "pending",
          summary: s.summary || null,
          error: s.error || null,
          childNodeId: s.childNodeId || null,
        }));
      const doneCount = subBranchesRollup.filter((b) => b.status === "done").length;
      const failedCount = subBranchesRollup.filter((b) => b.status === "failed").length;
      const overallStatus = failedCount > 0
        ? "partial"
        : (doneCount === subBranchesRollup.length && subBranchesRollup.length > 0)
          ? "settled"
          : "escalating";

      const { SIGNAL_KIND } = await import("../code-workspace/swarmEvents.js");
      await sw.appendSignal({
        nodeId: String(scopeNode._id),
        signal: {
          from: "sub-plan",
          kind: SIGNAL_KIND.SUB_PLAN_COMPLETE,
          filePath: null,
          payload: {
            subPlanNodeId: String(subPlanNodeId),
            overallStatus,
            subBranches: subBranchesRollup,
          },
        },
        core: null,
      });

      const { SWARM_WS_EVENTS } = await import("../swarm/wsEvents.js");
      socket?.emit?.(SWARM_WS_EVENTS.SUB_PLAN_COMPLETE, {
        subPlanNodeId: String(subPlanNodeId),
        scopeNodeId: String(scopeNode._id),
        scopeName: scopeNode.name || null,
        overallStatus,
        subBranches: subBranchesRollup,
      });

      await planExt.appendLedger(subPlanNodeId, {
        event: "sub-plan-completed",
        detail: { overallStatus, doneCount, failedCount, total: subBranchesRollup.length },
      }, null);

      // Retry budget exhaustion → SUB_PLAN_ESCALATION. Pass 1's escalation
      // path: a sub-plan branch that failed AND already hit the per-branch
      // retry cap (budget.retriesPerBranch, default 1) cannot settle
      // locally. The parent gets a separate signal alongside the
      // SUB_PLAN_COMPLETE rollup so its next turn can decide what to do
      // (revise spec, redispatch with different constraints, surface to
      // user via [[NO-WRITE: sub-plan blocked]]). Pass 2 will extend the
      // payload schema for court-driven escalations; until then, this
      // single trigger keeps the path real, not sketch.
      const budget = finalPlan?.budget || planExt.DEFAULT_BUDGET || {};
      const retryCap = Number.isFinite(budget?.retriesPerBranch)
        ? budget.retriesPerBranch
        : 1;
      const exhausted = (finalPlan?.steps || [])
        .filter((s) =>
          s.kind === "branch" &&
          s.status === "failed" &&
          (s.retries || 0) >= retryCap,
        )
        .map((s) => ({
          name: s.title,
          error: s.error || null,
          retries: s.retries || 0,
          childNodeId: s.childNodeId ? String(s.childNodeId) : null,
        }));

      if (exhausted.length > 0) {
        // Best-effort: collect a few recent unresolved signals from each
        // exhausted branch so the parent has concrete context for what
        // couldn't be reconciled. Cap total at 10 to avoid prompt bloat.
        const unresolvedSignals = [];
        try {
          for (const ex of exhausted) {
            if (!ex.childNodeId || unresolvedSignals.length >= 10) break;
            const sigs = (await sw.readSignals(ex.childNodeId)) || [];
            for (const s of sigs.slice(-3)) {
              if (unresolvedSignals.length >= 10) break;
              const summary = typeof s.payload === "string"
                ? s.payload.slice(0, 120)
                : (s.payload?.message || s.payload?.reason || s.payload?.kind || null);
              unresolvedSignals.push({
                from: ex.name,
                kind: s.kind || null,
                summary: summary ? String(summary).slice(0, 200) : null,
              });
            }
          }
        } catch (sigErr) {
          log.debug("Tree Orchestrator", `escalation signal collection skipped: ${sigErr.message}`);
        }

        await sw.appendSignal({
          nodeId: String(scopeNode._id),
          signal: {
            from: "sub-plan",
            kind: SIGNAL_KIND.SUB_PLAN_ESCALATION,
            filePath: null,
            payload: {
              subPlanNodeId: String(subPlanNodeId),
              reason: "retry-budget-exhausted",
              details:
                `${exhausted.length} branch(es) failed after ${retryCap} ` +
                `retry attempt(s); local resolution exhausted`,
              failedBranches: exhausted,
              unresolvedSignals,
            },
          },
          core: null,
        });

        await planExt.appendLedger(subPlanNodeId, {
          event: "sub-plan-escalation",
          detail: {
            reason: "retry-budget-exhausted",
            exhaustedCount: exhausted.length,
            retryCap,
          },
        }, null);

        log.warn(
          "Tree Orchestrator",
          `⚠️  Sub-plan ${String(subPlanNodeId).slice(0, 8)} escalating to parent: ` +
          `${exhausted.length} branch(es) exhausted retry budget (cap=${retryCap})`,
        );
      }
    } catch (notifErr) {
      log.debug("Tree Orchestrator", `SUB_PLAN_COMPLETE notify skipped: ${notifErr.message}`);
    }

    return swarmResult?.summary || "";
  } catch (err) {
    log.error("Tree Orchestrator", `dispatchApprovedSubPlan ${subPlanNodeId} failed: ${err.message}`);
    log.error("Tree Orchestrator", err.stack?.split("\n").slice(0, 5).join("\n"));
    return `Sub-plan dispatch failed: ${err.message}`;
  }
}

/**
 * Archive a proposed sub-plan (user cancel). Marks the sub-plan's
 * pending-approval steps as archived and emits SUB_PLAN_ARCHIVED so
 * the client can dismiss the card. Does not delete the plan node —
 * the plan's ledger preserves the history of its proposal.
 */
export async function archiveSubPlan({ subPlanNodeId, reason = "user-cancel", socket }) {
  if (!subPlanNodeId) return false;
  const { getExtension } = await import("../loader.js");
  const planExt = getExtension("plan")?.exports;
  if (!planExt?.archivePlan) return false;

  try {
    await planExt.archivePlan({ nodeId: subPlanNodeId, reason, core: null });
    await planExt.appendLedger(subPlanNodeId, {
      event: "sub-plan-archived",
      detail: { reason },
    }, null);

    try {
      const { SWARM_WS_EVENTS } = await import("../swarm/wsEvents.js");
      socket?.emit?.(SWARM_WS_EVENTS.SUB_PLAN_ARCHIVED, {
        subPlanNodeId: String(subPlanNodeId),
        reason,
      });
    } catch {}

    return true;
  } catch (err) {
    log.warn("Tree Orchestrator", `archiveSubPlan ${subPlanNodeId} failed: ${err.message}`);
    return false;
  }
}
