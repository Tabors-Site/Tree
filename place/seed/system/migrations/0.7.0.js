// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.7.0 — Being.currentPositionId introduction.
 *
 * 0.7.0 adds `currentPositionId` to Being: the being's current position
 * in the world, distinct from their home. Single-context model — a
 * being is at exactly one position at any moment, shared across all
 * their connected sockets.
 *
 * Backfill rule: existing beings get `currentPositionId = homePositionId`.
 * That's the natural starting point — every being starts "at home."
 * Beings without a home (legacy rows missing homePositionId) stay
 * with `currentPositionId: null` and only get a position when they
 * first navigate.
 *
 * Idempotent: only writes to rows where currentPositionId is missing
 * AND homePositionId is set. Re-running does nothing.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const coll = mongoose.connection.collection("beings");

  const result = await coll.updateMany(
    {
      currentPositionId: { $in: [null, undefined] },
      homePositionId:    { $exists: true, $ne: null },
    },
    [
      { $set: { currentPositionId: "$homePositionId" } },
    ],
  );

  if (result.modifiedCount > 0) {
    log.info("Seed/0.7.0",
      `backfilled currentPositionId from homePositionId on ${result.modifiedCount} being(s)`);
  } else {
    log.info("Seed/0.7.0", "no beings needed currentPositionId backfill");
  }
}
