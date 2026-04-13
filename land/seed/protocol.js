// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Protocol: The Communication Primitive
 *
 * One response shape for HTTP. One set of event types for WebSocket.
 * Semantic error codes. Cascade statuses. Node statuses. System roles.
 * Every route handler and every WebSocket emitter imports from this file.
 * Extensions access it through core.protocol.
 *
 * All exported objects are frozen. Extensions cannot modify error codes,
 * event types, or status values at runtime.
 */

import log from "./log.js";

// ============================================================================
// RESPONSE CONSTRUCTORS (transport-agnostic JSON shapes)
// ============================================================================

export function ok(data = {}) {
  return { status: "ok", data };
}

export function error(code, message, detail) {
  const err = { code: code || "INTERNAL", message: message || "An error occurred" };
  if (detail !== undefined && detail !== null) err.detail = detail;
  return { status: "error", error: err };
}

// ============================================================================
// EXPRESS CONVENIENCE (builds shape + sets HTTP status + sends)
// ============================================================================

/**
 * Send a success response. Guards against double-send.
 */
export function sendOk(res, data = {}, httpStatus = 200) {
  if (res.headersSent) {
    log.warn("Protocol", "sendOk called after headers sent. Skipped.");
    return;
  }
  return res.status(httpStatus).json(ok(data));
}

/**
 * Send an error response. Guards against double-send.
 * Never leaks internal details. Only ProtocolError messages reach the client.
 */
export function sendError(res, httpStatus, code, message, detail) {
  if (res.headersSent) {
    log.warn("Protocol", `sendError(${code}) called after headers sent. Skipped.`);
    return;
  }
  return res.status(httpStatus).json(error(code, message, detail));
}

// ============================================================================
// PROTOCOL ERROR (throwable Error with ERR code + HTTP status)
// ============================================================================

export class ProtocolError extends Error {
  constructor(httpStatus, code, message) {
    super(message);
    this.name = "ProtocolError";
    this.httpStatus = httpStatus;
    this.errCode = code;
  }
}

/**
 * Route-level catch helper. If the error is a ProtocolError, sends the
 * proper response. Otherwise sends 500 INTERNAL with a safe generic message.
 * Internal error details are logged, never sent to the client.
 */
export function sendCaughtError(res, err) {
  if (err instanceof ProtocolError) {
    return sendError(res, err.httpStatus, err.errCode, err.message);
  }
  // Log the real error for operators. Send a safe message to the client.
  log.error("Protocol", `Unhandled error: ${err.message}`);
  return sendError(res, 500, "INTERNAL", "Something went wrong.");
}

// ============================================================================
// SEMANTIC ERROR CODES
// ============================================================================

export const ERR = Object.freeze({
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
  INVALID_TREE:           "INVALID_TREE",

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

  // Document size
  DOCUMENT_SIZE_EXCEEDED:  "DOCUMENT_SIZE_EXCEEDED",

  // Uploads
  UPLOAD_DISABLED:          "UPLOAD_DISABLED",
  UPLOAD_TOO_LARGE:         "UPLOAD_TOO_LARGE",
  UPLOAD_MIME_REJECTED:     "UPLOAD_MIME_REJECTED",

  // Tree health
  TREE_DORMANT:             "TREE_DORMANT",

  // Extensions
  EXTENSION_NOT_FOUND:     "EXTENSION_NOT_FOUND",
  EXTENSION_BLOCKED:       "EXTENSION_BLOCKED",

  // Hooks
  HOOK_TIMEOUT:            "HOOK_TIMEOUT",
  HOOK_CANCELLED:          "HOOK_CANCELLED",

  // Orchestrator
  ORCHESTRATOR_NOT_FOUND:  "ORCHESTRATOR_NOT_FOUND",
  ORCHESTRATOR_LOCKED:     "ORCHESTRATOR_LOCKED",

  // Conflict
  RESOURCE_CONFLICT:       "RESOURCE_CONFLICT",

  // Federation
  PEER_NOT_FOUND:          "PEER_NOT_FOUND",
  PEER_UNREACHABLE:        "PEER_UNREACHABLE",

  // System
  INTERNAL:                "INTERNAL",
  TIMEOUT:                 "TIMEOUT",
});

// ============================================================================
// WEBSOCKET EVENT TYPES (kernel-emitted only)
// ============================================================================

export const WS = Object.freeze({
  CHAT_RESPONSE:        "chatResponse",
  CHAT_ERROR:           "chatError",
  CHAT_CANCELLED:       "chatCancelled",
  TOOL_RESULT:          "toolResult",
  PLACE_RESULT:         "placeResult",
  MODE_SWITCHED:        "modeSwitched",
  TREE_CHANGED:         "treeChanged",
  REGISTERED:           "registered",
  NAVIGATOR_SESSION:    "navigatorSession",
  AVAILABLE_MODES:      "availableModes",
  CONVERSATION_CLEARED: "conversationCleared",
  NAVIGATE:             "navigate",
  RELOAD:               "reload",
});

// ============================================================================
// CASCADE STATUSES
// ============================================================================

export const CASCADE = Object.freeze({
  SUCCEEDED: "succeeded",
  FAILED:    "failed",
  REJECTED:  "rejected",
  QUEUED:    "queued",
  PARTIAL:   "partial",
  AWAITING:  "awaiting",
});

// ============================================================================
// NODE STATUSES
// ============================================================================

export const NODE_STATUS = Object.freeze({
  ACTIVE:    "active",
  COMPLETED: "completed",
  TRIMMED:   "trimmed",
});

// ============================================================================
// SYSTEM ROLES
// ============================================================================

export const SYSTEM_ROLE = Object.freeze({
  LAND_ROOT:  "land-root",
  IDENTITY:   "identity",
  CONFIG:     "config",
  PEERS:      "peers",
  EXTENSIONS: "extensions",
  FLOW:       "flow",
  // The .source self-tree: a live mirror of land/extensions and land/seed
  // ingested at boot. First-class system node so the AI running inside
  // the land can read its own substrate. Owned by code-workspace.
  SOURCE:     "source",
});

// ============================================================================
// CONTENT TYPES
// ============================================================================

export const CONTENT_TYPE = Object.freeze({
  TEXT: "text",
  FILE: "file",
});

// ============================================================================
// SENTINEL VALUES
// ============================================================================

export const DELETED = "deleted";
export const SYSTEM_OWNER = "SYSTEM";
