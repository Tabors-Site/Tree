// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.17.0 — drop Space.visibility, express public as a
 * stance-auth permission rule.
 *
 * Visibility was a coarse one-bit overlay ("private" | "public") that
 * stance authorization already expresses through permission rules.
 * Stance auth admits anyone to SEE a space when the space carries
 *   metadata.permissions.see["*"] = { requires: {} }
 * (layer-2 walk finds the wildcard rule, empty requires passes every
 * stance). This migration translates the column into the rule and
 * drops the column.
 *
 * Two writes per space, idempotent:
 *
 *   1. Every space with `visibility: "public"` gets the wildcard SEE
 *      rule written (if not already present).
 *   2. The `visibility` field is unset from every space.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.17.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  if (!collections.some((c) => c.name === "spaces")) {
    log.verbose("Seed/0.17.0", "no spaces collection; nothing to rewrite");
    return;
  }

  const spaces = db.collection("spaces");

  // Step 1: write the wildcard SEE rule on previously-public spaces.
  // Use $set with a path that doesn't overwrite other permissions.see entries.
  const ruleRes = await spaces.updateMany(
    { visibility: "public" },
    { $set: { "metadata.permissions.see.*": { requires: {} } } },
  );
  if (ruleRes.modifiedCount > 0) {
    log.info("Seed/0.17.0",
      `wrote wildcard SEE rule on ${ruleRes.modifiedCount} previously-public space(s)`);
  }

  // Step 2: drop the visibility column.
  const dropRes = await spaces.updateMany(
    { visibility: { $exists: true } },
    { $unset: { visibility: "" } },
  );
  if (dropRes.modifiedCount > 0) {
    log.info("Seed/0.17.0",
      `dropped visibility field from ${dropRes.modifiedCount} space(s)`);
  } else {
    log.verbose("Seed/0.17.0", "no spaces carry the legacy visibility field");
  }

  // Step 3: drop the legacy single-field index on visibility if Mongoose
  // ever created one. Mongoose only creates indexes that the current
  // schema declares; with the visibility field removed, the index is
  // already orphaned. Defensive drop in case any lands still carry it.
  try {
    const indexes = await spaces.indexes();
    const legacy = indexes.find((i) => i.key && Object.keys(i.key).join() === "visibility");
    if (legacy) {
      await spaces.dropIndex(legacy.name);
      log.info("Seed/0.17.0", `dropped legacy index ${legacy.name} on visibility`);
    }
  } catch (err) {
    log.warn("Seed/0.17.0", `could not drop legacy visibility index: ${err.message}`);
  }
}
