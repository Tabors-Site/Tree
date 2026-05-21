// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.21.0 — Retire the `citizen` system being.
 *
 * `citizen` (read-only browsing of the land's public surface) was
 * listed in LAND_BEINGS but never had a role template registered.
 * Any SUMMON `@citizen` would fail with ROLE_UNAVAILABLE. Removed from
 * the system-being canon 2026-05-20.
 *
 * This migration deletes the leftover Being row by name and scrubs the
 * `metadata.beings.citizen` entry from the land root. Idempotent.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.21.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((c) => c.name));

  let beingRemoved = 0;
  if (names.has("beings")) {
    const result = await db.collection("beings").deleteMany({ name: "citizen" });
    beingRemoved = result.deletedCount || 0;
  }

  let metaScrubbed = 0;
  if (names.has("spaces")) {
    const result = await db.collection("spaces").updateMany(
      { "metadata.beings.citizen": { $exists: true } },
      { $unset: { "metadata.beings.citizen": "" } },
    );
    metaScrubbed = result.modifiedCount || 0;
  }

  if (beingRemoved > 0 || metaScrubbed > 0) {
    log.info("Seed/0.21.0",
      `retired citizen system being ` +
      `(deleted ${beingRemoved} Being row(s), ` +
      `scrubbed metadata.beings.citizen on ${metaScrubbed} Space(s))`);
  } else {
    log.verbose("Seed/0.21.0", "no citizen residue; clean");
  }
}
