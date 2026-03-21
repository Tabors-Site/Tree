// ws/aiChatTracker.js
// Tracks AI chat sessions — each LLM call = one AIChat document
// All calls in a chain share the same sessionId and are ordered by chainIndex
// Query: AIChat.find({ sessionId }).sort({ chainIndex: 1 }) → full chain

import { v4 as uuidv4 } from "uuid";
import AIChat from "../db/models/aiChat.js";
import Contribution from "../db/models/contribution.js";
import { createSession, SESSION_TYPES } from "./sessionRegistry.js";

// ─────────────────────────────────────────────────────────────────────────
// AI CONTRIBUTION CONTEXT (in-memory userId → { sessionId, aiChatId })
// Used by handleMcpRequest to inject into tool args so contributions
// are tagged with the correct AI chat, not linked by time window.
// ─────────────────────────────────────────────────────────────────────────

const activeAiContext = new Map();

export function setAiContributionContext(visitorId, sessionId, aiChatId) {
  activeAiContext.set(String(visitorId), { sessionId, aiChatId: aiChatId ? String(aiChatId) : null });
}

export function getAiContributionContext(visitorId) {
  return activeAiContext.get(String(visitorId)) || { sessionId: null, aiChatId: null };
}

export function clearAiContributionContext(visitorId) {
  activeAiContext.delete(String(visitorId));
}

// ─────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Initialize or retrieve the AI session on a socket.
 * Call before each chat. Reuses via scoped session if still within idle TTL.
 * Returns the current sessionId.
 */
export function ensureSession(socket) {
  const scopeKey = `ws:${socket.userId}`;
  const { sessionId, reused } = createSession({
    userId: socket.userId,
    type: SESSION_TYPES.WEBSOCKET_CHAT,
    scopeKey,
    description: `Chat session for ${socket.username || "unknown"}`,
    meta: { visitorId: socket.visitorId },
  });

  if (!reused) {
    console.log(
      `🆕 New AI session for ${socket.visitorId || socket.userId}: ${sessionId}`,
    );
  }

  socket._aiSession = { id: sessionId, lastActivity: Date.now() };
  return sessionId;
}

/**
 * Force-rotate to a new session (e.g. returning to home).
 * Returns the new sessionId.
 */
export function rotateSession(socket) {
  const { sessionId } = createSession({
    userId: socket.userId,
    type: SESSION_TYPES.WEBSOCKET_CHAT,
    scopeKey: `ws:${socket.userId}`,
    idleTTL: 0, // force new session by treating any existing as expired
    description: `Chat session for ${socket.username || "unknown"}`,
    meta: { visitorId: socket.visitorId },
  });

  console.log(
    `🔄 Rotated AI session for ${socket.visitorId || socket.userId}: ${sessionId}`,
  );

  socket._aiSession = { id: sessionId, lastActivity: Date.now() };
  return sessionId;
}

/**
 * Get current sessionId without touching lastActivity.
 */
export function getSessionId(socket) {
  return socket._aiSession?.id || null;
}

// ─────────────────────────────────────────────────────────────────────────
// ACTIVE CHAT TRACKING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Mark an in-flight chat on the socket so mode switches can finalize it.
 */
export function setActiveChat(socket, chatId, startTime) {
  socket._activeAIChat = { chatId, startTime };
}

/**
 * Clear the active chat marker.
 */
export function clearActiveChat(socket) {
  socket._activeAIChat = null;
}

/**
 * If there's an un-finalized chat on this socket, finalize it as stopped.
 * Safe to call anytime — no-ops if nothing is active.
 */
export async function finalizeOpenChat(socket) {
  const active = socket._activeAIChat;
  if (!active) return;

  socket._activeAIChat = null;

  try {
    await finalizeAIChat({
      chatId: active.chatId,
      content: null,
      stopped: true,
    });
    console.log(
      `⏹ Finalized orphaned AIChat ${active.chatId} for ${socket.visitorId}`,
    );
  } catch (err) {
    console.error(`⚠️ Failed to finalize orphaned AIChat:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TWO-PHASE RECORDING (for user-facing chats)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Phase 1: Create an AIChat record at the start of processing.
 * This is the user's original message — chainIndex 0.
 */
export async function startAIChat({
  userId,
  sessionId,
  message,
  source = "user",
  modeKey,
  llmProvider,
  treeContext,
}) {
  const layers = modeKey ? modeKey.split(":") : ["home", "default"];

  const chatId = uuidv4();
  const chat = await AIChat.create({
    _id: chatId,
    userId,
    sessionId: sessionId || uuidv4(),
    chainIndex: 0,
    rootChatId: chatId,
    startMessage: {
      content: message,
      source,
      time: new Date(),
    },
    aiContext: {
      path: modeKey || "home:default",
      layers,
    },
    llmProvider: llmProvider || { isCustom: false, model: null, connectionId: null },
    ...(treeContext ? { treeContext } : {}),
  });

  return chat;
}

/**
 * Phase 2: Finalize an AIChat — set endMessage, collect contributions.
 */
export async function finalizeAIChat({
  chatId,
  content,
  stopped = false,
  modeKey,
}) {
  const endTime = new Date();

  const chat = await AIChat.findById(chatId).lean();
  if (!chat) return null;

  // Already finalized — don't double-write
  if (chat.endMessage?.time) return chat;

  // Collect AI contributions linked to this chat by aiChatId
  const contributions = await Contribution.find({
    aiChatId: chatId,
  })
    .select("_id")
    .lean();

  const contributionIds = contributions.map((c) => c._id);

  const $set = {
    "endMessage.content": content || null,
    "endMessage.time": endTime,
    "endMessage.stopped": stopped,
  };

  // Patch mode only on success — stopped chats keep their start mode
  if (modeKey && !stopped) {
    $set["aiContext.path"] = modeKey;
    $set["aiContext.layers"] = modeKey.split(":");
  }

  const updated = await AIChat.findByIdAndUpdate(
    chatId,
    {
      $set,
      $addToSet: { contributions: { $each: contributionIds } },
    },
    { new: true },
  );

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────
// CHAIN STEP TRACKING (orchestrator internal calls)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Record an orchestrator chain step as its own AIChat document.
 * All steps in a chain share the same sessionId.
 *
 * This is fire-and-forget — never blocks the orchestrator.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.sessionId    - same sessionId as the user's chat
 * @param {number} opts.chainIndex   - position in chain (1, 2, 3...)
 * @param {string} opts.modeKey      - "translator", "tree:navigate", "tree:edit", etc.
 * @param {string} opts.source       - "orchestrator" | "script"
 * @param {string} opts.input        - what was sent to this step
 * @param {string} [opts.output]     - what came back (null if tracking start only)
 * @param {Date}   [opts.startTime]  - when the step started
 * @param {Date}   [opts.endTime]    - when the step finished (null if no output)
 * @param {object} [opts.llmProvider]
 */
export function trackChainStep({
  userId,
  sessionId,
  chainIndex,
  rootChatId = null,
  modeKey,
  source = "orchestrator",
  input,
  output = null,
  startTime = null,
  endTime = null,
  llmProvider = null,
  treeContext, // ← NEW
}) {
  if (!sessionId || !userId) return;

  const layers = modeKey ? modeKey.split(":") : ["orchestrator"];
  const start = startTime || new Date();
  const end = output ? endTime || new Date() : null;

  // Strip internal tracking fields from output before persisting
  let outputStr = null;
  if (output) {
    if (typeof output === "string") {
      outputStr = output;
    } else {
      const { _llmProvider, _raw, ...clean } = output;
      outputStr = JSON.stringify(clean).slice(0, 2000);
    }
  }

  // Fire and forget — don't await, don't block the chain
  AIChat.create({
    userId,
    sessionId,
    chainIndex,
    rootChatId,
    startMessage: {
      content:
        typeof input === "string"
          ? input
          : JSON.stringify(input).slice(0, 2000),
      source,
      time: start,
    },
    endMessage: {
      content: outputStr,
      time: end,
      stopped: false,
    },
    aiContext: {
      path: modeKey,
      layers,
    },
    llmProvider: llmProvider || { isCustom: false, model: null, connectionId: null },
    ...(treeContext ? { treeContext } : {}),
  }).catch((err) => {
    console.error(`⚠️ Failed to track chain step [${modeKey}]:`, err.message);
  });
}
