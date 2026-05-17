// TreeOS Seed — AGPL-3.0 — https://treeos.ai
/**
 * Seed Migration 0.8.0 — Contribution → Did rename, wasAi removal,
 * noteAction → artifactAction sub-shape rename.
 *
 * Contribution rows are the audit log of IBP DO emissions. The model is
 * renamed Did (past tense — a "did" is a thing that was done) so the kernel
 * pairs cleanly with TALK ↔ Chat. The schema stays the same except:
 *
 *   - Collection renamed: `contributions` → `dids`.
 *   - Field dropped: `wasAi` (derivable from Being.operatingMode).
 *   - Sub-shape renamed: `noteAction` → `artifactAction`. Inside the new
 *     sub-shape, `noteId` becomes `artifactId` (the ref target was renamed
 *     to Artifact in migration 0.4.0).
 *   - Enum value normalized: `action: "note"` rows become `action: "artifact"`.
 *
 * Non-destructive:
 *   - Collection rename folds existing docs into the destination if the
 *     destination already exists (e.g. half-completed prior run).
 *   - Idempotent: re-running after a partial migration completes safely.
 *     Docs already carrying `artifactAction` are left alone; only docs
 *     still carrying the legacy `wasAi` / `noteAction` shape are touched.
 *
 * Bumps SEED_VERSION 0.7.0 → 0.8.0.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.8.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const collNames = new Set(collections.map(c => c.name));

  // ── Step 1: rename collection contributions → dids ──────────────────
  if (collNames.has("contributions") && !collNames.has("dids")) {
    try {
      await db.collection("contributions").rename("dids");
      log.info("Seed/0.8.0", "renamed collection contributions → dids");
    } catch (err) {
      log.warn("Seed/0.8.0", `collection rename failed: ${err.message}`);
    }
  } else if (collNames.has("contributions") && collNames.has("dids")) {
    // Both exist (half-completed prior run). Fold contributions into dids.
    const src = db.collection("contributions");
    const dst = db.collection("dids");
    const cursor = src.find({});
    let moved = 0;
    for await (const doc of cursor) {
      try {
        await dst.updateOne(
          { _id: doc._id },
          { $setOnInsert: doc },
          { upsert: true },
        );
        moved++;
      } catch (err) {
        log.warn("Seed/0.8.0", `could not move contribution ${String(doc._id).slice(0, 8)}: ${err.message}`);
      }
    }
    if (moved > 0) log.info("Seed/0.8.0", `folded ${moved} contribution doc(s) into dids`);
    try {
      await src.drop();
      log.info("Seed/0.8.0", "dropped legacy contributions collection");
    } catch (err) {
      log.warn("Seed/0.8.0", `could not drop legacy contributions collection: ${err.message}`);
    }
  }

  // If the dids collection doesn't exist (fresh land), nothing else to do.
  const postCollections = await db.listCollections({ name: "dids" }, { nameOnly: true }).toArray();
  if (postCollections.length === 0) {
    log.verbose("Seed/0.8.0", "no dids collection present; nothing to reshape");
    return;
  }

  const dids = db.collection("dids");

  // ── Step 2: drop wasAi field on every row ───────────────────────────
  const wasAiResult = await dids.updateMany(
    { wasAi: { $exists: true } },
    { $unset: { wasAi: "" } },
  );
  if (wasAiResult.modifiedCount > 0) {
    log.info("Seed/0.8.0", `stripped wasAi from ${wasAiResult.modifiedCount} did doc(s)`);
  }

  // ── Step 3: rename noteAction sub-shape → artifactAction ────────────
  // The sub-shape's `noteId` field also moves to `artifactId` so the ref
  // target matches the Artifact rename completed in migration 0.4.0.
  // Done one doc at a time because the rename is a structure transform.
  let reshaped = 0;
  const cursor = dids.find({ noteAction: { $exists: true } });
  for await (const doc of cursor) {
    try {
      const na = doc.noteAction || {};
      const newAction = {
        action: na.action || null,
        artifactId: na.noteId || null,
        content: na.content == null ? null : na.content,
      };
      await dids.updateOne(
        { _id: doc._id },
        {
          $set: { artifactAction: newAction },
          $unset: { noteAction: "" },
        },
      );
      reshaped++;
    } catch (err) {
      log.warn("Seed/0.8.0",
        `could not reshape noteAction on did ${String(doc._id).slice(0, 8)}: ${err.message}`);
    }
  }
  if (reshaped > 0) {
    log.info("Seed/0.8.0", `reshaped ${reshaped} did doc(s): noteAction → artifactAction`);
  }

  // Step 3b: also normalize the `action` enum value when it's the literal
  // "note". The kernel now logs `action: "artifact"` for artifact CRUD.
  // Existing rows with `action: "note"` are migrated for consistency.
  const actionResult = await dids.updateMany(
    { action: "note" },
    { $set: { action: "artifact" } },
  );
  if (actionResult.modifiedCount > 0) {
    log.info("Seed/0.8.0", `normalized action "note" → "artifact" on ${actionResult.modifiedCount} did doc(s)`);
  }

  // ── Step 4: ensure indexes ──────────────────────────────────────────
  try {
    const Did = (await import("../models/did.js")).default;
    await Did.syncIndexes();
    log.verbose("Seed/0.8.0", "did indexes synced");
  } catch (err) {
    log.warn("Seed/0.8.0", `index sync failed (will rebuild on next model use): ${err.message}`);
  }
}
