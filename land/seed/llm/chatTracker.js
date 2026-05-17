// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
import { getLandConfigValue } from "../landConfig.js";
// llm/chatTracker.js
// Tracks AI chat sessions. Each LLM call = one Chat document.
// All calls in a chain share the same sessionId and are ordered by chainIndex.
// Query: Chat.find({ sessionId }).sort({ chainIndex: 1 }) -> full chain

import { v4 as uuidv4 } from "uuid";
import Chat from "../models/chat.js";
import Did from "../models/did.js";
import { createSession, SESSION_TYPES } from "../ws/sessionRegistry.js";
import { computePortalAddressForChat, invalidateStanceCache } from "./portalAddress.js";

/**
 * Bust cached stance fields for a being. Call after rename or home
 * change so the next chat write picks up the new values. Re-exported
 * for callers that already import from chatTracker.
 */
export { invalidateStanceCache };

// ─────────────────────────────────────────────────────────────────────────
// CHAT CONTRIBUTION CONTEXT
//
// Tool-call → chatId correlation used to flow through a global Map
// keyed by aiSessionKey (`activeAiContext`). Slice 2 of the
// per-being / per-Portal-Address refactor deleted that Map: callers
// now thread `chatId` and `sessionId` through processMessage's ctx,
// and mcp/server.js reads them directly from the inbound MCP tool
// call envelope. No server-side state to populate, no risk of stale
// reads between chainsteps.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Initialize or retrieve the AI session on a socket.
 * Call before each chat. Reuses via scoped session if still within idle TTL.
 * Returns the current sessionId.
 *
 * The scopeKey is per-transport (`ws:${socket.aiSessionKey}`), not per-user.
 * socket.aiSessionKey already encodes (being, clientKind, clientInstance) so
 * CLI and browser on the same being get independent sessions. A reconnect
 * in the same tab / CLI pid reuses; a different device doesn't collide.
 *
 * This matters because endSession(sessionId) aborts any registered abort
 * controller on that sessionId (sessionRegistry.js:198-202). If two
 * devices shared a sessionId, one device's navigate/rotate would abort
 * the other's in-flight chat.
 */
export function ensureSession(socket) {
  const scopeKey = `ws:${socket.aiSessionKey}`;
  const { sessionId, reused } = createSession({
    beingId: socket.beingId,
    type: SESSION_TYPES.WEBSOCKET_CHAT,
    scopeKey,
    description: `Chat session for ${socket.username || "unknown"}`,
    meta: { aiSessionKey: socket.aiSessionKey },
  });

  if (!reused) {
    log.debug("AI", `New AI session for ${socket.aiSessionKey}: ${sessionId}`);
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
    beingId: socket.beingId,
    type: SESSION_TYPES.WEBSOCKET_CHAT,
    scopeKey: `ws:${socket.aiSessionKey}`,
    idleTTL: 0, // force new session by treating any existing as expired
    description: `Chat session for ${socket.username || "unknown"}`,
    meta: { aiSessionKey: socket.aiSessionKey },
  });

  log.debug("AI", `Rotated AI session for ${socket.aiSessionKey}: ${sessionId}`);

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
    log.debug("AI", `Finalized orphaned chat ${active.chatId} for ${socket.aiSessionKey}`);
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
  // The asker being — who initiated this chat. Stored in `beingIn`.
  // Legacy callers may still pass `beingId` (post-sed rename); either
  // name is accepted, with `beingIn` winning when both are present.
  beingIn,
  beingId,
  // The responder being — who this chat is addressed to. Stored in
  // `beingOut`. Optional: legacy callers and background system chats
  // may omit it. When the asker is also the responder (a being
  // talking to itself), pass the same id for both.
  beingOut = null,
  // Stance positions used to compute this chat's Portal Address.
  // The Portal Address is `<askerStance> :: <addresseeStance>` (sorted
  // canonically), and each stance is anchored at a nodeId.
  //   askerPosition:     the asker's CURRENT nodeId — wherever they are
  //                      in the world when this chat is sent. For humans
  //                      this is their navigated position; for AI beings
  //                      it's typically their homePositionId.
  //   addresseePosition: the responder's nodeId. When omitted, the
  //                      responder's homePositionId is used.
  // When either resolves to null the Portal Address is left null —
  // tolerated for legacy callers and stanceless background tasks.
  askerPosition = null,
  addresseePosition = null,
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
  const askerBeingId = beingIn || beingId;
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

  // Compute the canonical Portal Address from the stance pair. Both
  // stances must be resolvable — when either side is missing (system
  // task without a responder, legacy caller without position context),
  // the Portal Address stays null and that's by design.
  const portalAddress = await computePortalAddressForChat({
    askerBeingId,
    askerPosition,
    addresseeBeingId: beingOut,
    addresseePosition,
  });

  const chat = await Chat.create({
    _id: chatId,
    beingIn: askerBeingId,
    beingOut: beingOut || null,
    portalAddress,
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
  const contributions = await Did.find({ chatId })
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

/**
 * Find the most recently active chainstep (Chat doc) where the given
 * being is the responder. "Active" means `endMessage.time` is still
 * null (the chainstep has not been finalized).
 *
 * Used by the Position Description's per-being `activity` field. When a
 * being's chainstep is running, the Chat's `beingOut` points at it; we
 * surface the latest one so the descriptor reflects "this being is
 * currently doing X."
 *
 * @param {string} beingOut  the responder being's id (the being whose
 *                            home / position we're rendering)
 * @returns {Promise<object|null>}  a lean Chat document, or null if none active
 */
export async function getLatestActiveChainstepForBeing(beingOut) {
  if (!beingOut) return null;
  try {
    return await Chat.findOne({
      beingOut,
      "endMessage.time": null,
    })
      .select("_id startMessage toolCalls aiContext treeContext parentChatId rootChatId chainIndex beingIn beingOut")
      .sort({ "startMessage.time": -1 })
      .lean();
  } catch {
    return null;
  }
}

/**
 * Legacy lookup: find the most recently active chainstep bound to a
 * (nodeId, modeKey) pair. Kept for callers that haven't migrated to
 * being-keyed lookups (older descriptor paths, e.g. when a chat row
 * was inserted before beingOut was populated).
 *
 * Instrumented 2026-05-17: every call logs a warn so we can verify the
 * descriptor backfill of `_chainstepLookupBeingId` covers every entry.
 * If this warn stays silent over a full session, the function is dead
 * code and can be deleted along with its callers in ibp/descriptor.js.
 */
export async function getLatestActiveChainstep(nodeId, modeKey) {
  if (!nodeId || !modeKey) return null;
  log.warn("ChatTracker",
    `getLatestActiveChainstep fallback hit (nodeId=${String(nodeId).slice(0,8)}, modeKey=${modeKey}). ` +
    `Indicates a being entry without _chainstepLookupBeingId. If this never fires, the legacy lookup is dead.`);
  const [zone, ...rest] = modeKey.split(":");
  const mode = rest.join(":");
  if (!zone || !mode) return null;
  try {
    return await Chat.findOne({
      "treeContext.targetNodeId": String(nodeId),
      "aiContext.zone":           zone,
      "aiContext.mode":           mode,
      "endMessage.time":          null,
    })
      .select("_id startMessage toolCalls aiContext treeContext parentChatId rootChatId chainIndex beingIn beingOut")
      .sort({ "startMessage.time": -1 })
      .lean();
  } catch {
    return null;
  }
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
  // Asker being for the chain step. `beingIn` is the schema field;
  // `beingId` is accepted as a legacy alias from older callers.
  beingIn,
  beingId,
  beingOut = null,
  // Pre-computed Portal Address (canonical sorted stance::stance).
  // Callers that already resolved the address pass it directly so
  // trackChainStep stays sync/fire-and-forget — no Mongo round-trip
  // here. When omitted the field is left null; downstream queries
  // by Portal Address simply won't surface this row.
  portalAddress = null,
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
  const askerBeingId = beingIn || beingId;
  if (!sessionId || !askerBeingId) return;

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

  // Fire and forget. Don't await, don't block the chain. portalAddress
  // is whatever the caller passed; trackChainStep does NOT resolve it
  // here, because the function contract is "log a completed step
  // without blocking" — adding a Mongo round-trip would violate that.
  Chat.create({
    beingIn: askerBeingId,
    beingOut: beingOut || null,
    portalAddress: portalAddress || null,
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
  // Asker being. `beingIn` is the schema field; `beingId` is the
  // legacy alias accepted from pre-rename callers.
  beingIn,
  beingId,
  beingOut = null,
  // Stance positions used to compute this chat's Portal Address.
  // See startChat for semantics. The awaited variant auto-resolves
  // each side via Being.homePositionId when omitted.
  askerPosition = null,
  addresseePosition = null,
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
  const askerBeingId = beingIn || beingId;
  if (!sessionId || !askerBeingId) return null;
  const portalAddress = await computePortalAddressForChat({
    askerBeingId,
    askerPosition,
    addresseeBeingId: beingOut,
    addresseePosition,
  });

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
      beingIn: askerBeingId,
      beingOut: beingOut || null,
      portalAddress,
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
