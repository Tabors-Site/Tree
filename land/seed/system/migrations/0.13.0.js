// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.13.0 — Artifact → Matter.
 *
 * The "stuff that occupies a position" primitive renames from Artifact to
 * Matter to match the locked architectural framing: Space is the structure;
 * Matter is what sits in space; Beings are substrate organized enough to
 * act on either. See [[project_substrate_generates_beings]] and the
 * philosophy/ folder.
 *
 * Physical changes in MongoDB:
 *
 *   1. Collection `artifacts` is renamed to `matters`. The Mongoose model
 *      is now `Matter` configured with `{ collection: "matters" }`, so we
 *      move the existing collection over before the new model starts
 *      writing.
 *
 *   2. The `parentArtifactId` field on every doc in the new `matters`
 *      collection is renamed to `parentMatterId` (the matter-tree chain
 *      pointer).
 *
 *   3. On `Did` documents:
 *        - the `artifactAction` sub-shape is renamed to `matterAction`
 *        - inside it, `artifactId` is renamed to `matterId`
 *        - the top-level `action: "artifact"` enum value is normalized
 *          to `action: "matter"`
 *
 * Idempotent: skips work when the destination shape is already present.
 *
 * Bumps SEED_VERSION 0.12.0 → 0.13.0.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.13.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((c) => c.name));

  // ── Step 1: rename collection artifacts → matters ───────────────────
  if (names.has("artifacts") && !names.has("matters")) {
    try {
      await db.collection("artifacts").rename("matters");
      log.info("Seed/0.13.0", "renamed collection artifacts → matters");
      names.add("matters");
      names.delete("artifacts");
    } catch (err) {
      log.error("Seed/0.13.0", `collection rename failed: ${err.message}`);
      throw err;
    }
  } else if (names.has("matters") && names.has("artifacts")) {
    log.warn("Seed/0.13.0",
      "both `artifacts` and `matters` collections exist. Skipping rename — " +
      "the operator should resolve this manually (likely a partial prior run).");
  } else if (names.has("matters")) {
    log.verbose("Seed/0.13.0", "matters collection already present; rename already applied");
  } else {
    log.verbose("Seed/0.13.0", "no artifacts collection present; nothing to rename");
  }

  // ── Step 2: rename parentArtifactId → parentMatterId ─────────────────
  if (names.has("matters")) {
    const matters = db.collection("matters");
    const res = await matters.updateMany(
      { parentArtifactId: { $exists: true } },
      { $rename: { parentArtifactId: "parentMatterId" } },
    );
    if (res.modifiedCount > 0) {
      log.info("Seed/0.13.0",
        `renamed parentArtifactId → parentMatterId on ${res.modifiedCount} matter doc(s)`);
    } else {
      log.verbose("Seed/0.13.0", "no matter docs carry legacy parentArtifactId field");
    }
  }

  // ── Step 3: rename Did.artifactAction → Did.matterAction ─────────────
  if (names.has("dids")) {
    const dids = db.collection("dids");

    // 3a: rename the sub-shape field on docs that carry the legacy name.
    const renameRes = await dids.updateMany(
      { artifactAction: { $exists: true } },
      { $rename: { artifactAction: "matterAction" } },
    );
    if (renameRes.modifiedCount > 0) {
      log.info("Seed/0.13.0",
        `renamed artifactAction → matterAction on ${renameRes.modifiedCount} Did doc(s)`);
    }

    // 3b: inside the (now-)matterAction sub-shape, rename artifactId → matterId.
    const subRes = await dids.updateMany(
      { "matterAction.artifactId": { $exists: true } },
      { $rename: { "matterAction.artifactId": "matterAction.matterId" } },
    );
    if (subRes.modifiedCount > 0) {
      log.info("Seed/0.13.0",
        `renamed matterAction.artifactId → matterAction.matterId on ${subRes.modifiedCount} Did doc(s)`);
    }

    // 3c: normalize the top-level action enum.
    const actionRes = await dids.updateMany(
      { action: "artifact" },
      { $set: { action: "matter" } },
    );
    if (actionRes.modifiedCount > 0) {
      log.info("Seed/0.13.0",
        `normalized action "artifact" → "matter" on ${actionRes.modifiedCount} Did doc(s)`);
    }
  }
}
