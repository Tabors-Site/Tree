// Portal Protocol errors.
//
// Native error codes for Portal Address operations. These are returned in
// `{ ok: false, error: { code, message } }` ack responses to portal:* WS ops
// AND from the bootstrap HTTP route on failures.
//
// Codes are namespaced PA_* so they don't collide with the legacy `ERR.*`
// codes in seed/protocol.js. The Portal Protocol does NOT reuse legacy HTTP
// error shapes — it has its own.

export const PORTAL_ERR = Object.freeze({
  PA_PARSE: "PA_PARSE",                    // address string failed to parse
  PA_UNAUTHORIZED: "PA_UNAUTHORIZED",      // socket has no userId
  PA_FORBIDDEN: "PA_FORBIDDEN",            // identity not allowed at this stance
  PA_NOT_FOUND: "PA_NOT_FOUND",            // land/path doesn't exist
  PA_EMBODIMENT_UNAVAILABLE: "PA_EMBODIMENT_UNAVAILABLE", // embodiment not invocable
  PA_INTERNAL: "PA_INTERNAL",              // unexpected server error
  PA_UNSUPPORTED: "PA_UNSUPPORTED",        // op recognized but not implemented yet
});

export class PortalError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "PortalError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export function isPortalError(e) {
  return e && e.name === "PortalError" && typeof e.code === "string";
}
