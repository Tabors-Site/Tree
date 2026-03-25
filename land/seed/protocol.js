/**
 * Protocol: The Communication Primitive
 *
 * One response shape for HTTP. One set of event types for websocket.
 * Semantic error codes that mean something in TreeOS. Cascade statuses
 * as named constants. Every route handler and every websocket emitter
 * imports from this file. Extensions access it through core.protocol.
 *
 * Cascade defined how signals move between nodes.
 * This file defines how the kernel talks to everything outside itself.
 * Same philosophy. Shared language that exists before anyone starts talking.
 */

// 400: INVALID_INPUT, INVALID_STATUS, INVALID_TYPE
// 401: UNAUTHORIZED
// 403: FORBIDDEN, EXTENSION_BLOCKED, SESSION_EXPIRED
// 404: NODE_NOT_FOUND, USER_NOT_FOUND, NOTE_NOT_FOUND, TREE_NOT_FOUND, PEER_NOT_FOUND, EXTENSION_NOT_FOUND, ORCHESTRATOR_NOT_FOUND
// 409: ORCHESTRATOR_LOCKED
// 413: INVALID_INPUT (payload too large)
// 415: INVALID_INPUT (unsupported media type)
// 429: RATE_LIMITED
// 500: INTERNAL, TIMEOUT, HOOK_TIMEOUT, HOOK_CANCELLED
// 502: PEER_UNREACHABLE
// 503: LLM_TIMEOUT, LLM_FAILED, LLM_NOT_CONFIGURED

// ============================================================================
// RESPONSE STATUS
// ============================================================================

export const STATUS = {
  OK: "ok",
  ERROR: "error",
};

// ============================================================================
// RESPONSE CONSTRUCTORS (transport-agnostic JSON shapes)
// ============================================================================

/**
 * Build a success response body.
 * @param {object} data - payload
 * @returns {{ status: "ok", data: object }}
 */
export function ok(data = {}) {
  return { status: STATUS.OK, data };
}

/**
 * Build an error response body.
 * @param {string} code - semantic error code (from ERR)
 * @param {string} message - human-readable message
 * @param {object} [detail] - optional extra context
 * @returns {{ status: "error", error: { code: string, message: string, detail?: object } }}
 */
export function error(code, message, detail) {
  const err = { code, message };
  if (detail !== undefined) err.detail = detail;
  return { status: STATUS.ERROR, error: err };
}

// ============================================================================
// EXPRESS CONVENIENCE (builds shape + sets HTTP status + sends)
// ============================================================================

/**
 * Send a success response.
 * @param {object} res - Express response
 * @param {object} data - payload
 * @param {number} [httpStatus=200]
 */
export function sendOk(res, data = {}, httpStatus = 200) {
  return res.status(httpStatus).json(ok(data));
}

/**
 * Send an error response.
 * @param {object} res - Express response
 * @param {number} httpStatus - HTTP status code (transport layer)
 * @param {string} code - semantic error code (application layer)
 * @param {string} message - human-readable message
 * @param {object} [detail] - optional extra context
 */
export function sendError(res, httpStatus, code, message, detail) {
  return res.status(httpStatus).json(error(code, message, detail));
}

// ============================================================================
// SEMANTIC ERROR CODES
// ============================================================================

export const ERR = {
  // Data
  NODE_NOT_FOUND:         "NODE_NOT_FOUND",
  USER_NOT_FOUND:         "USER_NOT_FOUND",
  NOTE_NOT_FOUND:         "NOTE_NOT_FOUND",
  TREE_NOT_FOUND:         "TREE_NOT_FOUND",

  // Auth
  UNAUTHORIZED:           "UNAUTHORIZED",
  FORBIDDEN:              "FORBIDDEN",
  SESSION_EXPIRED:        "SESSION_EXPIRED",

  // Validation
  INVALID_INPUT:          "INVALID_INPUT",
  INVALID_STATUS:         "INVALID_STATUS",
  INVALID_TYPE:           "INVALID_TYPE",

  // Rate limiting
  RATE_LIMITED:            "RATE_LIMITED",

  // LLM
  LLM_TIMEOUT:            "LLM_TIMEOUT",
  LLM_FAILED:             "LLM_FAILED",
  LLM_NOT_CONFIGURED:     "LLM_NOT_CONFIGURED",

  // Cascade
  CASCADE_DISABLED:        "CASCADE_DISABLED",
  CASCADE_DEPTH_EXCEEDED:  "CASCADE_DEPTH_EXCEEDED",
  CASCADE_REJECTED:        "CASCADE_REJECTED",

  // Extensions
  EXTENSION_NOT_FOUND:     "EXTENSION_NOT_FOUND",
  EXTENSION_BLOCKED:       "EXTENSION_BLOCKED",

  // Hooks
  HOOK_TIMEOUT:            "HOOK_TIMEOUT",
  HOOK_CANCELLED:          "HOOK_CANCELLED",

  // Orchestrator
  ORCHESTRATOR_NOT_FOUND:  "ORCHESTRATOR_NOT_FOUND",
  ORCHESTRATOR_LOCKED:     "ORCHESTRATOR_LOCKED",

  // Federation
  PEER_NOT_FOUND:          "PEER_NOT_FOUND",
  PEER_UNREACHABLE:        "PEER_UNREACHABLE",

  // System
  INTERNAL:                "INTERNAL",
  TIMEOUT:                 "TIMEOUT",
};

// ============================================================================
// WEBSOCKET EVENT TYPES (kernel-emitted only)
// ============================================================================

export const WS = {
  // Conversation lifecycle
  CHAT_RESPONSE:        "chatResponse",
  CHAT_ERROR:           "chatError",
  CHAT_CANCELLED:       "chatCancelled",
  TOOL_RESULT:          "toolResult",
  PLACE_RESULT:         "placeResult",
  MODE_SWITCHED:        "modeSwitched",

  // Tree mutations
  TREE_CHANGED:         "treeChanged",

  // Infrastructure
  REGISTERED:           "registered",
  NAVIGATOR_SESSION:    "navigatorSession",
  AVAILABLE_MODES:      "availableModes",
  CONVERSATION_CLEARED: "conversationCleared",
  NAVIGATE:             "navigate",
  RELOAD:               "reload",
};

// ============================================================================
// CASCADE STATUSES (canonical source, used by seed/tree/cascade.js)
// ============================================================================

export const CASCADE = {
  SUCCEEDED: "succeeded",
  FAILED:    "failed",
  REJECTED:  "rejected",
  QUEUED:    "queued",
  PARTIAL:   "partial",
  AWAITING:  "awaiting",
};
