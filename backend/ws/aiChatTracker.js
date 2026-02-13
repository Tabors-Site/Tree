// ws/aiChatTracker.js
// Tracks AI chat sessions — wraps each chat turn with start/end + contributions
// Manages per-socket session IDs for grouping chats

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
// TWO-PHASE RECORDING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Phase 1: Create an AIChat record at the start of processing.
 * Captures accurate startTime for the contribution window.
 * Mode may be pre-orchestrator — will be patched on finalize for success.
 */
export async function startAIChat({
  userId,
  sessionId,
  message,
  source = "user",
  modeKey,
}) {
  const layers = modeKey ? modeKey.split(":") : ["home", "default"];

  const chat = await AIChat.create({
    userId,
    sessionId: sessionId || uuidv4(),
    startMessage: {
      content: message,
      source,
      time: new Date(),
    },
    aiContext: {
      path: modeKey || "home:default",
      layers,
    },
  });

  return chat;
}

/**
 * Phase 2: Finalize an AIChat — set endMessage, collect contributions,
 * and optionally patch the mode to the actual execution mode.
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
