// TreeOS Tree Orchestrator . respond.js
// Response fallback path. Handles the "defer" and "respond" execution paths
// where the orchestrator needs the AI to summarize, confirm, or acknowledge.

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import { switchMode, processMessage, getCurrentNodeId } from "../../seed/llm/conversation.js";
import { formatMemoryContext, pushMemory } from "./state.js";
import { resolveModeForNode } from "./classify.js";

function formatStepSummaries(steps) {
  if (!steps || steps.length === 0) return "";
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function emitStatus(socket, phase, text) {
  if (socket?.emit) socket.emit(WS.EXECUTION_STATUS, { phase, text });
}

export async function runRespond({
  visitorId,
  socket,
  signal,
  username,
  userId,
  rootId,
  nodeContext,
  operationContext,
  confirmNeeded = false,
  originalMessage = null,
  responseHint = "",
  stepSummaries = [],
  librarianContext = null,
  slot,
}) {
  emitStatus(socket, "respond", "");

  const memCtx = formatMemoryContext(visitorId);
  const summaryCtx = formatStepSummaries(stepSummaries);

  let strippedLibCtx = null;
  if (librarianContext) {
    strippedLibCtx = {
      summary: librarianContext.summary || null,
      responseHint: librarianContext.responseHint || null,
      confidence: librarianContext.confidence ?? null,
    };
  }

  const respondMode = await resolveModeForNode("respond", getCurrentNodeId(visitorId) || rootId);
  await switchMode(visitorId, respondMode, {
    username,
    userId,
    rootId,
    nodeContext: nodeContext || null,
    operationContext: operationContext || null,
    conversationMemory: memCtx || null,
    stepSummaries: !operationContext ? summaryCtx || null : null,
    responseHint: responseHint || null,
    confirmNeeded,
    librarianContext: strippedLibCtx,
    clearHistory: true,
  });

  let trigger;
  if (confirmNeeded) {
    trigger = "Present the pending operation and ask for confirmation.";
  } else if (librarianContext) {
    trigger = responseHint
      ? `Respond naturally based on what you know. Guidance: ${responseHint}`
      : "Respond naturally based on the context provided.";
  } else if (operationContext) {
    trigger = responseHint
      ? `Summarize what was done. Tone guidance: ${responseHint}`
      : "Summarize what was done.";
  } else {
    trigger = responseHint
      ? `Respond to the user. Guidance: ${responseHint}`
      : "Respond to the user based on the provided context.";
  }

  const response = await processMessage(visitorId, trigger, {
    username,
    userId,
    rootId,
    slot,
    signal,
    onToolResults(results) {
      if (signal?.aborted) return;
      for (const r of results) {
        socket?.emit?.(WS.TOOL_RESULT, r);
      }
    },
    onToolCalled(call) {
      if (signal?.aborted) return;
      socket?.emit?.(WS.TOOL_CALLED, call);
    },
    onThinking(thought) {
      if (signal?.aborted) return;
      socket?.emit?.(WS.THINKING, thought);
    },
  });

  emitStatus(socket, "done", "");

  if (originalMessage && response?.answer) {
    pushMemory(visitorId, originalMessage, response.answer);
  }

  return response;
}
