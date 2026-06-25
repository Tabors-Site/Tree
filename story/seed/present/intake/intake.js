// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Intake — thin facade over the InboxProjection collection.
//
// Per Bucket 3 Option D (2026-05-23) the intake stopped being storage
// on Space.qualities and became a query over the InboxProjection
// projection (which is itself a fact-derived projection of call
// facts on summoners' reels). The scheduler picks rows out of that
// collection; "currently running" is transient in-memory state in
// scheduler.js (not durable). A moment seal commits the Act with
// `answers: <correlation>`; the cross-cutting fold then evicts the
// matching InboxProjection row.
//
// Two kinds of intake remain operationally distinguishable:
//
//   "summon"        — created by the CALL verb stamping a call
//                     Fact on the summoner's reel; the cross-cutting
//                     fold creates the InboxProjection row. The
//                     enqueueIntake here for kind="summon" is RETIRED
//                     — the verb does the work directly.
//
//   "transport-act" — the human acted from their own transport
//                     (WS/HTTP/CLI). No SUMMON envelope; the human is
//                     self-summoning, treated as a self-call
//                     where the summoner == the recipient. The
//                     InboxProjection row appears the same way; the
//                     scheduler treats them uniformly.
//
// Functions retained:
//   - enqueueIntake (transport-act only — kind="summon" throws)
//   - pickNextIntake (queries InboxProjection)
//   - markIntakeRunning / markIntakeComplete / cancelIntakeByRoot —
//     RETIRED. Running state is in-memory; completion is the Act seal
//     evicting the projection row. Kept as no-op tombstones so existing
//     callers don't crash mid-migration.

import { randomUUID } from "crypto";
import { InboxProjection } from "../../past/projections/inbox/inboxProjectionFold.js";
import { emitFact } from "../../past/fact/facts.js";
import { assertHistoryOrThrow } from "../../materials/projections.js";
import { stashSecrets, restoreSecrets } from "./secretStash.js";

// Place-level cap on pending intake entries. Counts InboxProjection
// rows (cheap to query on demand; the cached counter is a soft hint
// to avoid the round-trip on the hot path).
let MAX_INTAKE = 5000;
export function setMaxIntake(n) {
  if (Number.isFinite(n) && n > 0) {
    MAX_INTAKE = Math.max(100, Math.min(Math.floor(n), 1_000_000));
  }
}
export async function getPendingIntakeCount() {
  return await InboxProjection.estimatedDocumentCount();
}

/**
 * Enqueue a transport-act intake entry. The human acted from their
 * own transport (WS/HTTP/CLI); we represent that as a self-summon
 * Fact (the human summoned themselves to perform the wrapped verb).
 * The cross-cutting fold materializes the InboxProjection row; the
 * scheduler picks it like any other entry.
 *
 * kind="summon" entries are no longer accepted here — the CALL
 * verb in seed/ibp/verbs/call.js stamps the call Fact directly.
 *
 * @returns {Promise<{ correlation, sentAt, deduped?: boolean }>}
 */
export async function enqueueIntake(spaceId, beingId, entry) {
  if (!spaceId) throw new Error("enqueueIntake requires spaceId");
  if (!beingId) throw new Error("enqueueIntake requires beingId");
  if (!entry || typeof entry !== "object") {
    throw new Error("enqueueIntake requires an entry object");
  }
  const kind = entry.kind;
  if (kind !== "transport-act") {
    throw new Error(
      `enqueueIntake: kind "${kind}" no longer accepted. SUMMONs flow ` +
      `through the SUMMON verb directly; only "transport-act" remains.`,
    );
  }

  const sentAt = entry.sentAt || new Date().toISOString();
  const correlation = entry.correlation || randomUUID();
  const rootCorrelation = entry.rootCorrelation || correlation;

  // Secrets never ride the chain. The entry is about to be stamped
  // into a summon fact (and mirrored by the inbox projection) — pull
  // credential leaves (password, importKey, ...) into the in-memory
  // stash; "[held]" markers ride in their place and the pick path
  // grafts the values back (see secretStash.js).
  entry = stashSecrets(correlation, entry);

  // Idempotency on the projection's _id (which is the correlation).
  const existing = await InboxProjection.findById(correlation).lean();
  if (existing) {
    return {
      correlation: existing._id,
      sentAt:      existing.sentAt?.toISOString?.() || sentAt,
      deduped:     true,
    };
  }

  const total = await InboxProjection.estimatedDocumentCount();
  if (total >= MAX_INTAKE) {
    throw new Error(
      `Intake cap reached: ${MAX_INTAKE} pending entries place-wide.`,
    );
  }

  // Self-summon Fact: the being is the actor AND the recipient. The
  // params carry the transport-act payload; the scheduler reads them
  // when picking. The Fact lands on the being's own reel (single-
  // writer — the being is the actor; target=recipient=self). The
  // verb is `summon` (its own namespace, peer to DO and BE);
  // self-summon is the target.id===actor case. enqueueIntake runs
  // OUTSIDE a moment (it kicks one off), so emitFact's no-moment
  // path applies: immediate commit via sealFacts singleton.
  await emitFact({
    verb:    "call",
    act:     "call",
    through: String(beingId),
    // The actor NAME. This self-summon is stamped OUTSIDE a moment (it
    // kicks one off), so emitFact's actorAct.by derivation can't
    // fire — thread the caller's signed-in Name off the entry's identity
    // so the wake-call fact links to the name that did it, same as the
    // inner act will when the moment seals. Null for keyless/anonymous
    // transport (pre-Name).
    by:      entry.identity?.nameId || null,
    of:      { kind: "being", id: String(beingId) },
    params:  {
      correlation,
      rootCorrelation,
      inReplyTo:       entry.inReplyTo || null,
      sender:          entry.from || "transport",
      content:         entry,           // the whole entry rides as content
      priority:        entry.priority || "INTERACTIVE",
      activeAble:      entry.activeAble || null,
      attachments:     entry.attachments,
      inboxSpaceId:    String(spaceId),
      sentAt,
      transportAct:    true,            // marker for the scheduler / moment
    },
    // History threads off the entry; the inbox fold reads fact.history
    // when upserting the projection row so the scheduler can pick
    // history-scoped. Caller (transport-act dispatch) must attach
    // history from the wire layer's parsed address; no silent fallback.
    history:  assertHistoryOrThrow(entry.history, "enqueueIntake(entry)"),
  });

  return { correlation, sentAt };
}

/**
 * Pick the next intake entry the scheduler should process for this
 * being. Highest priority first; ties to oldest. Reads the
 * InboxProjection directly; the projection is the source of truth.
 *
 * The "claim" of a picked entry is in-memory in the scheduler —
 * scheduler.js holds the Map<beingId, currentCorrelation> that
 * prevents a second pick before the first moment seals. This
 * function only reads; it doesn't mutate the projection. A crashed
 * moment leaves the projection row in place and the next tick
 * re-picks it. Self-healing.
 *
 * @param {string} spaceId  the inbox-space (recipient's stance)
 * @param {string} beingId  the recipient
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.excludeCorrelations]  correlations the
 *        caller already attempted (or skipped: paused/deleted branch)
 *        this pass. Excluding them HERE keeps one blocked top row from
 *        starving the rest of the inbox — the pick falls through to the
 *        next-best row instead of returning the same one forever.
 * @returns {Promise<null | { entry, index }>}
 */
export async function pickNextIntake(spaceId, beingId, opts = {}) {
  if (!beingId) return null;
  const exclude = opts.excludeCorrelations
    ? Array.from(opts.excludeCorrelations, String)
    : [];
  // Priority order: HUMAN, GATEWAY, INTERACTIVE, BACKGROUND — sorted
  // on the numeric priorityRank (1..4) the fold writes, because the
  // string enum sorts lexically to the WRONG order (BACKGROUND would
  // pick before HUMAN). Within a rank, oldest sentAt wins (FIFO).
  const row = await InboxProjection.findOne({
    recipient:    String(beingId),
    ...(spaceId ? { inboxSpaceId: String(spaceId) } : {}),
    ...(exclude.length ? { _id: { $nin: exclude } } : {}),
  })
    .sort({ priorityRank: 1, sentAt: 1 })
    .lean();
  if (!row) return null;

  // Shape the return for back-compat with callers that destructure
  // { entry, index }. `index` is no longer meaningful (no array
  // position); we pass the correlation as a stand-in identifier.
  //
  // Secret leaves (password, importKey, ...) ride the chain as
  // "[held]" markers; restoreSecrets grafts the real values back from
  // the in-memory stash, keyed by the correlation (= row._id). The
  // restore covers the whole content (the stash paths are entry-
  // rooted), so the surfaced act below inherits the real values.
  const content = row.content ? restoreSecrets(row._id, row.content) : row.content;
  return {
    entry: {
      kind:            content?.kind || (content?.transportAct ? "transport-act" : "call"),
      correlation:     row._id,
      rootCorrelation: row.rootCorrelation,
      from:            row.sender,
      content,
      // Envelope intent. Surfaced here so the receiver's able handler
      // (LLM cognition, scripted summon(), or the human inbox panel)
      // can dispatch on the caller's stated purpose without re-reading
      // the projection row. See seed/SUMMON.md.
      intent:          row.intent || null,
      priority:        row.priority,
      activeAble:      row.activeAble,
      orientation:     row.orientation || "forward",
      inReplyTo:       row.inReplyTo,
      attachments:     row.attachments,
      sentAt:          row.sentAt?.toISOString?.() || row.sentAt,
      // For transport-act entries the whole original entry is stored
      // under row.content (enqueueIntake stuffs it there). Surface the
      // act payload + identity so runTransportAct in momentum.js gets
      // them on moment without re-reading row.content.
      act:             content?.act || null,
      identity:        content?.identity || null,
      // History the moment will run in. Sourced from the inbox row's
      // history field (written by the fold from the call fact's
      // history). assign.js reads entry.history to seed moment.
      // A row with null history indicates a data integrity issue — the
      // fold should always have populated it from the originating
      // fact. assert so the corruption surfaces immediately.
      history:          assertHistoryOrThrow(row.history, "intake.pick(row)"),
    },
    index: row._id, // correlation as identifier
  };
}

/**
 * Retired (Bucket 3 Option D). Running state is in-memory in
 * scheduler.js. Kept as a no-op so existing callers don't crash.
 */
export async function markIntakeRunning(/* spaceId, beingId, index */) {
  // no-op
}

/**
 * Retired (Bucket 3 Option D + Round 5). True no-op. The ONLY path
 * that closes an InboxProjection row is closeInboxOnAnswer firing
 * from sealAct when an answering Act materializes with answers:C.
 * A failed cognition produces no Act (Round 5), so no answers:C,
 * so the inbox stays open — automatically, by the model.
 *
 * The previous "defensive eviction" here ran on EVERY moment
 * completion (success or failure) and closed the row unconditionally,
 * breaking the structural guarantee that "failed moment leaves zero
 * trace including no inbox close." Removed.
 *
 * Kept as a no-op tombstone so callers that haven't migrated don't
 * crash. Returns { consumed: 0 } so any caller that reads the
 * return shape sees nothing was closed by this path.
 */
export async function markIntakeComplete(/* spaceId, beingId, correlationIds, opts */) {
  return { consumed: 0 };
}

/**
 * Retired (Bucket 3 Option D). There is no cancelling queued work: a
 * call is a fact, a response is a fact, and an appended fact is never
 * unmade. Kept as a no-op so existing callers don't crash.
 */
export async function cancelIntakeByRoot(/* spaceId, beingId, rootCorrelation */) {
  return { cancelled: 0, correlations: [] };
}
