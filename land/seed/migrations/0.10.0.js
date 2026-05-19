// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.10.0 — Portal Address → IBP Address rename.
 *
 * "Portal Address" was named after the Portal client, but the address is a
 * protocol-level concept that the protocol uses to join two stances. The
 * shape is uniform regardless of which two stances are joined — different
 * beings or same, different positions or same. "IBP Address" makes that
 * symmetry honest: it is the address shape IBP communicates between.
 *
 * Schema changes:
 *   - Field renamed on each Summon doc: `portalAddress` → `ibpAddress`.
 *
 * Idempotent. Re-running after a partial migration completes safely.
 *
 * Bumps SEED_VERSION 0.9.0 → 0.10.0.
 */

import mongoose from "mongoose";
import log from "../core/log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.10.0", "no active mongoose connection; skipping");
    return;
  }

  const summonsExist = (await db.listCollections({ name: "summons" }, { nameOnly: true }).toArray()).length > 0;
  if (!summonsExist) {
    log.verbose("Seed/0.10.0", "no summons collection present; nothing to rename");
    return;
  }

  const summons = db.collection("summons");

  // ── Step 1: rename portalAddress → ibpAddress on every row ──────────
  const res = await summons.updateMany(
    { portalAddress: { $exists: true } },
    { $rename: { portalAddress: "ibpAddress" } },
  );
  if (res.modifiedCount > 0) {
    log.info("Seed/0.10.0", `renamed portalAddress → ibpAddress on ${res.modifiedCount} summon(s)`);
  }

  // ── Step 2: drop the old portalAddress index if it exists ───────────
  try {
    const indexes = await summons.indexes();
    for (const idx of indexes) {
      if (idx.key && Object.prototype.hasOwnProperty.call(idx.key, "portalAddress")) {
        await summons.dropIndex(idx.name);
        log.info("Seed/0.10.0", `dropped legacy index ${idx.name} on portalAddress`);
      }
    }
  } catch (err) {
    log.warn("Seed/0.10.0", `could not enumerate/drop legacy portalAddress indexes: ${err.message}`);
  }

  // ── Step 3: sync new indexes from the model ─────────────────────────
  try {
    const Summon = (await import("../models/summon.js")).default;
    await Summon.syncIndexes();
    log.verbose("Seed/0.10.0", "summon indexes synced");
  } catch (err) {
    log.warn("Seed/0.10.0", `summon index sync failed: ${err.message}`);
  }
}
