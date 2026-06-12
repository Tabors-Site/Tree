// TreeOS IBP envelope helpers.
//
// Canonical wire shape:
//
//   { id, verb, address, payload, identity? }
//
// `verb` is one of "see" | "do" | "summon" | "be". `address` is the
// canonical string; the verb determines which address shapes are valid:
//
//   SEE     position OR stance (observation works at either tier)
//   DO      position only      (mutations always place at a position;
//                               a stance address has its @being stripped)
//   SUMMON  stance only        (inboxes are per-being-per-position)
//   BE      stance OR place     (cherub stance, or bare-place shorthand)
//
// `payload` carries operation-specific data per verb:
//   SEE     { live?: boolean, ... }
//   DO      { action: string, args?: object, ... }
//   SUMMON  { message, from?, inReplyTo?, rootCorrelation?, priority?,
//             activeRole?, correlation? }
//   BE      { op: "birth"|"connect"|"release", ...credentials }
//
// `identity` is the caller's auth token (when applicable). Verb handlers
// read it from the parsed envelope, no per-verb-field destructuring.

import { IbpError, IBP_ERR } from "../../seed/ibp/protocol.js";

// Matches the trailing `@<qualifier>` of a stance address. The
// qualifier accepts two shapes (see parseBeing in seed/ibp/address.js):
//   1. A bare being name (e.g. "@cherub", "@greeter-12345678")
//   2. An extension role shorthand "<ext>:<role>" (e.g.
//      "@hello-world:greeter") — namespaced roles use a colon to
//      separate the extension namespace from the role name.
// Both shapes participate in classifyAddress / stripBeingQualifier.
const EMBODIMENT_SUFFIX = /@[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/i;
const VALID_VERBS = new Set(["see", "do", "summon", "be"]);

/**
 * Classify an address string into its kind. The kind names "place" /
 * "position" / "stance" are the internal wire-side enum; in user-
 * facing copy these are usually described as:
 *
 *   "place"    — bare reality domain, no slash, no @being.
 *                Example: "treeos.ai". Accepted only by BE.
 *   "position" — reality domain + path, no @being.
 *                Example: "treeos.ai/~tabor". Accepted by SEE, DO.
 *   "stance"   — position + @being qualifier.
 *                Example: "treeos.ai/~tabor@cherub". Accepted by
 *                SEE, SUMMON, BE.
 */
export function classifyAddress(address) {
  if (typeof address !== "string" || !address) return null;
  const hasAt = EMBODIMENT_SUFFIX.test(address);
  const hasSlash = address.includes("/");
  if (hasAt) return "stance";
  if (hasSlash) return "position";
  return "place";
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
 * Extract the bare qualifier name from an address with an @qualifier,
 * or null when no qualifier is present. For being-targeting DO ops
 * the wire resolves this to a Being row and uses it as the target;
 * for space-targeting ops the qualifier is informational and gets
 * stripped before path resolution.
 */
export function extractBeingQualifier(address) {
  if (typeof address !== "string") return null;
  const m = address.match(EMBODIMENT_SUFFIX);
  if (!m) return null;
  // Strip leading "@" and any ":<role>" shorthand suffix.
  return m[0].slice(1).split(":")[0];
}

/**
 * Parse + validate a unified IBP envelope.
 *
 * Returns `{ id, verb, address, addressKind, payload }`. The verb
 * handlers consume this directly; no per-verb-field extraction.
 *
 * Identity is NOT carried in the envelope. The address IS the actor:
 * left stance's resolved beingId names the caller, the authenticated
 * socket proves they're allowed to be that caller. Cross-reality
 * provenance arrives via a signed-envelope mechanism documented in
 * FEDERATION.md (Diff B); local calls authenticate purely through
 * the transport-attached auth (socket / req).
 *
 * Throws IbpError(INVALID_INPUT) when:
 *   - envelope is not an object
 *   - verb is missing or not one of see/do/summon/be
 *   - address is missing or empty
 *   - address shape violates the verb's address-kind contract
 */
export async function parseUnifiedEnvelope(msg) {
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
  let address = typeof msg.address === "string" ? msg.address : null;
  if (!address || address.length === 0) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "ibp envelope must include a non-empty `address`");
  }
  let addressKind = classifyAddress(address);

  // Per-verb address-kind contract. Bare-place addresses (no slash)
  // mean "the place root" for verbs that need a position (SEE, DO).
  // Normalize once at the IBP layer so the seed never sees a bare-
  // place for position-targeted verbs — it always receives a position
  // address (`<reality>/`) that resolves to the place root via the
  // standard path-walk. The seed doesn't worry about the difference.
  //
  // BE is intentionally NOT normalized: it accepts bare-place
  // shorthand for birth/connect against the place's cherub, which
  // is a distinct semantic shape from "BE on the place root."
  // SUMMON requires a stance (@being qualifier) and rejects bare-
  // place outright; no normalization is meaningful.
  // SEE-op names ride the SEE verb's address slot ("classify-matter",
  // "clone-subtree", "<ext>:<name>"). They classify as "place" (no
  // slash) but are NOT places — without this carve-out the place
  // normalization below rewrites them to "<op>/" and the dispatcher
  // walks them as positions (or worse, routes them as foreign
  // domains). Registry membership is the test; the domain guard
  // covers the pathological collision where an op shares the local
  // reality's name.
  if (verb === "see" && addressKind === "place") {
    const { isSeeOpName } = await import("../../seed/ibp/seeOps.js");
    const { getRealityDomain } = await import("../../seed/ibp/address.js");
    if (isSeeOpName(address) && address !== getRealityDomain()) {
      addressKind = "see-op";
    }
  }

  if ((verb === "see" || verb === "do") && addressKind === "place") {
    address     = `${address}/`;
    addressKind = "position";
  }

  switch (verb) {
    case "see":
      if (addressKind !== "position" && addressKind !== "stance" && addressKind !== "see-op") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `ibp SEE address must be a position or stance, e.g. "${address}/" ` +
          `for the reality root or "${address}/<path>" for a specific space. ` +
          `Got bare reality domain "${address}".`,
        );
      }
      break;
    case "do":
      // Accept stance shape (informational) but normalize to position.
      if (addressKind !== "position" && addressKind !== "stance") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `ibp DO address must be a position (reality domain + path). ` +
          `Use "${address}/" to target the reality root (e.g. for set-config ` +
          `/ install-extension), or "${address}/<path>" for a specific space ` +
          `(e.g. "${address}/~tabor"). Got bare reality domain "${address}".`,
        );
      }
      break;
    case "summon":
      if (addressKind !== "stance") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `ibp SUMMON address must be a stance (position@being), e.g. ` +
          `"localhost/@cherub", "localhost/~tabor@greeter", or ` +
          `"localhost/~tabor@hello-world:greeter" (role shorthand). ` +
          `Got "${addressKind}" shape (address="${address}").`,
        );
      }
      break;
    case "be":
      if (addressKind !== "stance" && addressKind !== "place") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `ibp BE address must be a stance (e.g. "localhost/@cherub") or a bare ` +
          `reality domain (e.g. "localhost", no slash). Got "${addressKind}" ` +
          `shape (address="${address}").`,
        );
      }
      break;
  }

  const payload = (msg.payload && typeof msg.payload === "object") ? msg.payload : {};

  // Identity is intentionally not extracted. Per Diff A, the address
  // IS the actor (left stance resolved to beingId at the wire). Legacy
  // callers may still send `identity` in the envelope or payload; the
  // parser ignores it. The transport-attached auth (socket / req) is
  // what the verb gate trusts.

  return {
    id:          msg.id || null,
    verb,
    address,
    addressKind,
    payload,
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
