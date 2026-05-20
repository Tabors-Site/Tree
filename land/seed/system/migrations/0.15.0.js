// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.15.0 — Being.operatingMode enum rename.
 *
 * Updates the operatingMode field to the locked enum: human | llm | script.
 *
 *   "ai"  → "llm"  (LLM-driven beings)
 *   plus  → "script" is now allowed (deterministic code-driven beings;
 *                     auth and llm-assigner)
 *
 * The schema enum is updated; this migration rewrites existing rows
 * that carry the old value so the new validator accepts them. Specific
 * system beings (auth, llm-assigner, citizen) move to "script" because
 * their role specs do not call runChat; land-manager and every other
 * role with an LLM-backed summon stay on "llm".
 */

import mongoose from "mongoose";
import log from "../log.js";

const SCRIPT_DRIVEN_NAMES = new Set(["auth", "llm-assigner", "citizen"]);

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.15.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  if (!collections.some((c) => c.name === "beings")) {
    log.verbose("Seed/0.15.0", "no beings collection; nothing to rewrite");
    return;
  }

  const beings = db.collection("beings");

  // Promote script-driven system beings.
  const scriptRes = await beings.updateMany(
    { name: { $in: [...SCRIPT_DRIVEN_NAMES] }, operatingMode: "ai" },
    { $set: { operatingMode: "script" } },
  );
  if (scriptRes.modifiedCount > 0) {
    log.info("Seed/0.15.0",
      `set operatingMode → "script" on ${scriptRes.modifiedCount} system being(s)`);
  }

  // Everything else with "ai" becomes "llm".
  const llmRes = await beings.updateMany(
    { operatingMode: "ai" },
    { $set: { operatingMode: "llm" } },
  );
  if (llmRes.modifiedCount > 0) {
    log.info("Seed/0.15.0",
      `set operatingMode → "llm" on ${llmRes.modifiedCount} being(s)`);
  } else {
    log.verbose("Seed/0.15.0", `no beings carried operatingMode "ai"`);
  }
}
