// orchestrators/tree.js
// A compiler + runtime for executing structured intent across domain state systems.
// Extensions are state + tools + context. Modes are execution templates inside graph nodes.
// Natural language compiles into execution graphs. The runtime walks them.

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import {
  switchMode,
  processMessage,
  getRootId,
  getCurrentNodeId,
  setCurrentNodeId,
} from "../../seed/llm/conversation.js";
import { classify } from "./translator.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import {
  localClassify, extractBehavioral, resolveModeForNode,
  parseTense, parsePronouns, detectCausality, detectVoice,
  parseQuantifier, parseConditional, parseAdjectives,
  parsePreposition, parseTemporalScope,
} from "./classify.js";
import { runRespond } from "./respond.js";

import { setChatContext } from "../../seed/llm/chatTracker.js";
import {
  executeGraph,
  buildExecutionGraph,
  describeGraph,
  makeDispatch,
} from "./graph.js";
import {
  getPendingPlan,
  clearPendingPlan,
  isAffirmative,
} from "./pendingPlan.js";
import { runBeMode } from "./beMode.js";
import { logParseTree } from "./grammarDebug.js";

import { buildDeepTreeSummary } from "../../seed/tree/treeFetch.js";
import mongoose from "mongoose";
import Node from "../../seed/models/node.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";
import {
  getIntelligenceBrief,
  pushMemory, clearMemory, formatMemoryContext,
  updatePronounState,
  recordRoutingDecision, getLastRouting, getLastRoutingRing, clearLastRouting,
  setActiveRequest, getActiveRequest,
} from "./state.js";

// Dispatch functions extracted to ./dispatch.js. Re-export for any
// consumers that still import from orchestrator.js.
import {
  emitStatus,
  emitModeResult,
  buildSocketBridge,
  resolveLlmProvider,
  runModeAndReturn,
  runChain,
} from "./dispatch.js";
import { runSteppedMode } from "./steppedMode.js";

export { emitStatus, emitModeResult, resolveLlmProvider, runModeAndReturn, runChain };
export { clearMemory };

// Intelligence brief, path cache, memory, pronoun state, routing state,
// and active requests all live in ./state.js now.

// ─────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// SUFFIX CONVENTION ROUTING (one function, one place)
// ─────────────────────────────────────────────────────────────────────────

// Grammar/classification functions (localClassify, extractBehavioral, resolveModeForNode,
// parseTense, parsePronouns, detectCausality, detectVoice, parseQuantifier, parseConditional,
// parseAdjectives, parsePreposition, parseTemporalScope) and all regex constants live in
// ./classify.js. Imported at the top of this file.

export { updatePronounState, getLastRouting, getLastRoutingRing, clearLastRouting, getActiveRequest };

// Execution graph primitives (executeGraph, buildExecutionGraph, describeGraph,
// makeDispatch, makeFanout, evaluateCondition, resolveFork, resolveSet,
// serializeContextForEval) live in ./graph.js.

// Grammar parse tree debugger lives in ./grammarDebug.js.

// ─────────────────────────────────────────────────────────────────────────
// RUN PENDING PLAN
// ─────────────────────────────────────────────────────────────────────────

// Expand a captured plan into a sequence of independent chat turns.
// Each item becomes its own Chat record (new chainIndex inside the same
// session) so the frontend renders them as sibling steps under the
// affirmative's root chat. Runs sequentially; any failure or abort stops
// the chain but leaves prior items written.
//
// Each item dispatches through code-plan at the current tree position.
// The mode's own tool cap + the runSteppedMode continuation loop already
// handle per-item work bounding.
async function runPendingPlan(pending, triggerMessage, visitorId, {
  socket, username, userId, signal, sessionId,
  rootId, rootChatId, slot, onToolLoopCheckpoint,
}) {
  emitStatus(socket, "intent", `Applying ${pending.items.length} planned fixes...`);

  const items = pending.items;
  // Always execute through code-plan — it's the imperative builder mode.
  // Plans can be captured by any mode (review, coach, ask), but applying
  // them means writing files, and code-plan is the one wired to do that.
  // Using the capture mode would run items through an audit-only prompt
  // that explicitly says "don't write", and the model would respect it.
  const mode = "tree:code-plan";
  const results = [];
  const appliedLines = [];

  // Ensure we're in the plan mode for the whole sequence. Cheap: switchMode
  // short-circuits when already in the target mode.
  await switchMode(visitorId, mode, {
    username, userId, rootId,
    currentNodeId: getCurrentNodeId(visitorId) || rootId,
    clearHistory: false,
  });

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) {
      log.info("Tree Orchestrator", `⏹  Plan aborted after ${i}/${items.length}`);
      break;
    }

    const item = items[i];
    const itemMessage =
      `Apply plan item ${i + 1} of ${items.length}: ${item}\n\n` +
      `You previously produced this plan and the user confirmed it. ` +
      `Make the change now via workspace-edit-file or workspace-add-file. ` +
      `Report one short line when done. Do not ask for confirmation.`;

    emitStatus(socket, "intent", `Fix ${i + 1}/${items.length}: ${item.slice(0, 60)}`);

    // Dispatch the item. runSteppedMode creates its own chain steps via
    // rt.beginChainStep — including a first-call step whose input is
    // itemMessage. Each write-nudge retry and each continuation step
    // also gets its own chain step. No need to wrap with a parent item
    // header — the chain records speak for themselves.
    let itemResult;
    try {
      itemResult = await runSteppedMode(visitorId, mode, itemMessage, {
        username, userId, rootId, signal, slot,
        readOnly: false, onToolLoopCheckpoint, socket,
        parentChatId: rootChatId || null,
        dispatchOrigin: "plan-expand",
      });
    } catch (err) {
      log.error("Tree Orchestrator", `Plan item ${i + 1} failed: ${err.message}`);
      appliedLines.push(`${i + 1}. ❌ ${item} — ${err.message}`);
      continue;
    }

    results.push(itemResult);
    appliedLines.push(`${i + 1}. ✓ ${item}`);
  }

  // Restore context to the root chat record so the upstream finalize
  // (in runOrchestration) writes the final answer on the trigger chat.
  if (rootChatId && sessionId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  const summary = appliedLines.length === items.length
    ? `Applied all ${items.length} planned fixes:\n${appliedLines.join("\n")}`
    : `Applied ${appliedLines.length}/${items.length} planned fixes:\n${appliedLines.join("\n")}`;

  emitStatus(socket, "done", "");
  if (summary) pushMemory(visitorId, triggerMessage, summary);

  return {
    success: true,
    answer: summary,
    modeKey: mode,
    modesUsed: [mode],
    rootId,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ORCHESTRATE TREE REQUEST
// ─────────────────────────────────────────────────────────────────────────

// NOTE: respondToCompletion, executePlanSteps, runQueryFlow, runLibrarianFlow,
// executePendingOperation, scoutExistingStructure, fetchMoveCounterparts
// were removed. The orchestrator now routes to tree:converse for all
// non-extension messages. The AI has all tools at its position.

export async function orchestrateTreeRequest({
  visitorId,
  message,
  socket,
  username,
  userId,
  signal,
  sessionId,
  rootId: rootIdParam,
  skipRespond = false,
  forceQueryOnly = false,
  slot,
  rootChatId = null,
  sourceType = null,
  sourceId = null,
  onToolLoopCheckpoint = null,
  forceMode = null, // misroute reroute uses this to bypass classification
}) {
  if (signal?.aborted) return null;

  const rootId = rootIdParam ?? getRootId(visitorId);

  // Create the OrchestratorRuntime EARLY — before pending-plan expand,
  // misroute intercept, or classification — so every code path that
  // writes chain-step Chat records can use the same rt.chainIndex as
  // the single source of truth. runPendingPlan, runSteppedMode,
  // runBranchSwarm, the classifier step tracker — all of them read rt
  // from getActiveRequest(visitorId).rt.
  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username,
    // Pass-through: we're attaching to the user's live orchestrator
    // chain, so the runtime uses the same session key as the chat.
    aiSessionKey: visitorId,
    sessionType: "tree-chat",
    description: message,
    modeKeyForLlm: "tree:librarian",
    slot,
  });
  const llmProvider = await resolveLlmProvider(userId, rootId, "tree:librarian", slot);
  rt.attach({ sessionId, mainChatId: rootChatId, llmProvider, signal, chainIndex: 1 });

  // Stash the active request context so extensions (like misroute) can
  // redispatch on the same socket if they detect a correction. Cleared in
  // a finally below so we never leak state across requests. Includes rt
  // so downstream helpers can read/increment the shared chain counter.
  setActiveRequest(visitorId, {
    socket, username, userId, signal, sessionId, rootId,
    rootChatId, slot, sourceType, sourceId, onToolLoopCheckpoint,
    rt,
  });

  // Ensure AI contribution context is set so MCP tool calls get chatId/sessionId
  if (rootChatId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  // ── Ruler resumption intercept ──
  // The Ruler at the scope is the operational authority for what
  // happens when work resumes after a pause. When the user types a
  // short continuation ("continue", "keep going", "go") at a scope
  // whose plan has pending branches, governing.resumeAtRuler wakes
  // the Ruler, examines plan + contracts + branch states, and decides
  // whether to redispatch the pending branches via swarm. Decision
  // lives in governing; mechanism (parallel dispatch, retry, reconcile)
  // stays in swarm. Returns a result when handled, null otherwise.
  try {
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.resumeAtRuler) {
      const resumeResult = await governing.resumeAtRuler({
        message, forceMode, rootId, visitorId,
        userId, username, rootChatId, sessionId,
        signal, slot, socket, onToolLoopCheckpoint, rt,
        currentNodeId: getCurrentNodeId(visitorId) || rootId,
        emitStatus,
        runBranch: async ({ mode: branchMode, message: branchMessage, branchNodeId, slot: branchSlot }) => {
          setCurrentNodeId(visitorId, branchNodeId);
          await switchMode(visitorId, branchMode, {
            username, userId, rootId,
            currentNodeId: branchNodeId,
            clearHistory: true,
          });
          return runSteppedMode(visitorId, branchMode, branchMessage, {
            username, userId, rootId, signal, slot: branchSlot,
            readOnly: false, onToolLoopCheckpoint, socket,
            parentChatId: rootChatId || null,
            dispatchOrigin: "branch-swarm",
            // Thread the live runtime context through. Without these,
            // runSteppedMode's beginChainStep fallback fires with
            // sessionId missing → startChainStep returns null → chat
            // chain steps for resumed branches lack proper attribution
            // (no session, no rt-managed chainIndex, no parentChat).
            // The non-resume dispatch path in dispatch.js threads these
            // through; this path was missed.
            sessionId, rootChatId, rt,
          });
        },
      });
      if (resumeResult) return resumeResult;
    }
  } catch (err) {
    log.debug("Tree Orchestrator", `Resume intercept skipped: ${err.message}`);
  }

  // ── Pending swarm-plan interception ──
  // A prior architect turn may have proposed a [[BRANCHES]] plan that's
  // waiting for approval. Outcomes on this next turn:
  //   affirmative            → dispatch stashed plan via dispatchSwarmPlan
  //   cancel                 → archive the plan, return
  //   pivot-confirm pending
  //     affirmative          → archive, then re-run orchestration using
  //                            the stashed pivot message (not the "yes")
  //     anything else        → treat as keeping the plan, fall through
  //                            to revision flow
  //   pivot detected fresh   → stash pivotProposedMessage on the swarm
  //                            plan, return "archive the plan?" prompt
  //   revision               → re-call architect with user feedback; its
  //                            next [[BRANCHES]] block replaces the stash
  if (!forceMode && message) {
    const { getPendingSwarmPlan, setPendingSwarmPlan, clearPendingSwarmPlan } =
      await import("../swarm/state/pendingSwarmPlan.js");
    const pendingSwarm = getPendingSwarmPlan(visitorId);

    if (pendingSwarm) {
      const trimmed = message.trim();
      const isCancel = /^\s*(cancel|no|abort|drop|discard|nevermind|never\s*mind)\s*[.!]*$/i.test(trimmed);

      // Helper: archive the current plan and emit PLAN_ARCHIVED.
      const archiveCurrentPlan = async (reason) => {
        try {
          const planExt = (await import("../loader.js")).getExtension("plan")?.exports;
          const { SWARM_WS_EVENTS } = await import("../swarm/wsEvents.js");
          if (planExt?.archivePlan) {
            await planExt.archivePlan({
              nodeId: pendingSwarm.projectNodeId,
              reason,
              core: null,
            });
          }
          socket?.emit?.(SWARM_WS_EVENTS.PLAN_ARCHIVED, {
            projectNodeId: pendingSwarm.projectNodeId,
            projectName: pendingSwarm.projectName || null,
            reason,
            branchCount: pendingSwarm.branches.length,
          });
        } catch (archiveErr) {
          log.warn("Tree Orchestrator", `archive(${reason}) failed: ${archiveErr.message}`);
        }
      };

      // ── Pivot-confirm step (second turn of the pivot dialog) ──
      // If the stash carries pivotProposedMessage, we asked the user
      // "archive and proceed?" last turn and we're now receiving
      // their answer. Yes → archive + reprocess the original pivot
      // message. No / unclear → drop the pivot offer, continue as
      // if user is actively revising the plan.
      if (pendingSwarm.pivotProposedMessage) {
        if (isAffirmative(message)) {
          log.info("Tree Orchestrator",
            `🔀 Pivot confirmed. Archiving plan (${pendingSwarm.branches.length} branches) and re-running on: "${pendingSwarm.pivotProposedMessage.slice(0, 80)}"`,
          );
          await archiveCurrentPlan("user-pivot");
          const pivotMsg = pendingSwarm.pivotProposedMessage;
          clearPendingSwarmPlan(visitorId);
          // Overwrite the current message with the pivot text so the
          // remainder of this orchestrator turn classifies and runs
          // THAT (not the bare "yes" confirmation).
          message = pivotMsg;
          // Fall through to normal classification below.
        } else {
          // User backed out of the pivot. Drop the pivot marker; keep
          // the plan; treat this message as a revision (if non-cancel)
          // or as a no-op (if cancel).
          log.info("Tree Orchestrator", `🔀 Pivot declined; keeping plan v${pendingSwarm.version || 1}.`);
          setPendingSwarmPlan(visitorId, { ...pendingSwarm, pivotProposedMessage: undefined });
          if (!isCancel && !isAffirmative(message)) {
            // Treat as revision feedback below.
          }
          // Fall through into the affirmative/cancel/revision branches
          // with the pivotProposedMessage cleared.
        }
      }

      // Re-read the (possibly mutated) stash so the affirmative branch
      // picks up a cleared pivot state if we just reset it.
      const stash = getPendingSwarmPlan(visitorId);

      if (stash) {
        if (isAffirmative(message)) {
          log.info("Tree Orchestrator",
            `▶️  Accepted swarm plan v${stash.version || 1}: ${stash.branches.length} branches (project=${String(stash.projectNodeId || "").slice(0, 8)})`,
          );
          clearPendingSwarmPlan(visitorId);
          const { dispatchSwarmPlan } = await import("./dispatch.js");
          const summary = await dispatchSwarmPlan(stash, {
            visitorId, userId, username,
            rootId: stash.rootId || rootId,
            sessionId, signal, slot, socket, onToolLoopCheckpoint, rt,
            rootChatId,
          });
          return {
            success: true,
            answer: summary || "Plan dispatched.",
            modeKey: stash.modeKey || "tree:code-plan",
            modesUsed: ["tree:code-plan"],
            rootId: stash.rootId || rootId,
            targetNodeId: stash.targetNodeId || null,
          };
        }

        if (isCancel) {
          log.info("Tree Orchestrator",
            `🛑 Canceled swarm plan v${stash.version || 1} (${stash.branches.length} branches)`,
          );
          await archiveCurrentPlan("user-cancel");
          clearPendingSwarmPlan(visitorId);
          return {
            success: true,
            answer: "Plan dropped. What would you like instead?",
            modeKey: stash.modeKey || "tree:code-plan",
            modesUsed: [],
            rootId: stash.rootId || rootId,
            targetNodeId: stash.targetNodeId || null,
          };
        }

        // Classify the message to distinguish revision (stays inside
        // tree:code-* territory) from pivot (routes to a different
        // extension, e.g. fitness / food / kb).
        let pivot = false;
        try {
          const classification = await localClassify(
            message,
            stash.targetNodeId || stash.projectNodeId || rootId,
            rootId,
            userId,
          );
          if (
            classification?.intent === "extension" &&
            classification.mode &&
            !classification.mode.startsWith("tree:code-")
          ) {
            pivot = true;
            log.info("Tree Orchestrator",
              `🔀 Pivot detected on pending swarm plan: new message routes to ${classification.mode}`,
            );
          }
        } catch {}

        if (pivot) {
          // Stash the pivot message and ask for confirmation. Next
          // turn's handler (above) picks it up.
          setPendingSwarmPlan(visitorId, { ...stash, pivotProposedMessage: message });
          return {
            success: true,
            answer:
              `Looks like a different direction. Archive the pending plan ` +
              `(${stash.branches.length} branches) and start fresh? ` +
              `Reply "yes" to pivot, or anything else to keep the plan open.`,
            modeKey: stash.modeKey || "tree:code-plan",
            modesUsed: [],
            rootId: stash.rootId || rootId,
            targetNodeId: stash.targetNodeId || null,
          };
        }

        // Revision path: re-call the architect with user feedback.
        // Architect's next [[BRANCHES]] block will flow through
        // dispatch.js and replace the stash.
        log.info("Tree Orchestrator",
          `✍️  Revising swarm plan v${stash.version || 1} with: "${message.slice(0, 80)}"`,
        );
        // Phrase this as an IMPERATIVE instruction, not past-tense
        // ("Revise …"). The grammar tense parser runs even under a
        // forceMode and will re-route past-tense messages to a
        // `-review` mode, bypassing our architect. "Build a new …
        // incorporating …" keeps the verb imperative so the parser
        // stays on `-plan`.
        const revisionMsg =
          `Build a new [[BRANCHES]] plan incorporating this feedback from the user: ${message}\n\n` +
          `Current plan to update:\n${stash.branches.map((b) => `  • ${b.name}${b.path ? ` (${b.path})` : ""}: ${b.spec || ""}`).join("\n")}\n\n` +
          `Emit the COMPLETE updated [[BRANCHES]] block (every branch, not a diff). ` +
          `Keep branch names stable where possible so continuity is preserved. ` +
          `Close with [[DONE]].`;
        // Bump version so the re-emitted plan's stash reflects history.
        // Carry the user's actual revision text as `revisionTrigger` so
        // dispatch.js can surface it on the PLAN_UPDATED event's
        // `trigger` field — the chat plan card renders it as
        // "↪ Revised from: <user text>", which preserves the causal
        // link between the user's ask and the architect's new plan.
        // Without this the chat looks like the architect spontaneously
        // re-planned.
        setPendingSwarmPlan(visitorId, {
          ...stash,
          version: (stash.version || 1) + 1,
          revisionTrigger: String(message).slice(0, 400),
        });
        // Replace the user's message with the architect-directed
        // revision prompt, force the architect mode so classifier
        // doesn't send this elsewhere.
        message = revisionMsg;
        forceMode = stash.modeKey || "tree:code-plan";
      }
    }
  }

  // ── Pending-plan expand ──
  // If a prior review/audit stashed a structured plan and this message is
  // a clear affirmative ("ok", "fix it", "do them all"), expand the plan
  // into a sequence of runs. Each item becomes its own chat turn. Non-
  // affirmative input clears the stashed plan — the user moved on and
  // shouldn't get their unrelated message silently expanded.
  if (!forceMode && message) {
    const pending = getPendingPlan(visitorId);
    if (pending) {
      if (isAffirmative(message)) {
        log.info("Tree Orchestrator",
          `▶️  Expanding pending plan: ${pending.items.length} items (mode=${pending.mode || "?"})`,
        );
        clearPendingPlan(visitorId);
        return runPendingPlan(pending, message, visitorId, {
          socket, username, userId, signal, sessionId,
          rootId, rootChatId, slot, onToolLoopCheckpoint,
        });
      } else {
        // User said something else — they moved on. Drop the stash.
        clearPendingPlan(visitorId);
      }
    }
  }

  // ── Early misroute intercept ──
  // Before classification runs, ask the misroute extension if the current
  // message is a correction of the previous routing. If yes and the user
  // named a target, substitute the original message and forceMode the
  // correct extension. This produces ONE orchestration call (the rerouted
  // one) instead of two and the user only sees one response.
  //
  // Skipped when forceMode is already set (which means we ARE the rerouted
  // call, prevents loops) or when misroute extension isn't loaded.
  let reroutePrefix = null;
  if (!forceMode && message) {
    try {
      const { getExtension } = await import("../loader.js");
      const misroute = getExtension("misroute");
      if (misroute?.exports?.checkForCorrectionReroute) {
        const reroute = await misroute.exports.checkForCorrectionReroute({
          message, visitorId, userId, rootId,
        });
        if (reroute) {
          log.info("Tree Orchestrator",
            `🔄 Correction intercept: substituting "${reroute.rerouteMessage.slice(0, 50)}" forceMode=${reroute.forceMode}`,
          );
          // Substitute message and force mode for the rest of this orchestration
          message = reroute.rerouteMessage;
          forceMode = reroute.forceMode;
          // Build the prefix the AI should use to open its response. Makes
          // the chat history read clearly: user sees their correction, then
          // "↪ Rerouted ... : " followed by the actual answer from the
          // correct extension. Without this prefix the chat looks like the
          // AI ignored the correction and answered a random question.
          const origMessage = reroute.rerouteMessage.length > 60
            ? reroute.rerouteMessage.slice(0, 60) + "…"
            : reroute.rerouteMessage;
          reroutePrefix = `↪ Rerouted your previous message to ${reroute.correctExtension}: "${origMessage}"`;
        }
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Misroute intercept skipped: ${err.message}`);
    }
  }

  // rt / llmProvider / setActiveRequest already created above before the
  // pending-plan and misroute intercepts. Reuse them here.
  const meta = { username, userId, rootId, slot, llmProvider };
  const modesUsed = []; // Track full chain for Chat

  // ────────────────────────────────────────────────────────
  // QUERY FAST PATH — converse in read-only mode
  // ────────────────────────────────────────────────────────

  if (forceQueryOnly) {
    return runModeAndReturn(visitorId, "tree:converse", message, {
      socket, username, userId, rootId, signal, slot,
      readOnly: true, clearHistory: true, onToolLoopCheckpoint, modesUsed,
      // Thread the live runtime so downstream steppedMode can open chain
      // step Chat records against the user's real session. Without these,
      // rt=null / sessionId=null and startChainStep returns null — the
      // query produces no visible response.
      sessionId, rootChatId, rt,
      skipRespond,
    });
  }

  // ────────────────────────────────────────────────────────
  // CONTINUATION CHECK — short replies continue the previous mode
  // "ok", "yes", "do it", "go ahead" etc. continue the conversation
  // instead of re-classifying and switching modes.
  // ────────────────────────────────────────────────────────

  const CONTINUE_WORDS = /^(ok|okay|yes|yeah|yep|y|go|do it|go ahead|sure|continue|proceed|next|keep going|and|then)\s*[.!?]?$/i;
  if (CONTINUE_WORDS.test(message.trim())) {
    const { getCurrentMode } = await import("../../seed/llm/conversation.js");
    const currentMode = getCurrentMode(visitorId);
    if (currentMode && currentMode !== "tree:converse" && currentMode !== "tree:fallback") {
      log.verbose("Tree Orchestrator", `  Continuation in ${currentMode}: "${message}"`);
      // Don't switchMode. Stay in current mode, just process.
      modesUsed.push(currentMode);
      emitStatus(socket, "intent", "");
      const result = await processMessage(visitorId, message, {
        username, userId, rootId, signal, slot, onToolLoopCheckpoint,
        ...buildSocketBridge(socket, signal),
      });
      emitStatus(socket, "done", "");
      const answer = result?.content || result?.answer || null;
      if (answer) pushMemory(visitorId, message, answer);
      return { success: true, answer, modeKey: currentMode, modesUsed, rootId };
    }
  }

  // ────────────────────────────────────────────────────────
  // FAST PATH: Position hold. If the current node is an extension node,
  // route directly. No tree summary, no routing index scan, no classification.
  // This is the common case for follow-up messages in a conversation.
  // ────────────────────────────────────────────────────────

  const currentNodeId = getCurrentNodeId(visitorId) || rootId;
  let classification;
  let treeSummary = null;
  let classifyStart = new Date();
  let departed = false;

  // ────────────────────────────────────────────────────────
  // STEP 0: forceMode bypass. When set (by misroute reroute), skip
  // classification entirely and dispatch directly to the requested mode.
  // The extension owner is derived from the mode key for downstream noun
  // resolution. This is the entry point for active rerouting.
  // ────────────────────────────────────────────────────────
  if (forceMode) {
    const forcedExt = (typeof getModeOwner === "function" ? getModeOwner(forceMode) : null) || "?";
    classification = {
      intent: "extension",
      mode: forceMode,
      targetNodeId: null,
      confidence: 1.0,
      summary: message.slice(0, 100),
      responseHint: "",
    };
    log.info("Tree Orchestrator", `🔄 forceMode override: ${forceMode} (ext=${forcedExt})`);
  }

  // Check if current position has a mode override (extension node).
  // Skipped entirely when forceMode is set so the override actually wins.
  if (!forceMode) {
    const posNode = await Node.findById(currentNodeId).select("metadata").lean();
    const posModes = posNode?.metadata instanceof Map
      ? posNode.metadata.get("modes")
      : posNode?.metadata?.modes;
    if (posModes?.respond) {
      // Hoist getModeOwner so the position-hold log below can name the
      // owning extension. If the import itself fails we still fall through
      // to "?" so boot hiccups don't break the hot path.
      let getModeOwner = null;
      try {
        ({ getModeOwner } = await import("../../seed/tree/extensionScope.js"));
      } catch {}

      // Check for departure: does the message match a DIFFERENT extension's hints
      // but NOT the current extension's hints? If so, skip position hold.
      let isDeparture = false;
      try {
        const { getClassifierHintsForMode } = await import("../loader.js");
        const currentExt = getModeOwner ? getModeOwner(posModes.respond) : null;
        const currentHints = getClassifierHintsForMode(posModes.respond);
        const matchesCurrent = currentHints?.some(re => re.test(message));

        // Only check departure if the message doesn't match current extension
        if (!matchesCurrent && rootId) {
          const { queryAllMatches } = await import("./routingIndex.js");
          const otherMatches = queryAllMatches(rootId, message, null)
            .filter(m => m.extName !== currentExt);
          if (otherMatches.length > 0) {
            isDeparture = true;
            departed = true;
            // Commit to the top-scored match as the primary classification.
            // If we skip this step, STEP 1 CLASSIFY re-runs localClassify,
            // whose Path-2 fallback (classify.js:192) would re-read
            // modes.respond at this node and hand back the same mode we
            // just decided to leave — that's what caused "what workouts do
            // i have" at a code-workspace node to dispatch tree:code-coach
            // first and fitness second.
            const top = otherMatches[0]; // sorted by score desc
            classification = {
              intent: "extension",
              mode: top.mode,
              targetNodeId: top.targetNodeId,
              confidence: typeof top.confidence === "number" ? top.confidence : 0.85,
              summary: message.slice(0, 100),
              responseHint: "",
              posAllScores: otherMatches.map(m => ({
                extName: m.extName,
                score: m.score,
                locality: m.locality,
              })),
            };
            log.verbose("Tree Orchestrator",
              `🎯 Departure from ${currentExt}: message matches ${otherMatches.map(m => m.extName).join(", ")} → committing to ${top.extName}`);
          }
        }
      } catch (err) {
        log.debug("Tree Orchestrator", `Departure check error: ${err.message}`);
      }

      if (!isDeparture) {
        // Stay at this extension node. No suffix routing here.
        // The extension routing path (below) handles suffix resolution once.
        classification = {
          intent: "extension",
          mode: posModes.respond,
          targetNodeId: String(currentNodeId),
          confidence: 0.95,
          summary: message.slice(0, 100),
          responseHint: "",
        };
        const holdExt = getModeOwner ? getModeOwner(classification.mode) : null;
        log.verbose("Grammar", `🎯 noun=${holdExt || "?"} source=position-hold conf=0.95`);
      }
    }
  }

  // ────────────────────────────────────────────────────────
  // STEP 1: CLASSIFY (only if position hold didn't match)
  // ────────────────────────────────────────────────────────

  if (!classification) {
    emitStatus(socket, "intent", "Understanding request…");

    const classificationMode = getLandConfigValue("classificationMode") || "local";

    // Only build tree summary for LLM classification (local classification doesn't use it)
    if (classificationMode === "llm" && rootId) {
      try {
        let encodingMap = null;
        try {
          const { getExtension } = await import("../loader.js");
          const uExt = getExtension("understanding");
          if (uExt?.exports?.getEncodingMap) encodingMap = await uExt.exports.getEncodingMap(rootId);
        } catch {}
        treeSummary = await buildDeepTreeSummary(rootId, { encodingMap });

        const brief = await getIntelligenceBrief(rootId, userId);
        if (brief) treeSummary += "\n\n" + brief;

        log.verbose("Tree Orchestrator", " treeSummary for librarian:\n", treeSummary);
      } catch (err) {
        log.error("Tree Orchestrator", " Pre-fetch tree summary failed:", err.message);
      }
    }

    if (classificationMode === "llm") {
      // Opt-in LLM classification (old behavior)
      try {
        classification = await classify({
          message,
          userId,
          conversationMemory: formatMemoryContext(visitorId),
          treeSummary,
          signal,
          slot,
          rootId,
        });
      } catch (err) {
        if (signal?.aborted) return null;
        if (err.message === "NO_LLM") {
          throw new Error(
            "No LLM connection configured. Set one up at /setup or assign one to this tree.",
          );
        }
        log.error("Tree Orchestrator", " Classification failed:", err.message);
        classification = await localClassify(message, departed ? rootId : (getCurrentNodeId(visitorId) || rootId), rootId, userId);
      }
    } else {
      // Default: local classification. Zero LLM calls.
      classification = await localClassify(message, departed ? rootId : (getCurrentNodeId(visitorId) || rootId), rootId, userId);
    }
  }
  const classifyEnd = new Date();

  if (signal?.aborted) return null;

  const confidence = classification.confidence ?? 0.5;

 log.verbose("Tree Orchestrator",
    `🎯 noun=${classification.intent} source=classify conf=${confidence}`,
  );
  emitModeResult(socket, "intent", {
    intent: classification.intent,
    mode: classification.mode || null,
    targetNodeId: classification.targetNodeId || null,
    responseHint: classification.responseHint,
    summary: classification.summary,
    confidence,
  });

  // Track classification step (after override so logs reflect actual intent used)
  modesUsed.push("classifier");
  rt.trackStep("classifier", {
    input: message,
    output: (({ llmProvider: _, ...rest }) => rest)(classification),
    startTime: classifyStart,
    endTime: classifyEnd,
    llmProvider: classification.llmProvider || llmProvider,
  });

  // ────────────────────────────────────────────────────────
  // NO_FIT CHECK — tree rejects this idea
  // ────────────────────────────────────────────────────────

  if (classification.intent === "no_fit") {
    let reason = classification.summary || "Idea does not fit this tree.";

    // Suggest go if the message might match an extension in another tree
    try {
      const { getExtension } = await import("../loader.js");
      const goExt = getExtension("go");
      if (goExt?.exports?.findDestination) {
        const goResult = await goExt.exports.findDestination(message, userId);
        if (goResult?.found && !goResult.ambiguous && goResult.destination) {
          reason += ` Try: go ${goResult.destination.name || goResult.destination.path}`;
        }
      }
    } catch {}

    log.verbose("Tree Orchestrator", ` No fit: ${reason}`);

    emitStatus(socket, "done", "");

    return {
      success: false,
      noFit: true,
      confidence,
      reason,
      summary: classification.summary,
      modeKey: "classifier",
      rootId,
      modesUsed,
    };
  }

  // ────────────────────────────────────────────────────────
  // SHORT-MEMORY CHECK — explicit defer or vague placements
  // ────────────────────────────────────────────────────────

  // Only explicit "defer" intent triggers deferral (user said "hold this"/"park this").
  // Normal "place" intents always flow to the librarian.
  let deferDecision = { defer: false };
  if (classification.intent === "defer") {
    deferDecision = { defer: true, reason: "User explicitly requested deferral" };
    classification.intent = "place"; // treat as place for the defer path
  }
  if (deferDecision.defer) {
 log.verbose("Tree Orchestrator", ` Deferred to short memory: ${deferDecision.reason}`);

    const ShortMemory = mongoose.models.ShortMemory;
    if (!ShortMemory) throw new Error("Dreams extension required for short memory deferral");
    const memoryItem = await ShortMemory.create({
      rootId,
      userId,
      content: message,
      deferReason: deferDecision.reason,
      classificationAxes: classification.placementAxes,
      sourceType: sourceType || "tree-chat",
      sourceId: sourceId || null,
      sessionId,
    });

    rt.trackStep("short-memory:defer", {
      input: message,
      output: {
        deferReason: deferDecision.reason,
        memoryItemId: memoryItem._id,
      },
      llmProvider,
    });

    if (!skipRespond) {
      const response = await runRespond({
        visitorId,
        socket,
        signal,
        username,
        userId,
        rootId,
        originalMessage: message,
        responseHint:
          classification.responseHint ||
          "Acknowledge the idea naturally. Do not mention deferral, memory, or holding.",
        stepSummaries: [],
        slot,
      });

      return {
        ...response,
        success: true,
        deferred: true,
        memoryItemId: memoryItem._id,
        modeKey: "short-memory:defer",
        modesUsed: [...modesUsed, "short-memory"],
      };
    }

    return {
      success: true,
      deferred: true,
      memoryItemId: memoryItem._id,
      modeKey: "short-memory:defer",
      modesUsed,
      rootId,
    };
  }

  // ────────────────────────────────────────────────────────
  // BEHAVIORAL CONSTRAINT (chat/place/query)
  // ────────────────────────────────────────────────────────

  const behavioral = extractBehavioral(sourceType);

  // ────────────────────────────────────────────────────────
  // BE: GUIDED MODE — the tree leads, the user follows.
  // Full 3-tier logic lives in ./beMode.js (extension -> closest
  // extension via routing index -> generic tree:be).
  // ────────────────────────────────────────────────────────

  if (behavioral === "be") {
    return runBeMode(message, {
      visitorId, socket, username, userId, rootId,
      signal, slot, sessionId, onToolLoopCheckpoint,
      currentNodeId, modesUsed,
    });
  }

  // ────────────────────────────────────────────────────────
  // PATH 2: EXTENSION DETECTED — hand off to the extension
  //
  // Three tiers:
  // 1. handleMessage override: extension exports a full handler. It decides everything.
  // 2. Suffix convention: orchestrator resolves mode by naming convention.
  //    :coach (be), :review (questions), :plan (building), :log (default).
  // 3. modes.respond fallback: whatever the node declared.
  // ────────────────────────────────────────────────────────

  if (classification.intent === "extension" && classification.mode) {
    const { getModeOwner } = await import("../../seed/tree/extensionScope.js");
    const { getExtension, getExtensionManifest } = await import("../loader.js");

    // ── Chain check: does the message match 2+ extensions? ──
    try {
      const primaryExt = getModeOwner(classification.mode);
      const { queryAllMatches } = await import("./routingIndex.js");
      const allTreeMatches = queryAllMatches(rootId, message, null);
      const seenExts = new Set([primaryExt]);
      const otherMatches = [];

      // Default to Infinity so a primary whose hints do NOT match the message
      // sorts LAST in the chain instead of first. Without this, a position-
      // held or inherited primary ("I'm at a code-workspace node but the
      // message says workouts") would head the chain dispatch and run its
      // mode before the extension that actually claims the message.
      let primaryPos = Infinity;
      const primaryManifest = getExtensionManifest(primaryExt);
      if (Array.isArray(primaryManifest?.classifierHints)) {
        for (const re of primaryManifest.classifierHints) {
          const m = re.exec(message);
          if (m) { primaryPos = m.index; break; }
        }
      }

      for (const match of allTreeMatches) {
        if (seenExts.has(match.extName)) continue;
        seenExts.add(match.extName);
        const manifest = getExtensionManifest(match.extName);
        let matchPos = -1;
        if (Array.isArray(manifest?.classifierHints)) {
          for (const re of manifest.classifierHints) {
            const m = re.exec(message);
            if (m) { matchPos = matchPos === -1 ? m.index : Math.min(matchPos, m.index); }
          }
        }
        if (matchPos === -1) matchPos = message.length;
        otherMatches.push({ mode: match.mode, targetNodeId: match.targetNodeId, extName: match.extName, pos: matchPos });
      }

      log.verbose("Tree Orchestrator", `  Chain: ${otherMatches.length} other matches: ${otherMatches.map(m => m.extName).join(", ") || "none"}`);

      if (otherMatches.length > 0) {
        const allMatches = [
          { mode: classification.mode, targetNodeId: classification.targetNodeId || currentNodeId, extName: primaryExt, pos: primaryPos },
          ...otherMatches,
        ].sort((a, b) => a.pos - b.pos);

        // ── Causality check: is this cause -> effect, not sequential chain? ──
        const causal = detectCausality(message, allMatches);
        if (causal) {
          const effectMatch = allMatches.find(m => m.extName === causal.effect);
          if (effectMatch) {
            // Resolve the effect domain's coach mode
            const effectMode = await (async () => {
              const { getModesOwnedBy: gmo } = await import("../../seed/tree/extensionScope.js");
              const modes = gmo(causal.effect);
              return modes.find(m => m.endsWith("-coach")) || modes.find(m => m.endsWith("-review")) || effectMatch.mode;
            })();

            logParseTree(message, {
              noun: `${causal.cause}->${causal.effect}`, nounSource: "causal", nounConf: 0.85,
              tense: "future", tensePattern: "coach-causal", tenseConf: 0.9,
              resolvedMode: effectMode, adjectives: parseAdjectives(message), voice: "passive",
              conditional: parseConditional(message),
            });
            log.info("Grammar", `CAUSAL: ${causal.cause} -[${causal.connector}]-> ${causal.effect}`);

            const causalGraph = buildExecutionGraph({
              resolvedMode: effectMode, tenseInfo: { tense: "future", pattern: "coach-causal" },
              conditional: parseConditional(message),
              adjectives: parseAdjectives(message), quantifiers: null,
              temporalScope: parseTemporalScope(message), voice: "passive",
              causal: { cause: causal.cause, effect: causal.effect, connector: causal.connector, effectMode, effectNodeId: effectMatch.targetNodeId },
              classification, behavioral, currentNodeId: effectMatch.targetNodeId, rootId,
              extName: causal.effect,
            });
            log.verbose("Grammar", `Graph: ${describeGraph(causalGraph)}`);
            return executeGraph(causalGraph, message, visitorId, {
              socket, username, userId, rootId, signal, slot,
              currentNodeId: effectMatch.targetNodeId,
              onToolLoopCheckpoint, modesUsed,
              sessionId, rootChatId, rt,
              skipRespond,
            });
          }
        }

        // Not causal: run as sequential chain via graph
        log.verbose("Tree Orchestrator", `  Chain detected: ${allMatches.map(m => m.extName).join(" -> ")}`);
        const chainGraph = {
          type: "sequence",
          steps: allMatches.map(m => makeDispatch(m.mode, m.extName, m.targetNodeId, { tense: "present" })),
          source: "multi-extension",
        };
        return executeGraph(chainGraph, message, visitorId, { socket, username, userId, rootId, signal, slot, onToolLoopCheckpoint, modesUsed, sessionId, rootChatId, rt, skipRespond });
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Chain check failed: ${err.message}`);
    }

    const extName = getModeOwner(classification.mode);
    const ext = extName ? getExtension(extName) : null;

    log.verbose("Tree Orchestrator",
      `  Verb: ${extName || "?"} (mode: ${classification.mode}, behavioral: ${behavioral})`);

    // ── Data handler: extension pre-processing ──
    // Extensions can return:
    //   { answer }       - short-circuit, send this answer directly
    //   { mode }         - force a specific mode, skip suffix routing
    //   { answer, mode } - short-circuit with mode tagging
    //   null/undefined   - proceed to normal suffix routing
    let forcedMode = null;
    if (ext?.exports?.handleMessage) {
      if (classification.targetNodeId) setCurrentNodeId(visitorId, classification.targetNodeId);
      try {
        const decision = await ext.exports.handleMessage(message, {
          userId, username, rootId, targetNodeId: classification.targetNodeId,
        });
        if (decision?.answer) {
          emitStatus(socket, "done", "");
          pushMemory(visitorId, message, decision.answer);
          modesUsed.push(decision.mode || classification.mode);
          return { success: true, answer: decision.answer, modeKey: decision.mode || classification.mode, modesUsed, rootId, targetNodeId: classification.targetNodeId };
        }
        if (decision?.mode) {
          forcedMode = decision.mode;
          log.verbose("Tree Orchestrator", `  handleMessage forced mode: ${forcedMode}`);
        }
      } catch (err) {
        log.error("Tree Orchestrator", `Extension handleMessage failed: ${err.message}`);
      }
    }

    // ── Step 1a: Parse pronouns (resolve "it", "that", "same") ──
    const pronounInfo = parsePronouns(message, visitorId);
    if (pronounInfo?.resolvedNode && !classification.targetNodeId) {
      classification.targetNodeId = pronounInfo.resolvedNode;
      setCurrentNodeId(visitorId, pronounInfo.resolvedNode);
    }

    // ── Step 1c: Parse quantifiers (scope from one node to a set) ──
    const quantifiers = parseQuantifier(message);

    // ── Step 1d: Parse conditionals (if/when/unless branching logic) ──
    const conditional = parseConditional(message);

    // ── Step 1e: Parse temporal scope (data window) ──
    const temporalScope = parseTemporalScope(message);

    // ── Step 1b: Parse preposition (where in the tree?) ──
    let prepInfo = null;
    try {
      prepInfo = await parsePreposition(message, rootId);
      if (prepInfo?.targetOverride) {
        classification.targetNodeId = prepInfo.targetOverride;
        setCurrentNodeId(visitorId, prepInfo.targetOverride);
      }
    } catch {}

    // ── Step 2: Parse tense (which conjugation of this verb?) ──
    let resolvedMode;
    let tenseInfo = { tense: "present", pattern: "forced" };
    if (forcedMode) {
      resolvedMode = forcedMode;
      tenseInfo.pattern = "forced-by-handler";
    } else {
      tenseInfo = await parseTense(classification.mode, message, behavioral);
      resolvedMode = tenseInfo.mode;
    }
    const noun = getModeOwner(classification.mode) || "converse";

    // ── Step 2b: Semantic confidence check ──
    // Composite confidence from noun + tense. If low, escalate to LLM classifier.
    // Grammar = fast deterministic layer. LLM = fallback disambiguation.
    const CONFIDENCE_THRESHOLD = 0.65;
    const nounConf = classification.confidence || 0.5;
    const tenseConf = tenseInfo.pattern === "default" ? 0.6 : // fell to log by default
                      tenseInfo.pattern === "error" ? 0.3 :
                      tenseInfo.pattern === "single-mode" ? 0.7 :
                      tenseInfo.pattern === "none" ? 0.4 :
                      0.9; // explicit pattern match
    const compositeConf = (nounConf * 0.6) + (tenseConf * 0.4);

    if (compositeConf < CONFIDENCE_THRESHOLD && !forcedMode && rootId) {
      try {
        const { classify } = await import("./translator.js");
        const { buildDeepTreeSummary } = await import("../../seed/tree/treeFetch.js");
        const treeSummary = await buildDeepTreeSummary(rootId);
        const llmResult = await classify({
          message, userId,
          conversationMemory: formatMemoryContext(visitorId),
          treeSummary, signal, slot, rootId,
        });
        if (llmResult && llmResult.mode && llmResult.confidence > compositeConf) {
          log.info("Grammar", `📖 LOW CONFIDENCE (${compositeConf.toFixed(2)}) -> LLM escalation -> noun=${llmResult.intent} mode=${llmResult.mode} conf=${llmResult.confidence}`);
          classification.intent = llmResult.intent;
          classification.mode = llmResult.mode;
          classification.confidence = llmResult.confidence;
          classification.targetNodeId = llmResult.targetNodeId || classification.targetNodeId;
          // Re-parse tense with the new mode
          tenseInfo = await parseTense(classification.mode, message, behavioral);
          resolvedMode = tenseInfo.mode;
        }
      } catch (err) {
        log.debug("Grammar", `LLM escalation failed: ${err.message}`);
      }
    }

    // ── Step 3: Parse adjectives + voice ──
    const adjectives = parseAdjectives(message);
    const voice = detectVoice(message);

    // ── Layer 4: Build execution graph ──
    const graph = buildExecutionGraph({
      resolvedMode, tenseInfo, conditional, adjectives, quantifiers,
      temporalScope, voice, causal: null, classification, behavioral, currentNodeId, rootId,
      extName: noun,
    });

    // ── Grammar debugger ──
    logParseTree(message, {
      noun, nounSource: classification.targetNodeId ? "position-hold" : "classification",
      nounConf, tense: tenseInfo.tense, tensePattern: tenseInfo.pattern, tenseConf,
      resolvedMode, negated: tenseInfo.tense === "negated",
      compound: tenseInfo.compound ? tenseInfo.compound.map(s => s.tense) : null,
      pronoun: pronounInfo?.pronoun || null, quantifiers,
      adjectives: adjectives.length > 0 ? adjectives : null,
      voice, preposition: prepInfo?.preposition || null,
      prepTarget: prepInfo?.raw || null,
      temporal: temporalScope ? temporalScope.raw : null,
      conditional, forcedMode: forcedMode || null,
      graph,
      posMatches: classification.posMatches,
      posScore: classification.posScore,
      posLocality: classification.posLocality,
      posAllScores: classification.posAllScores,
    });

    // ── Update pronoun state for next message ──
    updatePronounState(visitorId, {
      active: classification.targetNodeId || currentNodeId,
      lastNoun: noun,
      lastMode: resolvedMode,
      lastMessage: message.slice(0, 200),
    });

    // ── Record the routing decision so misroute extension can check
    //    whether the NEXT message from this visitor is a correction. ──
    recordRoutingDecision(visitorId, {
      message: message.slice(0, 500),
      extName: noun,
      mode: resolvedMode,
      targetNodeId: classification.targetNodeId || null,
      currentNodeId,
      rootId,
      posMatches: classification.posMatches || null,
      posScore: classification.posScore || 0,
      posLocality: classification.posLocality || false,
      tense: tenseInfo.tense,
      tensePattern: tenseInfo.pattern,
      confidence: classification.confidence || 0,
    });

    // ── Execute ──
    return executeGraph(graph, message, visitorId, {
      socket, username, userId, rootId, signal, slot,
      currentNodeId: classification.targetNodeId || currentNodeId,
      onToolLoopCheckpoint, modesUsed,
      reroutePrefix, // null unless misroute intercept fired above
      sessionId, rootChatId, rt,
      skipRespond,
    });
  }


  // ────────────────────────────────────────────────────────
  // CONVERSE PATH — check routing index for implicit matches
  // ────────────────────────────────────────────────────────

  if (rootId && classification.intent === "converse") {
    try {
      const { queryAllMatches } = await import("./routingIndex.js");
      const indexMatches = queryAllMatches(rootId, message, null);

      log.verbose("Tree Orchestrator", `  Converse check: ${indexMatches.length} matches: ${indexMatches.map(m => m.extName).join(", ") || "none"}`);

      if (indexMatches.length === 1) {
        const single = indexMatches[0];
        const singleTense = await parseTense(single.mode, message, behavioral);
        const singleCond = parseConditional(message);
        logParseTree(message, {
          noun: single.extName, nounSource: "converse-implicit", nounConf: 0.75,
          tense: singleTense.tense, tensePattern: singleTense.pattern, tenseConf: 0.8,
          resolvedMode: singleTense.mode, adjectives: parseAdjectives(message),
          voice: detectVoice(message), conditional: singleCond,
        });
        const converseGraph = buildExecutionGraph({
          resolvedMode: singleTense.mode, tenseInfo: singleTense,
          conditional: singleCond, adjectives: parseAdjectives(message),
          quantifiers: parseQuantifier(message), temporalScope: parseTemporalScope(message),
          voice: detectVoice(message),
          causal: null, classification: { targetNodeId: single.targetNodeId },
          behavioral, currentNodeId: single.targetNodeId, rootId,
          extName: single.extName,
        });
        log.verbose("Grammar", `Graph: ${describeGraph(converseGraph)}`);
        return executeGraph(converseGraph, message, visitorId, {
          socket, username, userId, rootId, signal, slot,
          currentNodeId: single.targetNodeId, clearHistory: true,
          onToolLoopCheckpoint, modesUsed,
          sessionId, rootChatId, rt,
          skipRespond,
        });
      }

      if (indexMatches.length > 1) {
        log.verbose("Tree Orchestrator", `  Chain detected: ${indexMatches.map(m => m.extName).join(" -> ")}`);
        const converseChainGraph = {
          type: "sequence",
          steps: indexMatches.map(m => makeDispatch(m.mode, m.extName, m.targetNodeId, { tense: "present" })),
          source: "converse-multi",
        };
        return executeGraph(converseChainGraph, message, visitorId, { socket, username, userId, rootId, signal, slot, onToolLoopCheckpoint, modesUsed, sessionId, rootChatId, rt, skipRespond });
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Converse check failed: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────
  // FALLBACK — tree:converse
  // Build tree capabilities from the routing index so converse
  // knows what extensions exist in this tree even when nothing matched.
  // ────────────────────────────────────────────────────────

  let treeCapabilities = null;
  if (rootId) {
    try {
      const { getIndexForRoot } = await import("./routingIndex.js");
      const { getExtensionManifest } = await import("../loader.js");
      const index = getIndexForRoot(rootId);
      if (index && index.size > 0) {
        const lines = [];
        for (const [extName, entry] of index) {
          const manifest = getExtensionManifest(extName);
          const territory = manifest?.territory || extName;
          lines.push(`  ${extName}: ${entry.path} (${territory})`);
        }
        treeCapabilities = lines.join("\n");
      }
    } catch {}
  }

  const fallbackCond = parseConditional(message);
  logParseTree(message, {
    noun: "converse", nounSource: "fallback", nounConf: 0.5,
    tense: "present", tensePattern: "default", tenseConf: 0.5,
    resolvedMode: "tree:converse",
    adjectives: parseAdjectives(message), voice: detectVoice(message),
    conditional: fallbackCond,
  });

  // Fallback: converse mode. If conditional detected, route through graph for evaluation.
  // Otherwise direct dispatch (no graph overhead for simple messages).
  if (fallbackCond) {
    const fallbackGraph = buildExecutionGraph({
      resolvedMode: "tree:converse", tenseInfo: { tense: "present", pattern: "default" },
      conditional: fallbackCond, adjectives: parseAdjectives(message),
      quantifiers: null, temporalScope: parseTemporalScope(message),
      voice: detectVoice(message),
      causal: null, classification: {}, behavioral, currentNodeId, rootId,
      extName: null,
    });
    // Inject treeCapabilities into graph nodes
    if (fallbackGraph.type === "dispatch") fallbackGraph.modifiers.treeCapabilities = treeCapabilities;
    else if (fallbackGraph.type === "fork") {
      fallbackGraph.truePath.modifiers.treeCapabilities = treeCapabilities;
      fallbackGraph.falsePath.modifiers.treeCapabilities = treeCapabilities;
      fallbackGraph.unknownPath.modifiers.treeCapabilities = treeCapabilities;
    }
    log.verbose("Grammar", `Graph: ${describeGraph(fallbackGraph)}`);
    return executeGraph(fallbackGraph, message, visitorId, {
      socket, username, userId, rootId, signal, slot,
      currentNodeId, clearHistory: true,
      onToolLoopCheckpoint, modesUsed,
      sessionId, rootChatId, rt,
      skipRespond,
    });
  }

  return runModeAndReturn(visitorId, "tree:converse", message, {
    socket, username, userId, rootId, signal, slot,
    currentNodeId, clearHistory: true,
    onToolLoopCheckpoint, modesUsed,
    treeCapabilities,
    // Same reason as the query fast path — downstream steppedMode needs
    // these to open Chat records against the user's live session.
    sessionId, rootChatId, rt,
    skipRespond,
  });
}
// ─────────────────────────────────────────────────────────────────────────
// RESPOND (final user-facing output)
// ─────────────────────────────────────────────────────────────────────────

// runRespond moved to ./respond.js
// SHORT-MEMORY DECISION removed (was marked CURRENTLY UNUSED)
