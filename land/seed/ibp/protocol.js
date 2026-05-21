// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * IBP wire protocol: response shapes, error codes, ProtocolError.
 *
 * Every route handler and every IBP verb handler imports from this
 * file. Extensions access it through `core.protocol`.
 *
 * Domain-specific enums (CASCADE statuses, SEED_SPACE, MATTER_ORIGIN,
 * DELETED, I_AM) live with their domain modules — not here.
 *
 * All exported objects are frozen. Extensions cannot modify error codes
 * or response shapes at runtime.
 */

import log from "../system/log.js";

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
  log.error("Protocol", `Unhandled error: ${err.message}`);
  return sendError(res, 500, "INTERNAL", "Something went wrong.");
}

// ============================================================================
// SEMANTIC ERROR CODES
// ============================================================================

export const ERR = Object.freeze({
  // Data
  SPACE_NOT_FOUND:        "SPACE_NOT_FOUND",
  USER_NOT_FOUND:         "USER_NOT_FOUND",
  MATTER_NOT_FOUND:       "MATTER_NOT_FOUND",
  TREE_NOT_FOUND:         "TREE_NOT_FOUND",

  // Auth
  UNAUTHORIZED:           "UNAUTHORIZED",
  FORBIDDEN:              "FORBIDDEN",
  SESSION_EXPIRED:        "SESSION_EXPIRED",

  // Validation
  INVALID_INPUT:          "INVALID_INPUT",
  INVALID_TYPE:           "INVALID_TYPE",
  INVALID_TREE:           "INVALID_TREE",

  // Rate limiting
  RATE_LIMITED:           "RATE_LIMITED",

  // LLM
  LLM_TIMEOUT:            "LLM_TIMEOUT",
  LLM_FAILED:             "LLM_FAILED",
  LLM_NOT_CONFIGURED:     "LLM_NOT_CONFIGURED",

  // Cascade
  CASCADE_DISABLED:       "CASCADE_DISABLED",
  CASCADE_DEPTH_EXCEEDED: "CASCADE_DEPTH_EXCEEDED",
  CASCADE_REJECTED:       "CASCADE_REJECTED",

  // Document size
  DOCUMENT_SIZE_EXCEEDED: "DOCUMENT_SIZE_EXCEEDED",

  // Uploads
  UPLOAD_DISABLED:        "UPLOAD_DISABLED",
  UPLOAD_TOO_LARGE:       "UPLOAD_TOO_LARGE",
  UPLOAD_MIME_REJECTED:   "UPLOAD_MIME_REJECTED",

  // Tree health
  TREE_DORMANT:           "TREE_DORMANT",

  // Extensions
  EXTENSION_NOT_FOUND:    "EXTENSION_NOT_FOUND",
  EXTENSION_BLOCKED:      "EXTENSION_BLOCKED",

  // Hooks
  HOOK_TIMEOUT:           "HOOK_TIMEOUT",
  HOOK_CANCELLED:         "HOOK_CANCELLED",

  // Conflict
  RESOURCE_CONFLICT:      "RESOURCE_CONFLICT",

  // Federation
  PEER_NOT_FOUND:         "PEER_NOT_FOUND",
  PEER_UNREACHABLE:       "PEER_UNREACHABLE",

  // Origin policy
  // Raised when a write-type DO operation targets a matter whose
  // origin's sync mode is read-only. Filesystem-origin matter under
  // `.source` is always read-only: the substrate cannot mutate the
  // seed's own source files through verbs. Other read-mostly origins
  // (web, future bridges) also use this code.
  ORIGIN_READ_ONLY:       "ORIGIN_READ_ONLY",

  // System
  INTERNAL:               "INTERNAL",
  TIMEOUT:                "TIMEOUT",
});
