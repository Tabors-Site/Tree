// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Session registry.
//
// Tracks all active sessions per being and gates iframe navigation so only
// the designated "active navigator" session can redirect the user's view.
// All session creation should go through createSession().
//
// Lives in seed because a session is a "being-reach into the land" — the
// concept is transport-agnostic. A web tab, a CLI process, and a future
// CLI carrier all create sessions through the same API; transports just
// register their session-type strings via registerSessionType.

import log from "../system/log.js";
import { hooks } from "../system/hooks.js";
import { getLandConfigValue } from "../landConfig.js";

import { v4 as uuidv4 } from "uuid";

// ─────────────────────────────────────────────────────────────────────────
// SESSION TYPES
// ─────────────────────────────────────────────────────────────────────────

// Session type registry. Seed defines core types. Extensions and
// transport layers register additional types during init or boot.
export const SESSION_TYPES = {
  // Core (registered by seed, always available)
  HUMAN_WEB: "human-web",
  HUMAN_CLI: "human-cli",
  WEBSOCKET_CHAT: "websocket-chat",
  // Extension types registered dynamically via registerSessionType()
};

/**
 * Register a session type. Called by extensions (via manifest sessionTypes)
 * and by the transport layer (websocket.js, orchestrate routes).
 * Duplicate keys are rejected to prevent silent overwrites.
 */
export function registerSessionType(key, value) {
  if (typeof key !== "string" || typeof value !== "string") {
    log.warn(
      "Session",
      `Invalid session type registration: key and value must be strings`,
    );
    return false;
  }
  if (SESSION_TYPES[key] && SESSION_TYPES[key] !== value) {
    log.warn(
      "Session",
      `Session type "${key}" already registered as "${SESSION_TYPES[key]}". Cannot overwrite with "${value}".`,
    );
    return false;
  }
  SESSION_TYPES[key] = value;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// DATA STRUCTURES
// ─────────────────────────────────────────────────────────────────────────

// sessionId -> { sessionId, beingId, type, createdAt, lastActivity, status, description, meta }
const sessions = new Map();

// beingId -> Set<sessionId>
const beingSessionIndex = new Map();

// beingId -> sessionId  (which session controls the iframe)
const activeNavigator = new Map();

// sessionId -> AbortController  (allows killing in-flight work)
const sessionAbortControllers = new Map();

// scopeKey -> { sessionId, lastActivity }  (for idle-TTL reuse of scoped sessions)
const scopedSessions = new Map();
function MAX_SCOPED_SESSIONS() {
  return Math.max(
    100,
    Math.min(Number(getLandConfigValue("maxScopedSessions")) || 20000, 100000),
  );
}
let DEFAULT_SCOPE_TTL = 15 * 60 * 1000; // 15 minutes
export function setSessionTTL(ms) {
  DEFAULT_SCOPE_TTL = Math.max(5000, Math.min(ms, 86400000));
}

// ─────────────────────────────────────────────────────────────────────────
// SESSION CREATION
// ─────────────────────────────────────────────────────────────────────────

let MAX_SESSIONS = 10000;
export function setMaxSessions(n) {
  MAX_SESSIONS = Math.max(100, Math.min(Number(n) || 10000, 500000));
}

/**
 * Create or retrieve a session. Single entry point for all session creation.
 */
export function createSession({
  beingId,
  type,
  scopeKey,
  description = "",
  meta = {},
  idleTTL = DEFAULT_SCOPE_TTL,
}) {
  if (!beingId) throw new Error("createSession requires beingId");
  if (!type || typeof type !== "string")
    throw new Error("createSession requires a valid type string");

  const now = Date.now();

  // Land-level session cap with oldest-first eviction
  if (sessions.size >= MAX_SESSIONS) {
    let oldestKey = null,
      oldestTime = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastActivity < oldestTime) {
        oldestTime = s.lastActivity;
        oldestKey = id;
      }
    }
    if (oldestKey) endSession(oldestKey);
  }

  // If scopeKey provided, try to reuse an existing scoped session
  if (scopeKey) {
    const existing = scopedSessions.get(scopeKey);
    if (existing && now - existing.lastActivity < idleTTL) {
      existing.lastActivity = now;
      const { isActiveNavigator } = registerSession({
        sessionId: existing.sessionId,
        beingId,
        type,
        description,
        meta,
      });
      return { sessionId: existing.sessionId, reused: true, isActiveNavigator };
    }
  }

  // Create a new session
  const sessionId = uuidv4();
  const { isActiveNavigator } = registerSession({
    sessionId,
    beingId,
    type,
    description,
    meta,
  });

  // Store in scoped map if scopeKey provided (with cap)
  if (scopeKey) {
    if (scopedSessions.size >= MAX_SCOPED_SESSIONS()) {
      // Evict oldest scoped entry
      let oldestKey = null,
        oldestTime = Infinity;
      for (const [k, v] of scopedSessions) {
        if (v.lastActivity < oldestTime) {
          oldestTime = v.lastActivity;
          oldestKey = k;
        }
      }
      if (oldestKey) scopedSessions.delete(oldestKey);
    }
    scopedSessions.set(scopeKey, { sessionId, lastActivity: now });
  }

  return { sessionId, reused: false, isActiveNavigator };
}

// ─────────────────────────────────────────────────────────────────────────
// REGISTRATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Register a session (or touch it if it already exists).
 * websocket-chat type auto-claims navigator.
 */
const MAX_DESCRIPTION_LENGTH = 500;

export function registerSession({
  sessionId,
  beingId,
  type,
  description = "",
  meta = {},
}) {
  const now = Date.now();
  const uid = String(beingId);
  // Cap description to prevent oversized session objects
  const safeDesc =
    typeof description === "string"
      ? description.slice(0, MAX_DESCRIPTION_LENGTH)
      : "";

  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastActivity = now;
    existing.description = safeDesc || existing.description;
    existing.meta = { ...existing.meta, ...meta };
    const isNav = activeNavigator.get(uid) === sessionId;
    return { sessionId, isActiveNavigator: isNav };
  }

  sessions.set(sessionId, {
    sessionId,
    beingId: uid,
    type,
    createdAt: now,
    lastActivity: now,
    status: "active",
    description: safeDesc,
    meta,
  });

  if (!beingSessionIndex.has(uid)) {
    beingSessionIndex.set(uid, new Set());
  }
  beingSessionIndex.get(uid).add(sessionId);

  // Only claim navigator if no one else has it yet.
  const currentNav = activeNavigator.get(uid);
  const currentNavSession = currentNav ? sessions.get(currentNav) : null;

  if (!currentNav || !currentNavSession) {
    activeNavigator.set(uid, sessionId);
  } else if (
    type === SESSION_TYPES.WEBSOCKET_CHAT &&
    currentNavSession.type === SESSION_TYPES.WEBSOCKET_CHAT
  ) {
    activeNavigator.set(uid, sessionId);
  }

  const isNav = activeNavigator.get(uid) === sessionId;
  log.debug(
    "Session",
    `Session registered: ${type} [${sessionId.slice(0, 8)}] for being ${uid} (navigator: ${isNav})`,
  );

  hooks
    .run("afterSessionCreate", {
      sessionId,
      beingId: uid,
      type,
      description,
      meta,
      isActiveNavigator: isNav,
    })
    .catch(() => {});
  return { sessionId, isActiveNavigator: isNav };
}

// ─────────────────────────────────────────────────────────────────────────
// LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

/**
 * End a session and remove it. Promotes a replacement navigator if needed.
 */
export function endSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Abort any in-flight work tied to this session
  const ac = sessionAbortControllers.get(sessionId);
  if (ac) {
    try {
      ac.abort();
    } catch {}
    sessionAbortControllers.delete(sessionId);
  }

  // Capture session data before deletion so the hook gets full context
  const uid = session.beingId;
  const { type, meta, description } = session;

  sessions.delete(sessionId);

  const beingSet = beingSessionIndex.get(uid);
  if (beingSet) {
    beingSet.delete(sessionId);
    if (beingSet.size === 0) beingSessionIndex.delete(uid);
  }

  if (activeNavigator.get(uid) === sessionId) {
    promoteNavigator(uid);
  }

  hooks
    .run("afterSessionEnd", {
      sessionId,
      beingId: uid,
      type,
      meta,
      description,
    })
    .catch(() => {});
}

/**
 * Update lastActivity on a session.
 */
export function touchSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.lastActivity = Date.now();
}

/**
 * Merge updates into a session's meta object.
 * Capped to prevent unbounded growth from buggy extensions.
 */
export function updateSessionMeta(sessionId, metaUpdates) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (!metaUpdates || typeof metaUpdates !== "object") return false;
  // Cap: reject if serialized meta would exceed 64KB
  const merged = { ...session.meta, ...metaUpdates };
  try {
    if (JSON.stringify(merged).length > 65536) {
      log.warn(
        "Session",
        `Session meta update rejected: would exceed 64KB for ${sessionId.slice(0, 8)}`,
      );
      return false;
    }
  } catch {
    return false;
  }
  session.meta = merged;
  session.lastActivity = Date.now();
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// NAVIGATION GATING
// ─────────────────────────────────────────────────────────────────────────

export function canNavigate(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== "active") return false;
  const isNav = activeNavigator.get(session.beingId) === sessionId;
  if (isNav) session.lastActivity = Date.now();
  return isNav;
}

export function isActiveNavigator(beingId, sessionId) {
  return activeNavigator.get(String(beingId)) === sessionId;
}

// ─────────────────────────────────────────────────────────────────────────
// NAVIGATOR CONTROL
// ─────────────────────────────────────────────────────────────────────────

export function setActiveNavigator(beingId, sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.beingId !== String(beingId)) return false;
  activeNavigator.set(String(beingId), sessionId);
  return true;
}

export function getActiveNavigator(beingId) {
  return activeNavigator.get(String(beingId)) || null;
}

export function clearActiveNavigator(beingId) {
  activeNavigator.delete(String(beingId));
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY
// ─────────────────────────────────────────────────────────────────────────

export function getSessionsForBeing(beingId) {
  const uid = String(beingId);
  const beingSet = beingSessionIndex.get(uid);
  if (!beingSet) return [];
  const result = [];
  for (const sid of beingSet) {
    const s = sessions.get(sid);
    if (s) result.push({ ...s });
  }
  return result;
}

export function getSession(sessionId) {
  const s = sessions.get(sessionId);
  return s ? { ...s } : null;
}

export function registeredSessionCount() {
  return sessions.size;
}

// ─────────────────────────────────────────────────────────────────────────
// ABORT CONTROL
// ─────────────────────────────────────────────────────────────────────────

export function setSessionAbort(sessionId, abortController) {
  // Only store abort controllers for sessions that exist.
  // Orphan sweep catches stragglers, but this prevents the common case.
  if (!sessionId || !sessions.has(sessionId)) return;
  sessionAbortControllers.set(sessionId, abortController);
}

export function abortSession(sessionId) {
  const ac = sessionAbortControllers.get(sessionId);
  if (ac) {
    try {
      ac.abort();
    } catch {}
    sessionAbortControllers.delete(sessionId);
  }
}

export function clearSessionAbort(sessionId) {
  sessionAbortControllers.delete(sessionId);
}

export function abortSessionsByScope(scopeKey) {
  const scoped = scopedSessions.get(scopeKey);
  if (!scoped) return 0;

  const sessionId = scoped.sessionId;
  const session = sessions.get(sessionId);
  if (!session) {
    scopedSessions.delete(scopeKey);
    return 0;
  }

  abortSession(sessionId);
  endSession(sessionId);
  scopedSessions.delete(scopeKey);
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────
// INTERNAL: NAVIGATOR PROMOTION
// ─────────────────────────────────────────────────────────────────────────

// Navigator promotion priority. Resolved at call time since session
// types are registered dynamically by extensions and transport layers.
const PROMOTION_PRIORITY_KEYS = ["WEBSOCKET_CHAT"];

function promoteNavigator(beingId) {
  const beingSet = beingSessionIndex.get(beingId);
  if (!beingSet || beingSet.size === 0) {
    activeNavigator.delete(beingId);
    return;
  }

  const priority = PROMOTION_PRIORITY_KEYS.map((k) => SESSION_TYPES[k]).filter(
    Boolean,
  );
  for (const type of priority) {
    for (const sid of beingSet) {
      const s = sessions.get(sid);
      if (s && s.type === type && s.status === "active") {
        activeNavigator.set(beingId, sid);
        log.debug(
          "Session",
          `Navigator promoted: ${type} [${sid.slice(0, 8)}] for being ${beingId}`,
        );
        return;
      }
    }
  }

  activeNavigator.delete(beingId);
}

// ─────────────────────────────────────────────────────────────────────────
// AUTO-CLEANUP: sweep stale non-websocket sessions every 5 minutes
// ─────────────────────────────────────────────────────────────────────────

let STALE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
export function setStaleTimeout(ms) {
  STALE_TIMEOUT = Math.max(60000, Math.min(ms, 86400000));
}

setInterval(
  () => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      // WebSocket sessions get a longer timeout: they normally clean up on
      // socket disconnect, but crashed clients (power loss, network drop without
      // TCP FIN) can leave orphaned sessions. 2x the normal stale timeout gives
      // generous reconnection headroom while still reclaiming dead sessions.
      const timeout =
        session.type === SESSION_TYPES.WEBSOCKET_CHAT
          ? STALE_TIMEOUT * 2
          : STALE_TIMEOUT;
      if (now - session.lastActivity > timeout) {
        log.debug(
          "Session",
          `Stale session removed: ${session.type} [${sessionId.slice(0, 8)}]`,
        );
        endSession(sessionId);
      }
    }
    // Clean up expired scoped session entries
    for (const [key, val] of scopedSessions) {
      if (now - val.lastActivity > DEFAULT_SCOPE_TTL)
        scopedSessions.delete(key);
    }
    // Clean up orphaned abort controllers (session already ended but controller lingered)
    for (const sid of sessionAbortControllers.keys()) {
      if (!sessions.has(sid)) sessionAbortControllers.delete(sid);
    }
  },
  5 * 60 * 1000,
).unref();

// ─────────────────────────────────────────────────────────────────────────
// PIPELINE KEY RESOLUTION
// ─────────────────────────────────────────────────────────────────────────
//
// What `clientSessionId` IS:
//   - A transport-session identifier. One per tab / CLI / mobile reach.
//     Built at connect time in transports/ws/websocket.js as
//     `${beingId}:${clientKind}:${clientInstance}` and stable for the
//     lifetime of the reach (survives socket reconnect because
//     `clientInstance` is client-stable across refresh; `socket.id`
//     rotates). Used for per-tab enqueue serialization, in-flight chat
//     re-attach, and tracing/logging.
//   - A tracing/logging label. JWTs and MCP tool calls correlate back
//     to the reach that initiated them via this id.
//
// What `clientSessionId` IS NOT:
//   - Conversation identity. The canonical identifier for a conversation
//     between two beings is `Summon.ibpAddress` (the stance pair).
//   - Position state. Lives on `Being.currentSpace`. Two tabs for the
//     same being share position automatically.
//   - Tool-call → summonId correlation. The SUMMON loop injects
//     `summonId` / `rootCorrelation` / `ibpAddress` into MCP tool args
//     directly; mcp/server.js reads them without a Map lookup.
//   - MCP client cache key. Keyed by `ibpAddress` so all the being's
//     sockets share one MCP client.
//   - Per-conversation extension state (ruler/foreman decisions, abort
//     registry, pending plans). Keyed on `rootCorrelation` or
//     `ibpAddress` per each Map's semantics.

/**
 * Resolve the pipeline key for a runChat / OrchestratorRuntime call.
 *
 * A pipeline key identifies a stanceless internal-cognition lane — the
 * conversation-equivalent cache key for work that has no addressee
 * being. Distinct namespace from `clientSessionId` (transport identity)
 * and `ibpAddress` (being-to-being conversation identity).
 *
 * Three paths, in priority order:
 *   1. `pipelineKey` — explicit pass-through (extension joining an upstream caller's pipeline).
 *   2. `scope` + `purpose` — extension declares a named internal lane.
 *      Produces `pipeline:tree:${rootId}:${purpose}[:${extra}]`,
 *      `pipeline:home:${beingId}:${purpose}[:${extra}]`, or
 *      `pipeline:land:${purpose}[:${extra}]`.
 *   3. Neither — fresh `pipeline:ephemeral:${uuid}`. One-shot, no
 *      cross-call memory.
 *
 * Returns `{ key, persist }`. `persist === false` iff the key is
 * ephemeral — callers skip the session-chain cache so the key dies
 * with the call.
 */
export function resolvePipelineKey({
  pipelineKey = null,
  scope = null,
  purpose = null,
  extra = null,
  beingId = null,
  rootId = null,
  makeEphemeral,
}) {
  if (pipelineKey) {
    return {
      key: pipelineKey,
      persist: !pipelineKey.startsWith("pipeline:ephemeral:"),
    };
  }
  if (scope) {
    const suffix = extra
      ? `:${String(extra)
          .slice(0, 64)
          .replace(/[^a-z0-9:._-]/gi, "")}`
      : "";
    if (scope === "tree") {
      if (!rootId || !purpose)
        throw new Error(
          "resolvePipelineKey: scope='tree' requires rootId and purpose",
        );
      return {
        key: `pipeline:tree:${rootId}:${purpose}${suffix}`,
        persist: true,
      };
    }
    if (scope === "home") {
      if (!beingId || !purpose)
        throw new Error(
          "resolvePipelineKey: scope='home' requires beingId and purpose",
        );
      return {
        key: `pipeline:home:${beingId}:${purpose}${suffix}`,
        persist: true,
      };
    }
    if (scope === "land") {
      if (!purpose)
        throw new Error("resolvePipelineKey: scope='land' requires purpose");
      return { key: `pipeline:land:${purpose}${suffix}`, persist: true };
    }
    throw new Error(`resolvePipelineKey: unknown scope "${scope}"`);
  }
  const uuid =
    typeof makeEphemeral === "function" ? makeEphemeral() : cryptoRandomUUID();
  return { key: `pipeline:ephemeral:${uuid}`, persist: false };
}

// Back-compat alias for callers still importing the old name. Slated
// for removal once the codebase has converged on resolvePipelineKey.
export const resolveInternalAiSessionKey = resolvePipelineKey;

function cryptoRandomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return require("node:crypto").randomUUID();
}
