// IBP (Inter-Being Protocol) errors.
//
// IBP reuses seed's ERR vocabulary wherever the meaning matches and adds
// five portal-specific codes for IBP-layer concerns seed does not cover.
// PORTAL_ERR is the composition of both, so IBP callers have one import
// for every error code they may throw.
//
// Reuse rule: a portal handler should reach for seed's existing codes
// (UNAUTHORIZED, FORBIDDEN, NODE_NOT_FOUND, INVALID_INPUT, RESOURCE_CONFLICT,
// etc.) before considering a portal-specific code. The five additions exist
// only for things seed cannot express:
//
//   ADDRESS_PARSE_ERROR     address string failed to parse
//   EMBODIMENT_UNAVAILABLE  @embodiment qualifier not invocable here
//   VERB_NOT_SUPPORTED      address does not support the requested verb
//   ACTION_NOT_SUPPORTED    DO action unknown or not permitted here
//   INVALID_INTENT          TALK intent not in embodiment's honoredIntents

import { ERR } from "../seed/protocol.js";

const PORTAL_SPECIFIC = Object.freeze({
  ADDRESS_PARSE_ERROR:    "ADDRESS_PARSE_ERROR",
  EMBODIMENT_UNAVAILABLE: "EMBODIMENT_UNAVAILABLE",
  VERB_NOT_SUPPORTED:     "VERB_NOT_SUPPORTED",
  ACTION_NOT_SUPPORTED:   "ACTION_NOT_SUPPORTED",
  INVALID_INTENT:         "INVALID_INTENT",
});

export const PORTAL_ERR = Object.freeze({
  ...ERR,
  ...PORTAL_SPECIFIC,
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
