// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.20.0 — Space schema field rename:
 * `systemRole` → `seedSpace`.
 *
 * The enum that names kernel-managed Space kinds (`.identity`,
 * `.config`, `.peers`, etc.) renamed SEED_SPACE / SYSTEM_ROLE →
 * SEED_SPACE. The Space schema's field carrying that value renamed
 * `systemRole` → `seedSpace` to match. This migration copies the
 * existing field on every Space row so the new schema sees its data
 * under the new name.
 *
 * Why rename: "systemRole" conflated with the Being-role registry
 * (ruler, planner, contractor, etc.). The enum values
 * (`"place-root"`, `"identity"`, ...) describe what KIND of seed-
 * managed Space a position is, not a role a being plays.
 *
 * Idempotent. Reads from `systemRole`, writes to `seedSpace`, then
 * unsets `systemRole` on the same documents. Re-running is a no-op
 * because the filter excludes rows where `seedSpace` is already set.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.20.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  if (!collections.some((c) => c.name === "spaces")) {
    log.verbose("Seed/0.20.0", "no spaces collection; nothing to copy");
    return;
  }

  const spaces = db.collection("spaces");

  // MongoDB doesn't support copy-from-other-field in a single update,
  // so we fetch the affected rows and rewrite each. The set is small
  // (one row per place-seed space, typically <10 per place).
  const cursor = spaces.find(
    { systemRole: { $exists: true, $ne: null }, seedSpace: { $exists: false } },
    { projection: { _id: 1, systemRole: 1 } },
  );

  let copied = 0;
  let docs;
  try {
    docs = await cursor.toArray();
  } finally {
    try { await cursor.close(); } catch {}
  }

  for (const doc of docs) {
    await spaces.updateOne(
      { _id: doc._id },
      { $set: { seedSpace: doc.systemRole } },
    );
    copied++;
  }

  // Drop the legacy field once values have been copied. Safe to run
  // even when no rows were copied this pass — $unset is a no-op for
  // documents that lack the field.
  const unset = await spaces.updateMany(
    { systemRole: { $exists: true } },
    { $unset: { systemRole: "" } },
  );

  if (copied > 0 || unset.modifiedCount > 0) {
    log.info("Seed/0.20.0",
      `renamed Space.systemRole → seedSpace ` +
      `(copied ${copied}, unset legacy field on ${unset.modifiedCount})`);
  } else {
    log.verbose("Seed/0.20.0", "no Space rows carried legacy systemRole; clean");
  }
}
