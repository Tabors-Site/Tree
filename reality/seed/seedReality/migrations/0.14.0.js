// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.14.0 — Being.homePositionId/currentPositionId rename.
 *
 * The Being schema's position fields rename to match the Space primitive:
 *
 *   homePositionId    → homeSpace
 *   currentPositionId → currentSpace
 *
 * These fields both `ref: "Space"`; the old names carried the legacy
 * "position" terminology from before the Node → Space rename. With the
 * Space primitive locked, the field names align: where a being lives
 * (homeSpace) and where they are right now (currentSpace).
 *
 * Idempotent: skips when the new names are already present and the old
 * names are absent. Re-running after partial application is safe.
 *
 * Bumps SEED_VERSION 0.13.0 → 0.14.0.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.14.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  if (!collections.some((c) => c.name === "beings")) {
    log.verbose("Seed/0.14.0", "no beings collection; nothing to rename");
    return;
  }

  const beings = db.collection("beings");

  // ── homePositionId → homeSpace ─────────────────────────────────────
  const homeRes = await beings.updateMany(
    { homePositionId: { $exists: true } },
    { $rename: { homePositionId: "homeSpace" } },
  );
  if (homeRes.modifiedCount > 0) {
    log.info("Seed/0.14.0",
      `renamed homePositionId → homeSpace on ${homeRes.modifiedCount} being(s)`);
  } else {
    log.verbose("Seed/0.14.0", "no beings carry legacy homePositionId field");
  }

  // ── currentPositionId → currentSpace ───────────────────────────────
  const curRes = await beings.updateMany(
    { currentPositionId: { $exists: true } },
    { $rename: { currentPositionId: "currentSpace" } },
  );
  if (curRes.modifiedCount > 0) {
    log.info("Seed/0.14.0",
      `renamed currentPositionId → currentSpace on ${curRes.modifiedCount} being(s)`);
  } else {
    log.verbose("Seed/0.14.0", "no beings carry legacy currentPositionId field");
  }

  // ── drop + recreate the compound index that used the old name ───────
  // Mongoose recreates the canonical index on next ensureIndexes(); we
  // just drop the legacy one if it's there so the rename doesn't leave
  // a stale index pointing at a now-missing field name.
  try {
    const indexes = await beings.indexes();
    const legacy = indexes.find((i) =>
      i.key && Object.keys(i.key).includes("homePositionId"));
    if (legacy) {
      await beings.dropIndex(legacy.name);
      log.info("Seed/0.14.0", `dropped legacy index ${legacy.name} on homePositionId`);
    }
  } catch (err) {
    log.warn("Seed/0.14.0", `could not drop legacy index: ${err.message}`);
  }
}
