// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed Migration 0.25.0 — Per-reel seq + reelHeads.
//
// First reformation slice for the projection-from-facts architecture.
// Adds the per-reel monotonic sequence the fold depends on.
//
// What this migration does on disk:
//   1. Backfills `seq` on every existing Fact whose target identifies
//      a reel-bearing aggregate (target.kind ∈ {being,space,matter} AND
//      target.id is set). Per-reel groups are sorted by (date asc,
//      _id asc) for a stable order and assigned monotonic seq starting
//      at 1.
//   2. Populates the `reelHeads` collection with the final head per
//      (type, id) so future `allocSeq` calls continue from the
//      backfilled max.
//
// Facts without a reel-bearing target (e.g. place-level config, multi-
// being ops) are left with `seq: null` — they sit outside the fold
// model for now.
//
// Idempotent. Safe to re-run:
//   - Facts that already have seq set are skipped (the per-reel scan
//     starts from max(seq) + 1, so partial prior runs continue rather
//     than restart).
//   - reelHeads.ensureHeadAtLeast never regresses; existing heads stay
//     if already at the target value.
//
// Index management: the unique partial index on (target.kind,
// target.id, seq) is declared on the Fact schema (autoIndex creates it
// at model load). The partial filter excludes null seq, so the index
// is empty before backfill and fills naturally as backfill assigns
// values. Mongoose reconciles on the next boot.

import mongoose from "mongoose";
import log from "../log.js";

const REEL_TYPES = new Set(["being", "space", "matter"]);
const BATCH_LIMIT = 1000;

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.25.0", "no active mongoose connection; skipping");
    return;
  }

  const present = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  if (!present.has("facts")) {
    log.verbose("Seed/0.25.0", "no facts collection present; nothing to backfill");
    return;
  }

  const facts = db.collection("facts");
  const reelHeads = db.collection("reelHeads");

  // ── Step 1: enumerate reel-bearing target groups ────────────────────
  // Distinct (target.kind, target.id) pairs that have at least one fact.
  // Done as an aggregation rather than $distinct so we can filter the
  // valid kinds in one query.
  const groups = await facts.aggregate([
    { $match: {
        "target.kind": { $in: [...REEL_TYPES] },
        "target.id":   { $exists: true, $ne: null },
    }},
    { $group: { _id: { kind: "$target.kind", id: "$target.id" } }},
  ]).toArray();

  if (groups.length === 0) {
    log.verbose("Seed/0.25.0", "no reel-bearing facts present; nothing to backfill");
    return;
  }

  let backfilledFacts = 0;
  let touchedReels = 0;
  let skippedReels = 0;

  // ── Step 2: per-group, assign seq to facts missing it ───────────────
  for (const { _id: { kind, id } } of groups) {
    // Resume point: highest seq already assigned in this reel.
    const lastWithSeq = await facts
      .find({ "target.kind": kind, "target.id": id, seq: { $type: "number" } })
      .project({ seq: 1 })
      .sort({ seq: -1 })
      .limit(1)
      .toArray();
    let nextSeq = (lastWithSeq[0]?.seq || 0) + 1;
    const startSeq = nextSeq;

    // Walk the unseq'd facts in deterministic order. Sort by (date asc,
    // _id asc); _id is a UUID string and is stable across replicas.
    while (true) {
      const batch = await facts
        .find({
          "target.kind": kind,
          "target.id":   id,
          seq:           null,
        })
        .project({ _id: 1, date: 1 })
        .sort({ date: 1, _id: 1 })
        .limit(BATCH_LIMIT)
        .toArray();
      if (batch.length === 0) break;

      const ops = batch.map((f) => ({
        updateOne: {
          filter: { _id: f._id, seq: null },
          update: { $set: { seq: nextSeq++ } },
        },
      }));
      const result = await facts.bulkWrite(ops, { ordered: true });
      backfilledFacts += result.modifiedCount || 0;
      // If a concurrent writer (shouldn't happen at migration time but
      // be defensive) snuck a seq onto one of these, modifiedCount will
      // be < batch.length and nextSeq will have advanced past it. The
      // unique partial index would then reject any second attempt — by
      // design, we never reuse a seq number for a different fact.
    }

    // ── Step 3: write the reel head ───────────────────────────────────
    const finalHead = nextSeq - 1;
    if (finalHead >= startSeq || finalHead > 0) {
      const reelKey = `${kind}:${id}`;
      const upsertResult = await reelHeads.findOneAndUpdate(
        { _id: reelKey, head: { $lt: finalHead } },
        { $set: { head: finalHead, type: kind, id: id } },
        { upsert: false, returnDocument: "after" },
      );
      if (!upsertResult.value) {
        // Either head was already >= finalHead, or no doc exists.
        const existing = await reelHeads.findOne({ _id: reelKey });
        if (!existing) {
          await reelHeads.insertOne({ _id: reelKey, type: kind, id: id, head: finalHead });
        }
      }
      touchedReels++;
    } else {
      skippedReels++;
    }
  }

  log.info(
    "Seed/0.25.0",
    `backfill complete: ${backfilledFacts} fact(s) seq-stamped across ${touchedReels} reel(s)` +
    (skippedReels > 0 ? `, ${skippedReels} reel(s) already complete` : ""),
  );
}
