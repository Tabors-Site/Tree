// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// IBP error class + code namespace.
//
// `IbpError` is the throwable shape that every kernel primitive raises
// when it has something to say on the wire. Verb handlers catch it,
// translate it to the `{ id, status: "error", error: { code, message,
// detail? } }` ack shape, and return. Anything else thrown becomes
// INTERNAL.
//
// `IBP_ERR` is the composition of seed's HTTP-shaped `ERR` codes (from
// protocol.js) and five IBP-specific codes that describe wire-level
// concerns `ERR` does not cover. Callers reach for an existing `ERR`
// code first; the five additions exist only for things the substrate
// cannot express on its own:
//
//   ADDRESS_PARSE_ERROR    address string failed to parse
//   ROLE_UNAVAILABLE       @being qualifier not invocable here
//   VERB_NOT_SUPPORTED     address does not support the requested verb
//   ACTION_NOT_SUPPORTED   DO action unknown or not permitted here
//   INVALID_INTENT         SUMMON intent not in being's honoredIntents

import { ERR } from "./protocol.js";

const IBP_SPECIFIC = Object.freeze({
  ADDRESS_PARSE_ERROR:  "ADDRESS_PARSE_ERROR",
  ROLE_UNAVAILABLE:     "ROLE_UNAVAILABLE",
  VERB_NOT_SUPPORTED:   "VERB_NOT_SUPPORTED",
  ACTION_NOT_SUPPORTED: "ACTION_NOT_SUPPORTED",
  INVALID_INTENT:       "INVALID_INTENT",
});

export const IBP_ERR = Object.freeze({
  ...ERR,
  ...IBP_SPECIFIC,
});

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
 * Translate a kernel-internal Error into an IbpError by matching its
 * message against an ordered rule list. Each rule is `[regex, code]`;
 * the first regex that matches wins. Errors that already are IbpErrors
 * pass through unchanged. Otherwise the fallback code is used.
 *
 * Used by DO operation handlers that wrap low-level kernel helpers
 * (createNode, editNodeName, setExtMeta, ...) and want clean
 * wire-shape errors instead of opaque internal messages.
 *
 *   throw mapPatternsToIbpError(err, [
 *     [/system nodes|reserved/i, IBP_ERR.FORBIDDEN],
 *     [/not found/i,             IBP_ERR.NODE_NOT_FOUND],
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
