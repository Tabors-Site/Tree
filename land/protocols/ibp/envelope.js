// TreeOS IBP envelope helpers.
//
// Canonical wire shape per [[project_ibp_wire_shape]]:
//
//   { id, verb, address, payload, identity? }
//
// `verb` is one of "see" | "do" | "summon" | "be". `address` is the
// canonical string; the verb determines which address shapes are valid:
//
//   SEE     position OR stance (observation works at either tier)
//   DO      position only      (mutations always land at a position;
//                               a stance address has its @being stripped)
//   SUMMON  stance only        (inboxes are per-being-per-position)
//   BE      stance OR land     (auth-being stance, or bare-land shorthand)
//
// `payload` carries operation-specific data per verb:
//   SEE     { live?: boolean, ... }
//   DO      { action: string, args?: object, ... }
//   SUMMON  { message, from?, inReplyTo?, rootCorrelation?, priority?,
//             intent?, activeRole?, correlation? }
//   BE      { op: "register"|"claim"|"release"|"switch", ...credentials }
//
// `identity` is the caller's auth token (when applicable). Verb handlers
// read it from the parsed envelope, no per-verb-field destructuring.

import { IbpError, IBP_ERR } from "../../seed/core/errors.js";

const EMBODIMENT_SUFFIX = /@[a-z][a-z0-9-]*$/i;
const VALID_VERBS = new Set(["see", "do", "summon", "be"]);

/**
 * Classify an address string into its kind:
 *   "land"     bare domain, no slash, no @being (e.g. "treeos.ai")
 *   "stance"   has @being qualifier (e.g. "treeos.ai/abc-123@auth")
 *   "position" has slash, no @being (e.g. "treeos.ai/abc-123")
 */
export function classifyAddress(address) {
  if (typeof address !== "string" || !address) return null;
  const hasAt = EMBODIMENT_SUFFIX.test(address);
  const hasSlash = address.includes("/");
  if (hasAt) return "stance";
  if (hasSlash) return "position";
  return "land";
}

/**
 * Strip the trailing `@being` qualifier from an address. Used by DO,
 * which targets positions only — a stance address with an @being is
 * accepted but the qualifier is informational, not load-bearing.
 */
export function stripBeingQualifier(address) {
  return typeof address === "string" ? address.replace(EMBODIMENT_SUFFIX, "") : address;
}

/**
 * Parse + validate a unified IBP envelope.
 *
 * Returns `{ id, verb, address, addressKind, payload, identity }`. The
 * verb handlers consume this directly; no per-verb-field extraction.
 *
 * Throws IbpError(INVALID_INPUT) when:
 *   - envelope is not an object
 *   - verb is missing or not one of see/do/summon/be
 *   - address is missing or empty
 *   - address shape violates the verb's address-kind contract
 */
export function parseUnifiedEnvelope(msg) {
  if (!msg || typeof msg !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "ibp envelope must be an object");
  }
  const verb = typeof msg.verb === "string" ? msg.verb.toLowerCase() : null;
  if (!verb || !VALID_VERBS.has(verb)) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `ibp envelope must include verb (one of: ${[...VALID_VERBS].join(", ")})`,
    );
  }
  const address = typeof msg.address === "string" ? msg.address : null;
  if (!address || address.length === 0) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "ibp envelope must include a non-empty `address`");
  }
  const addressKind = classifyAddress(address);

  // Per-verb address-kind contract. Bare-land addresses (no slash) are
  // only valid for BE; every other verb needs at least the land-root
  // marker — `<land>/` — to name a position. SUMMON additionally needs
  // an @being qualifier.
  switch (verb) {
    case "see":
      if (addressKind !== "position" && addressKind !== "stance") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `ibp SEE address must be a position or stance, e.g. "${address}/" for the land root or "${address}/<nodeId>" for a node. ` +
          `Got bare-land "${address}".`,
        );
      }
      break;
    case "do":
      // Accept stance shape (informational) but normalize to position.
      if (addressKind !== "position" && addressKind !== "stance") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `ibp DO address must be a position. Use "${address}/" to target the land root ` +
          `(e.g. for set-config / install-extension), or "${address}/<nodeId>" for a specific node. ` +
          `Got bare-land "${address}".`,
        );
      }
      break;
    case "summon":
      if (addressKind !== "stance") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `ibp SUMMON address must be a stance (position@being), e.g. "${address}/@land-manager". ` +
          `Got "${addressKind}" shape.`,
        );
      }
      break;
    case "be":
      if (addressKind !== "stance" && addressKind !== "land") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `ibp BE address must be a stance (e.g. "${address}@auth") or a bare land (e.g. "${address.split("/")[0]}"). ` +
          `Got "${addressKind}" shape.`,
        );
      }
      break;
  }

  const payload = (msg.payload && typeof msg.payload === "object") ? msg.payload : {};
  const identity = msg.identity !== undefined ? msg.identity : (payload.identity !== undefined ? payload.identity : null);

  return {
    id:          msg.id || null,
    verb,
    address,
    addressKind,
    payload,
    identity,
  };
}

/**
 * Ack helpers — uniform { id, status, data | error } shape.
 * Used by socket.io callback acks; HTTP adapter also reuses the shape.
 */
export function ackOk(ack, id, data) {
  if (typeof ack !== "function") return;
  ack({ id, status: "ok", data });
}

export function ackError(ack, id, code, message, detail) {
  if (typeof ack !== "function") return;
  const err = { code, message };
  if (detail !== undefined) err.detail = detail;
  ack({ id, status: "error", error: err });
}
