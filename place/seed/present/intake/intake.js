// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Intake. The factory's run-feed.
//
// An intake entry is a moment-to-run for a being: assign opens a stamp,
// fold reads the present, momentum runs the act, stamped seals. The
// scheduler drains intake per-being-serial (one moment at a time per
// being); the choice of next entry is by priority then arrival order.
//
// Intake is NOT the inbox. The inbox is a being's per-position mailbox
// of received SUMMONs (messages); the intake is the run-feed of
// stampings the scheduler will dispatch. They overlap for LLM and
// scripted beings (a SUMMON to them creates both an inbox record and
// an intake entry), but they're structurally distinct:
//
//   inbox  = "messages received" — read by UI, by the being's own
//            attention. A human's inbox holds SUMMONs that wait for the
//            human to choose how to respond. An LLM's inbox holds the
//            same SUMMONs the intake will auto-process; the inbox is
//            the audit log of "what was received."
//
//   intake = "moments to run" — drained by the scheduler, run through
//            the four beats. A human's intake holds their transport-acts
//            (clicks, commands) that need to be stamped. An LLM's
//            intake holds the run-triggers auto-created from incoming
//            SUMMONs to their inbox.
//
// Two trigger-kinds populate intake:
//
//   kind: "summon"
//     The receiving being is LLM or scripted. A SUMMON to them creates
//     both an inbox record (for the mailbox) AND an intake entry (for
//     the run-feed). Momentum dispatches the role's summon handler
//     (LLM inference, scripted code-cognition).
//
//   kind: "transport-act"
//     The being acted from their own transport (WS/HTTP/CLI). No SUMMON
//     was involved; the transport itself triggered the moment. Momentum
//     applies the wrapped verb payload — doVerb/beVerb inside the
//     moment, riding the ambient actId.
//
// Storage: Space.qualities.intake.<beingId>.entries — atomic $push for
// enqueue, atomic $set by index for state transitions. Same storage
// shape as inbox, separate namespace.
//
// Per-being serial. The scheduler runs at most one intake entry per
// being at a time. SEE bypasses intake entirely (synchronous read-only
// fold, no scheduler).

import { randomUUID } from "crypto";
import Space from "../../materials/space/space.js";

const INTAKE_NS = "intake";

// Priority field: lower number = picked first by scheduler.
const DEFAULT_PRIORITY = 1;

// Place-level cap on pending intake entries. Pairs with maxRunTurns
// (active LLM turns) to bound the rate of change a place can hold.
// Counter is in-memory and starts at 0 on boot; entries that survived
// a restart aren't reflected until reseed on first consume.
let MAX_INTAKE = 5000;
let _pendingIntakeCount = 0;
export function setMaxIntake(n) {
  if (Number.isFinite(n) && n > 0) {
    MAX_INTAKE = Math.max(100, Math.min(Math.floor(n), 1_000_000));
  }
}
export function getPendingIntakeCount() {
  return _pendingIntakeCount;
}

/**
 * Append a moment-to-run to a being's intake at this position.
 *
 * **Idempotency.** `correlation` is the dedupe key. When the caller
 * supplies one and an entry with the same correlation already exists
 * on this (spaceId, beingId) bucket, no new entry is enqueued — the
 * existing entry is returned with `deduped: true`. This makes
 * transport retries safe: a client that re-sends the same act with
 * the same correlationId gets one moment, not two.
 *
 * @param {string} spaceId
 * @param {string} beingId   the being whose moment will be stamped
 * @param {object} entry     entry shape per the trigger-kind:
 *   common: { kind, correlation?, rootCorrelation?, priority?, sentAt? }
 *   kind="summon":       { from, content, inReplyTo?, attachments?, activeRole? }
 *   kind="transport-act": { verb, target, action, args, identity? }
 * @returns {Promise<{ correlation, sentAt, deduped?: boolean }>}
 */
export async function enqueueIntake(spaceId, beingId, entry) {
  if (!spaceId) throw new Error("enqueueIntake requires spaceId");
  if (!beingId) throw new Error("enqueueIntake requires beingId");
  if (!entry || typeof entry !== "object")
    throw new Error("enqueueIntake requires an entry object");
  const kind = entry.kind;
  if (kind !== "summon" && kind !== "transport-act") {
    throw new Error(`enqueueIntake: invalid kind "${kind}" (expected "summon" or "transport-act")`);
  }

  // Idempotency: if caller supplied a correlation and an entry with
  // that correlation already lives in this bucket, return the
  // existing one without adding a duplicate. Active OR completed
  // entries dedupe equally — a client retry that arrives after the
  // moment finished still collapses to the original result; new
  // handoff attaches will fire against the recorded responseId via
  // the result-replay path in the scheduler.
  if (entry.correlation) {
    const existing = await _findEntryByCorrelation(spaceId, beingId, entry.correlation);
    if (existing) {
      return {
        correlation: existing.correlation,
        sentAt:      existing.sentAt,
        deduped:     true,
        consumed:    !!existing.consumed,
        actId:     existing.actId || null,
      };
    }
  }

  if (_pendingIntakeCount >= MAX_INTAKE) {
    throw new Error(
      `Intake cap reached: ${MAX_INTAKE} pending entries place-wide. ` +
        `Raise maxIntake in .config or wait for backlog to drain.`,
    );
  }

  const sentAt = entry.sentAt || new Date().toISOString();
  const correlation = entry.correlation || randomUUID();
  const rootCorrelation = entry.rootCorrelation || correlation;
  const priority = Number.isFinite(entry.priority)
    ? Number(entry.priority)
    : DEFAULT_PRIORITY;

  const stored = {
    ...entry,
    kind,
    correlation,
    rootCorrelation,
    priority,
    sentAt,
    consumed: false,
    cancelledAt: null,
    stampedAt: null,
    consumedAt: null,
    responseId: null,
    actId: null,
  };

  await Space.updateOne(
    { _id: spaceId },
    { $push: { [`qualities.${INTAKE_NS}.${beingId}`]: stored } },
  );

  _pendingIntakeCount++;
  return { correlation, sentAt };
}

async function _findEntryByCorrelation(spaceId, beingId, correlation) {
  const space = await Space.findById(spaceId)
    .select(`qualities.${INTAKE_NS}.${beingId}`)
    .lean();
  const bucket = readMetaPath(space, [INTAKE_NS, beingId]);
  if (!Array.isArray(bucket)) return null;
  return bucket.find((e) => e?.correlation === correlation) || null;
}

/**
 * Pick the next intake entry the scheduler should process for this
 * being. Highest priority first (lowest number wins); ties break to
 * oldest (lowest array index). Skips entries already consumed or
 * cancelled. Ancestor-severance check: orphans (severed parent chain)
 * are stamped cancelled and skipped.
 *
 * @param {string} spaceId
 * @param {string} beingId
 * @returns {Promise<null | { entry, index }>}
 */
export async function pickNextIntake(spaceId, beingId) {
  if (!spaceId || !beingId) return null;
  const space = await Space.findById(spaceId)
    .select(`qualities.${INTAKE_NS}.${beingId}`)
    .lean();
  const bucket = readMetaPath(space, [INTAKE_NS, beingId]);
  if (!Array.isArray(bucket) || bucket.length === 0) return null;

  let bestIdx = -1;
  let bestPriority = Number.POSITIVE_INFINITY;
  for (let i = 0; i < bucket.length; i++) {
    const e = bucket[i];
    if (!e || e.consumed || e.cancelledAt) continue;
    const p = Number.isFinite(e.priority) ? Number(e.priority) : DEFAULT_PRIORITY;
    if (p < bestPriority) {
      bestPriority = p;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;

  const entry = bucket[bestIdx];
  if (entry.rootCorrelation) {
    const { isAncestorSevered } = await import("../../materials/space/threads.js");
    const check = await isAncestorSevered(entry.rootCorrelation);
    if (check.severed) {
      const now = new Date().toISOString();
      await Space.updateOne(
        { _id: spaceId },
        { $set: {
            [`qualities.${INTAKE_NS}.${beingId}.${bestIdx}.cancelledAt`]: now,
            [`qualities.${INTAKE_NS}.${beingId}.${bestIdx}.severedByAncestor`]: check.ancestorId,
          } },
      );
      return pickNextIntake(spaceId, beingId);
    }
  }

  return { entry, index: bestIdx };
}

/**
 * Act the moment the scheduler picked an entry up (informational —
 * compare stampedAt vs consumedAt to spot crashes where a stamp
 * opened but didn't finish). Idempotent.
 *
 * @param {string} spaceId
 * @param {string} beingId
 * @param {number} index    array index returned by pickNextIntake
 */
export async function markIntakeRunning(spaceId, beingId, index) {
  if (!spaceId || !beingId || !Number.isInteger(index) || index < 0) return;
  const stampedAt = new Date().toISOString();
  await Space.updateOne(
    { _id: spaceId },
    { $set: { [`qualities.${INTAKE_NS}.${beingId}.${index}.stampedAt`]: stampedAt } },
  );
}

/**
 * Mark intake entries complete after a stamping finishes. Decrements the
 * pending counter so the place-level cap stays honest.
 *
 * @param {string}   spaceId
 * @param {string}   beingId
 * @param {string[]} correlationIds
 * @param {object}   [opts]
 * @param {string}   [opts.responseId] correlation id of any reply-SUMMON emitted
 * @param {string}   [opts.actId]    id of the Act this moment became
 */
export async function markIntakeComplete(spaceId, beingId, correlationIds, opts = {}) {
  if (!spaceId || !beingId || !Array.isArray(correlationIds) || correlationIds.length === 0) {
    return { consumed: 0 };
  }
  const responseId = opts?.responseId ?? null;
  const actId = opts?.actId ?? null;

  const consumedAt = new Date().toISOString();
  const space = await Space.findById(spaceId)
    .select(`qualities.${INTAKE_NS}.${beingId}`)
    .lean();
  const bucket = readMetaPath(space, [INTAKE_NS, beingId]);
  if (!Array.isArray(bucket)) return { consumed: 0 };

  const idSet = new Set(correlationIds);
  const updates = {};
  let consumed = 0;
  bucket.forEach((entry, i) => {
    if (!idSet.has(entry.correlation) || entry.consumed) return;
    const base = `qualities.${INTAKE_NS}.${beingId}.${i}`;
    updates[`${base}.consumed`] = true;
    updates[`${base}.consumedAt`] = consumedAt;
    if (responseId) updates[`${base}.responseId`] = responseId;
    if (actId) updates[`${base}.actId`] = actId;
    consumed++;
  });

  if (consumed === 0) return { consumed: 0 };
  await Space.updateOne({ _id: spaceId }, { $set: updates });
  _pendingIntakeCount = Math.max(0, _pendingIntakeCount - consumed);
  return { consumed };
}

/**
 * Cancel every pending (non-consumed, non-cancelled) intake entry whose
 * rootCorrelation matches. Used by thread cuts and cancellation cascades.
 */
export async function cancelIntakeByRoot(spaceId, beingId, rootCorrelation) {
  if (!spaceId || !beingId || !rootCorrelation) {
    return { cancelled: 0, correlations: [] };
  }
  const space = await Space.findById(spaceId)
    .select(`qualities.${INTAKE_NS}.${beingId}`)
    .lean();
  const bucket = readMetaPath(space, [INTAKE_NS, beingId]);
  if (!Array.isArray(bucket)) return { cancelled: 0, correlations: [] };

  const cancelledAt = new Date().toISOString();
  const updates = {};
  const correlations = [];
  bucket.forEach((entry, i) => {
    if (!entry || entry.consumed || entry.cancelledAt) return;
    if (entry.rootCorrelation !== rootCorrelation) return;
    updates[`qualities.${INTAKE_NS}.${beingId}.${i}.cancelledAt`] = cancelledAt;
    correlations.push(entry.correlation);
  });
  if (correlations.length === 0) return { cancelled: 0, correlations: [] };
  await Space.updateOne({ _id: spaceId }, { $set: updates });
  _pendingIntakeCount = Math.max(0, _pendingIntakeCount - correlations.length);
  return { cancelled: correlations.length, correlations };
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function readMetaPath(space, path) {
  if (!space) return undefined;
  let cursor = space.qualities;
  for (const key of path) {
    if (cursor instanceof Map) {
      cursor = cursor.get(key);
    } else if (cursor && typeof cursor === "object") {
      cursor = cursor[key];
    } else {
      return undefined;
    }
    if (cursor === undefined || cursor === null) return undefined;
  }
  return cursor;
}
