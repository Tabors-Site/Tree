// TreeOS Seed . AGPL-3.0 . https://treeos.ai
//
// summonTracker.js — write surface for the slim Summon model.
//
// Each Summon = one being's wake-and-act through one LLM call. Tool calls
// during the Summon are Dids keyed by summonId (not arrays on the Summon).
//
// Public surface used by the rest of the codebase:
//   ensureSession / rotateSession / getSessionId   — WS chat session id
//   setActiveSummon / clearActiveSummon / finalizeOpenSummon — socket-side marker
//   startSummon / finalizeSummon                    — Summon lifecycle writes
//   appendToolCall                                  — writes a tool-call Did
//   getLatestActiveChainstepForBeing                — descriptor activity lookup
//
// Deprecated no-ops (orchestrator-era; tree-orchestrator + swarm slated for
// deletion in Slice 7, callers will retire with them):
//   trackChainStep / startChainStep / appendModeSwitch / getLatestActiveChainstep

import log from "../log.js";
import { getLandConfigValue } from "../landConfig.js";
import { v4 as uuidv4 } from "uuid";
import Summon from "../models/summon.js";
import Did from "../models/did.js";
import { createSession, SESSION_TYPES } from "../ws/sessionRegistry.js";
import { computeIbpAddressForSummon, invalidateStanceCache } from "./ibpAddress.js";

export { invalidateStanceCache };

// ─────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Initialize or retrieve the AI session on a socket. Returns sessionId.
 * Per-transport scopeKey: socket.aiSessionKey already encodes (being,
 * clientKind, clientInstance), so CLI and browser on the same being get
 * independent sessions. endSession(sessionId) aborts any registered abort
 * controller on that sessionId.
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
  if (!reused) log.debug("AI", `New AI session for ${socket.aiSessionKey}: ${sessionId}`);
  socket._aiSession = { id: sessionId, lastActivity: Date.now() };
  return sessionId;
}

export function rotateSession(socket) {
  const { sessionId } = createSession({
    beingId: socket.beingId,
    type: SESSION_TYPES.WEBSOCKET_CHAT,
    scopeKey: `ws:${socket.aiSessionKey}`,
    idleTTL: 0,
    description: `Chat session for ${socket.username || "unknown"}`,
    meta: { aiSessionKey: socket.aiSessionKey },
  });
  log.debug("AI", `Rotated AI session for ${socket.aiSessionKey}: ${sessionId}`);
  socket._aiSession = { id: sessionId, lastActivity: Date.now() };
  return sessionId;
}

export function getSessionId(socket) {
  return socket._aiSession?.id || null;
}

// ─────────────────────────────────────────────────────────────────────────
// ACTIVE SUMMON TRACKING (socket-side marker)
// ─────────────────────────────────────────────────────────────────────────

export function setActiveSummon(socket, summonId, startTime) {
  socket._activeChat = { summonId, startTime };
}

export function clearActiveSummon(socket) {
  socket._activeChat = null;
}

/** Finalize an orphaned in-flight Summon on socket disconnect. */
export async function finalizeOpenSummon(socket) {
  const active = socket._activeChat;
  if (!active) return;
  socket._activeChat = null;
  try {
    await finalizeSummon({ summonId: active.summonId, content: null, stopped: true });
    log.debug("AI", `Finalized orphaned summon ${active.summonId} for ${socket.aiSessionKey}`);
  } catch (err) {
    log.warn("AI", `Failed to finalize orphaned summon: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SUMMON LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

function MAX_CHAT_CONTENT_BYTES() {
  return Math.max(10000, Math.min(Number(getLandConfigValue("maxChatContentBytes")) || 100000, 1000000));
}

function capContent(s) {
  if (typeof s !== "string") return s;
  const max = MAX_CHAT_CONTENT_BYTES();
  return s.length > max ? s.slice(0, max) + "... (truncated)" : s;
}

/**
 * Phase 1: create the Summon record when a wake fires.
 *
 * Persists the slim Summon shape (beingIn/beingOut, ibpAddress, activeRole,
 * inReplyTo/rootCorrelation, start/end messages, llmProvider).
 * Legacy field names (beingId, parentSummonId, rootSummonId, role) are
 * accepted and mapped to the canonical names.
 */
export async function startSummon(opts = {}) {
  const {
    beingIn, beingOut = null,
    askerPosition = null, addresseePosition = null,
    message, source = "user",
    activeRole = null,
    llmProvider = null,
    inboxMessageId = null,
    inReplyTo = null,
    rootCorrelation = null,
    receivedAt = null,

    // Aliases — accepted, mapped, then dropped
    beingId,                    // alias for beingIn
    role = null,                // alias for activeRole (role.name)
    parentSummonId = null,      // alias for inReplyTo
    rootSummonId = null,        // alias for rootCorrelation
  } = opts;

  const resolvedActiveRole = activeRole || role || null;

  const askerBeingId = beingIn || beingId;
  if (!askerBeingId) {
    log.warn("SummonTracker", "startSummon called without beingIn/beingId");
    return null;
  }

  const resolvedInReplyTo = inReplyTo || parentSummonId || null;
  let resolvedRoot = rootCorrelation || rootSummonId || null;

  // Resolve rootCorrelation: when there's a parent and no explicit root,
  // inherit the parent's rootCorrelation so audit walks see the whole
  // reply chain rooted at the originating user message.
  if (!resolvedRoot && resolvedInReplyTo) {
    try {
      const parent = await Summon.findById(resolvedInReplyTo)
        .select("rootCorrelation")
        .lean();
      resolvedRoot = parent?.rootCorrelation || resolvedInReplyTo;
    } catch {
      resolvedRoot = resolvedInReplyTo;
    }
  }

  const summonId = uuidv4();
  // A summon with no parent IS its own root.
  if (!resolvedRoot) resolvedRoot = summonId;

  const ibpAddress = await computeIbpAddressForSummon({
    askerBeingId,
    askerPosition,
    addresseeBeingId: beingOut,
    addresseePosition,
  });

  const now = new Date();
  const safeMessage = capContent(message);

  try {
    const summon = await Summon.create({
      _id: summonId,
      beingIn: askerBeingId,
      beingOut: beingOut || null,
      ibpAddress,
      activeRole: resolvedActiveRole,
      inboxMessageId,
      inReplyTo: resolvedInReplyTo,
      rootCorrelation: resolvedRoot,
      receivedAt: receivedAt || now,
      summonedAt: now,
      startMessage: { content: safeMessage, source },
      llmProvider: llmProvider
        ? { model: llmProvider.model || null, connectionId: llmProvider.connectionId || null }
        : { model: null, connectionId: null },
    });
    return summon;
  } catch (err) {
    log.warn("SummonTracker", `startSummon failed: ${err.message}`);
    return null;
  }
}

/**
 * Phase 2: finalize a Summon — set endMessage.
 * Atomic guard against double-finalize: only fires when endMessage.time is null.
 */
export async function finalizeSummon({ summonId, content, stopped = false } = {}) {
  if (!summonId) return null;
  const endTime = new Date();
  const safeContent = content != null ? capContent(content) : null;

  const updated = await Summon.findOneAndUpdate(
    { _id: summonId, "endMessage.time": null },
    {
      $set: {
        "endMessage.content": safeContent,
        "endMessage.time": endTime,
        "endMessage.stopped": stopped,
      },
    },
    { new: true },
  );

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────
// TOOL CALL TRACKING (now writes a Did)
// ─────────────────────────────────────────────────────────────────────────

function MAX_TOOL_ARG_BYTES() {
  return Math.max(200, Math.min(Number(getLandConfigValue("chatToolArgBytes")) || 2000, 20000));
}

function summarizeArgs(args) {
  if (args == null || typeof args !== "object") return args ?? null;
  try {
    const serialized = JSON.stringify(args);
    const max = MAX_TOOL_ARG_BYTES();
    if (serialized.length <= max) return args;
    return { _truncated: true, _bytes: serialized.length, preview: serialized.slice(0, max) };
  } catch {
    return { _unserializable: true };
  }
}

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
 * Record a tool call as a Did with action="tool-call". Resolves beingId
 * (the actor) from the Summon's beingOut — the responder is the one who
 * ran the tool. Fire-and-forget: failures never block the conversation.
 */
export async function appendToolCall(summonId, { tool, args, result, success, error, ms } = {}) {
  if (!summonId || !tool) return;
  let beingId = null;
  try {
    const summon = await Summon.findById(summonId).select("beingOut beingIn").lean();
    beingId = summon?.beingOut || summon?.beingIn || null;
  } catch {
    // fall through with null beingId → skip write
  }
  if (!beingId) {
    log.debug("SummonTracker", `appendToolCall: no being resolvable for summon ${summonId}`);
    return;
  }

  const fullArgs = capFullBytes(args);
  const fullResult = capFullBytes(result, true);

  try {
    await Did.create({
      _id: uuidv4(),
      beingId,
      summonId,
      action: "tool-call",
      date: new Date(),
      toolCall: {
        name: tool,
        args: summarizeArgs(args),
        argsFull: fullArgs.value,
        result: fullResult.value,
        truncated: fullArgs.truncated || fullResult.truncated,
        success: success !== false,
        error: error ? String(error).slice(0, 500) : null,
        ms: Number(ms) || 0,
      },
    });
  } catch (err) {
    log.debug("SummonTracker", `appendToolCall failed for ${summonId}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DESCRIPTOR ACTIVITY LOOKUP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find the most recently active Summon where the given being is the
 * responder. "Active" = endMessage.time is null. Used by descriptor.js
 * to surface "this being is currently doing X."
 */
export async function getLatestActiveChainstepForBeing(beingOut) {
  if (!beingOut) return null;
  try {
    return await Summon.findOne({
      beingOut,
      "endMessage.time": null,
    })
      .select("_id startMessage activeRole inReplyTo rootCorrelation beingIn beingOut ibpAddress summonedAt")
      .sort({ summonedAt: -1 })
      .lean();
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DEPRECATED NO-OPS (orchestrator-era; retire with tree-orchestrator/swarm)
// ─────────────────────────────────────────────────────────────────────────

let _deprecationWarned = new Set();
function warnOnce(name) {
  if (_deprecationWarned.has(name)) return;
  _deprecationWarned.add(name);
  log.warn("SummonTracker",
    `${name} is deprecated under the slim Summon shape. ` +
    `Caller is orchestrator-era and will retire with tree-orchestrator/swarm (Slice 7).`);
}

/** @deprecated Mode switches no longer recorded — role IS the behavior. */
export async function appendModeSwitch(/* summonId, { modeKey, reason } */) {
  warnOnce("appendModeSwitch");
}

/** @deprecated chainIndex/sessionId removed; recursive sub-Ruler dispatch obsoletes chain steps. */
export function trackChainStep() {
  warnOnce("trackChainStep");
}

/** @deprecated chainIndex removed; sub-summons are normal startSummon writes with inReplyTo. */
export async function startChainStep() {
  warnOnce("startChainStep");
  return null;
}

/** @deprecated aiContext/treeContext removed; lookup by being via getLatestActiveChainstepForBeing instead. */
export async function getLatestActiveChainstep(/* nodeId, modeKey */) {
  warnOnce("getLatestActiveChainstep");
  return null;
}
