// TreeOS governing — shared helpers for the role templates.
//
// Cross-role reply emission. Each role file (rulerRole, plannerRole,
// contractorRole, foremanRole, worker*) reaches for these instead of
// duplicating address parsing + inbox append + scheduler wake.
//
// **emitReplyToAsker** is the canonical reply path. A being's role.summon
// finishes its work and emits a SUMMON back to whoever originally
// addressed it — reading `originalMessage.from` to find the asker. This
// covers every case symmetrically:
//
//   - Planner / Contractor / Foreman finishing → reply lands in their
//     Ruler's inbox (Ruler is the asker for the chain step).
//   - Ruler finishing a user-initiated chain → reply lands in the
//     user-being's inbox (the user is the asker). Their browser socket
//     observes the being-room and renders the arrival.
//   - Sub-Ruler finishing a branch dispatch → reply lands in the parent
//     scope's Ruler (the asker).
//
// Humans are summonable beings like any other; this helper has no
// special path for them. The scheduler's wake() handles the
// LLM-vs-human cognition distinction.

import { randomUUID } from "crypto";
import log from "../../../seed/log.js";
import Being from "../../../seed/models/being.js";
import { appendToInbox, readInbox } from "../../../ibp/inbox.js";
import { wake } from "../../../ibp/scheduler.js";
import { getLandDomain } from "../../../ibp/address.js";

// Mongoose lean() returns metadata as a plain object whose entries may
// be nested Maps depending on driver version. Walk a path against both
// shapes. Same pattern used in ibp/inbox.js.
export function readMetaPath(node, path) {
  if (!node) return undefined;
  let cursor = node.metadata;
  for (const key of path) {
    if (cursor instanceof Map) cursor = cursor.get(key);
    else if (cursor && typeof cursor === "object") cursor = cursor[key];
    else return undefined;
    if (cursor === undefined || cursor === null) return undefined;
  }
  return cursor;
}

// Parse a stance string of the form `<land>/<nodeId>@<qualifier>` into
// its parts. The governing role templates build `from` fields in this
// shape; this is the inverse. Returns null when the input doesn't
// match — emitReplyToAsker logs and returns false in that case.
//
// We deliberately use a small regex rather than the full IBP Address
// parser because every governing-emitted `from` follows this
// nodeId-as-path convention. If a future caller writes a fancier
// stance (path-by-name, bridged, etc.), this resolver will need to
// upgrade to the full parser — but the failure mode is loud (returns
// null, helper logs and skips the reply) rather than silent.
const STANCE_RE = /^([^/]+)\/([^/@]+)@([a-z][a-z0-9-]*)$/i;
function parseAskerStance(stance) {
  if (typeof stance !== "string") return null;
  const m = STANCE_RE.exec(stance.trim());
  if (!m) return null;
  return { land: m[1], nodeId: m[2], qualifier: m[3] };
}

/**
 * Emit a reply SUMMON to whoever originally addressed this being.
 *
 * Reads `originalMessage.from` (the asker's stance), resolves the asker
 * Being by username, appends a SUMMON to that being's inbox at the
 * asker's position, and wakes the per-being scheduler.
 *
 * Silent-best-effort on missing substrate: logs a warning, returns
 * false. Callers shouldn't depend on the reply landing for correctness
 * — substrate is canonical; reply text is conversational continuity.
 *
 * @param {object} opts
 * @param {string} opts.fromNodeId       The replier's home (plan/contracts/execution/ruler scope node)
 * @param {object} opts.fromBeing        The replier Being instance
 * @param {string} [opts.fromRoleName]   Stance qualifier for the reply's `from` field;
 *                                       defaults to fromBeing.username
 * @param {object} opts.originalMessage  The inbox entry being responded to (must have `.from`)
 * @param {string} opts.exitText         Content of the reply
 * @param {string} [opts.intent]         Reply intent (default "chat")
 * @param {number} [opts.priority]       Reply priority (default 3 — INTERACTIVE)
 * @param {object} [opts.payload]        Extra structured data folded into content
 * @returns {Promise<boolean>}
 */
export async function emitReplyToAsker({
  fromNodeId,
  fromBeing,
  fromRoleName,
  originalMessage,
  exitText,
  intent = "chat",
  priority = 3,
  payload = null,
}) {
  if (!fromNodeId) {
    log.warn("Governing/replyToAsker", "missing fromNodeId; skipping reply emission");
    return false;
  }
  if (!originalMessage?.from) {
    log.warn("Governing/replyToAsker",
      `originalMessage.from missing; cannot route reply (correlation=${originalMessage?.correlation?.slice?.(0, 8) || "?"})`);
    return false;
  }

  try {
    const askerStance = parseAskerStance(originalMessage.from);
    if (!askerStance) {
      log.warn("Governing/replyToAsker",
        `unparseable asker stance "${originalMessage.from}"; skipping reply`);
      return false;
    }

    // Resolve the asker Being by username. Usernames are globally
    // unique in a land, so qualifier-as-username is the canonical
    // lookup. Users and sub-beings both follow this convention.
    const askerBeing = await Being.findOne({ username: askerStance.qualifier })
      .select("_id username defaultRole roles operatingMode").lean();
    if (!askerBeing) {
      log.warn("Governing/replyToAsker",
        `asker being "${askerStance.qualifier}" not found; skipping reply`);
      return false;
    }

    // Build the reply envelope.
    const landDomain = getLandDomain() || "land";
    const fromQualifier =
      fromRoleName
      || fromBeing?.username
      || (Array.isArray(fromBeing?.roles) && fromBeing.roles[0])
      || "sub-being";
    const fromStance = `${landDomain}/${fromNodeId}@${fromQualifier}`;

    const correlation = randomUUID();
    const rootCorrelation =
      originalMessage?.rootCorrelation
      || originalMessage?.correlation
      || correlation;

    const content = payload
      ? { exit: exitText, ...payload }
      : exitText;

    await appendToInbox(String(askerStance.nodeId), String(askerBeing._id), {
      from:            fromStance,
      content,
      intent,
      correlation,
      rootCorrelation,
      activeRole:      askerBeing.defaultRole || null,
      inReplyTo:       originalMessage?.correlation || null,
      priority,
      sentAt:          new Date().toISOString(),
    });
    wake(String(askerBeing._id), String(askerStance.nodeId));

    log.info("Governing/replyToAsker",
      `↩  ${fromQualifier} → ${askerBeing.username} ` +
      `at ${String(askerStance.nodeId).slice(0, 8)} ` +
      `(correlation=${correlation.slice(0, 8)})`);
    return true;
  } catch (err) {
    log.warn("Governing/replyToAsker", `emit failed: ${err.message}`);
    return false;
  }
}

/**
 * Emit a SUMMON to an asker identified by a stance string directly
 * (rather than by reading `originalMessage.from`). Used by the Ruler
 * when it needs to reply to its chain-initial caller — which is a
 * different stance than the immediate sender of the wake-SUMMON (the
 * immediate sender is a sub-being like Planner; the chain-initial
 * caller is the user-being or parent Ruler).
 *
 * Parses the stance, resolves the asker Being by username, appends to
 * their inbox at the stance's position, and wakes the per-being
 * scheduler. Silent-best-effort on missing substrate.
 *
 * @param {object} opts
 * @param {string} opts.askerStance      e.g. "treeos.ai/<userHomeId>@tabor"
 * @param {string} opts.fromNodeId       The replier's home (Ruler scope node)
 * @param {object} opts.fromBeing        The replier Being
 * @param {string} [opts.fromRoleName]
 * @param {string} opts.exitText
 * @param {string} [opts.inReplyTo]      Correlation of the wake-SUMMON being responded to
 * @param {string} [opts.rootCorrelation] Chain root (propagates from wake)
 * @param {string} [opts.intent]
 * @param {number} [opts.priority]
 * @param {object} [opts.payload]
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
  intent = "chat",
  priority = 3,
  payload = null,
}) {
  if (!fromNodeId) {
    log.warn("Governing/replyToStance", "missing fromNodeId; skipping reply emission");
    return false;
  }
  if (!askerStance) {
    log.warn("Governing/replyToStance", "missing askerStance; skipping reply emission");
    return false;
  }
  try {
    const parsed = parseAskerStance(askerStance);
    if (!parsed) {
      log.warn("Governing/replyToStance",
        `unparseable asker stance "${askerStance}"; skipping reply`);
      return false;
    }
    const askerBeing = await Being.findOne({ username: parsed.qualifier })
      .select("_id username defaultRole roles operatingMode").lean();
    if (!askerBeing) {
      log.warn("Governing/replyToStance",
        `asker being "${parsed.qualifier}" not found; skipping reply`);
      return false;
    }

    const landDomain = getLandDomain() || "land";
    const fromQualifier =
      fromRoleName
      || fromBeing?.username
      || (Array.isArray(fromBeing?.roles) && fromBeing.roles[0])
      || "sub-being";
    const fromStance = `${landDomain}/${fromNodeId}@${fromQualifier}`;

    const correlation = randomUUID();
    const rootC = rootCorrelation || correlation;
    const content = payload ? { exit: exitText, ...payload } : exitText;

    await appendToInbox(String(parsed.nodeId), String(askerBeing._id), {
      from:            fromStance,
      content,
      intent,
      correlation,
      rootCorrelation: rootC,
      activeRole:      askerBeing.defaultRole || null,
      inReplyTo,
      priority,
      sentAt:          new Date().toISOString(),
    });
    wake(String(askerBeing._id), String(parsed.nodeId));

    log.info("Governing/replyToStance",
      `↩  ${fromQualifier} → ${askerBeing.username} ` +
      `at ${String(parsed.nodeId).slice(0, 8)} ` +
      `(correlation=${correlation.slice(0, 8)})`);
    return true;
  } catch (err) {
    log.warn("Governing/replyToStance", `emit failed: ${err.message}`);
    return false;
  }
}

/**
 * Find the chain-initial caller for a Ruler — the asker that opened
 * this rootCorrelation at this Ruler's scope. Walks the Ruler's inbox
 * bucket for the first entry where `rootCorrelation` matches and
 * `inReplyTo` is null (the chain-opening SUMMON to this Ruler, not a
 * sub-being's reply).
 *
 * For an entry-scope Ruler this returns the user-being's stance.
 * For a sub-scope Ruler this returns the parent Ruler's stance. Same
 * mechanism, varied identity — see memory `card-is-a-summon`.
 *
 * Returns the `from` field of the chain-initial entry, or null when
 * none is found.
 *
 * @param {string} rulerNodeId
 * @param {string} rulerBeingId
 * @param {string} rootCorrelation
 * @returns {Promise<string | null>}
 */
export async function findChainInitialCaller(rulerNodeId, rulerBeingId, rootCorrelation) {
  if (!rulerNodeId || !rulerBeingId || !rootCorrelation) return null;
  try {
    const entries = await readInbox(rulerNodeId, rulerBeingId);
    if (!Array.isArray(entries) || entries.length === 0) return null;
    // First entry at this rootCorrelation that wasn't itself a reply.
    // The inbox bucket is push-ordered, so the first match is the
    // earliest chain-initial SUMMON to this Ruler.
    for (const entry of entries) {
      if (entry?.rootCorrelation === rootCorrelation && !entry.inReplyTo) {
        return entry.from || null;
      }
    }
    return null;
  } catch (err) {
    log.warn("Governing/chainInitialCaller",
      `lookup failed for ruler ${String(rulerBeingId).slice(0, 8)}/root ${String(rootCorrelation).slice(0, 8)}: ${err.message}`);
    return null;
  }
}

/**
 * Convenience: extract `(beingId, username)` from the role.summon
 * context, falling back gracefully when one or the other is missing.
 * Used by every role.summon when building the `runChat` arguments.
 */
export function resolveBeingInOut(ctx) {
  const beingIn  = ctx?.identity?.beingId || ctx?.toBeing?._id || null;
  const beingOut = ctx?.toBeing?._id ? String(ctx.toBeing._id) : null;
  const username = ctx?.identity?.username
                || ctx?.toBeing?.username
                || "(unknown)";
  return { beingIn, beingOut, username };
}
