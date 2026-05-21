// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed Migration 0.23.0 — Rename the extension-data Map field to `qualities`.
//
// The Map field that carries each primitive's extension data was
// previously named with the generic word for "data about data." 0.23.0
// renames the field to `qualities`, the word that actually names what
// it holds: Plato's ποιότης (qualitas), the answer to "of what sort is
// this?" Schemas in 0.23.0 declare the field as `qualities`; this
// migration renames the existing field on every Being, Space, and
// Matter row so callers reading the new field name find the existing
// data.
//
// Three placeConfig keys also rename in lockstep so an existing
// .config space's overrides survive the boot:
//   metadataNamespaceMaxBytes → qualityNamespaceMaxBytes
//   metadataMaxNestingDepth   → qualityMaxNestingDepth
//   maxTreeMetadataBytes      → maxTreeQualityBytes
//
// Idempotent. Safe to re-run. Mongo's $rename is a no-op when the
// source field is absent on a document.

import mongoose from "mongoose";
import log from "../log.js";

const COLLECTIONS = ["beings", "spaces", "matters"];

const CONFIG_KEY_RENAMES = {
  "qualities.metadataNamespaceMaxBytes": "qualities.qualityNamespaceMaxBytes",
  "qualities.metadataMaxNestingDepth":   "qualities.qualityMaxNestingDepth",
  "qualities.maxTreeMetadataBytes":      "qualities.maxTreeQualityBytes",
};

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.23.0", "no active mongoose connection; skipping");
    return;
  }

  const present = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );

  let totalRenamed = 0;
  for (const coll of COLLECTIONS) {
    if (!present.has(coll)) continue;
    const result = await db
      .collection(coll)
      .updateMany(
        { metadata: { $exists: true } },
        { $rename: { metadata: "qualities" } },
      );
    const n = result.modifiedCount || 0;
    if (n > 0) {
      log.info("Seed/0.23.0", `renamed extension-data field on ${n} ${coll} row(s)`);
      totalRenamed += n;
    }
  }

  if (present.has("spaces")) {
    const configResult = await db
      .collection("spaces")
      .updateMany(
        { seedSpace: "config" },
        { $rename: CONFIG_KEY_RENAMES },
      );
    if (configResult.modifiedCount > 0) {
      log.info("Seed/0.23.0", "renamed placeConfig keys in .config space");
    }
  }

  if (totalRenamed === 0) {
    log.verbose("Seed/0.23.0", "no rows carried the older field name; nothing to rename");
  }
}
