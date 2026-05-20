// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.3.0 — Users → Beings unification + home territories.
 *
 * Two coupled transitions:
 *
 * 1. Every existing User row becomes a Being row with
 *    `operatingMode = "human"`. All existing fields carry forward
 *    unchanged (password stays bcrypt-hashed, llmDefault preserved,
 *    isAdmin/isRemote/homeLand/metadata preserved). AI beings are
 *    created lazily by their extensions and are NOT part of this
 *    migration.
 *
 * 2. Every migrated being also gets a home territory Node: a real Node
 *    owned by the being, parented under the land root, that becomes
 *    their home in the world. `Being.homePositionId` points at it.
 *    The address shorthand `/~<username>` resolves through this Node
 *    once the address grammar updates.
 *
 *    Existing user-owned tree roots stay where they are (children of
 *    the land root). They remain accessible by direct path; the home
 *    Node is initially empty and the user can build inside it. A
 *    future pass may move user trees inside their home territory; for
 *    now structural shape stays compatible.
 *
 * Non-destructive:
 *   - Legacy `users` collection is untouched.
 *   - Idempotent: if a Being row or home Node already exists, skip the
 *     duplicate creation; re-runs are safe.
 *   - The first admin's `isAdmin` flag carries forward.
 */

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import log from "../core/log.js";
import Being from "../models/being.js";
import Node from "../models/node.js";
import { getLandRootId } from "../landRoot.js";

export default async function migrate() {
  const usersColl = mongoose.connection.collection("users");
  const userDocs = await usersColl.find({}).toArray();

  if (userDocs.length === 0) {
    log.info("Seed/0.3.0", "no User rows to migrate (fresh land or already migrated)");
    return;
  }

  const landRootId = getLandRootId();
  if (!landRootId) {
    throw new Error("Cannot run 0.3.0 migration — land root not initialized yet. Boot order issue.");
  }

  let inserted = 0;
  let skipped  = 0;
  let failed   = 0;
  let homesCreated = 0;

  for (const u of userDocs) {
    try {
      // Step 1: Being row. Skip if already migrated (idempotent re-run).
      let beingId = u._id;
      const existing = await Being.findById(u._id).select("_id homePositionId").lean();

      if (!existing) {
        const beingDoc = {
          _id:           u._id,
          name:      u.name,
          operatingMode: "human",
          password:      u.password,         // already bcrypt-hashed
          isAdmin:       !!u.isAdmin,
          role:          null,
          homePositionId: null,              // set in step 2
          llmDefault:    u.llmDefault || null,
          isRemote:      !!u.isRemote,
          homeLand:      u.homeLand || null,
          metadata:      u.metadata || {},
          createdAt:     u.createdAt || new Date(),
          updatedAt:     u.updatedAt || new Date(),
        };
        await mongoose.connection.collection("beings").insertOne(beingDoc);
        inserted++;
      } else {
        skipped++;
      }

      // Step 2: home territory Node. Create one if the being doesn't
      // already have a homePositionId pointing at a real Node.
      let homeNodeId = existing?.homePositionId || null;
      if (homeNodeId) {
        const homeStillExists = await Node.findById(homeNodeId).select("_id").lean();
        if (!homeStillExists) homeNodeId = null;
      }

      if (!homeNodeId) {
        const homeName = `~${u.name}`;
        // Direct insert through Mongoose so afterNodeCreate hooks fire
        // (position auto-placement etc.). Mirrors createNode but uses
        // direct create to keep migration self-contained.
        const homeNode = await Node.create({
          _id: uuidv4(),
          name: homeName,
          type: "home-territory",
          parent: landRootId,
          rootOwner: beingId,
          contributors: [],
          status: "active",
        });
        // Wire the home Node id back onto the being.
        await mongoose.connection.collection("beings").updateOne(
          { _id: beingId },
          { $set: { homePositionId: String(homeNode._id) } },
        );
        // Add to the land root's children list so navigation works.
        await Node.updateOne(
          { _id: landRootId },
          { $addToSet: { children: String(homeNode._id) } },
        );
        homesCreated++;
      }
    } catch (err) {
      failed++;
      log.warn("Seed/0.3.0",
        `failed to migrate user ${String(u._id).slice(0, 8)} (${u.name}): ${err.message}`);
    }
  }

  log.info("Seed/0.3.0",
    `Users → Beings: ${inserted} inserted, ${skipped} already present, ${homesCreated} home territories created, ${failed} failed ` +
    `(of ${userDocs.length} total). Legacy users collection preserved.`);

  if (failed > 0) {
    throw new Error(`${failed} user(s) failed to migrate. Inspect logs and re-run.`);
  }

  // ── Step 3: rename foreign-key fields in dependent collections ──
  //
  // Models now declare `beingId` (or `beingIn` for Chat) where they
  // used to declare `userId`. Existing documents need their field
  // names updated to match, or Mongoose reads will return docs
  // missing the new key. Each rename is idempotent: $rename on a
  // field that's already been renamed is a no-op.
  const renames = [
    { collection: "notes",                from: "userId", to: "beingId" },
    { collection: "contributions",        from: "userId", to: "beingId" },
    { collection: "customllmconnections", from: "userId", to: "beingId" },
    { collection: "aichats",              from: "userId", to: "beingIn" },
  ];
  for (const { collection, from, to } of renames) {
    try {
      const coll = mongoose.connection.collection(collection);
      const result = await coll.updateMany(
        { [from]: { $exists: true } },
        { $rename: { [from]: to } },
      );
      if (result.modifiedCount > 0) {
        log.info("Seed/0.3.0",
          `${collection}.${from} → ${collection}.${to}: renamed in ${result.modifiedCount} doc(s)`);
      }
    } catch (err) {
      log.warn("Seed/0.3.0",
        `field rename failed on ${collection}.${from} → ${to}: ${err.message}`);
    }
  }
}
