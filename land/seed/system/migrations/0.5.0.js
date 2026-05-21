// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.5.0 — rename metadata.beings → metadata.beings.
 *
 * Vocabulary cleanup. The metadata namespace that records which beings
 * live at a position has been renamed from "beings" to "beings"
 * to match the unified-identity vocabulary:
 *
 *   - A "being" is the instance (a real account with identity, role,
 *     home position).
 *   - A "role" is the template the being follows (still defined in
 *     portal/roles/registry.js as the role-template registry).
 *   - The metadata at a position is a residence index: beings live
 *     here. The natural name is `qualities.beings`.
 *
 * The data shape is unchanged:
 *
 *   metadata.beings = {
 *     <roleName>: { beingId, installedAt, installedBy, scopeRulerId, ... },
 *     arrival: { permissions: {...} },   // legacy stance profiles ride along
 *     owner:   { permissions: {...} },
 *   }
 *
 * Non-destructive: $rename is atomic per document; if the destination
 * already exists (e.g. partial replay) MongoDB drops the source and
 * keeps the destination. Idempotent.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const coll = mongoose.connection.collection("nodes");
  // Only touch documents that actually have metadata.beings. The
  // filter keeps this fast on fresh lands and idempotent on re-runs.
  const result = await coll.updateMany(
    { "qualities.embodiments": { $exists: true } },
    { $rename: { "qualities.embodiments": "qualities.beings" } },
  );
  if (result.modifiedCount > 0) {
    log.info("Seed/0.5.0",
      `renamed metadata.embodiments → metadata.beings on ${result.modifiedCount} node(s)`);
  } else {
    log.info("Seed/0.5.0", "no nodes carried metadata.embodiments — nothing to rename");
  }
}
