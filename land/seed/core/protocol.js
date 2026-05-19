// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
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
  ARTIFACT_NOT_FOUND:     "ARTIFACT_NOT_FOUND",
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

  // Origin policy
  // Raised when a write-type DO operation targets an artifact whose
  // origin's sync mode is read-only. Filesystem-origin artifacts under
  // `.source` are always read-only: the substrate cannot mutate the
  // seed's own source files through verbs. Other read-mostly origins
  // (web, future bridges) also use this code.
  ORIGIN_READ_ONLY:        "ORIGIN_READ_ONLY",

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
  TOOL_CALLED:          "toolCalled",
  TOOL_RESULT:          "toolResult",
  THINKING:             "thinking",
  PLACE_RESULT:         "placeResult",
  MODE_SWITCHED:        "modeSwitched",
  EXECUTION_STATUS:     "executionStatus",
  ORCHESTRATOR_STEP:    "orchestratorStep",
  BRANCH_STARTED:       "branchStarted",
  BRANCH_COMPLETED:     "branchCompleted",
  // Emitted when a sub-role (Planner, Contractor, Foreman) spawned
  // as a chainstep child of a Ruler turn finishes. Carries the
  // sub-role's exit text so the chat UI can render it as an inline
  // sub-bubble between the user's message and the Ruler's final
  // synthesis — exposing the internal dialogue between Ruler and
  // its hired roles. Payload: { role, modeKey, exitText, parentSummonId, source }.
  CHAINSTEP_COMPLETED:  "chainstepCompleted",
  // Lifecycle activity signal — fired when a fire-and-forget spawn
  // begins at a Ruler scope (planner/contractor/dispatch/etc.) and
  // again when the lifecycle reaches a terminal state. The chat
  // panel renders this as a persistent "Ruler active — phase: X"
  // header chip that stays visible across hook-wakeup turns. Without
  // this signal, the chat panel's per-message typing indicator goes
  // silent between turns even though work continues in the background,
  // making the conversation appear "stuck" when it's actually
  // progressing. Payload: { rulerNodeId, rootId, phase, spawnId,
  // active: true|false, terminalStatus?: "completed"|"failed"|... }.
  LIFECYCLE_ACTIVE:     "lifecycleActive",
  SWARM_DISPATCH:       "swarmDispatch",
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

// Node status retired 2026-05-18. The kernel doesn't claim a universal
// state machine; status is domain-specific and lives in extension
// metadata. Extensions that want lifecycle states register their own
// `<ext>:set-<field>` ops and read their own metadata namespace.

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
  // Registry-mirror system nodes. Each runtime registry (tool defs,
  // role specs, DO operations) syncs its contents into a child Node
  // here so SEE on `<land>/.tools` (etc.) returns the current
  // registry through the standard descriptor pipeline — no resolver
  // framework. See [[project_meta_positions]]. Orchestrators are NOT
  // in this list: the orchestrator concept retired with the
  // state-based-LLM era ([[project_tree_orchestrator_deleted]]).
  TOOLS:      "tools",
  ROLES:      "roles",
  OPERATIONS: "operations",
  // The .source self-tree. Seed walks its own land/ directory at boot
  // and plants a recursive filesystem-origin artifact tree under this
  // node, mirroring the codebase as substrate. Read-only: DO writes on
  // .source artifacts reject with ORIGIN_READ_ONLY. Public by default
  // including cross-land SEE (`peer-land.com/.source/...`).
  SOURCE:     "source",
});

// ============================================================================
// ARTIFACT ORIGINS
// ============================================================================
//
// What system the artifact's underlying representation comes from.
// Origin determines how the artifact is fetched, stored, kept in sync,
// addressed, and transferred. The content field's shape varies by origin:
//
//   IBP        : TreeOS native. content is a string (text) or null
//                (metadata-only object). Always in sync; TreeOS owns it.
//   FILESYSTEM : Bridges to a file on disk. content is { path, size,
//                mimeType }. Bytes live outside TreeOS.
//   WEB        : Bridges to a URL. content is { url, fetchedAt?, cache? }.
//                Live content lives at the URL.
//   CROSS_LAND : Bridges to an artifact on another TreeOS land.
//                content is { land, artifactRef }.
//
// Future kinds (git, database, stream, service) plug in as new bridging
// patterns without altering the schema shape.

export const ARTIFACT_ORIGIN = Object.freeze({
  IBP:        "ibp",
  FILESYSTEM: "filesystem",
  WEB:        "web",
  CROSS_LAND: "cross-land",
});

// ============================================================================
// SENTINEL VALUES
// ============================================================================

export const DELETED = "deleted";
export const SYSTEM_OWNER = "SYSTEM";
