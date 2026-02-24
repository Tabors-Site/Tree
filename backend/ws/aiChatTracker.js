// ws/aiChatTracker.js
// Tracks AI chat sessions — each LLM call = one AIChat document
// All calls in a chain share the same sessionId and are ordered by chainIndex
// Query: AIChat.find({ sessionId }).sort({ chainIndex: 1 }) → full chain

import { v4 as uuidv4 } from "uuid";
import AIChat from "../db/models/aiChat.js";
import Contribution from "../db/models/contribution.js";

// ─────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────

const SESSION_TTL = 15 * 60 * 1000; // 15 minutes idle → new session

/**
 * Initialize or retrieve the AI session on a socket.
 * Call before each chat. Rotates if expired.
 * Returns the current sessionId.
 */
export function ensureSession(socket) {
  const now = Date.now();

  if (
    !socket._aiSession ||
    now - socket._aiSession.lastActivity > SESSION_TTL
  ) {
    socket._aiSession = { id: uuidv4(), lastActivity: now };
    console.log(
      `🆕 New AI session for ${socket.visitorId || socket.userId}: ${socket._aiSession.id}`,
    );
  } else {
    socket._aiSession.lastActivity = now;
  }

  return socket._aiSession.id;
}

/**
 * Force-rotate to a new session (e.g. returning to home).
 * Returns the new sessionId.
 */
export function rotateSession(socket) {
  socket._aiSession = { id: uuidv4(), lastActivity: Date.now() };
  console.log(
    `🔄 Rotated AI session for ${socket.visitorId || socket.userId}: ${socket._aiSession.id}`,
  );
  return socket._aiSession.id;
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
}) {
  const layers = modeKey ? modeKey.split(":") : ["home", "default"];

  const chat = await AIChat.create({
    userId,
    sessionId: sessionId || uuidv4(),
    chainIndex: 0,
    startMessage: {
      content: message,
      source,
      time: new Date(),
    },
    aiContext: {
      path: modeKey || "home:default",
      layers,
    },
    llmProvider: llmProvider || { isCustom: false, model: null, baseUrl: null },
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

  // Collect AI contributions in the time window
  const contributions = await Contribution.find({
    userId: chat.userId,
    wasAi: true,
    date: {
      $gte: chat.startMessage.time,
      $lte: endTime,
    },
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

  // Fire and forget — don't await, don't block the chain
  AIChat.create({
    userId,
    sessionId,
    chainIndex,
    startMessage: {
      content:
        typeof input === "string"
          ? input
          : JSON.stringify(input).slice(0, 2000),
      source,
      time: start,
    },
    endMessage: {
      content: output
        ? typeof output === "string"
          ? output
          : JSON.stringify(output).slice(0, 2000)
        : null,
      time: end,
      stopped: false,
    },
    aiContext: {
      path: modeKey,
      layers,
    },
    llmProvider: llmProvider || { isCustom: false, model: null, baseUrl: null },
    ...(treeContext ? { treeContext } : {}),
  }).catch((err) => {
    console.error(`⚠️ Failed to track chain step [${modeKey}]:`, err.message);
  });
}
