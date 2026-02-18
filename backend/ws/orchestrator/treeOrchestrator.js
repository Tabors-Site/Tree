// ws/orchestrator/treeOrchestrator.js
// Orchestrates tree requests: intent → navigate → getContext → execute → respond

import {
  switchMode,
  processMessage,
  getRootId,
  getClientForUser,
  getCurrentNodeId
} from "../conversation.js";

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
// INTENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────

const INTENT_SYSTEM_PROMPT = `
You are an intent classifier for a tree-based knowledge system.
Given a user message, classify what operation is needed.

Return ONLY this JSON. No markdown. No explanation.

{
  "intent": "navigate" | "query" | "structure" | "edit" | "notes" | "reflect",
  "needsNavigation": boolean,
  "needsContext": boolean,
  "isDestructive": boolean,
  "targetHint": string | null,
  "summary": string
}

DEFINITIONS:
- "navigate": user wants to go to or find a node
- "query": user wants to know something about the tree/node (read-only)
- "structure": user wants to create, move, or delete nodes
- "edit": user wants to change node fields (name, values, goals, status, schedule, prestige)
- "notes": user wants to read, create, edit, or delete notes
- "reflect": user wants to analyze, discuss patterns, or plan

RULES:
- needsNavigation = true if the user references a node by name/description
  and we need to find it. false if operating on "current node" or root.
- needsContext = true for almost everything except pure navigation requests
- isDestructive = true for: delete, status changes with cascade, bulk edits
- targetHint = extracted node name/keyword if mentioned, null otherwise
- summary = one-line description of what the user wants
`.trim();

/**
 * Classify user intent using a direct lightweight LLM call.
 * Includes conversation memory so follow-ups like "add a note to it" resolve correctly.
 */
async function classifyIntent({ message, visitorId, userId, signal }) {
  const { client: openai, model } = await getClientForUser(userId);

  const memoryContext = formatMemoryContext(visitorId);
  const userContent = memoryContext
    ? `${memoryContext}\n\nCurrent request: ${message}`
    : message;

  const response = await openai.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    },
    signal ? { signal } : {},
  );

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty intent response");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Intent parse failed: ${raw}`);
  }
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
  // STEP 1: CLASSIFY INTENT
  // ────────────────────────────────────────────────────────

  emitStatus(socket, "intent", "Understanding request…");

  let intent;
  try {
    intent = await classifyIntent({
      visitorId,
      message,
      ...meta,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return null;
    console.error("❌ Intent classification failed:", err.message);
    // Fallback: treat as a query
    intent = {
      intent: "query",
      needsNavigation: false,
      needsContext: true,
      isDestructive: false,
      targetHint: null,
      summary: message,
    };
  }

  if (signal?.aborted) return null;
  console.log(`🎯 Intent: ${intent.intent} | nav=${intent.needsNavigation} | ctx=${intent.needsContext} | destructive=${intent.isDestructive}`);
  emitModeResult(socket, "intent", intent);

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

    const memCtx = formatMemoryContext(visitorId);
    const navMessage = memCtx
      ? `${memCtx}\n\nCurrent request: ${message}`
      : message;

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
        operationContext: "Navigation found multiple matches. Need user to disambiguate.",
        originalMessage: message,
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

    // Build a directive execution message — tell the mode WHAT to do, not just context
    const executionMessage = buildExecutionMessage(intent, message, targetNodeId, nodeContext);

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
    confirmNeeded,
    clearHistory: true,
  });

  // For respond, we don't send the original user message — the context is
  // already in the system prompt. We send a minimal trigger.
  const trigger = confirmNeeded
    ? "Present the pending operation and ask for confirmation."
    : operationContext
      ? "Summarize what was done."
      : "Respond to the user based on the provided context.";

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