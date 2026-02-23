// ws/orchestrator/treeOrchestrator.js
// Orchestrates tree requests: translator → navigate → getContext → execute → respond

import {
  switchMode,
  processMessage,
  getRootId,
  getCurrentNodeId,
} from "../conversation.js";
import { translate } from "./translator.js";
import { trackChainStep } from "../aiChatTracker.js";

import { getContextForAi } from "../../core/treeFetch.js";
// ─────────────────────────────────────────────────────────────────────────
// PENDING OPERATIONS (confirmation flow)
// ─────────────────────────────────────────────────────────────────────────

// visitorId → { action, targetNodeId, targetPath, nodeContext, originalMessage }
const pendingOperations = new Map();

// ─────────────────────────────────────────────────────────────────────────
// CONVERSATION MEMORY (survives mode switches)
// ─────────────────────────────────────────────────────────────────────────

// visitorId → [{ role: "user"|"assistant", content }]
const orchestratorMemory = new Map();
const MAX_MEMORY_TURNS = 6; // 3 exchanges (user + assistant each)

function getMemory(visitorId) {
  return orchestratorMemory.get(visitorId) || [];
}

function pushMemory(visitorId, userMessage, assistantResponse) {
  const mem = getMemory(visitorId);
  mem.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantResponse },
  );
  // Keep only the last N turns
  while (mem.length > MAX_MEMORY_TURNS) mem.shift();
  orchestratorMemory.set(visitorId, mem);
}

function clearMemory(visitorId) {
  orchestratorMemory.delete(visitorId);
}

export { clearMemory };

/**
 * Format memory as context string for injection into mode messages.
 */
function formatMemoryContext(visitorId) {
  const mem = getMemory(visitorId);
  if (mem.length === 0) return "";
  const lines = mem.map(m =>
    m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`
  );
  return `\n\nRecent conversation:\n${lines.join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIRMATION CHECK
// ─────────────────────────────────────────────────────────────────────────

const CONFIRM_WORDS = /^(yes|yeah|yep|y|confirm|proceed|do it|go ahead|ok|sure|approved?)\s*[.!]?$/i;
const DENY_WORDS = /^(no|nah|nope|n|cancel|stop|don'?t|abort|never\s*mind)\s*[.!]?$/i;

function isConfirmation(message) {
  return CONFIRM_WORDS.test(message.trim());
}

function isDenial(message) {
  return DENY_WORDS.test(message.trim());
}

// ─────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit a status event to the frontend.
 */
function emitStatus(socket, phase, text) {
  socket.emit("executionStatus", { phase, text });
}

/**
 * Emit an internal mode result to the chat so the user can see what's happening.
 */
function emitModeResult(socket, modeKey, result) {
  socket.emit("orchestratorStep", {
    modeKey,
    result: typeof result === "string" ? result : JSON.stringify(result, null, 2),
    timestamp: Date.now(),
  });
}

export async function orchestrateTreeRequest({
  visitorId,
  message,
  socket,
  username,
  userId,
  signal,
  sessionId,
}) {
  if (signal?.aborted) return null;

  const rootId = getRootId(visitorId);
  const meta = { username, userId, rootId };
  const modesUsed = []; // Track full chain for AIChat
  let chainIndex = 1; // 0 = user message (created in websocket.js)

  // ────────────────────────────────────────────────────────
  // CHECK FOR PENDING CONFIRMATION
  // ────────────────────────────────────────────────────────

  const pending = pendingOperations.get(visitorId);
  if (pending) {
    pendingOperations.delete(visitorId);

    if (isConfirmation(message)) {
      // User confirmed — execute the pending operation
      return await executePendingOperation({
        visitorId,
        pending,
        socket,
        signal,
        ...meta,
      });
    } else if (isDenial(message)) {
      // User cancelled — respond accordingly
      return await runRespond({
        visitorId,
        socket,
        signal,
        ...meta,
        operationContext: "User cancelled the operation.",
        nodeContext: pending.nodeContext,
        originalMessage: message,
      });
    }
    // If neither confirm nor deny, treat as a new request (fall through)
  }

  // ────────────────────────────────────────────────────────
  // STEP 1: TRANSLATE (natural language → tree operations)
  // ────────────────────────────────────────────────────────

  emitStatus(socket, "intent", "Understanding request…");

  let translation;
  const translatorStart = new Date();
  try {
    translation = await translate({
      message,
      userId,
      conversationMemory: formatMemoryContext(visitorId),
      treeSummary: null, // TODO: light tree summary for better context
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return null;
    console.error("❌ Translation failed:", err.message);
    translation = {
      plan: [{
        intent: "query",
        targetHint: null,
        directive: message,
        needsNavigation: false,
        isDestructive: false,
      }],
      responseHint: "Respond naturally to the user's message.",
      summary: message,
    };
  }
  const translatorEnd = new Date();

  if (signal?.aborted) return null;

  const responseHint = translation.responseHint || "";
  const plan = translation.plan;

  console.log(`🎯 Translated: ${plan.length} step(s) | "${translation.summary}"`);
  emitModeResult(socket, "intent", { plan, responseHint, summary: translation.summary });

  // Track translation step
  modesUsed.push("translator");
  trackChainStep({
    userId, sessionId, chainIndex: chainIndex++,
    modeKey: "translator",
    input: message,
    output: translation,
    startTime: translatorStart,
    endTime: translatorEnd,
  });

  // ────────────────────────────────────────────────────────
  // STEP 2: EXECUTE PLAN (navigate → context → execute per step)
  // ────────────────────────────────────────────────────────

  const stepResults = [];
  let lastTargetNodeId = rootId;
  let lastTargetPath = null;
  let lastNodeContext = null;

  for (let i = 0; i < plan.length; i++) {
  if (signal?.aborted) {
  // Memory still gets the partial work
  if (stepResults.length > 0) {
    pushMemory(visitorId, message,
      `[Stopped mid-plan. Completed ${stepResults.length}/${plan.length} steps: ${JSON.stringify(stepResults)}]`
    );
  }
  return null;
}

    const op = plan[i];
    const stepNum = i + 1;
    const isOnlyStep = plan.length === 1;

    // Emit plan step marker so frontend can group chain steps
    trackChainStep({
      userId, sessionId, chainIndex: chainIndex++,
      modeKey: `tree:orchestrator:plan:${stepNum}`,
      input: `Step ${stepNum}/${plan.length}: ${op.intent}${op.targetHint ? ` → ${op.targetHint}` : ""}\n${op.directive}`,
    });

    // Map plan op to intent shape used by helpers
    const intent = {
      intent: op.intent,
      needsNavigation: op.needsNavigation,
      needsContext: !["navigate"].includes(op.intent),
      isDestructive: op.isDestructive,
      targetHint: op.targetHint,
      directive: op.directive,
      summary: op.directive,
    };

    console.log(`  📋 Step ${stepNum}/${plan.length}: ${intent.intent} → ${intent.targetHint || "(current)"}`);

    // ── NAVIGATE (if this step needs it) ──
    let targetNodeId = lastTargetNodeId;
    let targetPath = lastTargetPath;

    if (intent.needsNavigation) {
      emitStatus(socket, "navigate", `Step ${stepNum}: Finding node…`);

      switchMode(visitorId, "tree:navigate", {
        ...meta,
        currentNodeId: getCurrentNodeId(visitorId) || rootId,
        clearHistory: true,
      });

      const navDirective = intent.directive || message;
      const memCtx = i === 0 ? formatMemoryContext(visitorId) : null;
      const navMessage = memCtx
        ? `${memCtx}\n\nCurrent request: ${navDirective}`
        : navDirective;

      const navStart = new Date();
      const navResult = await processMessage(visitorId, navMessage, {
        ...meta,
        signal,
        meta: { internal: true },
      });
      const navEnd = new Date();

      if (signal?.aborted) return null;
      emitModeResult(socket, "tree:navigate", navResult);

      // Track navigate step
      modesUsed.push("tree:navigate");
      trackChainStep({
        userId, sessionId, chainIndex: chainIndex++,
        modeKey: "tree:navigate",
        input: navDirective,
        output: navResult,
        startTime: navStart,
        endTime: navEnd,
      });

      if (navResult?.action === "found") {
        targetNodeId = navResult.targetNodeId;
        targetPath = navResult.targetPath;

        socket.emit("navigate", {
          url: `/api/v1/node/${targetNodeId}?html`,
          replace: false,
        });
      } else if (navResult?.action === "ambiguous") {
        return await runRespond({
          visitorId, socket, signal, ...meta,
          nodeContext: JSON.stringify(navResult, null, 2),
          operationContext: stepResults.length > 0
            ? `Completed ${stepResults.length} step(s) before hitting ambiguity:\n${JSON.stringify(stepResults, null, 2)}`
            : "Navigation found multiple matches. Need user to disambiguate.",
          originalMessage: message,
          responseHint: "Ask the user to clarify which node they mean. List the options clearly.",
        });
      } else if (navResult?.action === "not_found") {
        // If step 1 can't find the target, bail. If later step, skip it.
        if (i === 0) {
          return await runRespond({
            visitorId, socket, signal, ...meta,
            nodeContext: null,
            operationContext: `Could not find a node matching: "${intent.targetHint || message}"`,
            originalMessage: message,
            responseHint: "Let the user know the node wasn't found. Suggest alternatives if possible.",
          });
        } else {
          stepResults.push({ step: stepNum, intent: intent.intent, skipped: true, reason: "Node not found" });
          continue;
        }
      }
    }

    // ── PURE NAVIGATION: if navigate is the only step, return early ──
    if (intent.intent === "navigate" && targetNodeId) {
      if (isOnlyStep) {
        const navSummary = `Navigated to ${targetPath || targetNodeId}.`;
        emitStatus(socket, "done", "");
        pushMemory(visitorId, message, navSummary);
        return {
          success: true,
          answer: navSummary,
          modeKey: "tree:navigate",
          rootId,
          modesUsed,
        };
      }
      // Navigate step in a multi-step plan — just update position
      lastTargetNodeId = targetNodeId;
      lastTargetPath = targetPath;
      stepResults.push({ step: stepNum, intent: "navigate", targetPath });
      continue;
    }

    // ── GET CONTEXT (if needed) ──
    let nodeContext = lastNodeContext;

// Replace the whole getContext block in the plan loop with:
if (intent.needsContext && targetNodeId) {
  emitStatus(socket, "context", isOnlyStep ? "Reading node…" : `Step ${stepNum}: Reading node…`);
  const ctxStart = new Date();  // ← this was missing

  const contextProfiles = {
    structure: { includeChildren: true, includeParentChain: true, includeValues: false, includeNotes: false },
    edit:      { includeChildren: true, includeParentChain: true, includeValues: true, includeNotes: false },
    notes:     { includeChildren: false, includeParentChain: false, includeValues: false, includeNotes: true },
    query:     { includeChildren: true, includeParentChain: true, includeValues: true, includeNotes: true },
  };

  const profile = contextProfiles[intent.intent] || contextProfiles.query;
  const ctxResult = await getContextForAi(targetNodeId, profile);

  nodeContext = JSON.stringify(ctxResult, null, 2);
  emitModeResult(socket, "tree:getContext", ctxResult);

  const ctxEnd = new Date();
  trackChainStep({
    userId, sessionId, chainIndex: chainIndex++,
    modeKey: "tree:getContext",
    input: `getContextForAi(${targetNodeId}, ${intent.intent})`,
    output: ctxResult,
    startTime: ctxStart,
    endTime: ctxEnd,
  });
}

    // ── CONFIRM IF DESTRUCTIVE (aborts plan for confirmation) ──
    if (intent.isDestructive) {
      pendingOperations.set(visitorId, {
        action: intent.intent,
        targetNodeId,
        targetPath,
        nodeContext,
        originalMessage: message,
      });

      return await runRespond({
        visitorId, socket, signal, ...meta,
        nodeContext,
        operationContext: stepResults.length > 0
          ? `Completed ${stepResults.length} step(s), then hit destructive operation:\n${JSON.stringify(stepResults, null, 2)}\n\nPending: ${intent.directive}`
          : `Destructive operation requested: ${intent.directive}`,
        confirmNeeded: true,
        originalMessage: message,
        responseHint: "Clearly describe the destructive action and ask for explicit confirmation.",
      });
    }

    // ── EXECUTE MUTATION ──
    const mutationModes = {
      structure: "tree:structure",
      edit: "tree:edit",
      notes: "tree:notes",
    };

    const executionMode = mutationModes[intent.intent];

    if (executionMode) {
      emitStatus(socket, "execute", isOnlyStep ? "Making changes…" : `Step ${stepNum}: Making changes…`);

      let prestige = 0;
      if (nodeContext) {
        try {
          const parsed = JSON.parse(nodeContext);
          prestige = parsed.prestige ?? 0;
        } catch {}
      }

      switchMode(visitorId, executionMode, {
        ...meta,
        targetNodeId,
        prestige,
        clearHistory: true,
      });

      const executionMessage = buildExecutionMessage(intent, intent.directive || message, targetNodeId, nodeContext);

      const execStart = new Date();
      const execResult = await processMessage(visitorId, executionMessage, {
        ...meta,
        signal,
        meta: { internal: true },
      });
      const execEnd = new Date();

      if (signal?.aborted) return null;
      emitModeResult(socket, executionMode, execResult);

      // Track execute step
      modesUsed.push(executionMode);
      trackChainStep({
        userId, sessionId, chainIndex: chainIndex++,
        modeKey: executionMode,
        input: intent.directive,
        output: execResult,
        startTime: execStart,
        endTime: execEnd,
      });

      stepResults.push({ step: stepNum, intent: intent.intent, result: execResult });

      // Notify frontend of tree changes
      if (intent.intent === "structure") {
        socket.emit("treeChanged", {
          nodeId: targetNodeId,
          changeType: execResult?.action || "modified",
        });
        // If structure created new nodes, the next step might target them
        // Update lastTargetNodeId so subsequent navigate can find children
      }
    } else {
      // query, reflect — non-mutation, just collect context
      stepResults.push({ step: stepNum, intent: intent.intent, context: nodeContext });
    }

    // Carry forward for next step
    lastTargetNodeId = targetNodeId;
    lastTargetPath = targetPath;
    lastNodeContext = nodeContext;
  }

  // ────────────────────────────────────────────────────────
  // STEP 3: RESPOND (with all collected results)
  // ────────────────────────────────────────────────────────

  const operationContext = stepResults.length > 0
    ? JSON.stringify(stepResults, null, 2)
    : null;

  modesUsed.push("tree:respond");
  const respondStart = new Date();

  const response = await runRespond({
    visitorId,
    socket,
    signal,
    ...meta,
    nodeContext: lastNodeContext,
    operationContext,
    originalMessage: message,
    responseHint,
  });

  const respondEnd = new Date();

  trackChainStep({
    userId, sessionId, chainIndex: chainIndex++,
    modeKey: "tree:respond",
    input: responseHint || "Respond to the user",
    output: response?.answer || null,
    startTime: respondStart,
    endTime: respondEnd,
  });

  if (response) {
    response.modesUsed = modesUsed;
  }
  return response;
}

// ─────────────────────────────────────────────────────────────────────────
// EXECUTE PENDING (after confirmation)
// ─────────────────────────────────────────────────────────────────────────

async function executePendingOperation({
  visitorId,
  pending,
  socket,
  signal,
  username,
  userId,
  rootId,
}) {
  const meta = { username, userId, rootId };

  emitStatus(socket, "execute", "Executing confirmed operation…");

  const mutationModes = {
    structure: "tree:structure",
    edit: "tree:edit",
    notes: "tree:notes",
  };

  const executionMode = mutationModes[pending.action];
  if (!executionMode) {
    return await runRespond({
      visitorId,
      socket,
      signal,
      ...meta,
      nodeContext: pending.nodeContext,
      operationContext: "Error: Unknown operation type for confirmation.",
      originalMessage: pending.originalMessage,
    });
  }

  // Extract prestige from context
  let prestige = 0;
  if (pending.nodeContext) {
    try {
      const parsed = JSON.parse(pending.nodeContext);
      prestige = parsed.prestige ?? 0;
    } catch {}
  }

  switchMode(visitorId, executionMode, {
    ...meta,
    targetNodeId: pending.targetNodeId,
    prestige,
    clearHistory: true,
  });

  const executionMessage = buildExecutionMessage(
    { intent: pending.action },
    pending.originalMessage,
    pending.targetNodeId,
    pending.nodeContext,
  );

  const execResult = await processMessage(visitorId, executionMessage, {
    ...meta,
    signal,
    meta: { internal: true },
  });

  if (signal?.aborted) return null;

  const operationContext = JSON.stringify(execResult, null, 2);
  emitModeResult(socket, executionMode, execResult);

  if (pending.action === "structure") {
    socket.emit("treeChanged", {
      nodeId: pending.targetNodeId,
      changeType: execResult?.action || "modified",
    });
  }

  return await runRespond({
    visitorId,
    socket,
    signal,
    ...meta,
    nodeContext: pending.nodeContext,
    operationContext,
    originalMessage: pending.originalMessage,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// RESPOND (final user-facing output)
// ─────────────────────────────────────────────────────────────────────────

async function runRespond({
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
}) {
  emitStatus(socket, "respond", "");

  // Include conversation memory so respond can reference prior exchanges
  const memCtx = formatMemoryContext(visitorId);

  switchMode(visitorId, "tree:respond", {
    username,
    userId,
    rootId,
    nodeContext: nodeContext || null,
    operationContext: operationContext || null,
    conversationMemory: memCtx || null,
    responseHint: responseHint || null,
    confirmNeeded,
    clearHistory: true,
  });

  // Build trigger with responseHint for tone/content guidance
  let trigger;
  if (confirmNeeded) {
    trigger = "Present the pending operation and ask for confirmation.";
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
    signal,
    onToolResults(results) {
      if (signal?.aborted) return;
      for (const r of results) {
        socket.emit("toolResult", r);
      }
    },
  });

  emitStatus(socket, "done", "");

  // Save this exchange to memory for future turns
  if (originalMessage && response?.answer) {
    pushMemory(visitorId, originalMessage, response.answer);
  }

  return response;
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a context request message based on intent type.
 * Tells getContext mode what scope to use.
 */


/**
 * Build a directive execution message for mutation modes.
 * Instead of just "here's context + user request", this tells the mode
 * exactly what action to perform with the necessary IDs.
 */
function buildExecutionMessage(intent, userMessage, targetNodeId, nodeContext) {
  const contextBlock = nodeContext
    ? `Current node state:\n${nodeContext}\n\n`
    : "";

  switch (intent.intent) {
    case "notes":
      return (
        `${contextBlock}` +
        `EXECUTE: Perform the following note operation on node ${targetNodeId}.\n` +
        `User request: ${userMessage}\n\n` +
        `If the user wants to CREATE a note, call create-node-version-note immediately.\n` +
        `If the user wants to EDIT a note, call edit-node-note with the correct noteId.\n` +
        `If the user wants to DELETE a note, call delete-node-note.\n` +
        `Do NOT just read notes — the context above already has them. ACT on the request.`
      );

    case "structure":
      return (
        `${contextBlock}` +
        `EXECUTE: Perform the following structure change on node ${targetNodeId}.\n` +
        `User request: ${userMessage}\n\n` +
        `Act immediately. Do not read the tree — context is provided above.`
      );

    case "edit":
      return (
        `${contextBlock}` +
        `EXECUTE: Perform the following edit on node ${targetNodeId}.\n` +
        `User request: ${userMessage}\n\n` +
        `Act immediately using the appropriate edit tool. Context is provided above.`
      );

    default:
      return `${contextBlock}User request: ${userMessage}`;
  }
} 