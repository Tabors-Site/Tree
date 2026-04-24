// steppedMode.js
// Extracted from orchestrator.js — the continuation loop for running a mode
// with multi-step chain tracking. No circular imports: does NOT import from
// dispatch.js or orchestrator.js.

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import {
  processMessage,
  getCurrentNodeId,
  setCurrentNodeId as setCurrentNodeIdSafely,
} from "../../seed/llm/conversation.js";
import { setChatContext, startChainStep, finalizeChat } from "../../seed/llm/chatTracker.js";
// Run processMessage for a mode, but split the tool-call work across
// chainIndex steps. The first call reuses the rootChat created upstream.
// If processMessage signals _continue (the mode's maxToolCallsPerStep cap
// was hit), we open a fresh chainIndex step via startChainStep, swap the
// active chat context to it so new tool calls land on the new record,
// and re-enter processMessage with continuation: true. Finalize each
// sub-step's chat as we go, restore the root chat context at the end so
// the upstream orchestrator can still write the final answer to it.
export async function runSteppedMode(visitorId, mode, message, {
  username, userId, rootId, signal, slot,
  readOnly, onToolLoopCheckpoint, socket,
  parentChatId = null, dispatchOrigin = null,
  sessionId, rootChatId, rt,
  currentNodeId = null,
  // Place mode — tells processMessage's tool loop to exit after a
  // successful tool call instead of re-invoking the LLM for prose.
  skipRespond = false,
}) {
  // Caller (dispatch.js's swarm runBranch) may pass currentNodeId
  // explicitly so this function can pin position regardless of session
  // state. Bundle it into a ctx object so downstream code can read it.
  const ctx = { currentNodeId };

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
  // Tool trace for post-hoc summarization. Each entry captures the tool
  // name and a compact arg hint (path for file ops, method+path for
  // probes). Bounded to the last 40 calls so a long chain doesn't eat
  // the summarizer's context.
  const toolTrace = [];
  // Write-only subset of the trace, used by place mode (skipRespond) to
  // produce `stepSummaries` — "what the turn actually placed." Read
  // tools don't count as placements. Surfaced on result._writeTrace so
  // dispatch can return it; runOrchestration maps it into stepSummaries.
  const writeTrace = [];
  const TOOL_TRACE_MAX = 40;
  const { isToolReadOnly } = await import("../../seed/tree/extensionScope.js");

  const onToolResults = (results) => {
    if (signal?.aborted) return;
    for (const r of results) {
      socket?.emit?.(WS.TOOL_RESULT, r);
      if (r?.tool) {
        const readOnly = isToolReadOnly(r.tool);
        if (readOnly) readCount++;
        else writeCount++;
        let hint = "";
        const args = r.args || r.arguments || {};
        if (args.filePath) hint = args.filePath;
        else if (args.path && args.method) hint = `${args.method} ${args.path}`;
        else if (args.path) hint = args.path;
        else if (args.name) hint = args.name;
        // Take a compact summary of the tool result too. For extension
        // tools like food-log-entry the result text is the user-visible
        // confirmation ("Logged to snack ..."); surfacing it makes the
        // place-mode output show what actually got placed.
        let resultSummary = "";
        const rawResult = r.result ?? r.content ?? null;
        if (typeof rawResult === "string") resultSummary = rawResult.slice(0, 200);
        else if (rawResult && typeof rawResult === "object") {
          try { resultSummary = JSON.stringify(rawResult).slice(0, 200); } catch {}
        }
        const entry = {
          tool: r.tool,
          hint: String(hint || "").slice(0, 120),
          ...(resultSummary ? { summary: resultSummary } : {}),
        };
        toolTrace.push(entry);
        if (toolTrace.length > TOOL_TRACE_MAX) toolTrace.shift();
        if (!readOnly) {
          writeTrace.push(entry);
          if (writeTrace.length > TOOL_TRACE_MAX) writeTrace.shift();
        }
      }
    }
  };

  const onToolCalled = (call) => {
    if (signal?.aborted) return;
    socket?.emit?.(WS.TOOL_CALLED, call);
  };
  const onThinking = (thought) => {
    if (signal?.aborted) return;
    socket?.emit?.(WS.THINKING, thought);
  };

  // Thread the current node into pmCtx explicitly.
  //
  // Two sources, in priority:
  //   1. ctx.currentNodeId — caller (e.g. dispatch.js's swarm runBranch)
  //      explicitly tells us "the branch is at THIS node". Authoritative.
  //   2. getCurrentNodeId(visitorId) — fall back to whatever the session
  //      currently says.
  //
  // Setting it in pmCtx forces ensureSession to also stamp it on the
  // session record, which double-protects against any upstream code
  // path that might have reset session.currentNodeId between dispatch
  // and processMessage. Without this thread-through, enrichContext and
  // the write-scope guards would see the project root instead of the
  // actual branch node and the AI would write "game.js" at the root
  // instead of "game/game.js".
  const pmCurrentNodeId =
    ctx.currentNodeId
      ? String(ctx.currentNodeId)
      : (getCurrentNodeId(visitorId) || rootId || null);
  const pmCtx = {
    username, userId, rootId, signal, slot,
    currentNodeId: pmCurrentNodeId,
    readOnly,
    skipRespond,
    onToolLoopCheckpoint,
    onToolResults,
    onToolCalled,
    onThinking,
    meta: { internal: false },
  };
  // Belt + suspenders: also re-assert via setCurrentNodeId so any
  // session-keyed callers (MCP server's getCurrentNodeId injection)
  // see the right value.
  if (pmCurrentNodeId) {
    setCurrentNodeIdSafely(visitorId, pmCurrentNodeId);
  }

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
  // Track the most recent chain-step chatId so the caller (dispatch.js
  // swarm wiring) can point branch workers at the step that actually
  // emitted [[BRANCHES]] instead of the whole session's root chat.
  let lastStepChatId = firstStep?.chatId || null;
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
      // Superseded-by-pivot is a special case worth calling out. The
      // branch received a PLAN_PIVOTED signal, saw the stop-work
      // block in enrichContext, and emitted [[NO-WRITE: superseded
      // by pivot]] on its next turn. We mark the result as done too
      // so no retry loop fires — the branch cleanly bowed out, the
      // user's new plan will dispatch a fresh set of branches.
      const superseded = /superseded\s+by\s+pivot/i.test(noWrite);
      if (superseded) {
        log.info("Tree Orchestrator", `🛑 ${mode} superseded by pivot; exiting branch cleanly`);
        result._taskDone = true;
      } else {
        log.info("Tree Orchestrator", `🟡 ${mode} declared no-write: ${noWrite}`);
      }
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
    if (retryStep?.chatId) lastStepChatId = retryStep.chatId;
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
    if (stepChat?.chatId) lastStepChatId = stepChat.chatId;

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

  // Attach the tool trace + write/read counts so callers (dispatch.js)
  // can decide whether to run a post-hoc summarizer when the model
  // emitted a bare [[DONE]] with no user-facing prose.
  if (result) {
    result._toolTrace = toolTrace;
    result._writeTrace = writeTrace;
    result._writeCount = writeCount;
    result._readCount = readCount;
    // The last chain-step chatId. Used by dispatch.js to nest branch
    // workers under the architect's final step (the one that emitted
    // [[BRANCHES]]) so the chat-history tree groups correctly.
    result._lastChatId = lastStepChatId;
  }

  return result;
}
