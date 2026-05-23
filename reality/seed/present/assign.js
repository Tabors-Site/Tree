// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// assign.js — beat one of the stamping. Who acts, and the moment
// opens its frame.
//
// Scheduler picks an intake entry off a being's line and hands it
// here. assign loads the receiver Being, resolves the active role,
// checks role-carry, opens the Act row that frames this moment,
// and builds the summon context the moment's dispatch needs. It
// returns { actId, role, summonCtx } for moment to dispatch, or
// { skipped } when the entry can't run.
//
// Two intake kinds reach assign:
//
//   kind: "summon"
//     A SUMMON the being received. summonCtx carries the message
//     shape; moment.js calls role.summon(message, ctx).
//
//   kind: "transport-act"
//     The being acted from their own transport (portal/browser/CLI).
//     summonCtx carries the act payload { verb, target, action, args };
//     moment.js dispatches it directly through doVerb/beVerb. No
//     role.summon handler runs — the act was already decided
//     externally.
//
// Opening the row IS part of beat one. presentism: a being only
// exists as a moment, so when the scheduler picks an intake entry
// and assign resolves who acts, the Act that frames the moment
// opens here. Every DO and BE the being emits during the moment
// carries this actId. stamped.js presses the closing face when
// the moment ends.
//
// genesis is the one exception: the I-Am's first BE has no
// summoner, so it bootstraps its own first Act out-of-band in
// boot code. Every other Act opens here.
//
// The four beats of a stamping:
//   assign.js   who acts + open the frame   (this file)
//   fold/       read the present
//   moment.js   the being acting
//   stamped.js  press the closing face

import log from "../seedReality/log.js";
import { getInternalConfigValue } from "../internalConfig.js";
import { v4 as uuidv4 } from "uuid";
import Being from "../materials/being/being.js";
import Act from "../past/act/act.js";
import { getRealityConfigValue } from "../realityConfig.js";
import { getRole } from "./roles/registry.js";
import { computeIbpStampAddress } from "../ibp/address.js";

/**
 * Set up one moment for stamping. Loads the being, resolves the
 * active role, opens the Act row, and builds the summon ctx.
 *
 * Dispatches by entry.kind:
 *   "summon"        — message-shaped ctx; moment calls role.summon
 *   "transport-act" — act-shaped ctx ({ verb, target, action, args });
 *                     moment dispatches the wrapped verb directly
 *
 * @param {object} opts
 * @param {string} opts.beingId       — receiver / acting being
 * @param {string} opts.spaceId       — position the entry landed at
 * @param {object} opts.entry         — the intake row (kind, correlation, ...)
 * @param {object} [opts.handoff]     — runtime context stashed by SUMMON (identity, resolved, ...)
 * @param {AbortSignal} [opts.signal] — abort propagating from the scheduler's controller
 *
 * @returns {Promise<{ actId?, role?, summonCtx?, skipped? }>}
 *   actId    — the Act row this moment opened (always present on success)
 *   role       — resolved role spec
 *   summonCtx  — the prepared context moment.js dispatches on (carries actId + kind)
 *   skipped    — reason string when the entry can't run
 *                ("being-not-found" | "role-not-carried" | "role-unavailable")
 */
export async function assign({ beingId, spaceId, entry, handoff = null, signal = null } = {}) {
  const kind = entry?.kind || "summon";
  // ── assign: load the being ───────────────────────────────────────
  const toBeing = await Being.findById(beingId);
  if (!toBeing) {
    log.warn("Assign", `being ${String(beingId).slice(0, 8)} not found`);
    return { skipped: "being-not-found" };
  }

  // ── assign: resolve the active role ──────────────────────────────
  // entry.activeRole has primacy when present; toBeing.defaultRole
  // falls back when the inbox row didn't pin one. A specified
  // activeRole must be in the being's roles[].
  let activeRole = null;
  if (entry.activeRole) {
    const carried = Array.isArray(toBeing.roles) ? toBeing.roles : [];
    if (!carried.includes(entry.activeRole)) {
      log.warn(
        "Assign",
        `entry's activeRole "${entry.activeRole}" not carried by being ` +
          `${String(beingId).slice(0, 8)} (roles: ${carried.join(", ") || "none"})`,
      );
      return { skipped: "role-not-carried" };
    }
    activeRole = entry.activeRole;
  } else {
    activeRole = toBeing.defaultRole || null;
  }

  const role = activeRole ? getRole(activeRole) : null;
  if (!role) {
    log.warn(
      "Assign",
      `no role registered for "${activeRole}" of being ${String(beingId).slice(0, 8)}`,
    );
    return { skipped: "role-unavailable" };
  }

  // ── assign: open the Act row for this moment ───────────────────
  // For kind="summon" the asker is the SUMMON's sender (from handoff
  // when present, else the receiver acting on its own behalf for
  // place-driven wakes). For kind="transport-act" the asker IS the
  // acting being — they entered through their own transport, no
  // SUMMON envelope.
  const askerBeingId = kind === "transport-act"
    ? String(beingId)
    : (handoff?.identity?.beingId || beingId);
  const askerName = kind === "transport-act"
    ? (entry?.identity?.name || null)
    : (handoff?.identity?.name || null);

  const actMessage = kind === "transport-act"
    ? describeTransportAct(entry.act)
    : entry.content;
  const actSource = kind === "transport-act"
    ? (askerName || "transport")
    : (askerName || entry.from || "user");

  const act = await openActRow({
    beingIn:           String(askerBeingId),
    beingOut:          String(beingId),
    addresseePosition: spaceId,
    askerPosition:    handoff?.resolved?.spaceId || null,
    message:           actMessage,
    source:            actSource,
    activeRole,
    inboxMessageId:    entry.correlation,
    inReplyTo:         entry.inReplyTo || null,
    rootCorrelation:   entry.rootCorrelation || entry.correlation || null,
    receivedAt:        entry.sentAt || null,
    priority:          entry.priority || null,
    // Bucket 3 Option D: this moment answers the InboxProjection
    // row keyed by entry.correlation; stamped.js evicts it on seal.
    answers:           entry.correlation || null,
  });

  // ── assign: build the summon ctx moment.js dispatches on ─────────
  // Two shapes by kind. moment.js reads ctx.kind and routes.
  const actId = stamp?._id ? String(stamp._id) : null;

  const baseCtx = {
    kind,
    spaceId,
    being:       activeRole,             // legacy field name; carries the active role
    activeRole,
    toBeing,
    actId,
    resolved: handoff?.resolved || {
      being:       activeRole,
      activeRole,
      spaceId,
    },
    identity: handoff?.identity || entry?.identity || null,
    signal,
  };

  let summonCtx;
  if (kind === "transport-act") {
    summonCtx = {
      ...baseCtx,
      act: entry.act || null,
    };
  } else {
    summonCtx = {
      ...baseCtx,
      message: {
        from:            entry.from,
        content:         entry.content,
        correlation:     entry.correlation,
        rootCorrelation: entry.rootCorrelation || entry.correlation,
        activeRole,
        inReplyTo:       entry.inReplyTo,
        attachments:     entry.attachments,
        sentAt:          entry.sentAt,
        priority:        entry.priority,
        actId,
      },
    };
  }

  return { actId, role, summonCtx };
}

// Render a one-line description of a transport-act for the Act's
// startMessage. The full payload lives on the intake entry; this is
// what shows up when humans skim a Summon row.
function describeTransportAct(act) {
  if (!act || typeof act !== "object") return "[transport-act]";
  const verb   = act.verb || "?";
  const target = act.target || "?";
  const action = act.action || "?";
  return `${verb.toUpperCase()} ${target} ${action}`;
}

// ─────────────────────────────────────────────────────────────────────
// Private helper: open the Act row.
//
// This is the moment-open write. It's private to assign because
// assign is the only legitimate Act opener — genesis bootstraps
// the I-Am's first Act out-of-band in boot code; everything else
// runs through SUMMON, lands in an inbox, and reaches assign.
//
// Resolves rootCorrelation (inherits from parent), spawn-lineage
// parentThread (from scheduler.currentRoot), and ibpAddress
// (canonical stance pair); caps message content; creates the row
// with an open endMessage. stamped.js presses the closing face
// when the moment ends.
// ─────────────────────────────────────────────────────────────────────

function MAX_CHAT_CONTENT_BYTES() {
  return Math.max(
    10000,
    Math.min(
      Number(getInternalConfigValue("maxChatContentBytes")) || 100000,
      1000000,
    ),
  );
}

function capContent(s) {
  if (typeof s !== "string") return s;
  const max = MAX_CHAT_CONTENT_BYTES();
  return s.length > max ? s.slice(0, max) + "... (truncated)" : s;
}

async function openActRow(opts = {}) {
  const {
    beingIn,
    beingOut = null,
    askerPosition = null,
    addresseePosition = null,
    message,
    source = "user",
    activeRole = null,
    inboxMessageId = null,
    inReplyTo = null,
    rootCorrelation = null,
    receivedAt = null,
    priority = null,
    // Bucket 3 Option D: the correlation of the InboxProjection row
    // this moment is consuming. Stored on the Act as `answers`; on
    // seal, the cross-cutting fold evicts the matching row.
    answers = null,
  } = opts;

  if (!beingIn) {
    log.warn("Assign", "openActRow called without beingIn");
    return null;
  }

  let resolvedRoot = rootCorrelation || null;

  // Resolve rootCorrelation: when there's a parent and no explicit
  // root, inherit the parent's so audit walks see the whole reply
  // chain rooted at the originating user message.
  if (!resolvedRoot && inReplyTo) {
    try {
      const parent = await Act.findById(inReplyTo)
        .select("rootCorrelation")
        .lean();
      resolvedRoot = parent?.rootCorrelation || inReplyTo;
    } catch {
      resolvedRoot = inReplyTo;
    }
  }

  const actId = uuidv4();
  // A summon with no parent IS its own root.
  if (!resolvedRoot) resolvedRoot = actId;

  // Spawn-lineage. When the asker is currently acting under another
  // rootCorrelation (running inside thread A) and emits a fresh
  // top-level SUMMON (no inReplyTo, so a new chain), record that the
  // new chain was spawned from A. Without this, spawned threads
  // look like roots with no lineage. Read scheduler.currentRoot
  // here so beings don't have to remember to pass it.
  let resolvedParentThread = null;
  if (!inReplyTo) {
    try {
      const { getCurrentRootCorrelation } = await import("../intake/scheduler.js");
      const currentRoot = getCurrentRootCorrelation(String(beingIn));
      if (currentRoot && currentRoot !== resolvedRoot) {
        resolvedParentThread = currentRoot;
      }
    } catch {
      // Scheduler unavailable (pre-cognition boot, tests).
    }
  }

  const ibpAddress = await computeIbpStampAddress({
    askerBeingId: beingIn,
    askerPosition,
    addresseeBeingId: beingOut,
    addresseePosition,
  });

  const now = new Date();
  const safeMessage = capContent(message);

  try {
    const row = await Act.create({
      _id: actId,
      beingIn,
      beingOut: beingOut || null,
      ibpAddress,
      activeRole,
      inboxMessageId,
      inReplyTo,
      rootCorrelation: resolvedRoot,
      parentThread:    resolvedParentThread,
      answers, // Bucket 3 Option D: closure key the seal evicts on
      receivedAt: receivedAt || now,
      stampedAt: now,
      startMessage: { content: safeMessage, source },
      ...(priority ? { priority } : {}),
    });
    return row;
  } catch (err) {
    log.warn("Assign", `openActRow failed: ${err.message}`);
    return null;
  }
}
