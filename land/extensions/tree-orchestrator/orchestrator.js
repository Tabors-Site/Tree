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
  getClientForUser,
  resolveRootLlmForMode,
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

import { setChatContext, startChainStep, finalizeChat } from "../../seed/llm/chatTracker.js";
import { getModesOwnedBy as _getModesOwnedBy } from "../../seed/tree/extensionScope.js";
import {
  executeGraph,
  buildExecutionGraph,
  describeGraph,
  makeDispatch,
} from "./graph.js";
import {
  parsePlan,
  setPendingPlan,
  getPendingPlan,
  clearPendingPlan,
  isAffirmative,
} from "./pendingPlan.js";
import { parseBranches, runBranchSwarm, validateBranches, parseContracts } from "./swarm.js";
import { isActiveNavigator } from "../../seed/ws/sessionRegistry.js";

import {
  getContextForAi,
  getNavigationContext,
  buildDeepTreeSummary,
} from "../../seed/tree/treeFetch.js";
import mongoose from "mongoose";
import Node from "../../seed/models/node.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";
import { resolveMode } from "../../seed/modes/registry.js";
import {
  getIntelligenceBrief,
  getMemory, pushMemory, clearMemory, formatMemoryContext,
  updatePronounState,
  recordRoutingDecision, getLastRouting, getLastRoutingRing, clearLastRouting,
  setActiveRequest, getActiveRequest,
} from "./state.js";

// Intelligence brief, path cache, memory, pronoun state, routing state,
// and active requests all live in ./state.js now.

export { clearMemory };

// ─────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit a status event to the frontend.
 */
export function emitStatus(socket, phase, text) {
  socket.emit("executionStatus", { phase, text });
}

/**
 * Emit an internal mode result to the chat so the user can see what's happening.
 */
function emitModeResult(socket, modeKey, result) {
  // Strip internal tracking fields before sending to client
  let sanitized = result;
  if (result && typeof result === "object") {
    const { _llmProvider, _raw, ...rest } = result;
    sanitized = rest;
  }
  socket.emit("orchestratorStep", {
    modeKey,
    result:
      typeof sanitized === "string"
        ? sanitized
        : JSON.stringify(sanitized, null, 2),
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SHARED: RESOLVE LLM PROVIDER
// ─────────────────────────────────────────────────────────────────────────

async function resolveLlmProvider(userId, rootId, modeKey, slot) {
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

// GRAMMAR DEBUGGER (standalone, called from every path)
// ─────────────────────────────────────────────────────────────────────────

function logParseTree(message, { noun, nounSource, nounConf, tense, tensePattern, tenseConf, resolvedMode, negated, compound, pronoun, quantifiers, adjectives, voice, preposition, prepTarget, temporal, conditional, forcedMode, graph, posMatches, posScore, posLocality, posAllScores }) {
  const debugLines = [];
  debugLines.push(`📖 Parse: "${(message || "").slice(0, 80)}"`);
  debugLines.push(`   noun: ${noun || "?"} (${nounSource || "?"}, conf=${(nounConf || 0).toFixed(2)})`);
  debugLines.push(`   tense: ${tense || "?"} (${tensePattern || "?"}, conf=${(tenseConf || 0).toFixed(2)})`);
  if (negated) debugLines.push(`   negation: YES`);
  if (compound) debugLines.push(`   compound: ${compound.join(" -> ")}`);
  if (pronoun) debugLines.push(`   pronoun: ${pronoun}`);
  if (quantifiers && quantifiers.length > 0) debugLines.push(`   quantifiers: ${quantifiers.map(q => q.type === "numeric" ? `${q.direction} ${q.count}` : q.type === "temporal" ? `${q.direction} ${q.unit}` : q.type === "superlative" ? `${q.qualifier} ${q.subject}` : q.type).join(", ")}`);
  if (adjectives && adjectives.length > 0) debugLines.push(`   adjectives: ${adjectives.map(a => `${a.qualifier} ${a.subject || ""}`).join(", ")}`);
  if (voice === "passive") debugLines.push(`   voice: passive`);
  if (preposition) debugLines.push(`   preposition: "${preposition}" -> ${prepTarget}`);
  if (temporal) debugLines.push(`   temporal: ${temporal}`);
  if (conditional) debugLines.push(`   conditional: ${conditional.type} (${conditional.keyword}) "${conditional.condition}"`);
  if (forcedMode) debugLines.push(`   forced: ${forcedMode}`);
  if (graph) debugLines.push(`   graph: ${describeGraph(graph)}`);

  // Per-POS routing matches: which words hit which extension's vocabulary,
  // including the locality bonus applied to the winner.
  if (posMatches && (posMatches.verbs.length > 0 || posMatches.nouns.length > 0 || posMatches.adjectives.length > 0)) {
    const parts = [];
    if (posMatches.nouns.length > 0) parts.push(`n:${posMatches.nouns.join(",")}`);
    if (posMatches.verbs.length > 0) parts.push(`v:${posMatches.verbs.join(",")}`);
    if (posMatches.adjectives.length > 0) parts.push(`a:${posMatches.adjectives.join(",")}`);
    const locTag = posLocality ? " LOCALITY" : "";
    debugLines.push(`   matched: score=${posScore || 0}${locTag} [${parts.join(" ")}]`);
  }
  if (posAllScores && posAllScores.length > 1) {
    const rivals = posAllScores.slice(1).map(s => `${s.extName}=${s.score}${s.locality ? "(loc)" : ""}`).join(" ");
    debugLines.push(`   rivals: ${rivals}`);
  }

  const compositeConf = ((nounConf || 0.5) * 0.6) + ((tenseConf || 0.5) * 0.4);
  debugLines.push(`   confidence: ${compositeConf.toFixed(2)}${compositeConf < 0.65 ? " (LOW)" : ""}`);
  debugLines.push(`   dispatch: ${resolvedMode || "?"}`);
  for (const line of debugLines) log.info("Grammar", line);
}

// ─────────────────────────────────────────────────────────────────────────
// RUN MODE AND RETURN (eliminates copy-pasted switchMode/processMessage)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Switch to a mode, run processMessage, handle memory and status events,
 * return the standard response shape. Every exit path that runs a mode
 * should call this instead of inlining the same 20 lines.
 */
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

// Run processMessage for a mode, but split the tool-call work across
// chainIndex steps. The first call reuses the rootChat created upstream.
// If processMessage signals _continue (the mode's maxToolCallsPerStep cap
// was hit), we open a fresh chainIndex step via startChainStep, swap the
// active chat context to it so new tool calls land on the new record,
// and re-enter processMessage with continuation: true. Finalize each
// sub-step's chat as we go, restore the root chat context at the end so
// the upstream orchestrator can still write the final answer to it.
async function runSteppedMode(visitorId, mode, message, {
  username, userId, rootId, signal, slot,
  readOnly, onToolLoopCheckpoint, socket,
  parentChatId = null, dispatchOrigin = null,
  sessionId: sessionIdParam = null,
  rootChatId: rootChatIdParam = null,
}) {
  const active = getActiveRequest(visitorId) || {};
  const sessionId = sessionIdParam || active.sessionId;
  const rootChatId = rootChatIdParam || active.rootChatId;
  const rt = active.rt; // shared OrchestratorRuntime with rt.chainIndex counter

  // Helper to begin a chain step (live chat context for tool calls) using
  // rt.beginChainStep. Falls back to a direct startChainStep + local counter
  // only if rt is somehow missing (non-orchestrator caller path).
  //
  // IMPORTANT: stamp the chat step's treeContext.targetNodeId with the
  // CURRENT node (which swarm dispatch moves to the branch node via
  // setCurrentNodeId), NOT with rootId. Prior behavior stamped every
  // branch's chat chain under the project root, making per-node chat
  // pages empty for every branch. This is the load-bearing fix that
  // makes per-node drill-in work.
  let fallbackChainIndex = 0;
  const beginStep = async (stepModeKey, stepInput) => {
    const currentNodeId = getCurrentNodeId(visitorId) || rootId;
    log.info("Tree Orchestrator",
      `📍 beginChainStep ${stepModeKey} targetNodeId=${currentNodeId?.slice?.(0, 8)} (rootId=${rootId?.slice?.(0, 8)}, dispatchOrigin=${dispatchOrigin || "continuation"}, parentChatId=${parentChatId ? parentChatId.slice(0, 8) : "null"}, rt=${rt && !rt._cleaned ? "live" : "fallback"})`,
    );
    if (rt && !rt._cleaned) {
      const step = await rt.beginChainStep(stepModeKey, stepInput, {
        treeContext: currentNodeId ? { targetNodeId: currentNodeId } : undefined,
        parentChatId: parentChatId || null,
        dispatchOrigin: dispatchOrigin || "continuation",
      });
      if (step?.chatId) {
        setChatContext(visitorId, sessionId, step.chatId);
      }
      return step;
    }
    // Fallback: rt is null or cleaned (common for branch dispatches
    // where the shared runtime has progressed past this branch).
    // Create the chat record directly so treeContext is stamped.
    try {
      const { startChainStep } = await import("../../seed/llm/chatTracker.js");
      if (!sessionId || !userId) {
        log.warn("Tree Orchestrator", `beginStep fallback: missing sessionId=${!!sessionId} userId=${!!userId}`);
      }
      const chat = await startChainStep({
        userId,
        sessionId,
        chainIndex: fallbackChainIndex++,
        rootChatId: rootChatId || null,
        modeKey: stepModeKey,
        source: "branch",
        input: stepInput,
        treeContext: currentNodeId ? { targetNodeId: currentNodeId } : undefined,
        parentChatId: parentChatId || null,
        dispatchOrigin: dispatchOrigin || "branch-swarm",
      });
      if (chat?._id) {
        log.info("Tree Orchestrator", `📍 fallback chat created: ${chat._id.slice(0, 8)} target=${currentNodeId?.slice(0, 8)}`);
        setChatContext(visitorId, sessionId, chat._id);
        return { chatId: chat._id, chainIndex: fallbackChainIndex - 1 };
      }
      log.warn("Tree Orchestrator", `beginStep fallback: startChainStep returned null`);
    } catch (err) {
      log.warn("Tree Orchestrator", `beginStep fallback failed: ${err.message}`);
    }
    return null;
  };

  const finishStep = async (step, outputText, stopped = false) => {
    if (!step?.chatId) return;
    if (rt && !rt._cleaned) {
      await rt.finishChainStep(step.chatId, {
        output: outputText,
        stopped,
        modeKey: mode,
      });
    } else {
      await finalizeChat({
        chatId: step.chatId,
        content: outputText,
        stopped,
        modeKey: mode,
      }).catch(() => {});
    }
  };

  // Modes that are expected to produce file writes. A turn that ends with
  // reads only is suspicious for these — the model is probably claiming
  // completion without actually doing the work. We'll force a retry below.
  const WRITE_EXPECTED_MODES = new Set([
    "tree:code-plan",
    "tree:code-log",
    "tree:code-coach",
  ]);
  const expectsWrites = WRITE_EXPECTED_MODES.has(mode);

  // Tool-call audit for this whole runSteppedMode invocation. We flag each
  // call as read-only or write via isToolReadOnly(). If a plan-mode turn
  // finishes with pureReadCount > 0 and writeCount === 0, we inject a
  // nudge and force one more step.
  let writeCount = 0;
  let readCount = 0;
  const { isToolReadOnly } = await import("../../seed/tree/extensionScope.js");

  const onToolResults = (results) => {
    if (signal?.aborted) return;
    for (const r of results) {
      socket.emit(WS.TOOL_RESULT, r);
      if (r?.tool) {
        if (isToolReadOnly(r.tool)) readCount++;
        else writeCount++;
      }
    }
  };

  const pmCtx = {
    username, userId, rootId, signal, slot,
    readOnly,
    onToolLoopCheckpoint,
    onToolResults,
    meta: { internal: false },
  };

  // Markers the model can emit to signal status to the orchestrator.
  // Stripped from visible text before it reaches the user AND before we
  // write the OUT to the chain step's chat record.
  //   [[NO-WRITE: reason]]  — this turn intentionally has no write, skip retry
  //   [[DONE]]              — the entire task is complete, stop continuing
  const NO_WRITE_RE = /\[\[\s*no[\s-]?write(?::\s*([^\]]*))?\s*\]\]/i;
  const DONE_RE = /\[\[\s*done\s*\]\]/i;
  const stripMarkers = (r) => {
    if (!r?.content) return { noWrite: null, done: false };
    let txt = r.content;
    let noWrite = null;
    const mNW = txt.match(NO_WRITE_RE);
    if (mNW) {
      noWrite = (mNW[1] || "no change needed").trim();
      txt = txt.replace(NO_WRITE_RE, "").trim();
    }
    const done = DONE_RE.test(txt);
    if (done) txt = txt.replace(DONE_RE, "").trim();
    if (txt !== r.content) {
      r.content = txt;
      r.answer = txt;
    }
    return { noWrite, done };
  };

  // ─── First call: always gets its own chain step ────────────────────
  // Even the very first runSteppedMode call (top-level message) opens a
  // fresh chain step so every LLM call is a distinct, visible substep.
  // chainIndex 0 stays reserved for the root (user's message + final
  // aggregated answer), set up upstream by runOrchestration.
  let firstStep = await beginStep(mode, message || "(empty)");
  let result;
  const allContent = []; // accumulate content across continuation turns
  try {
    result = await processMessage(visitorId, message, pmCtx);
    if (result?.content) allContent.push(result.content);
  } catch (err) {
    await finishStep(firstStep, `Error: ${err.message}`, true);
    if (rootChatId && sessionId) setChatContext(visitorId, sessionId, rootChatId);
    throw err;
  }

  let noWriteReason = null;
  {
    const { noWrite, done } = stripMarkers(result);
    if (noWrite) {
      noWriteReason = noWrite;
      log.info("Tree Orchestrator", `🟡 ${mode} declared no-write: ${noWrite}`);
    }
    if (done) {
      log.info("Tree Orchestrator", `✅ ${mode} declared done`);
      result._taskDone = true;
    }
  }

  // Finalize the first step with its real OUT
  await finishStep(
    firstStep,
    result?.content || result?.answer || "(no text)",
    signal?.aborted || false,
  );

  // No-write guardrail. If the mode was supposed to write files but the
  // turn ended with only reads AND no escape hatch was declared, the
  // model is claiming completion it didn't earn. Force one retry with a
  // nudge. After one retry it either writes, or declares no-write, or
  // we accept whatever it said (don't loop forever lying to the user).
  let noWriteRetries = 0;
  const MAX_NO_WRITE_RETRIES = 1;
  const needsWriteRetry = () =>
    expectsWrites
    && !readOnly
    && !result?._continue
    && !noWriteReason
    && readCount > 0
    && writeCount === 0
    && noWriteRetries < MAX_NO_WRITE_RETRIES;

  if (needsWriteRetry()) {
    noWriteRetries++;
    log.warn("Tree Orchestrator",
      `⚠️  ${mode} finished with ${readCount} reads, 0 writes. Injecting write nudge and retrying.`,
    );
    const nudge =
      `You read files but did not call workspace-add-file or workspace-edit-file. ` +
      `You must either (a) apply the change now via a write tool, or ` +
      `(b) explain why no write is needed and end your response with ` +
      `[[NO-WRITE: <one-line reason>]]. Do not respond with "Done" unless ` +
      `you actually wrote something in this turn.`;

    const retryStep = await beginStep(mode, nudge);
    try {
      result = await processMessage(visitorId, nudge, pmCtx);
    } catch (err) {
      await finishStep(retryStep, `Error: ${err.message}`, true);
      if (rootChatId && sessionId) setChatContext(visitorId, sessionId, rootChatId);
      throw err;
    }
    const afterRetry = stripMarkers(result);
    if (afterRetry.noWrite) {
      noWriteReason = afterRetry.noWrite;
      log.info("Tree Orchestrator", `🟡 ${mode} declared no-write on retry`);
    }
    if (afterRetry.done) result._taskDone = true;
    await finishStep(
      retryStep,
      result?.content || result?.answer || "(no text)",
      signal?.aborted || false,
    );
  }

  // Per-mode continuation budget. Plan mode ships with maxSteppedRuns=20
  // so it can run 20 short LLM calls back-to-back without hitting the
  // default 8-step cap. Modes that don't declare it keep the default.
  let maxSteps = 8;
  try {
    const { resolveMode } = await import("../../seed/modes/registry.js");
    const modeObj = resolveMode(mode);
    if (modeObj?.maxSteppedRuns && Number.isFinite(modeObj.maxSteppedRuns)) {
      maxSteps = Math.max(1, Math.min(Math.floor(modeObj.maxSteppedRuns), 40));
    }
  } catch {}

  // Continuation loop. Two triggers:
  //  (a) result._continue is true — the tool cap was hit mid-generation
  //      and we should re-enter with the same session to keep going.
  //  (b) result._taskDone is NOT set AND writes happened — the model
  //      stopped on its own but didn't explicitly declare done. Force
  //      another step and ask "anything else, or [[DONE]]?" so a lazy
  //      "package.json written, I'll do the rest later" becomes actual
  //      completion.
  //
  // Stops when: _taskDone is true, or signal is aborted, or maxSteps
  // cap is reached. chainIndex is tracked by rt.chainIndex (via
  // beginChainStep), not a local counter.
  let continuationCount = 0;
  let idleTurns = 0;
  let lastWriteCount = writeCount;
  const MAX_IDLE_TURNS = 4;
  const shouldContinue = () => {
    if (signal?.aborted) return false;
    if (result?._taskDone) return false;
    if (continuationCount >= maxSteps) return false;
    // Track idle turns (no writes) across BOTH _continue and
    // force-continue paths. Without this, _continue from read-only
    // tool calls burns unlimited turns.
    if (writeCount > lastWriteCount) {
      idleTurns = 0;
      lastWriteCount = writeCount;
    } else {
      idleTurns++;
    }
    if (idleTurns >= MAX_IDLE_TURNS && !result?._continue) return false;
    if (idleTurns >= MAX_IDLE_TURNS * 2) return false; // hard cap even for _continue
    if (result?._continue) return true;
    if (expectsWrites && writeCount > 0) return true;
    return false;
  };

  while (shouldContinue()) {
    continuationCount++;

    // Active cascade nudge check — between turns, see if any other
    // session wrote a signal targeting this session's subtree while
    // we were waiting on the last LLM call. If yes, log it so the
    // operator knows the feature fired; the actual "fresh banner"
    // injection happens naturally on the next enrichContext run.
    // Guard with try/catch so a nudge failure never breaks the loop.
    try {
      const { getExtension: _getExt } = await import("../loader.js");
      const cwExt = _getExt("code-workspace")?.exports;
      if (cwExt?.maybeApplyCascadeNudge) {
        await cwExt.maybeApplyCascadeNudge({ sessionId, visitorId });
      }
      // DEBUG_ENRICH_CONTEXT=1 dumps what the AI sees before each
      // processMessage call. One operator switch for deep inspection
      // without touching the prompt path.
      if (process.env.DEBUG_ENRICH_CONTEXT === "1" && cwExt?.dumpContextForSession) {
        try {
          const dump = await cwExt.dumpContextForSession(sessionId, core, { dryRun: true });
          log.debug(
            "Tree Orchestrator",
            `[DEBUG_ENRICH_CONTEXT] sid=${sessionId?.slice?.(0, 8)}\n${JSON.stringify(dump?.context || {}, null, 2).slice(0, 4000)}`,
          );
        } catch {}
      }
    } catch (nudgeErr) {
      log.warn(
        "Tree Orchestrator",
        `maybeApplyCascadeNudge failed: ${nudgeErr.message}`,
      );
    }

    // Pick the nudge based on which trigger fired:
    //   - tool cap hit:  empty message, just re-enter the loop
    //   - missing done:  explicit "what's next, or emit [[DONE]]" prompt
    const nudgeMessage = result?._continue
      ? "[continue]"
      : `Anything else to do for this task? ` +
        `If yes: call the next write tool now (one per turn). ` +
        `If no: end your response with [[DONE]] on its own line. ` +
        `Do not describe what you "will do next" — either do it, or emit [[DONE]].`;

    const useContinuation = result?._continue; // only true for empty-message re-entry
    const stepChat = await beginStep(mode, nudgeMessage);

    try {
      result = await processMessage(visitorId, result?._continue ? "" : nudgeMessage, {
        ...pmCtx,
        continuation: useContinuation,
      });
      if (result?.content) allContent.push(result.content);
    } catch (err) {
      await finishStep(stepChat, `Error: ${err.message}`, true);
      if (rootChatId && sessionId) setChatContext(visitorId, sessionId, rootChatId);
      throw err;
    }

    // Strip markers from continuation responses too
    const stripped = stripMarkers(result);
    if (stripped.done) result._taskDone = true;
    if (stripped.noWrite) result._taskDone = true; // no-write on a continuation = done

    await finishStep(
      stepChat,
      result?.content || result?.answer || "(no text)",
      signal?.aborted || false,
    );
  }

  // Restore context to the root chat so any subsequent writes (final answer,
  // contributions, upstream finalizeChat) target chainIndex 0.
  if (rootChatId && sessionId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  // Attach accumulated content from all continuation turns so the
  // caller can detect [[CONTRACTS]]/[[BRANCHES]] blocks that appeared
  // in earlier turns but were overwritten by later continuations.
  if (result && allContent.length > 1) {
    result._allContent = allContent.join("\n");
  }

  return result;
}

export async function runModeAndReturn(visitorId, mode, message, {
  socket, username, userId, rootId, signal, slot,
  currentNodeId, readOnly = false, clearHistory = false,
  onToolLoopCheckpoint, modesUsed,
  targetNodeId = null,
  sessionId = null, rootChatId = null,
  treeCapabilities = null,
  adjectives = null,
  quantifiers = null,
  temporalScope = null,
  fanoutContext = null,
  reroutePrefix = null,
  voice = "active",
}) {
  modesUsed.push(mode);
  emitStatus(socket, "intent", "");

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
    sessionId, rootChatId,
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
    // Parse contracts FIRST so parseBranches sees the cleaned text
    // (the [[CONTRACTS]] block is stripped before parseBranches runs).
    // Contracts are optional — a simple single-branch build doesn't
    // need them — but when present they become the authoritative wire
    // protocol all branches must implement.
    const contractsParse = parseContracts(answer);
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
    const branchParse = parseBranches(answer);
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

      // Resolve the current project root node so the swarm runner knows
      // where to hang branch children. We look up by the current position
      // walking the metadata.code-workspace.role chain to find "project".
      // If no project exists yet (common: user is at a fresh tree root,
      // no files written), auto-initialize the tree root as a workspace
      // project so the swarm has somewhere to hang branches.
      try {
        const { getExtension } = await import("../loader.js");
        const cwExt = getExtension("code-workspace");
        // Walk from current position to find the project root
        let projectNode = null;
        const searchNodeId = currentNodeId || targetNodeId || rootId;
        const NodeModel = (await import("../../seed/models/node.js")).default;
        if (searchNodeId) {
          let cursor = String(searchNodeId);
          for (let i = 0; i < 64 && cursor; i++) {
            const n = await NodeModel.findById(cursor).select("_id name parent metadata").lean();
            if (!n) break;
            const meta = n.metadata instanceof Map ? n.metadata.get("code-workspace") : n.metadata?.["code-workspace"];
            if (meta?.role === "project" && meta?.initialized) {
              projectNode = n;
              break;
            }
            if (!n.parent) break;
            cursor = String(n.parent);
          }
        }

        // Auto-init fallback. If the user is at a tree root with no
        // existing project metadata, treat the tree root as the project
        // and initialize it via code-workspace's initProject export.
        // Mirrors the ensureProject auto-init that runs on first file
        // write, but fires before the swarm dispatch so branches have a
        // parent to hang under.
        if (!projectNode && rootId && cwExt?.exports?.initProject) {
          log.info("Tree Orchestrator", `Swarm: no project at position, auto-initializing tree root ${rootId}`);
          try {
            const rootNode = await NodeModel.findById(rootId).lean();
            if (rootNode) {
              await cwExt.exports.initProject({
                projectNodeId: rootId,
                name: rootNode.name || "workspace",
                description: "Auto-initialized by swarm dispatch.",
                userId,
              });
              projectNode = await NodeModel.findById(rootId).select("_id name parent metadata").lean();
            }
          } catch (initErr) {
            log.error("Tree Orchestrator", `Swarm auto-init failed: ${initErr.message}`);
          }
        }

        if (!projectNode) {
          log.warn("Tree Orchestrator", "Swarm: no project root found at current position; branches will not run.");
        } else {
          // Persist the architect's declared contracts on the project
          // root BEFORE the swarm dispatches, so each branch session's
          // enrichContext walks into them via readProjectContracts and
          // injects them into the branch's system prompt from turn 1.
          // This is how the architect's design flows to every
          // implementing branch without a separate distribution step.
          if (parsedContracts && parsedContracts.length > 0) {
            try {
              const { setProjectContracts } = await import("../code-workspace/swarmEvents.js");
              await setProjectContracts({
                projectNodeId: projectNode._id,
                contracts: parsedContracts,
                core: { metadata: { setExtMeta: async (node, ns, data) => {
                  const NodeModel = (await import("../../seed/models/node.js")).default;
                  await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
                } } },
              });
              log.info("Tree Orchestrator",
                `📜 Contracts stored on project root ${String(projectNode._id).slice(0, 8)}`,
              );
            } catch (ctxErr) {
              log.warn("Tree Orchestrator", `Failed to store contracts: ${ctxErr.message}`);
            }
          }

          // Validate the architect's branch paths against the seam
          // rules (no path may equal the project name, all paths must
          // be unique, every branch must have a path). If any branch
          // is broken, reject the whole block, skip the swarm dispatch,
          // and append an error message to the answer so the next turn
          // forces the architect to re-emit a corrected [[BRANCHES]]
          // block. Without this, a bad branch plan (like two branches
          // both using path=ProjectName) silently collapses the whole
          // swarm into one subdirectory with empty branch nodes.
          const validation = validateBranches(branchParse.branches, projectNode?.name);
          if (validation.errors.length > 0) {
            log.warn("Tree Orchestrator",
              `🚫 Swarm: rejecting branch plan with ${validation.errors.length} validation error(s):\n  - ${validation.errors.join("\n  - ")}`,
            );
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

          const _swarmActive = getActiveRequest(visitorId) || {};
          const swarmResult = await runBranchSwarm({
            branches: branchParse.branches,
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
            userRequest: message,
            rt: _swarmActive.rt,
            core: { metadata: { setExtMeta: async (node, ns, data) => {
              // Safe fallback via direct Node update if core services aren't available here
              const NodeModel = (await import("../../seed/models/node.js")).default;
              await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
            } } },
            emitStatus,
            runBranch: async ({ mode: branchMode, message: branchMessage, branchNodeId, slot: branchSlot, ...rest }) => {
              // Position the session at the branch node + clear history so
              // each branch starts fresh at its own tree position.
              log.info("Tree Orchestrator",
                `🌿 runBranch dispatching: mode=${branchMode} branchNodeId=${branchNodeId?.slice?.(0, 8)} (was currentNodeId=${getCurrentNodeId(visitorId)?.slice?.(0, 8)})`,
              );
              setCurrentNodeId(visitorId, branchNodeId);
              // Refresh the active request so the branch's
              // runSteppedMode can read sessionId/userId/rt.
              // The 30s TTL on getActiveRequest expires during
              // long builds; re-stamp with the values captured
              // at swarm start (line 2497) so they survive.
              setActiveRequest(visitorId, {
                socket, username, userId, signal,
                sessionId,
                rootId,
                rootChatId,
                slot, onToolLoopCheckpoint,
                rt: (getActiveRequest(visitorId) || {}).rt,
              });
              await switchMode(visitorId, branchMode, {
                username, userId, rootId,
                currentNodeId: branchNodeId,
                clearHistory: true,
              });
              log.info("Tree Orchestrator",
                `🌿 runBranch post-switch: currentNodeId=${getCurrentNodeId(visitorId)?.slice?.(0, 8)} (expected ${branchNodeId?.slice?.(0, 8)})`,
              );
              // Stamp dispatch lineage on the branch's chat chain so
              // the operator can walk from the orchestrator's root
              // step down to each branch and back. parentChatId points
              // at the orchestrator's root chat (active.rootChatId);
              // dispatchOrigin tells the renderer "this is a swarm
              // branch spawn" so the labels are right.
              return runSteppedMode(visitorId, branchMode, branchMessage, {
                username, userId, rootId, signal, slot: branchSlot,
                readOnly: false, onToolLoopCheckpoint, socket,
                sessionId, rootChatId,
                parentChatId: rootChatId || null,
                dispatchOrigin: "branch-swarm",
              });
            },
          });

          // Replace the answer with the swarm summary so the user sees the
          // full picture. Original architect text + swarm result.
          answer = [answer, "", swarmResult.summary].filter(Boolean).join("\n");
          if (result) {
            result.content = answer;
            result.answer = answer;
          }

          // Restore position to the original project root
          if (projectNode?._id) setCurrentNodeId(visitorId, String(projectNode._id));
        }
      } catch (err) {
        log.error("Tree Orchestrator", `Swarm dispatch failed: ${err.message}`);
        log.error("Tree Orchestrator", err.stack?.split("\n").slice(0, 5).join("\n"));
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
  return { success: true, answer, modeKey: mode, modesUsed, rootId, targetNodeId: targetNodeId || currentNodeId };
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
          for (const r of results) socket.emit(WS.TOOL_RESULT, r);
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
    visitorId,
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

  // ── Resumable swarm intercept ──
  // When the user is inside (or at) a code-workspace project with a
  // masterPlan that has ANY non-done branches, AND this message looks
  // like a continuation ("continue", "finish", "keep going", or any
  // short imperative at the project), skip the classifier/architect
  // entirely and dispatch runBranchSwarm directly with the pending /
  // paused / failed branches.
  //
  // This is the "TreeOS knows what it already built" behavior: the
  // tree is the authoritative state, AI chats are ephemeral. Any new
  // message at a project automatically sees its state and picks up
  // where it left off — no re-architecting, no duplicate branches.
  if (!forceMode && message && rootId) {
    try {
      // Use the session's current tree position if set, otherwise the
      // tree root. `currentNodeId` is NOT a destructured param on this
      // function — a previous version referenced it as an undeclared
      // local which silently ReferenceError'd every call and left the
      // whole resume intercept inert. Read it off the session instead.
      const searchNodeId = getCurrentNodeId(visitorId) || rootId;
      const { findProjectForNode, detectResumableSwarm } = await import("../code-workspace/swarmEvents.js");
      const projectNode = await findProjectForNode(searchNodeId);
      if (projectNode) {
        const resumable = await detectResumableSwarm(projectNode._id);
        if (resumable && resumable.resumable.length > 0) {
          // At least one non-done branch exists. Should we intercept?
          // Intercept if:
          //   - message is an affirmative / continuation word, OR
          //   - message is short + imperative (user said "build it" or "go" at an in-progress project)
          // Skip intercept if message is long and clearly describes a new task
          // (user will get the architect path to produce fresh branches).
          const RESUME_CONTINUATION_RE = /^\s*(continue|keep\s+going|resume|finish(\s+it)?(\s+up)?|pick(\s+up)?|retry|again|go|go\s+ahead|proceed|keep\s+building|build|make\s+it|do\s+it|complete(\s+it)?|the\s+rest|what('|')?s\s+left|where\s+were\s+we)\b/i;
          const shortImperative = message.length < 60 && RESUME_CONTINUATION_RE.test(message);

          if (shortImperative) {
            log.info("Tree Orchestrator",
              `▶️  Resume intercept: ${resumable.resumable.length} of ${resumable.total} branches non-done under "${resumable.projectName}" (${JSON.stringify(resumable.statusCounts)}). Skipping classifier, dispatching runBranchSwarm in resume mode.`,
            );
            emitStatus(socket, "intent", `Resuming ${resumable.resumable.length} branch(es) from prior run...`);

            const swarmResult = await runBranchSwarm({
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
              userRequest: resumable.systemSpec || message,
              rt,
              resumeMode: true,
              core: {
                metadata: {
                  setExtMeta: async (node, ns, data) => {
                    const NodeModel = (await import("../../seed/models/node.js")).default;
                    await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
                  },
                },
              },
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
                });
              },
            });

            emitStatus(socket, "done", "");
            return {
              success: swarmResult.success,
              answer: swarmResult.summary,
              modeKey: "tree:code-plan",
              modesUsed: ["tree:code-plan"],
              rootId,
              targetNodeId: String(projectNode._id),
            };
          }
        }
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Resume intercept skipped: ${err.message}`);
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
        onToolResults(results) { if (signal?.aborted) return; for (const r of results) socket.emit(WS.TOOL_RESULT, r); },
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
      // Check for departure: does the message match a DIFFERENT extension's hints
      // but NOT the current extension's hints? If so, skip position hold.
      let isDeparture = false;
      try {
        const { getClassifierHintsForMode } = await import("../loader.js");
        const { getModeOwner } = await import("../../seed/tree/extensionScope.js");
        const currentExt = getModeOwner(posModes.respond);
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
            log.verbose("Tree Orchestrator",
              `🎯 Departure from ${currentExt}: message matches ${otherMatches.map(m => m.extName).join(", ")}`);
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
        const holdExt = typeof getModeOwner === "function" ? getModeOwner(classification.mode) : "?";
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
  // BE: GUIDED MODE — the tree leads, the user follows
  // Skip classification. Find the guided mode at this position.
  // ────────────────────────────────────────────────────────

  if (behavioral === "be") {
    // Tier 1: Current node has an extension. Delegate to its handleMessage or coach mode.
    let beHandled = false;
    try {
      const { getLoadedExtensionNames, getExtension } = await import("../loader.js");
      const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
      const nodeDoc = currentNodeId ? await Node.findById(currentNodeId).select("metadata").lean() : null;
      if (nodeDoc) {
        const meta = nodeDoc.metadata instanceof Map ? Object.fromEntries(nodeDoc.metadata) : (nodeDoc.metadata || {});
        for (const extName of getLoadedExtensionNames()) {
          if (meta[extName]?.role || meta[extName]?.initialized) {
            const ext = getExtension(extName);
            if (ext?.exports?.handleMessage) {
              log.verbose("Tree Orchestrator", `  BE mode: delegating to ${extName}.handleMessage`);
              emitStatus(socket, "intent", "");
              const decision = await ext.exports.handleMessage("be", {
                userId, username, rootId, targetNodeId: String(currentNodeId),
              });
              // Resolve coach mode via registry, NOT string concatenation.
              // Extension name and mode prefix don't always match
              // (code-workspace owns tree:code-coach, not tree:code-workspace-coach).
              const extCoachModes = getModesOwnedBy(extName).filter((m) => m.endsWith("-coach"));
              const resolvedMode = decision?.mode || extCoachModes[0] || null;
              if (!resolvedMode) {
                log.warn("Tree Orchestrator", `BE mode: ${extName} has no coach mode registered, skipping`);
                continue;
              }
              modesUsed.push(resolvedMode);

              if (decision?.answer) {
                emitStatus(socket, "done", "");
                pushMemory(visitorId, message, decision.answer);
                return { success: true, answer: decision.answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: String(currentNodeId) };
              }

              await switchMode(visitorId, resolvedMode, { username, userId, rootId, currentNodeId: String(currentNodeId), conversationMemory: formatMemoryContext(visitorId), clearHistory: decision?.setup || false });
              const result = await processMessage(visitorId, decision?.message || message, { username, userId, rootId, signal, slot, onToolLoopCheckpoint, onToolResults(results) { if (signal?.aborted) return; for (const r of results) socket.emit(WS.TOOL_RESULT, r); } });
              emitStatus(socket, "done", "");
              const answer = result?.content || result?.answer || null;
              if (answer) pushMemory(visitorId, message, answer);
              return { success: true, answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: String(currentNodeId) };
            }
            const extModes = getModesOwnedBy(extName);
            const coachMode = extModes.find(m => m.endsWith("-coach")) || null;
            if (coachMode) {
              log.verbose("Tree Orchestrator", `  BE mode: switching to ${coachMode}`);
              await switchMode(visitorId, coachMode, { username, userId, rootId, conversationMemory: formatMemoryContext(visitorId), clearHistory: true });
              const result = await processMessage(visitorId, message, { username, userId, rootId, signal, socket, sessionId });
              modesUsed.push(coachMode);
              return { success: true, answer: result?.content || "", modeKey: coachMode, modesUsed, rootId };
            }
            break;
          }
        }
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `BE Tier 1 failed: ${err.message}`);
    }

    // Tier 2: Not at an extension node. Find closest extension via routing index.
    // If the message matches an extension's hints, route there. Otherwise pick the first.
    if (!beHandled && rootId) {
      try {
        const { getExtension } = await import("../loader.js");
        const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
        const { queryAllMatches, getIndexForRoot } = await import("./routingIndex.js");
        const index = getIndexForRoot(rootId);
        if (index && index.size > 0) {
          // Check if the message matches any extension's hints
          const hintMatches = queryAllMatches(rootId, message, null);
          // Use hint match if found, otherwise fall through to first extension
          const entries = hintMatches.length > 0
            ? hintMatches.map(m => [m.extName, index.get(m.extName)]).filter(([, e]) => e)
            : [...index.entries()];

          for (const [extName, entry] of entries) {
            const ext = getExtension(extName);
            if (!ext?.exports?.handleMessage) continue;
            const extModes = getModesOwnedBy(extName);
            const extCoachModes = extModes.filter((m) => m.endsWith("-coach"));
            if (extCoachModes.length === 0) continue;

            const targetId = entry.nodeId || entry.nodes?.[0]?.nodeId;
            log.verbose("Tree Orchestrator", `  BE mode: routing to closest extension ${extName} at ${targetId}`);
            setCurrentNodeId(visitorId, targetId);
            emitStatus(socket, "intent", "");
            try {
              const decision = await ext.exports.handleMessage("be", {
                userId, username, rootId, targetNodeId: targetId,
              });
              // Use the first registered -coach mode for this extension.
              // Extension name ≠ mode prefix in general (code-workspace
              // owns tree:code-coach), so we look up via the registry.
              const resolvedMode = decision?.mode || extCoachModes[0];
              modesUsed.push(resolvedMode);

              if (decision?.answer) {
                emitStatus(socket, "done", "");
                pushMemory(visitorId, message, decision.answer);
                return { success: true, answer: decision.answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: targetId };
              }

              await switchMode(visitorId, resolvedMode, { username, userId, rootId, currentNodeId: targetId, conversationMemory: formatMemoryContext(visitorId), clearHistory: decision?.setup || false });
              const result = await processMessage(visitorId, decision?.message || message, { username, userId, rootId, signal, slot, onToolLoopCheckpoint, onToolResults(results) { if (signal?.aborted) return; for (const r of results) socket.emit(WS.TOOL_RESULT, r); } });
              emitStatus(socket, "done", "");
              const answer = result?.content || result?.answer || null;
              if (answer) pushMemory(visitorId, message, answer);
              return { success: true, answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: targetId };
            } catch (err) {
              log.error("Tree Orchestrator", `BE routing failed for ${extName}: ${err.message}`);
            }
          }
        }
      } catch {}
    }

    // Tier 3: No extensions found. Generic tree:be.
    log.verbose("Tree Orchestrator", `  BE mode: switching to tree:be`);
    await switchMode(visitorId, "tree:be", { username, userId, rootId, conversationMemory: formatMemoryContext(visitorId), clearHistory: true });
    const result = await processMessage(visitorId, message, { username, userId, rootId, signal, socket, sessionId });
    modesUsed.push("tree:be");
    return { success: true, answer: result?.content || "", modeKey: "tree:be", modesUsed, rootId };
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

      let primaryPos = 0;
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
        return executeGraph(chainGraph, message, visitorId, { socket, username, userId, rootId, signal, slot, onToolLoopCheckpoint, modesUsed });
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
      sessionId, rootChatId,
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
        });
      }

      if (indexMatches.length > 1) {
        log.verbose("Tree Orchestrator", `  Chain detected: ${indexMatches.map(m => m.extName).join(" -> ")}`);
        const converseChainGraph = {
          type: "sequence",
          steps: indexMatches.map(m => makeDispatch(m.mode, m.extName, m.targetNodeId, { tense: "present" })),
          source: "converse-multi",
        };
        return executeGraph(converseChainGraph, message, visitorId, { socket, username, userId, rootId, signal, slot, onToolLoopCheckpoint, modesUsed });
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
    });
  }

  return runModeAndReturn(visitorId, "tree:converse", message, {
    socket, username, userId, rootId, signal, slot,
    currentNodeId, clearHistory: true,
    onToolLoopCheckpoint, modesUsed,
    treeCapabilities,
  });
}
// ─────────────────────────────────────────────────────────────────────────
// RESPOND (final user-facing output)
// ─────────────────────────────────────────────────────────────────────────

// runRespond moved to ./respond.js
// SHORT-MEMORY DECISION removed (was marked CURRENTLY UNUSED)
