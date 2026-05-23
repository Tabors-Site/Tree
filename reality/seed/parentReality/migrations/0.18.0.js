// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.18.0 — retire layer-4 (legacy place-stance permissions).
 *
 * The seed's authorize() used to fall back to per-stance permission
 * rows stored at metadata.beings.arrival.permissions and
 * metadata.beings.owner.permissions on the place root. Layer 4 is gone;
 * the same semantics now live as layer-2 rules at
 * metadata.permissions.<verb>.<keyParts> on the place root, planted by
 * seedDefaultStancePermissions().
 *
 * This migration drops the legacy permission rows. The next boot's
 * seedDefaultStancePermissions() writes the layer-2 defaults idempotently;
 * operators who customized the legacy rows lose those customizations
 * (rare — the legacy shape was seed-internal). If your place has
 * customized stance permissions, port them to the new shape before
 * upgrading.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.18.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  if (!collections.some((c) => c.name === "spaces")) {
    log.verbose("Seed/0.18.0", "no spaces collection; nothing to clean");
    return;
  }

  const spaces = db.collection("spaces");

  // Drop the legacy arrival + owner permission rows on every space
  // (only the place root ever carried them in practice, but $unset on
  // missing paths is a safe no-op).
  const res = await spaces.updateMany(
    {
      $or: [
        { "qualities.beings.arrival.permissions": { $exists: true } },
        { "qualities.beings.owner.permissions":   { $exists: true } },
      ],
    },
    {
      $unset: {
        "qualities.beings.arrival.permissions": "",
        "qualities.beings.owner.permissions":   "",
      },
    },
  );
  if (res.modifiedCount > 0) {
    log.info("Seed/0.18.0",
      `dropped legacy stance permissions from ${res.modifiedCount} space(s); ` +
      `seedDefaultStancePermissions will plant layer-2 defaults on next boot`);
  } else {
    log.verbose("Seed/0.18.0", "no legacy stance permissions to drop");
  }
}
