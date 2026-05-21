// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Reply emission. Substrate-generic helpers a role's summon function
// reaches for after its work is done to wake whoever is waiting.
//
// Three shapes:
//
//   emitReplyToAsker      reply places in the inbox of whoever
//                         summoned this being (reads originalMessage.from).
//                         Default for sub-beings reporting up.
//
//   emitReplyToStance     reply places at an explicitly named stance.
//                         Default for Ruler-style chain-initial replies
//                         where the immediate sender (sub-being) is NOT
//                         the address we want to wake.
//
//   findChainInitialCaller  walk a being's inbox for the chain-opening
//                         SUMMON at this rootCorrelation. Returns the
//                         stance to address with emitReplyToStance.
//
// All three are seed-generic. They speak only Being model, inbox /
// scheduler, address parsing, and place domain — no extension-specific
// knowledge. Extensions that previously lived with these helpers in
// `extensions/governing/roles/_shared.js` now import them from here.

import { randomUUID } from "crypto";
import log from "../system/log.js";
import Being from "../models/being.js";
import { appendToInbox, readInbox } from "./inbox.js";
import { wake } from "./scheduler.js";
import { getPlaceDomain } from "../ibp/address.js";

// Parse a stance string of the form `<place>/<spaceId>@<qualifier>` into
// its parts. Replies build `from` fields in this shape; this is the
// inverse. Returns null on mismatch — callers log and skip the reply.
//
// Deliberately a small regex rather than the full IBP Address parser
// because the substrate convention is spaceId-as-path. If a future
// caller writes a fancier stance (path-by-name, bridged), this resolver
// upgrades to the full parser — but the failure mode is loud (returns
// null, helper logs and skips) rather than silent.
const STANCE_RE = /^([^/]+)\/([^/@]+)@([a-z][a-z0-9-]*)$/i;

function parseAskerStance(stance) {
  if (typeof stance !== "string") return null;
  const m = STANCE_RE.exec(stance.trim());
  if (!m) return null;
  return { place: m[1], spaceId: m[2], qualifier: m[3] };
}

/**
 * Emit a reply SUMMON to whoever originally addressed this being.
 *
 * Reads `originalMessage.from` (the asker's stance), resolves the
 * asker Being by name, appends a SUMMON to that being's inbox at the
 * asker's position, and wakes the per-being scheduler.
 *
 * Silent-best-effort on missing substrate: logs a warning, returns
 * false. Callers should not depend on the reply landing for
 * correctness . substrate is canonical; reply text is conversational
 * continuity.
 *
 * @param {object} opts
 * @param {string} opts.fromNodeId       Replier's home (scope spaceId)
 * @param {object} opts.fromBeing        Replier Being doc
 * @param {string} [opts.fromRoleName]   Stance qualifier; default fromBeing.name
 * @param {object} opts.originalMessage  Inbox entry being responded to (carries .from)
 * @param {string} opts.exitText         Reply content
 * @param {number} [opts.priority]       Default 3 (INTERACTIVE)
 * @param {object} [opts.payload]        Extra structured data folded into content
 * @returns {Promise<boolean>}
 */
export async function emitReplyToAsker({
  fromNodeId,
  fromBeing,
  fromRoleName,
  originalMessage,
  exitText,
  priority = 3,
  payload = null,
}) {
  if (!fromNodeId) {
    log.warn("ReplyEmission", "missing fromNodeId; skipping reply emission");
    return false;
  }
  if (!originalMessage?.from) {
    log.warn(
      "ReplyEmission",
      `originalMessage.from missing; cannot route reply (correlation=${originalMessage?.correlation?.slice?.(0, 8) || "?"})`,
    );
    return false;
  }

  try {
    const askerStance = parseAskerStance(originalMessage.from);
    if (!askerStance) {
      log.warn(
        "ReplyEmission",
        `unparseable asker stance "${originalMessage.from}"; skipping reply`,
      );
      return false;
    }

    const askerBeing = await Being.findOne({ name: askerStance.qualifier })
      .select("_id name defaultRole roles operatingMode")
      .lean();
    if (!askerBeing) {
      log.warn(
        "ReplyEmission",
        `asker being "${askerStance.qualifier}" not found; skipping reply`,
      );
      return false;
    }

    const placeDomain = getPlaceDomain() || "place";
    const fromQualifier =
      fromRoleName ||
      fromBeing?.name ||
      (Array.isArray(fromBeing?.roles) && fromBeing.roles[0]) ||
      "sub-being";
    const fromStance = `${placeDomain}/${fromNodeId}@${fromQualifier}`;

    const correlation = randomUUID();
    const rootCorrelation =
      originalMessage?.rootCorrelation ||
      originalMessage?.correlation ||
      correlation;

    const content = payload ? { exit: exitText, ...payload } : exitText;

    await appendToInbox(String(askerStance.spaceId), String(askerBeing._id), {
      from: fromStance,
      content,
      correlation,
      rootCorrelation,
      activeRole: askerBeing.defaultRole || null,
      inReplyTo: originalMessage?.correlation || null,
      priority,
      sentAt: new Date().toISOString(),
    });
    wake(String(askerBeing._id), String(askerStance.spaceId));

    log.info(
      "ReplyEmission",
      `↩  ${fromQualifier} → ${askerBeing.name} ` +
        `at ${String(askerStance.spaceId).slice(0, 8)} ` +
        `(correlation=${correlation.slice(0, 8)})`,
    );
    return true;
  } catch (err) {
    log.warn("ReplyEmission", `emitReplyToAsker failed: ${err.message}`);
    return false;
  }
}

/**
 * Emit a SUMMON to an asker identified by a stance string directly.
 *
 * Used when the wake-asker (the being whose reply summoned us) is not
 * the stance we want to address. Rulers use this on reply-wakes to
 * route back to the chain-initial caller (user-being or parent Ruler)
 * rather than to the immediate sub-being sender.
 *
 * Parses the stance, resolves the asker Being by name, appends to
 * their inbox at the stance's position, wakes the per-being
 * scheduler. Silent-best-effort on missing substrate.
 *
 * @param {object} opts
 * @param {string} opts.askerStance      e.g. "treeos.ai/<userHomeId>@tabor"
 * @param {string} opts.fromNodeId       Replier's home (scope spaceId)
 * @param {object} opts.fromBeing        Replier Being doc
 * @param {string} [opts.fromRoleName]   Stance qualifier
 * @param {string} opts.exitText         Reply content
 * @param {string} [opts.inReplyTo]      Correlation of the wake-SUMMON
 * @param {string} [opts.rootCorrelation] Chain root (propagates from wake)
 * @param {number} [opts.priority]       Default 3
 * @param {object} [opts.payload]        Extra structured data folded into content
 * @returns {Promise<boolean>}
 */
export async function emitReplyToStance({
  askerStance,
  fromNodeId,
  fromBeing,
  fromRoleName,
  exitText,
  inReplyTo = null,
  rootCorrelation = null,
  priority = 3,
  payload = null,
}) {
  if (!fromNodeId) {
    log.warn("ReplyEmission", "missing fromNodeId; skipping stance reply");
    return false;
  }
  if (!askerStance) {
    log.warn("ReplyEmission", "missing askerStance; skipping stance reply");
    return false;
  }
  try {
    const parsed = parseAskerStance(askerStance);
    if (!parsed) {
      log.warn(
        "ReplyEmission",
        `unparseable asker stance "${askerStance}"; skipping reply`,
      );
      return false;
    }
    const askerBeing = await Being.findOne({ name: parsed.qualifier })
      .select("_id name defaultRole roles operatingMode")
      .lean();
    if (!askerBeing) {
      log.warn(
        "ReplyEmission",
        `asker being "${parsed.qualifier}" not found; skipping reply`,
      );
      return false;
    }

    const placeDomain = getPlaceDomain() || "place";
    const fromQualifier =
      fromRoleName ||
      fromBeing?.name ||
      (Array.isArray(fromBeing?.roles) && fromBeing.roles[0]) ||
      "sub-being";
    const fromStance = `${placeDomain}/${fromNodeId}@${fromQualifier}`;

    const correlation = randomUUID();
    const rootC = rootCorrelation || correlation;
    const content = payload ? { exit: exitText, ...payload } : exitText;

    await appendToInbox(String(parsed.spaceId), String(askerBeing._id), {
      from: fromStance,
      content,
      correlation,
      rootCorrelation: rootC,
      activeRole: askerBeing.defaultRole || null,
      inReplyTo,
      priority,
      sentAt: new Date().toISOString(),
    });
    wake(String(askerBeing._id), String(parsed.spaceId));

    log.info(
      "ReplyEmission",
      `↩  ${fromQualifier} → ${askerBeing.name} ` +
        `at ${String(parsed.spaceId).slice(0, 8)} ` +
        `(correlation=${correlation.slice(0, 8)})`,
    );
    return true;
  } catch (err) {
    log.warn("ReplyEmission", `emitReplyToStance failed: ${err.message}`);
    return false;
  }
}

/**
 * Find the chain-initial caller for a being's inbox at a scope.
 *
 * Walks the being's inbox at scopeNodeId for the first entry where
 * `rootCorrelation` matches and `inReplyTo` is null . the chain-opening
 * SUMMON to this being, not a sub-being's reply.
 *
 * For an entry-scope Ruler this returns the user-being's stance.
 * For a sub-scope Ruler this returns the parent Ruler's stance.
 * Same mechanism, different identity. See memory `card-is-a-summon`.
 *
 * Returns the `from` field of the chain-initial entry, or null when
 * none is found.
 *
 * @param {string} scopeNodeId
 * @param {string} beingId
 * @param {string} rootCorrelation
 * @returns {Promise<string | null>}
 */
export async function findChainInitialCaller(
  scopeNodeId,
  beingId,
  rootCorrelation,
) {
  if (!scopeNodeId || !beingId || !rootCorrelation) return null;
  try {
    const entries = await readInbox(scopeNodeId, beingId);
    if (!Array.isArray(entries) || entries.length === 0) return null;
    for (const entry of entries) {
      if (entry?.rootCorrelation === rootCorrelation && !entry.inReplyTo) {
        return entry.from || null;
      }
    }
    return null;
  } catch (err) {
    log.warn(
      "ReplyEmission",
      `findChainInitialCaller failed for being ${String(beingId).slice(0, 8)}/root ${String(rootCorrelation).slice(0, 8)}: ${err.message}`,
    );
    return null;
  }
}
