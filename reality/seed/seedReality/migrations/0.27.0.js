// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed Migration 0.27.0 — INTEGRITY backfill (per-reel hash chains).
//
// Adds `p` (prev-hash) and `h` (self-hash) to every reel-bearing
// Fact that pre-dates the INTEGRITY work. After this runs every
// (target.kind, target.id) reel verifies end-to-end with
// verifyReel(); thereafter every new Fact stamps its own p+h inside
// the seal.
//
// Idempotent. A Fact that already carries `h` is skipped. Re-run is
// a fast no-op once a reel is hashed.
//
// Reel discovery walks the distinct (target.kind, target.id) pairs
// where seq is numeric. For each pair we sort by seq, chain
// GENESIS_PREV → h(seq=1) → h(seq=2) → ..., and $set { p, h } on
// each row.

import mongoose from "mongoose";
import log from "../log.js";

const REEL_KINDS = ["being", "space", "matter"];

export default async function migrate() {
  if (!mongoose.connection?.db) {
    log.warn("Seed/0.27.0", "no active mongoose connection; skipping");
    return;
  }
  const Fact = (await import("../../past/fact/fact.js")).default;
  const { computeHash, contentOf, GENESIS_PREV } =
    await import("../../past/fact/hash.js");

  let totalReels = 0;
  let totalFactsHashed = 0;
  let totalFactsSkipped = 0;

  for (const kind of REEL_KINDS) {
    // Distinct target ids in this kind that have at least one
    // reel-bearing fact. Mongo's `distinct` on the indexed field is
    // cheap; the per-reel walk below handles the bulk work.
    const ids = await Fact.distinct("target.id", {
      "target.kind": kind,
      seq: { $type: "number" },
    });

    for (const targetId of ids) {
      if (!targetId) continue;
      totalReels++;

      const facts = await Fact.find({
        "target.kind": kind,
        "target.id":   targetId,
        seq:           { $type: "number" },
      }).sort({ seq: 1 }).lean();

      let prev = GENESIS_PREV;
      for (const f of facts) {
        // Idempotent: if both p and h already present, just advance
        // prev and move on. We don't recompute or verify here — that
        // is verifyReel's job.
        if (typeof f.h === "string" && typeof f.p === "string") {
          prev = f.h;
          totalFactsSkipped++;
          continue;
        }
        const p = prev;
        // contentOf reads the fields hash.js uses for the digest. The
        // lean object has exactly those fields plus mongoose
        // internals (which contentOf ignores).
        const h = computeHash(p, contentOf(f));
        try {
          await Fact.updateOne({ _id: f._id }, { $set: { p, h } });
          totalFactsHashed++;
        } catch (err) {
          log.warn(
            "Migration 0.27.0",
            `Failed to backfill p/h on fact ${f._id} (${kind}:${targetId} seq=${f.seq}): ${err.message}`,
          );
          // Don't advance prev — the next fact's chain would be wrong.
          // Throw so the runner records the failure and the operator
          // sees it; partial backfill leaves verifyReel green up to
          // the break and red after, which is the correct state.
          throw err;
        }
        prev = h;
      }
    }
  }

  log.info(
    "Migration 0.27.0",
    `INTEGRITY backfill: ${totalReels} reels, ${totalFactsHashed} facts hashed, ${totalFactsSkipped} skipped (already hashed)`,
  );
}
