// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Wire shape. The form every SEE, DO, SUMMON, and BE takes.
//
// IBP is my communication primitive. reality/ is what I AM; factory/
// is how my LLM beings THINK; ibp/ is how any of it speaks to any
// other. Without this folder a being could not SEE a position, DO
// an action, SUMMON another being, or BE in any stance — every
// crossing between substrate and speaker goes through these four
// verbs. This file is the grammar of success and failure they
// share: every reply has the same shape, every error speaks the
// same code set, every wire layer recognizes the same envelope.
//
// What lives here:
//   IbpError              the throwable shape anything inside me raises
//                         when it has something to say on the wire
//   IBP_ERR               the code set the wire knows
//   httpStatusFor(code)   one canonical code → HTTP status mapping
//   ok / error            the two reply shapes
//   sendOk / sendError    Express-side wrappers
//   sendCaughtError       route-level catch helper
//   mapPatternsToIbpError translate seed-internal Errors to wire shape
//
// Verb handlers catch IbpError and translate it to
//   { id, status: "error", error: { code, message, detail? } }
// Anything else thrown becomes INTERNAL. Only IBP codes ever reach
// the client; internal details stay in my logs.
//
// IBP_ERR is the full code set — semantic codes (SPACE_NOT_FOUND,
// UNAUTHORIZED, FORBIDDEN, RESOURCE_CONFLICT, ...) plus wire-specific
// codes I can't express any other way (ADDRESS_PARSE_ERROR,
// ROLE_UNAVAILABLE, VERB_NOT_SUPPORTED, ACTION_NOT_SUPPORTED,
// INVALID_INTENT). Callers reach for an existing code first; the
// wire-specific ones exist only for things the substrate can't
// otherwise name.
//
// HTTP status is not stored on the throw. I derive it from the code
// through `httpStatusFor(code)` — one canonical mapping.
// `sendCaughtError` consults it; explicit `sendError(res, status,
// ...)` callers still pass a status if they want to.
//
// Domain-specific enums (SEED_SPACE, MATTER_ORIGIN, DELETED, I_AM)
// live with their domain modules — not here.

import log from "../seedReality/log.js";

// ============================================================================
// CODE ENUM
// ============================================================================

export const IBP_ERR = Object.freeze({
  // Data
  SPACE_NOT_FOUND: "SPACE_NOT_FOUND",
  BEING_NOT_FOUND: "BEING_NOT_FOUND",
  MATTER_NOT_FOUND: "MATTER_NOT_FOUND",

  // Auth
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  SESSION_EXPIRED: "SESSION_EXPIRED",

  // Validation
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_TYPE: "INVALID_TYPE",
  INVALID_SPACE: "INVALID_SPACE",

  // Rate limiting
  RATE_LIMITED: "RATE_LIMITED",

  // LLM
  LLM_TIMEOUT: "LLM_TIMEOUT",
  LLM_FAILED: "LLM_FAILED",
  LLM_NOT_CONFIGURED: "LLM_NOT_CONFIGURED",

  // Document size
  DOCUMENT_SIZE_EXCEEDED: "DOCUMENT_SIZE_EXCEEDED",

  // Uploads
  UPLOAD_DISABLED: "UPLOAD_DISABLED",
  UPLOAD_TOO_LARGE: "UPLOAD_TOO_LARGE",
  UPLOAD_MIME_REJECTED: "UPLOAD_MIME_REJECTED",

  // Space-tree health
  SPACE_DORMANT: "SPACE_DORMANT",

  // Extensions
  EXTENSION_NOT_FOUND: "EXTENSION_NOT_FOUND",
  EXTENSION_BLOCKED: "EXTENSION_BLOCKED",

  // Hooks
  HOOK_TIMEOUT: "HOOK_TIMEOUT",
  HOOK_CANCELLED: "HOOK_CANCELLED",

  // Conflict
  RESOURCE_CONFLICT: "RESOURCE_CONFLICT",

  // Federation
  PEER_NOT_FOUND: "PEER_NOT_FOUND",
  PEER_UNREACHABLE: "PEER_UNREACHABLE",

  // Origin policy. Raised when a write-type DO operation targets a
  // matter whose origin's sync mode is read-only. Filesystem-origin
  // matter under .source is always read-only; the substrate cannot
  // mutate the seed's own source files through verbs.
  ORIGIN_READ_ONLY: "ORIGIN_READ_ONLY",

  // Historical-read doctrine. SEE accepts an `at: { atSeq?, atTimestamp? }`
  // qualifier that returns the substrate's state as of a past point.
  // Acting in the past is structurally impossible — the verb of
  // change (DO / SUMMON / BE) is not compatible with a frozen view.
  // This code throws when a write verb arrives carrying `at`; the
  // message says what's allowed instead.
  HISTORICAL_READ_ONLY: "HISTORICAL_READ_ONLY",

  // Cross-branch doctrine. Different branches are different worlds —
  // their fact-chains never converge. A bridge or verb dispatch that
  // crosses branches has no shared fold to authorize against. This code
  // throws when an address bridge mixes branches, or when a verb's
  // ambient summonCtx.branch disagrees with the target stance's branch.
  CROSS_BRANCH_FORBIDDEN: "CROSS_BRANCH_FORBIDDEN",

  // Branch is paused. The Branch row carries `paused: true` (set via
  // do.pause-branch on @branch-manager). Every write verb (DO / BE /
  // SUMMON) refuses with this code; SEE still works so the user can
  // inspect or rewind frozen state. unpause-branch lifts the gate.
  REALITY_PAUSED: "REALITY_PAUSED",

  // System
  INTERNAL: "INTERNAL",
  TIMEOUT: "TIMEOUT",

  // Wire-specific. Things the substrate cannot otherwise express.
  ADDRESS_PARSE_ERROR: "ADDRESS_PARSE_ERROR",
  ROLE_UNAVAILABLE: "ROLE_UNAVAILABLE",
  VERB_NOT_SUPPORTED: "VERB_NOT_SUPPORTED",
  ACTION_NOT_SUPPORTED: "ACTION_NOT_SUPPORTED",
  INVALID_INTENT: "INVALID_INTENT",
  NOT_A_BEING: "NOT_A_BEING",
  NOT_A_SEED: "NOT_A_SEED",
});

// ============================================================================
// ERROR CLASS
// ============================================================================

export class IbpError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "IbpError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export function isIbpError(e) {
  return e && e.name === "IbpError" && typeof e.code === "string";
}

/**
 * Translate a seed-internal Error into an IbpError by matching its
 * message against an ordered rule list. Each rule is `[regex, code]`;
 * the first regex that matches wins. Errors that already are IbpErrors
 * pass through unchanged. Otherwise the fallback code is used.
 *
 * Used by DO operation handlers that wrap low-level seed helpers
 * (createSpace, editSpaceName, setQuality, ...) and want clean
 * wire-shape errors instead of opaque internal messages.
 *
 *   throw mapPatternsToIbpError(err, [
 *     [/reality seed spaces|reserved/i, IBP_ERR.FORBIDDEN],
 *     [/not found/i,                 IBP_ERR.SPACE_NOT_FOUND],
 *   ], IBP_ERR.INTERNAL);
 */
export function mapPatternsToIbpError(err, rules, fallback = IBP_ERR.INTERNAL) {
  if (isIbpError(err)) return err;
  const msg = err?.message || "operation failed";
  for (const [pattern, code] of rules) {
    if (pattern.test(msg)) return new IbpError(code, msg);
  }
  return new IbpError(fallback, msg);
}

// ============================================================================
// HTTP STATUS DERIVATION
// ============================================================================
//
// One canonical mapping from semantic code to HTTP status. Throw sites
// don't carry an httpStatus; the wire layer derives it here. The
// classification is the one documented in CLAUDE.md (the table under
// "HTTP → ERR mapping").

const STATUS_FOR_CODE = Object.freeze({
  // 400 Bad request
  INVALID_INPUT: 400,
  INVALID_TYPE: 400,
  INVALID_SPACE: 400,
  ADDRESS_PARSE_ERROR: 400,
  INVALID_INTENT: 400,

  // 401 Unauthorized
  UNAUTHORIZED: 401,

  // 403 Forbidden
  FORBIDDEN: 403,
  EXTENSION_BLOCKED: 403,
  SESSION_EXPIRED: 403,
  UPLOAD_DISABLED: 403,
  ORIGIN_READ_ONLY: 403,
  HISTORICAL_READ_ONLY: 403,
  CROSS_BRANCH_FORBIDDEN: 403,
  REALITY_PAUSED: 403,
  NOT_A_BEING: 403,
  NOT_A_SEED: 403,

  // 404 Not found
  SPACE_NOT_FOUND: 404,
  BEING_NOT_FOUND: 404,
  MATTER_NOT_FOUND: 404,
  PEER_NOT_FOUND: 404,
  EXTENSION_NOT_FOUND: 404,
  ROLE_UNAVAILABLE: 404,
  VERB_NOT_SUPPORTED: 404,
  ACTION_NOT_SUPPORTED: 404,

  // 409 Conflict
  RESOURCE_CONFLICT: 409,

  // 413 Payload too large
  DOCUMENT_SIZE_EXCEEDED: 413,
  UPLOAD_TOO_LARGE: 413,

  // 415 Unsupported media
  UPLOAD_MIME_REJECTED: 415,

  // 429 Rate limited
  RATE_LIMITED: 429,

  // 500 Internal
  INTERNAL: 500,
  TIMEOUT: 500,
  HOOK_TIMEOUT: 500,
  HOOK_CANCELLED: 500,

  // 502 Bad gateway
  PEER_UNREACHABLE: 502,

  // 503 Service unavailable
  LLM_TIMEOUT: 503,
  LLM_FAILED: 503,
  LLM_NOT_CONFIGURED: 503,
  SPACE_DORMANT: 503,
});

/**
 * HTTP status for an IBP code. Returns 500 for unknown codes so the
 * wire layer always has a number.
 */
export function httpStatusFor(code) {
  return STATUS_FOR_CODE[code] || 500;
}

// ============================================================================
// RESPONSE CONSTRUCTORS (transport-agnostic JSON shapes)
// ============================================================================

export function ok(data = {}) {
  return { status: "ok", data };
}

export function error(code, message, detail) {
  const err = {
    code: code || IBP_ERR.INTERNAL,
    message: message || "An error occurred",
  };
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
 * Never leaks internal details. Only IbpError messages reach the client.
 */
export function sendError(res, httpStatus, code, message, detail) {
  if (res.headersSent) {
    log.warn(
      "Protocol",
      `sendError(${code}) called after headers sent. Skipped.`,
    );
    return;
  }
  return res.status(httpStatus).json(error(code, message, detail));
}

/**
 * Route-level catch helper. If the error is an IbpError, sends the
 * proper response (HTTP status derived from code). Otherwise sends
 * 500 INTERNAL with a safe generic message. Internal error details
 * are logged, never sent to the client.
 */
export function sendCaughtError(res, err) {
  if (isIbpError(err)) {
    return sendError(
      res,
      httpStatusFor(err.code),
      err.code,
      err.message,
      err.detail,
    );
  }
  log.error("Protocol", `Unhandled error: ${err.message}`);
  return sendError(res, 500, IBP_ERR.INTERNAL, "Something went wrong.");
}
