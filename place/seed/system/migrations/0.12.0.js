// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.12.0 — Node → Space.
 *
 * The substrate primitive's name moves from "Node" to "Space" to match
 * the locked architectural framing: substrate is what IS, beings are
 * substrate organized enough to act on itself. See [[project_substrate_generates_beings]]
 * and the philosophy/ folder.
 *
 * Two physical changes in MongoDB:
 *
 *   1. Collection `nodes` is renamed to `spaces`. Mongoose default
 *      pluralization of the `Node` model went to `nodes`; the new
 *      `Space` model is configured with `{ collection: "spaces" }`, so
 *      we move the existing collection over before the new model
 *      starts writing.
 *
 *   2. The `Did` document field `nodeId` is renamed to `spaceId`. Did
 *      documents pre-migration carry the action's target as `nodeId`;
 *      the new schema reads / writes `spaceId`. Without this rename,
 *      old audit-log entries become unreadable.
 *
 * Artifact.nodeId is NOT touched here — that's owned by the Artifact →
 * Matter rename happening in parallel.
 *
 * Idempotent: skips when the spaces collection already exists or when
 * no Did docs have the legacy `nodeId` field.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.12.0", "no active mongoose connection; skipping");
    return;
  }

  // ── Step 1: rename collection nodes → spaces ────────────────────────
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((c) => c.name));

  if (names.has("nodes") && !names.has("spaces")) {
    try {
      await db.collection("nodes").rename("spaces");
      log.info("Seed/0.12.0", "renamed collection nodes → spaces");
    } catch (err) {
      log.error("Seed/0.12.0", `collection rename failed: ${err.message}`);
      throw err;
    }
  } else if (names.has("spaces") && names.has("nodes")) {
    log.warn("Seed/0.12.0",
      "both `nodes` and `spaces` collections exist. Skipping rename — " +
      "the operator should resolve this manually (likely a partial prior run).");
  } else if (names.has("spaces")) {
    log.verbose("Seed/0.12.0", "spaces collection already present; rename already applied");
  } else {
    log.verbose("Seed/0.12.0", "no nodes collection present; nothing to rename");
  }

  // ── Step 2: rename Did.nodeId → Did.spaceId ─────────────────────────
  if (names.has("dids")) {
    const dids = db.collection("dids");
    const res = await dids.updateMany(
      { nodeId: { $exists: true } },
      { $rename: { nodeId: "spaceId" } },
    );
    if (res.modifiedCount > 0) {
      log.info("Seed/0.12.0", `renamed nodeId → spaceId on ${res.modifiedCount} Did document(s)`);
    } else {
      log.verbose("Seed/0.12.0", "no Did docs carry legacy nodeId field");
    }
  }
}
