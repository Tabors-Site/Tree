// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.11.0 — Being.role → Being.roles[] + defaultRole.
 *
 * Identity is durable; role is composable per summon. The earlier static
 * `role: String` field conflated the two: each being was locked to one
 * role for its lifetime. The corrected model: a being carries a *set*
 * of roles it's capable of acting in (`roles: [String]`) plus a default
 * (`defaultRole: String`) used when a SUMMON envelope doesn't specify
 * an active role.
 *
 * This migration is the rip-clean pass:
 *   1. For every Being with a non-null `role`, set
 *        roles:       [<existing role>]
 *        defaultRole: <existing role>
 *   2. $unset the legacy `role` field entirely.
 *   3. Drop the legacy `role_1` index.
 *   4. Sync the new indexes (`roles_1`, `defaultRole_1`).
 *
 * Idempotent. Re-running after a partial migration completes safely —
 * beings that already have `roles` set are skipped at step 1.
 *
 * Bumps SEED_VERSION 0.10.0 → 0.11.0.
 *
 * See [[project_identity_durable_role_composable]] for the architectural
 * framing.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.11.0", "no active mongoose connection; skipping");
    return;
  }

  const beingsExist = (await db.listCollections({ name: "beings" }, { nameOnly: true }).toArray()).length > 0;
  if (!beingsExist) {
    log.verbose("Seed/0.11.0", "no beings collection present; nothing to migrate");
    return;
  }

  const beings = db.collection("beings");

  // ── Step 1: backfill roles + defaultRole from legacy `role` ──────────
  // Only beings that have a `role` set AND don't yet have `defaultRole`.
  // Idempotency: re-runs skip beings already migrated.
  const cursor = beings.find({
    role: { $exists: true, $nin: [null, ""] },
    $or: [
      { defaultRole: { $exists: false } },
      { defaultRole: null },
    ],
  });

  let backfilled = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const role = doc.role;
    await beings.updateOne(
      { _id: doc._id },
      {
        $set: {
          roles:       [role],
          defaultRole: role,
        },
      },
    );
    backfilled++;
  }
  if (backfilled > 0) {
    log.info("Seed/0.11.0", `backfilled roles + defaultRole on ${backfilled} being(s) from legacy role`);
  }

  // Step 1.5: humans that had no role get an empty roles array.
  // Without this, downstream code reading `being.roles` on a human would
  // get undefined and need a fallback. Empty array is the right shape.
  const humanRes = await beings.updateMany(
    { roles: { $exists: false } },
    { $set: { roles: [], defaultRole: null } },
  );
  if (humanRes.modifiedCount > 0) {
    log.info("Seed/0.11.0", `seeded empty roles[] on ${humanRes.modifiedCount} being(s) without a role`);
  }

  // ── Step 2: drop the legacy `role` field entirely ────────────────────
  const unsetRes = await beings.updateMany(
    { role: { $exists: true } },
    { $unset: { role: "" } },
  );
  if (unsetRes.modifiedCount > 0) {
    log.info("Seed/0.11.0", `dropped legacy role field from ${unsetRes.modifiedCount} being(s)`);
  }

  // ── Step 3: drop the legacy `role_1` index if present ────────────────
  try {
    const indexes = await beings.indexes();
    for (const idx of indexes) {
      if (idx.key && Object.keys(idx.key).length === 1 && idx.key.role === 1) {
        await beings.dropIndex(idx.name);
        log.info("Seed/0.11.0", `dropped legacy index ${idx.name} on role`);
      }
    }
  } catch (err) {
    log.warn("Seed/0.11.0", `could not enumerate/drop legacy role index: ${err.message}`);
  }

  // ── Step 4: ensure new indexes exist (Mongoose syncs from model
  //            on next ensureIndexes call; explicit createIndex is a
  //            safety net so migrations don't depend on Model load
  //            order).
  try {
    await beings.createIndex({ roles: 1 });
    await beings.createIndex({ defaultRole: 1 });
  } catch (err) {
    log.warn("Seed/0.11.0", `could not ensure new role indexes: ${err.message}`);
  }
}
