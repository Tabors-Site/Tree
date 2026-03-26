// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
import { hooks } from "../hooks.js";
// ws/sessionRegistry.js
// Tracks all active sessions per user and gates iframe navigation so only
// the designated "active navigator" session can redirect the user's view.
// All session creation should go through createSession().

import { v4 as uuidv4 } from "uuid";

// ─────────────────────────────────────────────────────────────────────────
// SESSION TYPES
// ─────────────────────────────────────────────────────────────────────────

// Session type registry. The kernel defines no types. Extensions and
// transport layers register their own during init or boot.
export const SESSION_TYPES = {};

/**
 * Register a session type. Called by extensions (via manifest sessionTypes)
 * and by the transport layer (websocket.js, orchestrate routes).
 * Duplicate keys are rejected to prevent silent overwrites.
 */
export function registerSessionType(key, value) {
  if (typeof key !== "string" || typeof value !== "string") {
    log.warn("Session", `Invalid session type registration: key and value must be strings`);
    return false;
  }
  if (SESSION_TYPES[key] && SESSION_TYPES[key] !== value) {
    log.warn("Session", `Session type "${key}" already registered as "${SESSION_TYPES[key]}". Cannot overwrite with "${value}".`);
    return false;
  }
  SESSION_TYPES[key] = value;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// DATA STRUCTURES
// ─────────────────────────────────────────────────────────────────────────

// sessionId -> { sessionId, userId, type, createdAt, lastActivity, status, description, meta }
const sessions = new Map();

// userId -> Set<sessionId>
const userSessionIndex = new Map();

// userId -> sessionId  (which session controls the iframe)
const activeNavigator = new Map();

// sessionId -> AbortController  (allows killing in-flight work)
const sessionAbortControllers = new Map();

// scopeKey -> { sessionId, lastActivity }  (for idle-TTL reuse of scoped sessions)
const scopedSessions = new Map();
const MAX_SCOPED_SESSIONS = 20000;
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
export function createSession({ userId, type, scopeKey, description = "", meta = {}, idleTTL = DEFAULT_SCOPE_TTL }) {
  if (!userId) throw new Error("createSession requires userId");
  if (!type || typeof type !== "string") throw new Error("createSession requires a valid type string");

  const now = Date.now();

  // Land-level session cap with oldest-first eviction
  if (sessions.size >= MAX_SESSIONS) {
    let oldestKey = null, oldestTime = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastActivity < oldestTime) { oldestTime = s.lastActivity; oldestKey = id; }
    }
    if (oldestKey) endSession(oldestKey);
  }

  // If scopeKey provided, try to reuse an existing scoped session
  if (scopeKey) {
    const existing = scopedSessions.get(scopeKey);
    if (existing && now - existing.lastActivity < idleTTL) {
      existing.lastActivity = now;
      const { isActiveNavigator } = registerSession({ sessionId: existing.sessionId, userId, type, description, meta });
      return { sessionId: existing.sessionId, reused: true, isActiveNavigator };
    }
  }

  // Create a new session
  const sessionId = uuidv4();
  const { isActiveNavigator } = registerSession({ sessionId, userId, type, description, meta });

  // Store in scoped map if scopeKey provided (with cap)
  if (scopeKey) {
    if (scopedSessions.size >= MAX_SCOPED_SESSIONS) {
      // Evict oldest scoped entry
      let oldestKey = null, oldestTime = Infinity;
      for (const [k, v] of scopedSessions) {
        if (v.lastActivity < oldestTime) { oldestTime = v.lastActivity; oldestKey = k; }
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

export function registerSession({ sessionId, userId, type, description = "", meta = {} }) {
  const now = Date.now();
  const uid = String(userId);
  // Cap description to prevent oversized session objects
  const safeDesc = typeof description === "string" ? description.slice(0, MAX_DESCRIPTION_LENGTH) : "";

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
    userId: uid,
    type,
    createdAt: now,
    lastActivity: now,
    status: "active",
    description: safeDesc,
    meta,
  });

  if (!userSessionIndex.has(uid)) {
    userSessionIndex.set(uid, new Set());
  }
  userSessionIndex.get(uid).add(sessionId);

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
  log.debug("Session", `Session registered: ${type} [${sessionId.slice(0, 8)}] for user ${uid} (navigator: ${isNav})`);

  hooks.run("afterSessionCreate", { sessionId, userId: uid, type, description, meta, isActiveNavigator: isNav }).catch(() => {});
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
    try { ac.abort(); } catch {}
    sessionAbortControllers.delete(sessionId);
  }

  const uid = session.userId;
  sessions.delete(sessionId);

  const userSet = userSessionIndex.get(uid);
  if (userSet) {
    userSet.delete(sessionId);
    if (userSet.size === 0) userSessionIndex.delete(uid);
  }

  if (activeNavigator.get(uid) === sessionId) {
    promoteNavigator(uid);
  }

  hooks.run("afterSessionEnd", { sessionId, userId: uid, type: session.type }).catch(() => {});
}

/**
 * Remove all sessions for a user (e.g. on disconnect).
 * Fires afterSessionEnd for each session so extensions can clean up.
 */
export function clearUserSessions(userId) {
  const uid = String(userId);
  const userSet = userSessionIndex.get(uid);
  if (!userSet) return;

  for (const sid of userSet) {
    const session = sessions.get(sid);
    // Clean up abort controllers
    const ac = sessionAbortControllers.get(sid);
    if (ac) {
      try { ac.abort(); } catch {}
      sessionAbortControllers.delete(sid);
    }
    sessions.delete(sid);
    // Fire hook so extensions know the session ended
    if (session) {
      hooks.run("afterSessionEnd", { sessionId: sid, userId: uid, type: session.type }).catch(() => {});
    }
  }
  userSessionIndex.delete(uid);
  activeNavigator.delete(uid);

  // Clean up scoped sessions pointing to this user's sessions
  for (const [key, val] of scopedSessions) {
    if (!sessions.has(val.sessionId)) scopedSessions.delete(key);
  }
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
      log.warn("Session", `Session meta update rejected: would exceed 64KB for ${sessionId.slice(0, 8)}`);
      return false;
    }
  } catch { return false; }
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
  const isNav = activeNavigator.get(session.userId) === sessionId;
  if (isNav) session.lastActivity = Date.now();
  return isNav;
}

export function isActiveNavigator(userId, sessionId) {
  return activeNavigator.get(String(userId)) === sessionId;
}

// ─────────────────────────────────────────────────────────────────────────
// NAVIGATOR CONTROL
// ─────────────────────────────────────────────────────────────────────────

export function setActiveNavigator(userId, sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== String(userId)) return false;
  activeNavigator.set(String(userId), sessionId);
  return true;
}

export function getActiveNavigator(userId) {
  return activeNavigator.get(String(userId)) || null;
}

export function clearActiveNavigator(userId) {
  activeNavigator.delete(String(userId));
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY
// ─────────────────────────────────────────────────────────────────────────

export function getSessionsForUser(userId) {
  const uid = String(userId);
  const userSet = userSessionIndex.get(uid);
  if (!userSet) return [];
  const result = [];
  for (const sid of userSet) {
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
  if (!sessions.has(sessionId) && !sessionId) return;
  sessionAbortControllers.set(sessionId, abortController);
}

export function abortSession(sessionId) {
  const ac = sessionAbortControllers.get(sessionId);
  if (ac) {
    try { ac.abort(); } catch {}
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
const PROMOTION_PRIORITY_KEYS = ["WEBSOCKET_CHAT", "API_TREE_CHAT"];

/**
 * Register additional session types for navigator promotion priority.
 * Extensions call this to make their interactive session types eligible.
 */
export function registerPromotionPriority(key) {
  if (!PROMOTION_PRIORITY_KEYS.includes(key)) {
    PROMOTION_PRIORITY_KEYS.push(key);
  }
}

function promoteNavigator(userId) {
  const userSet = userSessionIndex.get(userId);
  if (!userSet || userSet.size === 0) {
    activeNavigator.delete(userId);
    return;
  }

  const priority = PROMOTION_PRIORITY_KEYS.map(k => SESSION_TYPES[k]).filter(Boolean);
  for (const type of priority) {
    for (const sid of userSet) {
      const s = sessions.get(sid);
      if (s && s.type === type && s.status === "active") {
        activeNavigator.set(userId, sid);
        log.debug("Session", `Navigator promoted: ${type} [${sid.slice(0, 8)}] for user ${userId}`);
        return;
      }
    }
  }

  activeNavigator.delete(userId);
}

// ─────────────────────────────────────────────────────────────────────────
// AUTO-CLEANUP: sweep stale non-websocket sessions every 5 minutes
// ─────────────────────────────────────────────────────────────────────────

let STALE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
export function setStaleTimeout(ms) {
  STALE_TIMEOUT = Math.max(60000, Math.min(ms, 86400000));
}

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    // Skip websocket sessions (they have their own lifecycle via socket disconnect)
    if (session.type === SESSION_TYPES.WEBSOCKET_CHAT) continue;
    if (now - session.lastActivity > STALE_TIMEOUT) {
      log.debug("Session", `Stale session removed: ${session.type} [${sessionId.slice(0, 8)}]`);
      endSession(sessionId);
    }
  }
  // Clean up expired scoped session entries
  for (const [key, val] of scopedSessions) {
    if (now - val.lastActivity > DEFAULT_SCOPE_TTL) scopedSessions.delete(key);
  }
  // Clean up orphaned abort controllers (session already ended but controller lingered)
  for (const sid of sessionAbortControllers.keys()) {
    if (!sessions.has(sid)) sessionAbortControllers.delete(sid);
  }
}, 5 * 60 * 1000).unref();
