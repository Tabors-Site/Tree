// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.19.0 — operatingMode "script" → "scripted".
 *
 * The Being.operatingMode enum tightened its naming: "script" became
 * "scripted" (cleaner past-participle parallel with "mixed", and the
 * full enum is now ["human", "llm", "scripted", "mixed"]). This
 * migration rewrites existing Being rows so the validator accepts
 * them after the rename.
 *
 * Idempotent. No-op for fresh installs (nothing carries "script").
 * For lands that ran 0.15.0 (which introduced "script"), the
 * affected beings are the system beings (auth, llm-assigner, citizen)
 * plus the I_AM and any custom code-driven beings extensions
 * registered with operatingMode: "script". All move to "scripted" in
 * one updateMany.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.19.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  if (!collections.some((c) => c.name === "beings")) {
    log.verbose("Seed/0.19.0", "no beings collection; nothing to rewrite");
    return;
  }

  const beings = db.collection("beings");

  const res = await beings.updateMany(
    { operatingMode: "script" },
    { $set: { operatingMode: "scripted" } },
  );

  if (res.modifiedCount > 0) {
    log.info("Seed/0.19.0",
      `renamed operatingMode "script" → "scripted" on ${res.modifiedCount} being(s)`);
  } else {
    log.verbose("Seed/0.19.0", "no beings carried operatingMode \"script\"; clean");
  }
}
