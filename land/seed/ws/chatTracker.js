// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
// ws/chatTracker.js
// Tracks AI chat sessions — each LLM call = one Chat document
// All calls in a chain share the same sessionId and are ordered by chainIndex
// Query: Chat.find({ sessionId }).sort({ chainIndex: 1 }) → full chain

import { v4 as uuidv4 } from "uuid";
import Chat from "../models/chat.js";
import Contribution from "../models/contribution.js";
import { createSession, SESSION_TYPES } from "./sessionRegistry.js";

// ─────────────────────────────────────────────────────────────────────────
// CHAT CONTRIBUTION CONTEXT (in-memory userId → { sessionId, chatId })
// Used by handleMcpRequest to inject into tool args so contributions
// are tagged with the correct chat, not linked by time window.
// ─────────────────────────────────────────────────────────────────────────

const activeAiContext = new Map();

export function setChatContext(visitorId, sessionId, chatId) {
  activeAiContext.set(String(visitorId), { sessionId, chatId: chatId ? String(chatId) : null });
}

export function getChatContext(visitorId) {
  return activeAiContext.get(String(visitorId)) || { sessionId: null, chatId: null };
}

export function clearChatContext(visitorId) {
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
    log.debug("AI", 
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

  log.debug("AI", 
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
  socket._activeChat = { chatId, startTime };
}

/**
 * Clear the active chat marker.
 */
export function clearActiveChat(socket) {
  socket._activeChat = null;
}

/**
 * If there's an un-finalized chat on this socket, finalize it as stopped.
 * Safe to call anytime — no-ops if nothing is active.
 */
export async function finalizeOpenChat(socket) {
  const active = socket._activeChat;
  if (!active) return;

  socket._activeChat = null;

  try {
    await finalizeChat({
      chatId: active.chatId,
      content: null,
      stopped: true,
    });
    log.debug("AI",
      `⏹ Finalized orphaned chat ${active.chatId} for ${socket.visitorId}`,
    );
  } catch (err) {
    log.warn("AI", `Failed to finalize orphaned chat:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TWO-PHASE RECORDING (for user-facing chats)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Phase 1: Create a Chat record at the start of processing.
 * This is the user's original message — chainIndex 0.
 */
export async function startChat({
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
  const chat = await Chat.create({
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
 * Phase 2: Finalize a Chat — set endMessage, collect contributions.
 */
export async function finalizeChat({
  chatId,
  content,
  stopped = false,
  modeKey,
}) {
  const endTime = new Date();

  const chat = await Chat.findById(chatId).lean();
  if (!chat) return null;

  // Already finalized — don't double-write
  if (chat.endMessage?.time) return chat;

  // Collect AI contributions linked to this chat by chatId
  const contributions = await Contribution.find({
    chatId: chatId,
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

  const updated = await Chat.findByIdAndUpdate(
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
 * Record an orchestrator chain step as its own Chat document.
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
  Chat.create({
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
    log.warn("AI", `Failed to track chain step [${modeKey}]:`, err.message);
  });
}
