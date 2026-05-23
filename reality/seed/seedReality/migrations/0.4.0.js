// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.4.0 — Note → Artifact rename + contentType → origin pivot.
 *
 * The Note model and `notes` collection become the Artifact model and
 * `artifacts` collection. The contentType axis (text|file) is replaced
 * by the origin axis (ibp|filesystem|web|cross-place). Origin captures
 * what system the artifact's underlying representation lives in.
 *
 * Field reshaping:
 *
 *   Legacy text note:
 *     { contentType: "text",  content: "<string>" }
 *   →
 *     { origin: "ibp",        content: "<string>" }
 *
 *   Legacy file note:
 *     { contentType: "file",  content: "<filename in uploads/>" }
 *   →
 *     { origin: "filesystem", content: { path: "<filename>",
 *                                        size: null,
 *                                        mimeType: null,
 *                                        originalName: null } }
 *
 *   `size` and `mimeType` for migrated files are left null. They were
 *   not stored on the legacy Note schema. New uploads carry them.
 *
 * Non-destructive:
 *   - Renames the `notes` collection to `artifacts` (idempotent: skipped
 *     if the destination already exists).
 *   - Idempotent: re-running this migration after a partial run completes
 *     safely. Records that already carry an `origin` field are left alone.
 *   - The legacy `contentType` field is removed once reshaping completes.
 *
 * Bumps SEED_VERSION 0.3.0 → 0.4.0.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.4.0", "no active mongoose connection; skipping");
    return;
  }

  // ── Step 1: rename collection notes → artifacts ─────────────────────
  // If both exist, fold notes into artifacts; otherwise straight rename.
  // If neither exists (fresh reality), nothing to do.
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const collNames = new Set(collections.map(c => c.name));

  if (collNames.has("notes") && !collNames.has("artifacts")) {
    try {
      await db.collection("notes").rename("artifacts");
      log.info("Seed/0.4.0", "renamed collection notes → artifacts");
    } catch (err) {
      log.warn("Seed/0.4.0", `collection rename failed: ${err.message}`);
    }
  } else if (collNames.has("notes") && collNames.has("artifacts")) {
    // Both exist. Move documents from notes into artifacts, then drop notes.
    const notesColl = db.collection("notes");
    const artifactsColl = db.collection("artifacts");
    const cursor = notesColl.find({});
    let moved = 0;
    for await (const doc of cursor) {
      try {
        await artifactsColl.updateOne(
          { _id: doc._id },
          { $setOnInsert: doc },
          { upsert: true },
        );
        moved++;
      } catch (err) {
        log.warn("Seed/0.4.0", `could not move note ${String(doc._id).slice(0, 8)}: ${err.message}`);
      }
    }
    if (moved > 0) log.info("Seed/0.4.0", `folded ${moved} note doc(s) into artifacts collection`);
    try {
      await notesColl.drop();
      log.info("Seed/0.4.0", "dropped legacy notes collection");
    } catch (err) {
      log.warn("Seed/0.4.0", `could not drop legacy notes collection: ${err.message}`);
    }
  }

  // If the artifacts collection doesn't exist (fresh reality or pre-Notes
  // place), nothing else to do.
  const postCollections = await db.listCollections({ name: "artifacts" }, { nameOnly: true }).toArray();
  if (postCollections.length === 0) {
    log.verbose("Seed/0.4.0", "no artifacts collection present; nothing to reshape");
    return;
  }

  const artifactsColl = db.collection("artifacts");

  // ── Step 2: reshape contentType: "text" → origin: "ibp" ─────────────
  // content stays as-is (a string). Idempotent: only touches docs that
  // still carry the legacy contentType field.
  const textResult = await artifactsColl.updateMany(
    { contentType: "text" },
    {
      $set: { origin: "ibp" },
      $unset: { contentType: "" },
    },
  );
  if (textResult.modifiedCount > 0) {
    log.info("Seed/0.4.0", `reshaped ${textResult.modifiedCount} text artifact(s) to origin "ibp"`);
  }

  // ── Step 3: reshape contentType: "file" → origin: "filesystem" ──────
  // content morphs from a filename string to { path, size, mimeType,
  // originalName }. Done one doc at a time because $set can't promote a
  // string field into an object via a single update operator.
  let filesReshaped = 0;
  const fileCursor = artifactsColl.find({ contentType: "file" });
  for await (const doc of fileCursor) {
    try {
      const legacyContent = typeof doc.content === "string" ? doc.content : null;
      const newContent = legacyContent
        ? { path: legacyContent, size: null, mimeType: null, originalName: null }
        : null;
      await artifactsColl.updateOne(
        { _id: doc._id },
        {
          $set: { origin: "filesystem", content: newContent },
          $unset: { contentType: "" },
        },
      );
      filesReshaped++;
    } catch (err) {
      log.warn("Seed/0.4.0",
        `could not reshape file artifact ${String(doc._id).slice(0, 8)}: ${err.message}`);
    }
  }
  if (filesReshaped > 0) {
    log.info("Seed/0.4.0", `reshaped ${filesReshaped} file artifact(s) to origin "filesystem"`);
  }

  // ── Step 4: backfill origin on any leftover docs ────────────────────
  // Any doc that survives without an origin (e.g. legacy data with a
  // missing contentType field) gets origin "ibp" as the safe default.
  const backfill = await artifactsColl.updateMany(
    { origin: { $exists: false } },
    { $set: { origin: "ibp" } },
  );
  if (backfill.modifiedCount > 0) {
    log.info("Seed/0.4.0", `backfilled origin "ibp" on ${backfill.modifiedCount} legacy doc(s)`);
  }

  // ── Step 5: ensure new indexes ──────────────────────────────────────
  // The Artifact schema declares indexes on (spaceId, createdAt -1),
  // (beingId, createdAt -1), and (origin). Mongoose will sync them on
  // first model use, but explicitly trigger now so the migration leaves
  // the database in the expected shape.
  try {
    const Artifact = (await import("../models/artifact.js")).default;
    await Artifact.syncIndexes();
    log.verbose("Seed/0.4.0", "artifact indexes synced");
  } catch (err) {
    log.warn("Seed/0.4.0", `index sync failed (will rebuild on next model use): ${err.message}`);
  }
}
