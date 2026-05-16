// TreeOS IBP envelope helpers.
//
// The four IBP verbs have distinct address rules:
//   SEE  accepts position OR stance (observation works at either tier).
//   DO   accepts position only (mutations always land at a position).
//   TALK accepts stance only (inboxes are per-being-per-position).
//   BE   accepts stance only (self-identity targets stances; for fresh
//        registration, the stance is the land's auth-being).
//
// These helpers validate that the envelope matches its verb's contract
// and extract the canonical address string for downstream parsing.

import { PortalError, PORTAL_ERR } from "./errors.js";

const EMBODIMENT_SUFFIX = /@[a-z][a-z0-9-]*$/i;

/**
 * SEE and DO: extract the position-or-stance string from the envelope.
 *
 * Returns { addressString, isStance } so handlers can choose which path to
 * walk for embodiment-aware logic (DO authorization, descriptor augmentation).
 *
 * Throws PortalError with INVALID_INPUT when:
 *   - neither `position` nor `stance` is present
 *   - both are present
 *   - `position` contains an @embodiment qualifier
 *   - `stance` lacks an @embodiment qualifier
 */
export function extractPositionOrStance(msg, verbName) {
  if (!msg || typeof msg !== "object") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, `${verbName} requires an envelope object`);
  }
  const hasPosition = typeof msg.position === "string" && msg.position.length > 0;
  const hasStance = typeof msg.stance === "string" && msg.stance.length > 0;

  if (hasPosition && hasStance) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      `${verbName} envelope must have exactly one of \`position\` or \`stance\`, not both`,
    );
  }
  if (!hasPosition && !hasStance) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      `${verbName} envelope must include either \`position\` or \`stance\``,
    );
  }

  const value = hasPosition ? msg.position : msg.stance;
  const looksLikeStance = EMBODIMENT_SUFFIX.test(value);

  if (hasPosition && looksLikeStance) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      "`position` field must not include an @embodiment qualifier; use `stance` instead",
    );
  }
  if (hasStance && !looksLikeStance) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      "`stance` field must include an @embodiment qualifier; use `position` instead",
    );
  }

  return { addressString: value, isStance: hasStance };
}

/**
 * DO: extract a required position string. The `stance` field is not
 * accepted (mutations target positions only; embodiments are summoned
 * moments, not storage). If a client sends `position` with a trailing
 * `@<embodiment>` qualifier, the qualifier is stripped (informational,
 * not load-bearing for DO).
 */
export function extractPosition(msg, verbName) {
  if (!msg || typeof msg !== "object") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, `${verbName} requires an envelope object`);
  }
  if (typeof msg.stance === "string" && msg.stance.length > 0) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      `${verbName} does not accept a \`stance\` field; use \`position\` (mutations always land at a position; beings are summoned moments, not storage)`,
    );
  }
  if (typeof msg.position !== "string" || msg.position.length === 0) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      `${verbName} requires a \`position\` field`,
    );
  }
  return stripEmbodimentQualifier(msg.position);
}

function stripEmbodimentQualifier(addressString) {
  return addressString.replace(EMBODIMENT_SUFFIX, "");
}

/**
 * TALK: extract a required stance string. Stance must be qualified.
 */
export function extractStance(msg, verbName) {
  if (!msg || typeof msg !== "object") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, `${verbName} requires an envelope object`);
  }
  if (typeof msg.stance !== "string" || msg.stance.length === 0) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      `${verbName} requires a \`stance\` field (qualified position@embodiment)`,
    );
  }
  if (!EMBODIMENT_SUFFIX.test(msg.stance)) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      `${verbName} \`stance\` must include an @embodiment qualifier`,
    );
  }
  return msg.stance;
}

/**
 * BE: extract exactly one of `stance` or `land`. Both are accepted because
 * BE has two address forms:
 *   - `land: "<land>"` (bare domain, no slash, no qualifier) is the
 *     shorthand for register and credential-based claim. Equivalent to
 *     `stance: "<land>/@auth"`.
 *   - `stance: "<land>/@auth"` is the explicit auth-being form.
 *   - `stance: "<held stance>"` is for release, switch, and token re-claim.
 *
 * Returns { kind: "stance"|"land", value }.
 */
export function extractStanceOrLand(msg, verbName) {
  if (!msg || typeof msg !== "object") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, `${verbName} requires an envelope object`);
  }
  const hasStance = typeof msg.stance === "string" && msg.stance.length > 0;
  const hasLand = typeof msg.land === "string" && msg.land.length > 0;

  if (hasStance && hasLand) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      `${verbName} must have exactly one of \`stance\` or \`land\`, not both`,
    );
  }
  if (!hasStance && !hasLand) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      `${verbName} must include either \`stance\` or \`land\``,
    );
  }

  if (hasStance) {
    if (!EMBODIMENT_SUFFIX.test(msg.stance)) {
      throw new PortalError(
        PORTAL_ERR.INVALID_INPUT,
        `${verbName} \`stance\` must include an @embodiment qualifier`,
      );
    }
    return { kind: "stance", value: msg.stance };
  }

  if (msg.land.includes("/") || msg.land.includes("@")) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      `${verbName} \`land\` must be a bare domain with no path or @embodiment`,
    );
  }
  return { kind: "land", value: msg.land };
}

/**
 * Ack helpers — uniform { id, status, data | error } shape.
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
