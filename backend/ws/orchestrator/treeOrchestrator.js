// ws/orchestrator/treeOrchestrator.js
// Orchestrates tree requests: translator → navigate → getContext → execute → respond

import {
  switchMode,
  processMessage,
  getRootId,
  getCurrentNodeId,
} from "../conversation.js";
import { translate } from "./translator.js";

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
  const lines = mem.map((m) =>
    m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`,
  );
  return `\n\nRecent conversation:\n${lines.join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIRMATION CHECK
// ─────────────────────────────────────────────────────────────────────────

const CONFIRM_WORDS =
  /^(yes|yeah|yep|y|confirm|proceed|do it|go ahead|ok|sure|approved?)\s*[.!]?$/i;
const DENY_WORDS =
  /^(no|nah|nope|n|cancel|stop|don'?t|abort|never\s*mind)\s*[.!]?$/i;

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
    result:
      typeof result === "string" ? result : JSON.stringify(result, null, 2),
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
}) {
  if (signal?.aborted) return null;

  const rootId = getRootId(visitorId);
  const meta = { username, userId, rootId };

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
      plan: [
        {
          intent: "query",
          targetHint: null,
          directive: message,
          needsNavigation: false,
          isDestructive: false,
        },
      ],
      responseHint: "Respond naturally to the user's message.",
      summary: message,
    };
  }

  if (signal?.aborted) return null;

  // For now, execute plan[0] as primary operation. Multi-step plans come later.
  const primaryOp = translation.plan[0];
  const responseHint = translation.responseHint || "";

  // Map translator output to the intent shape the rest of the orchestrator expects
  const intent = {
    intent: primaryOp.intent,
    needsNavigation: primaryOp.needsNavigation,
    needsContext: !["navigate"].includes(primaryOp.intent), // everything except pure nav needs context
    isDestructive: primaryOp.isDestructive,
    targetHint: primaryOp.targetHint,
    directive: primaryOp.directive,
    summary: translation.summary,
  };

  console.log(
    `🎯 Translated: ${intent.intent} | nav=${intent.needsNavigation} | destructive=${intent.isDestructive} | "${intent.summary}"`,
  );
  emitModeResult(socket, "intent", {
    ...intent,
    responseHint,
    fullPlan: translation.plan,
  });

  // ────────────────────────────────────────────────────────
  // STEP 2: NAVIGATE (if needed)
  // ────────────────────────────────────────────────────────

  let targetNodeId = rootId;
  let targetPath = null;

  if (intent.needsNavigation) {
    emitStatus(socket, "navigate", "Finding node…");

    switchMode(visitorId, "tree:navigate", {
      ...meta,
      currentNodeId: getCurrentNodeId(visitorId) || rootId,
      clearHistory: true,
    });

    // Use the translator's directive for navigation (more precise than raw message)
    const navDirective = intent.directive || message;
    const memCtx = formatMemoryContext(visitorId);
    const navMessage = memCtx
      ? `${memCtx}\n\nCurrent request: ${navDirective}`
      : navDirective;

    const navResult = await processMessage(visitorId, navMessage, {
      ...meta,
      signal,
      meta: { internal: true },
    });

    if (signal?.aborted) return null;
    emitModeResult(socket, "tree:navigate", navResult);

    if (navResult?.action === "found") {
      targetNodeId = navResult.targetNodeId;
      targetPath = navResult.targetPath;

      // Navigate the iframe to the found node
      socket.emit("navigate", {
        url: `/api/v1/node/${targetNodeId}?html`,
        replace: false,
      });
    } else if (navResult?.action === "ambiguous") {
      // Let respond handle disambiguation
      return await runRespond({
        visitorId,
        socket,
        signal,
        ...meta,
        nodeContext: JSON.stringify(navResult, null, 2),
        operationContext:
          "Navigation found multiple matches. Need user to disambiguate.",
        originalMessage: message,
        responseHint:
          "Ask the user to clarify which node they mean. List the options clearly.",
      });
    } else if (navResult?.action === "not_found") {
      return await runRespond({
        visitorId,
        socket,
        signal,
        ...meta,
        nodeContext: null,
        operationContext: `Could not find a node matching the request. Target hint: "${intent.targetHint || message}"`,
        originalMessage: message,
        responseHint:
          "Let the user know the node wasn't found. Suggest alternatives if possible.",
      });
    }
  }

  // ── PURE NAVIGATION: skip context/execute/respond ──
  if (intent.intent === "navigate" && targetNodeId) {
    const navSummary = `Navigated to ${targetPath || targetNodeId}.`;
    emitStatus(socket, "done", "");
    pushMemory(visitorId, message, navSummary);
    return {
      success: true,
      answer: navSummary,
      modeKey: "tree:navigate",
      rootId,
    };
  }

  // ────────────────────────────────────────────────────────
  // STEP 3: GET CONTEXT (if needed)
  // ────────────────────────────────────────────────────────

  let nodeContext = null;

  if (intent.needsContext && targetNodeId) {
    emitStatus(socket, "context", "Reading node…");

    switchMode(visitorId, "tree:getContext", {
      ...meta,
      targetNodeId,
      clearHistory: true,
    });

    // Build the context request based on intent
    const contextRequest = buildContextRequest(intent, targetNodeId);

    const ctxResult = await processMessage(visitorId, contextRequest, {
      ...meta,
      signal,
      meta: { internal: true },
    });

    if (signal?.aborted) return null;
    nodeContext = JSON.stringify(ctxResult, null, 2);
    emitModeResult(socket, "tree:getContext", ctxResult);
  }

  // ────────────────────────────────────────────────────────
  // STEP 4: CONFIRM IF DESTRUCTIVE
  // ────────────────────────────────────────────────────────

  if (intent.isDestructive) {
    pendingOperations.set(visitorId, {
      action: intent.intent,
      targetNodeId,
      targetPath,
      nodeContext,
      originalMessage: message,
    });

    return await runRespond({
      visitorId,
      socket,
      signal,
      ...meta,
      nodeContext,
      operationContext: `Destructive operation requested: ${intent.summary}`,
      confirmNeeded: true,
      originalMessage: message,
      responseHint:
        "Clearly describe the destructive action and ask for explicit confirmation.",
    });
  }

  // ────────────────────────────────────────────────────────
  // STEP 5: EXECUTE MUTATION (if applicable)
  // ────────────────────────────────────────────────────────

  let operationContext = null;

  const mutationModes = {
    structure: "tree:structure",
    edit: "tree:edit",
    notes: "tree:notes",
  };

  const executionMode = mutationModes[intent.intent];

  if (executionMode) {
    emitStatus(socket, "execute", "Making changes…");

    // Extract prestige from nodeContext for notes mode
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

    // Build a directive execution message — use translator's directive for precision
    const executionMessage = buildExecutionMessage(
      intent,
      intent.directive || message,
      targetNodeId,
      nodeContext,
    );

    const execResult = await processMessage(visitorId, executionMessage, {
      ...meta,
      signal,
      meta: { internal: true },
    });

    if (signal?.aborted) return null;
    operationContext = JSON.stringify(execResult, null, 2);
    emitModeResult(socket, executionMode, execResult);

    // Notify frontend of tree changes
    if (intent.intent === "structure") {
      socket.emit("treeChanged", {
        nodeId: targetNodeId,
        changeType: execResult?.action || "modified",
      });
    }
  }

  // ────────────────────────────────────────────────────────
  // STEP 6: RESPOND
  // ────────────────────────────────────────────────────────

  return await runRespond({
    visitorId,
    socket,
    signal,
    ...meta,
    nodeContext,
    operationContext,
    originalMessage: message,
    responseHint,
  });
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
function buildContextRequest(intent, targetNodeId) {
  const base = `Get context for node ${targetNodeId}`;

  switch (intent.intent) {
    case "query":
    case "reflect":
      return `${base} with full scope: notes, values, children, siblings, and parent chain.`;

    case "structure":
      return `${base} with children and parent chain. I need to understand the topology.`;

    case "edit":
      return `${base} with values, goals, and current status. I need to see what fields exist.`;

    case "notes":
      return `${base} with notes for the current version. Include note IDs.`;

    case "navigate":
      return `${base} with children and parent.`;

    default:
      return `${base} with notes and children.`;
  }
}

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
