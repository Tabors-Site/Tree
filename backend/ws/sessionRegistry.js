// ws/sessionRegistry.js
// Tracks all active sessions per user and gates iframe navigation so only
// the designated "active navigator" session can redirect the user's view.
// All session creation should go through createSession().

import { v4 as uuidv4 } from "uuid";

// ─────────────────────────────────────────────────────────────────────────
// SESSION TYPES
// ─────────────────────────────────────────────────────────────────────────

export const SESSION_TYPES = {
  WEBSOCKET_CHAT: "websocket-chat",
  API_TREE_CHAT: "api-tree-chat",
  API_TREE_PLACE: "api-tree-place",
  API_TREE_QUERY: "api-tree-query",
  RAW_IDEA_ORCHESTRATE: "raw-idea-orchestrate",
  RAW_IDEA_CHAT: "raw-idea-chat",
  UNDERSTANDING_ORCHESTRATE: "understanding-orchestrate",
  SCHEDULED_RAW_IDEA: "scheduled-raw-idea",
  SHORT_TERM_DRAIN: "short-term-drain",
  CLEANUP_REORGANIZE: "cleanup-reorganize",
  CLEANUP_EXPAND: "cleanup-expand",
  DREAM_NOTIFY: "dream-notify",
};

// ─────────────────────────────────────────────────────────────────────────
// DATA STRUCTURES
// ─────────────────────────────────────────────────────────────────────────

// sessionId → { sessionId, userId, type, createdAt, lastActivity, status, description, meta }
const sessions = new Map();

// userId → Set<sessionId>
const userSessionIndex = new Map();

// userId → sessionId  (which session controls the iframe)
const activeNavigator = new Map();

// Change listeners — dashboard subscribes to get notified of session changes
const changeListeners = new Set();

// sessionId → AbortController  (allows killing in-flight work)
const sessionAbortControllers = new Map();

// scopeKey → { sessionId, lastActivity }  (for idle-TTL reuse of scoped sessions)
const scopedSessions = new Map();
const DEFAULT_SCOPE_TTL = 15 * 60 * 1000; // 15 minutes

// ─────────────────────────────────────────────────────────────────────────
// SESSION CREATION — single entry point for all session creation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create or retrieve a session. This is the preferred way to get a sessionId.
 *
 * @param {object}  opts
 * @param {string}  opts.userId      - required
 * @param {string}  opts.type        - SESSION_TYPES value
 * @param {string}  [opts.scopeKey]  - for idle-TTL reuse (e.g. "userId:rootId")
 * @param {string}  [opts.description]
 * @param {object}  [opts.meta]
 * @param {number}  [opts.idleTTL]   - ms before a scoped session expires (default 15 min)
 * @returns {{ sessionId: string, reused: boolean, isActiveNavigator: boolean }}
 */
export function createSession({ userId, type, scopeKey, description = "", meta = {}, idleTTL = DEFAULT_SCOPE_TTL }) {
  const now = Date.now();

  // If scopeKey provided, try to reuse an existing scoped session
  if (scopeKey) {
    const existing = scopedSessions.get(scopeKey);
    if (existing && now - existing.lastActivity < idleTTL) {
      existing.lastActivity = now;
      // Re-register to update meta/description and touch lastActivity
      const { isActiveNavigator } = registerSession({ sessionId: existing.sessionId, userId, type, description, meta });
      return { sessionId: existing.sessionId, reused: true, isActiveNavigator };
    }
  }

  // Create a new session
  const sessionId = uuidv4();
  const { isActiveNavigator } = registerSession({ sessionId, userId, type, description, meta });

  // Store in scoped map if scopeKey provided
  if (scopeKey) {
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
 * @returns {{ sessionId: string, isActiveNavigator: boolean }}
 */
export function registerSession({ sessionId, userId, type, description = "", meta = {} }) {
  const now = Date.now();
  const uid = String(userId);

  const existing = sessions.get(sessionId);
  if (existing) {
    // Idempotent re-registration — just touch and update meta
    existing.lastActivity = now;
    existing.description = description || existing.description;
    existing.meta = { ...existing.meta, ...meta };
    const isNav = activeNavigator.get(uid) === sessionId;
    for (const cb of changeListeners) cb(uid);
    return { sessionId, isActiveNavigator: isNav };
  }

  sessions.set(sessionId, {
    sessionId,
    userId: uid,
    type,
    createdAt: now,
    lastActivity: now,
    status: "active",
    description,
    meta,
  });

  if (!userSessionIndex.has(uid)) {
    userSessionIndex.set(uid, new Set());
  }
  userSessionIndex.get(uid).add(sessionId);

  // Only claim navigator if no one else has it yet.
  // websocket-chat claims by default, but never steals from another type.
  const currentNav = activeNavigator.get(uid);
  const currentNavSession = currentNav ? sessions.get(currentNav) : null;

  if (!currentNav || !currentNavSession) {
    // No navigator — claim it
    activeNavigator.set(uid, sessionId);
  } else if (
    type === SESSION_TYPES.WEBSOCKET_CHAT &&
    currentNavSession.type === SESSION_TYPES.WEBSOCKET_CHAT
  ) {
    // Replacing an old websocket-chat session (rotation) — fine
    activeNavigator.set(uid, sessionId);
  }

  const isNav = activeNavigator.get(uid) === sessionId;
  console.log(
    `📋 Session registered: ${type} [${sessionId.slice(0, 8)}] for user ${uid} (navigator: ${isNav})`,
  );

  for (const cb of changeListeners) cb(uid);
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
    ac.abort();
    sessionAbortControllers.delete(sessionId);
  }

  const uid = session.userId;
  sessions.delete(sessionId);

  const userSet = userSessionIndex.get(uid);
  if (userSet) {
    userSet.delete(sessionId);
    if (userSet.size === 0) userSessionIndex.delete(uid);
  }

  // If this was the active navigator, promote a replacement
  if (activeNavigator.get(uid) === sessionId) {
    promoteNavigator(uid);
  }

  for (const cb of changeListeners) cb(uid);
}

/**
 * Remove all sessions for a user (e.g. on disconnect).
 */
export function clearUserSessions(userId) {
  const uid = String(userId);
  const userSet = userSessionIndex.get(uid);
  if (!userSet) return;

  for (const sid of userSet) {
    sessions.delete(sid);
  }
  userSessionIndex.delete(uid);
  activeNavigator.delete(uid);

  for (const cb of changeListeners) cb(uid);
}

/**
 * Update lastActivity on a session.
 */
export function touchSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.lastActivity = Date.now();
}

/**
 * Merge updates into a session's meta object and notify listeners.
 */
export function updateSessionMeta(sessionId, metaUpdates) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.meta = { ...session.meta, ...metaUpdates };
  session.lastActivity = Date.now();
  for (const cb of changeListeners) cb(session.userId);
  return true;
}

/**
 * Subscribe to session changes. Callback receives (userId).
 * Returns an unsubscribe function.
 */
export function onSessionChange(callback) {
  changeListeners.add(callback);
  return () => changeListeners.delete(callback);
}

// ─────────────────────────────────────────────────────────────────────────
// NAVIGATION GATING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if a session is allowed to navigate. Returns true only if:
 * 1. The session exists and is active
 * 2. The session is the active navigator for its user
 * Also updates lastActivity.
 */
export function canNavigate(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== "active") return false;

  const isNav = activeNavigator.get(session.userId) === sessionId;
  if (isNav) session.lastActivity = Date.now();
  return isNav;
}

/**
 * Check if a given session is the active navigator for a user.
 */
export function isActiveNavigator(userId, sessionId) {
  return activeNavigator.get(String(userId)) === sessionId;
}

// ─────────────────────────────────────────────────────────────────────────
// NAVIGATOR CONTROL
// ─────────────────────────────────────────────────────────────────────────

/**
 * Manually set which session controls navigation for a user.
 * @returns {boolean} true if set successfully
 */
export function setActiveNavigator(userId, sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== String(userId)) return false;
  activeNavigator.set(String(userId), sessionId);
  for (const cb of changeListeners) cb(String(userId));
  return true;
}

/**
 * Get the current active navigator sessionId for a user.
 */
export function getActiveNavigator(userId) {
  return activeNavigator.get(String(userId)) || null;
}

/**
 * Clear the active navigator for a user (no session controls iframe).
 */
export function clearActiveNavigator(userId) {
  activeNavigator.delete(String(userId));
  for (const cb of changeListeners) cb(String(userId));
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY (for future frontend UI)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get all sessions for a user.
 */
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

/**
 * Get a single session by ID.
 */
export function getSession(sessionId) {
  const s = sessions.get(sessionId);
  return s ? { ...s } : null;
}

/**
 * Total registered session count (for logStats).
 */
export function registeredSessionCount() {
  return sessions.size;
}

// ─────────────────────────────────────────────────────────────────────────
// ABORT CONTROL — lets callers register an AbortController per session
// ─────────────────────────────────────────────────────────────────────────

/**
 * Register an AbortController for a session so it can be killed externally.
 */
export function setSessionAbort(sessionId, abortController) {
  sessionAbortControllers.set(sessionId, abortController);
}

/**
 * Abort and remove the controller for a session.
 */
export function abortSession(sessionId) {
  const ac = sessionAbortControllers.get(sessionId);
  if (ac) {
    ac.abort();
    sessionAbortControllers.delete(sessionId);
  }
}

/**
 * Clean up abort controller (called when session ends normally).
 */
export function clearSessionAbort(sessionId) {
  sessionAbortControllers.delete(sessionId);
}

// ─────────────────────────────────────────────────────────────────────────
// INTERNAL: NAVIGATOR PROMOTION
// ─────────────────────────────────────────────────────────────────────────

const PROMOTION_PRIORITY = [
  SESSION_TYPES.WEBSOCKET_CHAT,
  SESSION_TYPES.RAW_IDEA_CHAT,
  SESSION_TYPES.API_TREE_CHAT,
];

function promoteNavigator(userId) {
  const userSet = userSessionIndex.get(userId);
  if (!userSet || userSet.size === 0) {
    activeNavigator.delete(userId);
    return;
  }

  for (const type of PROMOTION_PRIORITY) {
    for (const sid of userSet) {
      const s = sessions.get(sid);
      if (s && s.type === type && s.status === "active") {
        activeNavigator.set(userId, sid);
        console.log(`📋 Navigator promoted: ${type} [${sid.slice(0, 8)}] for user ${userId}`);
        return;
      }
    }
  }

  // No priority match — clear navigator
  activeNavigator.delete(userId);
}

// ─────────────────────────────────────────────────────────────────────────
// AUTO-CLEANUP: sweep stale non-websocket sessions every 5 minutes
// ─────────────────────────────────────────────────────────────────────────

const STALE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    // websocket-chat sessions are cleaned up by socket disconnect, not stale sweep
    if (session.type === SESSION_TYPES.WEBSOCKET_CHAT) continue;
    if (now - session.lastActivity > STALE_TIMEOUT) {
      console.log(`🧹 Stale session removed: ${session.type} [${sessionId.slice(0, 8)}]`);
      endSession(sessionId);
    }
  }
  // Clean up expired scoped session entries
  for (const [key, val] of scopedSessions) {
    if (now - val.lastActivity > DEFAULT_SCOPE_TTL) scopedSessions.delete(key);
  }
}, 5 * 60 * 1000);
