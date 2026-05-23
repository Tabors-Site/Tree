// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed Migration 0.26.0 — Bucket 3 Option D inbox/intake projection.
//
// Retires the per-Space `qualities.inbox.<beingId>` and
// `qualities.intake.<beingId>` arrays in favor of:
//   - A `be:summon` Fact on the summoner's reel for every open SUMMON
//   - An InboxProjection collection row per open SUMMON, keyed by
//     correlation, maintained by the cross-cutting fold from those
//     facts (see seed/past/act/inboxProjectionFold.js)
//
// What this migration does on disk:
//   1. Walks every Space row that carries qualities.inbox.* or
//      qualities.intake.*
//   2. For each per-being array entry whose `consumed`/`cancelledAt`
//      is unset (i.e. open), stamps a be:summon Fact on I_AM's reel
//      with the original entry's correlation, rootCorrelation, and
//      message envelope. Attributes to I_AM because the legacy
//      arrays did not record the summoner; the historical SUMMONs
//      are folded as if I_AM had been the proxy actor.
//   3. Upserts an InboxProjection row directly for the same entry
//      (belt-and-suspenders: the cross-cutting fold would do this
//      from the stamped Fact, but doing both insulates against any
//      ordering surprise during migration).
//   4. $unsets qualities.inbox and qualities.intake on each Space.
//
// Idempotent. Safe to re-run:
//   - InboxProjection upsert is keyed by correlation; second pass is
//     a no-op on the projection.
//   - Fact insert dedupe: the be:summon Fact also keys off
//     correlation (in params); we skip stamping if a be:summon Fact
//     with that correlation already exists.
//   - The $unset is a no-op once the qualities entries are gone.

import mongoose from "mongoose";
import log from "../log.js";

const BATCH_LIMIT = 200;

export default async function migrate() {
  if (!mongoose.connection?.db) {
    log.warn("Seed/0.26.0", "no active mongoose connection; skipping");
    return;
  }
  const Space = (await import("../../materials/space/space.js")).default;
  const Fact = (await import("../../past/fact/fact.js")).default;
  const InboxProjection = (await import("../../past/act/inboxProjection.js")).default;

  let totalStamped = 0;
  let totalProjections = 0;
  let totalSpaces = 0;
  let skip = 0;

  // Walk spaces carrying inbox OR intake qualities. Mongo can't $or
  // on map-key-existence directly, so use $exists on the nested path
  // with two passes.
  while (true) {
    const batch = await Space.find({
      $or: [
        { "qualities.inbox":  { $exists: true } },
        { "qualities.intake": { $exists: true } },
      ],
    })
      .skip(skip)
      .limit(BATCH_LIMIT)
      .lean();
    if (batch.length === 0) break;

    for (const space of batch) {
      const qualities = space.qualities instanceof Map
        ? Object.fromEntries(space.qualities)
        : (space.qualities || {});
      const inbox = qualities.inbox || {};
      const intake = qualities.intake || {};

      // Prefer the inbox bucket (the canonical mailbox); fall back to
      // intake when only intake had the entry (rare edge case for
      // transport-acts that never wrote the inbox).
      const beingIds = new Set([
        ...Object.keys(inbox),
        ...Object.keys(intake),
      ]);

      for (const beingId of beingIds) {
        const inboxBucket  = Array.isArray(inbox[beingId])  ? inbox[beingId]  : [];
        const intakeBucket = Array.isArray(intake[beingId]) ? intake[beingId] : [];

        // Map both buckets by correlation; intake's lifecycle flags win.
        const byCorrelation = new Map();
        for (const e of inboxBucket) {
          if (e?.correlation) byCorrelation.set(e.correlation, { ...e });
        }
        for (const e of intakeBucket) {
          if (e?.correlation) {
            const prior = byCorrelation.get(e.correlation) || {};
            byCorrelation.set(e.correlation, { ...prior, ...e });
          }
        }

        for (const [correlation, entry] of byCorrelation) {
          // Only migrate OPEN entries. Closed (consumed or cancelled)
          // entries had their lifecycle complete in the legacy model;
          // there's nothing left to do with them in the projection.
          const isClosed = !!entry.consumed || !!entry.cancelledAt;
          if (isClosed) continue;

          const rootCorrelation = entry.rootCorrelation || correlation;
          const sentAt = entry.sentAt ? new Date(entry.sentAt) : new Date();

          // 1) Stamp be:summon Fact (if not already stamped).
          if (Fact) {
            const exists = await Fact.findOne({
              verb:   "be",
              action: "summon",
              "params.correlation": correlation,
            }).select("_id").lean();
            if (!exists) {
              try {
                await Fact.create({
                  verb:    "be",
                  action:  "summon",
                  beingId: "I_AM",
                  target:  { kind: "being", id: "I_AM" },
                  params:  {
                    recipient:       String(beingId),
                    correlation,
                    rootCorrelation,
                    inReplyTo:       entry.inReplyTo || null,
                    sender:          entry.from || null,
                    content:         entry.content ?? null,
                    priority:        entry.priority || "INTERACTIVE",
                    activeRole:      entry.activeRole || null,
                    attachments:     entry.attachments,
                    inboxSpaceId:    String(space._id),
                    sentAt:          sentAt.toISOString(),
                  },
                  date:    sentAt,
                  seq:     null, // backfill by 0.25.0-style scan if needed
                });
                totalStamped++;
              } catch (err) {
                log.warn(
                  "Migration 0.26.0",
                  `Fact stamp failed for correlation ${correlation}: ${err.message}`,
                );
              }
            }
          }

          // 2) Upsert InboxProjection row directly.
          try {
            await InboxProjection.updateOne(
              { _id: correlation },
              {
                $set: {
                  recipient:       String(beingId),
                  summoner:        "I_AM",
                  sender:          entry.from || null,
                  content:         entry.content ?? null,
                  activeRole:      entry.activeRole || null,
                  attachments:     entry.attachments,
                  priority:        entry.priority || "INTERACTIVE",
                  rootCorrelation,
                  inReplyTo:       entry.inReplyTo || null,
                  inboxSpaceId:    String(space._id),
                  sentAt,
                },
                $setOnInsert: { _id: correlation },
              },
              { upsert: true },
            );
            totalProjections++;
          } catch (err) {
            log.warn(
              "Migration 0.26.0",
              `InboxProjection upsert failed for ${correlation}: ${err.message}`,
            );
          }
        }
      }

      // 3) $unset the legacy quality namespaces.
      try {
        await Space.updateOne(
          { _id: space._id },
          { $unset: { "qualities.inbox": "", "qualities.intake": "" } },
        );
        totalSpaces++;
      } catch (err) {
        log.warn(
          "Migration 0.26.0",
          `Failed to $unset qualities.inbox/intake on ${space._id}: ${err.message}`,
        );
      }
    }

    skip += batch.length;
  }

  log.info(
    "Migration 0.26.0",
    `Bucket 3 Option D: stamped ${totalStamped} be:summon Facts, ` +
    `upserted ${totalProjections} InboxProjection rows, ` +
    `cleared inbox/intake on ${totalSpaces} Spaces`,
  );
}
