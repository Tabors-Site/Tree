// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
import { getLandConfigValue } from "../landConfig.js";
// llm/chatTracker.js
// Tracks AI chat sessions. Each LLM call = one Chat document.
// All calls in a chain share the same sessionId and are ordered by chainIndex.
// Query: Chat.find({ sessionId }).sort({ chainIndex: 1 }) -> full chain

import { v4 as uuidv4 } from "uuid";
import Chat from "../models/chat.js";
import Contribution from "../models/contribution.js";
import { createSession, SESSION_TYPES } from "../ws/sessionRegistry.js";

// ─────────────────────────────────────────────────────────────────────────
// CHAT CONTRIBUTION CONTEXT (in-memory aiSessionKey -> { sessionId, chatId })
// Used by handleMcpRequest to inject into tool args so contributions
// are tagged with the correct chat, not linked by time window.
//
// The key is the ai-chat session key (historically called "visitorId"
// throughout the codebase; conversation.js still uses that name
// internally).
// ─────────────────────────────────────────────────────────────────────────

const activeAiContext = new Map();
function MAX_AI_CONTEXT_ENTRIES() { return Math.max(100, Math.min(Number(getLandConfigValue("maxAiContextEntries")) || 10000, 100000)); }

export function setChatContext(aiSessionKey, sessionId, chatId) {
  // Cap to prevent unbounded growth if clearChatContext is never called
  if (activeAiContext.size >= MAX_AI_CONTEXT_ENTRIES() && !activeAiContext.has(String(aiSessionKey))) {
    const first = activeAiContext.keys().next().value;
    activeAiContext.delete(first);
  }
  activeAiContext.set(String(aiSessionKey), { sessionId, chatId: chatId ? String(chatId) : null });
}

export function getChatContext(aiSessionKey) {
  return activeAiContext.get(String(aiSessionKey)) || { sessionId: null, chatId: null };
}

export function clearChatContext(aiSessionKey) {
  activeAiContext.delete(String(aiSessionKey));
}

// Periodic sweep: clear entries older than 30 minutes (safety net for missed clears)
setInterval(() => {
  // activeAiContext doesn't track timestamps, so just cap the size.
  // If it's over the limit, evict the oldest half.
  const maxEntries = MAX_AI_CONTEXT_ENTRIES();
  if (activeAiContext.size > maxEntries / 2) {
    let toDelete = activeAiContext.size - Math.floor(maxEntries / 2);
    for (const key of activeAiContext.keys()) {
      if (toDelete <= 0) break;
      activeAiContext.delete(key);
      toDelete--;
    }
  }
}, 30 * 60 * 1000).unref();

// ─────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Initialize or retrieve the AI session on a socket.
 * Call before each chat. Reuses via scoped session if still within idle TTL.
 * Returns the current sessionId.
 *
 * The scopeKey is per-transport (`ws:${socket.visitorId}`), not per-user.
 * socket.visitorId already encodes (user, clientKind, clientInstance) so
 * CLI and browser on the same user get independent sessions. A reconnect
 * in the same tab / CLI pid reuses; a different device doesn't collide.
 *
 * This matters because endSession(sessionId) aborts any registered abort
 * controller on that sessionId (sessionRegistry.js:198-202). If two
 * devices shared a sessionId, one device's navigate/rotate would abort
 * the other's in-flight chat.
 */
export function ensureSession(socket) {
  const scopeKey = `ws:${socket.visitorId || socket.userId}`;
  const { sessionId, reused } = createSession({
    userId: socket.userId,
    type: SESSION_TYPES.WEBSOCKET_CHAT,
    scopeKey,
    description: `Chat session for ${socket.username || "unknown"}`,
    meta: { visitorId: socket.visitorId },
  });

  if (!reused) {
    log.debug("AI", `New AI session for ${socket.visitorId || socket.userId}: ${sessionId}`);
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
    scopeKey: `ws:${socket.visitorId || socket.userId}`,
    idleTTL: 0, // force new session by treating any existing as expired
    description: `Chat session for ${socket.username || "unknown"}`,
    meta: { visitorId: socket.visitorId },
  });

  log.debug("AI", `Rotated AI session for ${socket.visitorId || socket.userId}: ${sessionId}`);

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
 * Safe to call anytime. No-ops if nothing is active.
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
    log.debug("AI", `Finalized orphaned chat ${active.chatId} for ${socket.visitorId}`);
  } catch (err) {
    log.warn("AI", `Failed to finalize orphaned chat: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TWO-PHASE RECORDING (for user-facing chats)
// ─────────────────────────────────────────────────────────────────────────

// Max message content stored in Chat documents. Prevents oversized user messages
// from exceeding the 16MB BSON limit when combined with other Chat fields.
function MAX_CHAT_CONTENT_BYTES() { return Math.max(10000, Math.min(Number(getLandConfigValue("maxChatContentBytes")) || 100000, 1000000)); }

/**
 * Phase 1: Create a Chat record at the start of processing.
 * This is the user's original message. chainIndex 0.
 */
export async function startChat({
  userId,
  sessionId,
  message,
  source = "user",
  modeKey,
  llmProvider,
  treeContext,
  systemPrompt = null,
  enrichedContext = null,
  // Chain linkage. When this chat is spawned from inside another
  // chat's tool handler (e.g., Ruler's hire-planner spawning a
  // Planner chainstep), pass the parent chatId. We resolve the
  // parent's rootChatId so the spawned chat sits in the same chain
  // hierarchy under the original user message.
  parentChatId = null,
}) {
  const safeModeKey = modeKey || "home:default";
  const colonIdx = safeModeKey.indexOf(":");
  const zone = colonIdx > 0 ? safeModeKey.slice(0, colonIdx) : safeModeKey;
  const mode = colonIdx > 0 ? safeModeKey.slice(colonIdx + 1) : "default";

  // Cap stored message content
  const maxContent = MAX_CHAT_CONTENT_BYTES();
  const safeMessage = typeof message === "string" && message.length > maxContent
    ? message.slice(0, maxContent) + "... (truncated)"
    : message;

  // Resolve rootChatId: when there's a parent, the new chat inherits
  // its rootChatId so audit walks see the whole chain rooted at the
  // user's original message. Without a parent (top-level chat), the
  // chat IS its own root.
  const chatId = uuidv4();
  let resolvedRootChatId = chatId;
  let resolvedChainIndex = 0;
  if (parentChatId) {
    try {
      const parent = await Chat.findById(parentChatId).select("rootChatId chainIndex").lean();
      if (parent) {
        resolvedRootChatId = parent.rootChatId || parentChatId;
        // Increment chainIndex from parent so ordering reflects depth.
        resolvedChainIndex = (parent.chainIndex || 0) + 1;
      } else {
        // Parent not found — fall back to using parentChatId as root.
        // The link is still useful for audit walks even if the parent
        // record is gone.
        resolvedRootChatId = parentChatId;
      }
    } catch {
      resolvedRootChatId = parentChatId;
    }
  }

  const chat = await Chat.create({
    _id: chatId,
    userId,
    sessionId: sessionId || uuidv4(),
    chainIndex: resolvedChainIndex,
    rootChatId: resolvedRootChatId,
    parentChatId: parentChatId || null,
    startMessage: {
      content: safeMessage,
      source,
      time: new Date(),
    },
    aiContext: {
      zone,
      mode,
    },
    llmProvider: llmProvider || { isCustom: false, model: null, connectionId: null },
    ...(treeContext ? { treeContext } : {}),
    ...(systemPrompt ? { systemPrompt: capSystemPrompt(systemPrompt) } : {}),
    ...(enrichedContext ? { enrichedContext } : {}),
    modeHistory: [{ modeKey: safeModeKey, reason: "start", at: new Date() }],
  });

  return chat;
}

// System prompts are large by design (persona, tools, enrichContext). We
// keep them whole for audit but still cap at 1MB so a runaway prompt
// builder can't explode a single chat document past Mongo's 16MB limit.
const MAX_SYSTEM_PROMPT_BYTES = 1_000_000;
function capSystemPrompt(s) {
  if (typeof s !== "string") return null;
  if (Buffer.byteLength(s, "utf8") <= MAX_SYSTEM_PROMPT_BYTES) return s;
  const chars = Math.floor(MAX_SYSTEM_PROMPT_BYTES * 0.9);
  return s.slice(0, chars) + "\n... (systemPrompt truncated at 1MB)";
}

/**
 * Phase 2: Finalize a Chat. Set endMessage, collect contributions.
 * Uses findOneAndUpdate with a condition to prevent double-finalization races.
 */
export async function finalizeChat({
  chatId,
  content,
  stopped = false,
  modeKey,
}) {
  if (!chatId) return null;

  const endTime = new Date();

  // Cap stored content
  const maxEndContent = MAX_CHAT_CONTENT_BYTES();
  const safeContent = typeof content === "string" && content.length > maxEndContent
    ? content.slice(0, maxEndContent) + "... (truncated)"
    : (content || null);

  // Collect AI contributions linked to this chat by chatId (capped)
  const contributions = await Contribution.find({ chatId })
    .select("_id")
    .limit(Number(getLandConfigValue("chatContributionQueryLimit")) || 2000)
    .lean();

  const contributionIds = contributions.map((c) => c._id);

  const $set = {
    "endMessage.content": safeContent,
    "endMessage.time": endTime,
    "endMessage.stopped": stopped,
  };

  // Patch mode only on success. Stopped chats keep their start mode.
  if (modeKey && !stopped) {
    const colonIdx = modeKey.indexOf(":");
    $set["aiContext.zone"] = colonIdx > 0 ? modeKey.slice(0, colonIdx) : modeKey;
    $set["aiContext.mode"] = colonIdx > 0 ? modeKey.slice(colonIdx + 1) : "default";
  }

  // Atomic guard: only finalize if endMessage.time is not already set.
  // Prevents double-finalize races where two concurrent calls both read
  // endMessage.time as null and both proceed to write.
  const updated = await Chat.findOneAndUpdate(
    { _id: chatId, "endMessage.time": null },
    {
      $set,
      $addToSet: { contributions: { $each: contributionIds } },
    },
    { new: true },
  );

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────
// TOOL CALL TRACKING (per-chat step log)
// ─────────────────────────────────────────────────────────────────────────

// Keep chat documents bounded. 50 tool calls is plenty for normal sessions
// and collapses gracefully for tool-heavy runs (fanout, multi-file edits).
const MAX_TOOL_CALLS_PER_CHAT = 50;

// Args can be large (full file content). Cap the stored version so chat
// docs don't balloon. The full args are already in the server log; the
// chat record holds a summary for UX display.
function MAX_TOOL_ARG_BYTES() { return Math.max(200, Math.min(Number(getLandConfigValue("chatToolArgBytes")) || 2000, 20000)); }

function summarizeArgs(args) {
  if (args == null || typeof args !== "object") return args ?? null;
  try {
    const serialized = JSON.stringify(args);
    const max = MAX_TOOL_ARG_BYTES();
    if (serialized.length <= max) return args;
    // Truncated form: keep structure but mark as truncated
    return { _truncated: true, _bytes: serialized.length, preview: serialized.slice(0, max) };
  } catch {
    return { _unserializable: true };
  }
}

/**
 * Push a single tool call entry onto a Chat record's toolCalls array.
 * Atomic — uses $push + $slice to keep the cap enforced without a race.
 * Fire-and-forget: every call the tool loop makes gets logged, but a
 * failure here never blocks the conversation.
 */
// Full tool args + result cap. 1MB per entry gives real auditability
// while keeping each chat document well inside Mongo's 16MB cap even
// with a full 50-call log. If either hits the cap, `truncated: true`
// flags the entry so the viewer can show a "truncated" badge.
const MAX_FULL_TOOL_BYTES = 1_000_000;
function capFullBytes(value, isString = false) {
  if (value == null) return { value: null, truncated: false };
  const str = isString ? String(value) : (typeof value === "string" ? value : (() => {
    try { return JSON.stringify(value); } catch { return "[unserializable]"; }
  })());
  if (Buffer.byteLength(str, "utf8") <= MAX_FULL_TOOL_BYTES) {
    return { value: isString ? str : value, truncated: false };
  }
  const chars = Math.floor(MAX_FULL_TOOL_BYTES * 0.9);
  const sliced = str.slice(0, chars) + "\n... (truncated at 1MB)";
  return { value: sliced, truncated: true };
}

export async function appendToolCall(chatId, { tool, args, result, success, error, ms }) {
  if (!chatId || !tool) return;
  try {
    const fullArgs = capFullBytes(args);
    const fullResult = capFullBytes(result, true);
    await Chat.updateOne(
      { _id: chatId },
      {
        $push: {
          toolCalls: {
            $each: [{
              tool,
              args: summarizeArgs(args),
              argsFull: fullArgs.value,
              resultFull: fullResult.value,
              truncated: fullArgs.truncated || fullResult.truncated,
              success: success !== false,
              error: error ? String(error).slice(0, 500) : null,
              ms: Number(ms) || 0,
              at: new Date(),
            }],
            $slice: -MAX_TOOL_CALLS_PER_CHAT,
          },
        },
      },
    );
  } catch (err) {
    log.debug("ChatTracker", `appendToolCall failed for ${chatId}: ${err.message}`);
  }
}

/**
 * Push a mode switch onto the chat's modeHistory. Fire-and-forget; a
 * failure never breaks the orchestrator flow. Used when a chain step
 * changes mode (handoffs, nested dispatches, converse → extension).
 */
export async function appendModeSwitch(chatId, { modeKey, reason = null }) {
  if (!chatId || !modeKey) return;
  try {
    await Chat.updateOne(
      { _id: chatId },
      {
        $push: {
          modeHistory: { modeKey, reason, at: new Date() },
        },
      },
    );
  } catch (err) {
    log.debug("ChatTracker", `appendModeSwitch failed for ${chatId}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CHAIN STEP TRACKING (orchestrator internal calls)
// ─────────────────────────────────────────────────────────────────────────

function MAX_CHAIN_STEP_CONTENT() { return Math.max(500, Math.min(Number(getLandConfigValue("maxChainStepContentBytes")) || 2000, 50000)); }

/**
 * Record an orchestrator chain step as its own Chat document.
 * All steps in a chain share the same sessionId.
 *
 * Fire-and-forget. Never blocks the orchestrator.
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
  treeContext,
}) {
  if (!sessionId || !userId) return;

  const safeKey = modeKey || "orchestrator:step";
  const cIdx = safeKey.indexOf(":");
  const stepZone = cIdx > 0 ? safeKey.slice(0, cIdx) : safeKey;
  const stepMode = cIdx > 0 ? safeKey.slice(cIdx + 1) : "step";
  const start = startTime || new Date();
  const end = output ? endTime || new Date() : null;

  // Truncate both input and output consistently
  const maxStep = MAX_CHAIN_STEP_CONTENT();
  let inputStr;
  if (typeof input === "string") {
    inputStr = input.slice(0, maxStep);
  } else {
    inputStr = JSON.stringify(input).slice(0, maxStep);
  }

  let outputStr = null;
  if (output) {
    if (typeof output === "string") {
      outputStr = output.slice(0, maxStep);
    } else {
      const { _llmProvider, _raw, ...clean } = output;
      outputStr = JSON.stringify(clean).slice(0, maxStep);
    }
  }

  // Fire and forget. Don't await, don't block the chain.
  Chat.create({
    userId,
    sessionId,
    chainIndex,
    rootChatId,
    startMessage: {
      content: inputStr,
      source,
      time: start,
    },
    endMessage: {
      content: outputStr,
      time: end,
      stopped: false,
    },
    aiContext: {
      zone: stepZone,
      mode: stepMode,
    },
    llmProvider: llmProvider || { isCustom: false, model: null, connectionId: null },
    ...(treeContext ? { treeContext } : {}),
  }).catch((err) => {
    log.warn("AI", `Failed to track chain step [${modeKey}]: ${err.message}`);
  });
}

/**
 * Awaited version of trackChainStep. Creates a chain-step Chat record
 * and returns the doc so the caller can swap chatContext to it and
 * finalize it later with the step's result.
 *
 * Used by the tree-orchestrator to split a long tool-call session into
 * bounded chainIndex steps so each step has its own visible phase.
 */
export async function startChainStep({
  userId,
  sessionId,
  chainIndex,
  rootChatId = null,
  modeKey,
  source = "continuation",
  input,
  treeContext,
  llmProvider = null,
  parentChatId = null,
  dispatchOrigin = null,
  systemPrompt = null,
  enrichedContext = null,
}) {
  if (!sessionId || !userId) return null;

  const safeKey = modeKey || "orchestrator:step";
  const cIdx = safeKey.indexOf(":");
  const stepZone = cIdx > 0 ? safeKey.slice(0, cIdx) : safeKey;
  const stepMode = cIdx > 0 ? safeKey.slice(cIdx + 1) : "step";

  const maxStep = MAX_CHAIN_STEP_CONTENT();
  const inputStr =
    typeof input === "string"
      ? input.slice(0, maxStep)
      : JSON.stringify(input || "").slice(0, maxStep);

  try {
    const chat = await Chat.create({
      _id: uuidv4(),
      userId,
      sessionId,
      chainIndex,
      rootChatId,
      parentChatId: parentChatId || null,
      dispatchOrigin: dispatchOrigin || source || null,
      startMessage: {
        content: inputStr,
        source,
        time: new Date(),
      },
      aiContext: { zone: stepZone, mode: stepMode },
      llmProvider: llmProvider || { isCustom: false, model: null, connectionId: null },
      ...(treeContext ? { treeContext } : {}),
      ...(systemPrompt ? { systemPrompt: capSystemPrompt(systemPrompt) } : {}),
      ...(enrichedContext ? { enrichedContext } : {}),
      modeHistory: [{ modeKey: safeKey, reason: source || "chain-step", at: new Date() }],
    });
    return chat;
  } catch (err) {
    log.warn("AI", `startChainStep failed [${modeKey}]: ${err.message}`);
    return null;
  }
}
