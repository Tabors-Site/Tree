// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// assign.js — beat one of the stamping. Who acts, and the moment
// opens its frame.
//
// Scheduler picks an inbox entry off a being's line and hands it
// here. assign loads the receiver Being, resolves the active role,
// checks role-carry, opens the Stamp row that frames this moment,
// and builds the summon context the role's voice expects. It
// returns { stampId, role, summonCtx } for moment to dispatch, or
// { skipped } when the entry can't run.
//
// Opening the row IS part of beat one. presentism: a being only
// exists as a moment, and a moment only exists because a SUMMON
// created it — so when the scheduler picks an inbox entry and
// assign resolves who acts, the Stamp that frames the moment opens
// here. Every DO and BE the being emits during the moment carries
// this stampId. stamped.js presses the closing face when the
// moment ends.
//
// genesis is the one exception: the I-Am's first BE has no
// summoner, so it bootstraps its own first Stamp out-of-band in
// boot code. Every other Stamp opens here.
//
// The four beats of a stamping:
//   assign.js   who acts + open the frame   (this file)
//   fold/       read the present
//   moment.js   the being acting
//   stamped.js  press the closing face

import log from "../../system/log.js";
import { v4 as uuidv4 } from "uuid";
import Being from "../../models/being.js";
import Stamp from "../../models/stamp.js";
import { getPlaceConfigValue } from "../../placeConfig.js";
import { getRole } from "../roles/registry.js";
import { computeIbpStampAddress } from "../../ibp/address.js";

/**
 * Set up one moment for stamping. Loads the being, resolves the
 * active role, opens the Stamp row, and builds the summon ctx.
 *
 * @param {object} opts
 * @param {string} opts.beingId       — receiver
 * @param {string} opts.spaceId       — inbox position the entry landed at
 * @param {object} opts.entry         — the inbox row (correlation, content, activeRole, ...)
 * @param {object} [opts.handoff]     — runtime context stashed by SUMMON (identity, resolved, ...)
 * @param {AbortSignal} [opts.signal] — abort propagating from the scheduler's controller
 *
 * @returns {Promise<{ stampId?, role?, summonCtx?, skipped? }>}
 *   stampId    — the Stamp row this moment opened (always present on success)
 *   role       — resolved role spec
 *   summonCtx  — the prepared context the role's summon handler expects (carries stampId)
 *   skipped    — reason string when the entry can't run
 *                ("being-not-found" | "role-not-carried" | "role-unavailable")
 */
export async function assign({ beingId, spaceId, entry, handoff = null, signal = null } = {}) {
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

  // ── assign: open the Stamp row for this moment ───────────────────
  // The asker identity comes from handoff when SUMMON registered one
  // (async respondMode); when it didn't (place-driven subscriptions,
  // cadence wakes, internal verb-without-handoff paths), the asker is
  // the receiver itself acting on its own behalf.
  const askerBeingId = handoff?.identity?.beingId || beingId;
  const askerName    = handoff?.identity?.name    || null;

  const stamp = await openStampRow({
    beingIn:           String(askerBeingId),
    beingOut:          String(beingId),
    addresseePosition: spaceId,
    askerPosition:    handoff?.resolved?.spaceId || null,
    message:           entry.content,
    source:            askerName || entry.from || "user",
    activeRole,
    inboxMessageId:    entry.correlation,
    inReplyTo:         entry.inReplyTo || null,
    rootCorrelation:   entry.rootCorrelation || entry.correlation || null,
    receivedAt:        entry.sentAt || null,
    priority:          entry.priority || null,
  });

  // ── assign: build the summon ctx the role expects ────────────────
  // Mirrors verbs/summon.js's same-shape build at request time. The
  // handoff record (registered by the SUMMON verb when respondMode is
  // "async") carries the asker's identity and the resolved stance.
  const stampId = stamp?._id ? String(stamp._id) : null;
  const summonCtx = {
    spaceId,
    being:       activeRole,             // legacy field name; carries the active role
    activeRole,
    toBeing,
    stampId,
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
      stampId,
    },
    resolved: handoff?.resolved || {
      being:       activeRole,
      activeRole,
      spaceId,
    },
    identity: handoff?.identity || null,
    signal,
  };

  return { stampId, role, summonCtx };
}

// ─────────────────────────────────────────────────────────────────────
// Private helper: open the Stamp row.
//
// This is the moment-open write. It's private to assign because
// assign is the only legitimate Stamp opener — genesis bootstraps
// the I-Am's first Stamp out-of-band in boot code; everything else
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
      Number(getPlaceConfigValue("maxChatContentBytes")) || 100000,
      1000000,
    ),
  );
}

function capContent(s) {
  if (typeof s !== "string") return s;
  const max = MAX_CHAT_CONTENT_BYTES();
  return s.length > max ? s.slice(0, max) + "... (truncated)" : s;
}

async function openStampRow(opts = {}) {
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
  } = opts;

  if (!beingIn) {
    log.warn("Assign", "openStampRow called without beingIn");
    return null;
  }

  let resolvedRoot = rootCorrelation || null;

  // Resolve rootCorrelation: when there's a parent and no explicit
  // root, inherit the parent's so audit walks see the whole reply
  // chain rooted at the originating user message.
  if (!resolvedRoot && inReplyTo) {
    try {
      const parent = await Stamp.findById(inReplyTo)
        .select("rootCorrelation")
        .lean();
      resolvedRoot = parent?.rootCorrelation || inReplyTo;
    } catch {
      resolvedRoot = inReplyTo;
    }
  }

  const stampId = uuidv4();
  // A summon with no parent IS its own root.
  if (!resolvedRoot) resolvedRoot = stampId;

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
    const row = await Stamp.create({
      _id: stampId,
      beingIn,
      beingOut: beingOut || null,
      ibpAddress,
      activeRole,
      inboxMessageId,
      inReplyTo,
      rootCorrelation: resolvedRoot,
      parentThread:    resolvedParentThread,
      receivedAt: receivedAt || now,
      stampedAt: now,
      startMessage: { content: safeMessage, source },
      ...(priority ? { priority } : {}),
    });
    return row;
  } catch (err) {
    log.warn("Assign", `openStampRow failed: ${err.message}`);
    return null;
  }
}
