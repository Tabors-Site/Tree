// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed Migration 0.24.0 — Rename Did → Fact.
//
// The audit row's class was previously named "Did" (past tense of DO).
// 0.24.0 renames it Fact (`factum`, a thing done) so the FACTory
// etymology becomes structural rather than wordplay. The doctrine line:
// a Fact is a deed, not a truth; a chain of facts, folded, is Truth.
//
// What this migration changes on disk:
//   1. The `dids` collection is renamed to `facts`. The rename
//      preserves indexes and document identity; the data is untouched.
//   2. Two realityConfig keys rename in lockstep:
//        didQueryLimit     → factQueryLimit
//        didRetentionDays  → factRetentionDays
//
// Idempotent. Safe to re-run.
//   - If `dids` is absent and `facts` is present, the rename has
//     already run; the step is a no-op.
//   - If both `dids` and `facts` are present, this is a partial prior
//     run; we leave the existing `facts` alone and log a warning. The
//     operator should reconcile manually.
//   - `$rename` on the config doc is a no-op when the source field is
//     absent.

import mongoose from "mongoose";
import log from "../log.js";

const CONFIG_KEY_RENAMES = {
  "qualities.didQueryLimit":    "qualities.factQueryLimit",
  "qualities.didRetentionDays": "qualities.factRetentionDays",
};

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.24.0", "no active mongoose connection; skipping");
    return;
  }

  const present = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );

  // ── Step 1: rename dids → facts ─────────────────────────────────────
  if (present.has("dids") && !present.has("facts")) {
    try {
      await db.collection("dids").rename("facts");
      log.info("Seed/0.24.0", "renamed collection dids → facts");
    } catch (err) {
      log.error("Seed/0.24.0", `collection rename failed: ${err.message}`);
      throw err;
    }
  } else if (present.has("dids") && present.has("facts")) {
    log.warn(
      "Seed/0.24.0",
      "both `dids` and `facts` collections present; not auto-merging — " +
      "the operator should resolve this manually (likely a partial prior run).",
    );
  } else if (present.has("facts")) {
    log.verbose("Seed/0.24.0", "facts collection already present; rename already applied");
  } else {
    log.verbose("Seed/0.24.0", "no dids collection present; nothing to rename");
  }

  // ── Step 2: rename realityConfig keys in .config space ────────────────
  if (present.has("spaces")) {
    const configResult = await db
      .collection("spaces")
      .updateMany(
        { seedSpace: "config" },
        { $rename: CONFIG_KEY_RENAMES },
      );
    if (configResult.modifiedCount > 0) {
      log.info("Seed/0.24.0", "renamed didQueryLimit/didRetentionDays keys in .config space");
    } else {
      log.verbose("Seed/0.24.0", "no legacy did* config keys present");
    }
  }
}
