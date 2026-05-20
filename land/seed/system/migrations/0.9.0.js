// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.9.0 — Chat → Summon rename.
 *
 * Renames the Chat model to Summon. A Summon is the record of one being's
 * invocation: one being processes one inbox entry through one LLM call
 * (possibly with tool calls) producing one output. "Summoning" is the
 * verb; a Summon is the record of one wake-and-act.
 *
 * Schema changes:
 *   - Collection renamed: `aichats` → `summons`.
 *   - Field renamed on each Summon doc: `rootChatId` → `rootSummonId`,
 *     `parentChatId` → `parentSummonId`.
 *   - Field renamed on each Did doc: `chatId` → `summonId`.
 *
 * Bumps SEED_VERSION 0.8.0 → 0.9.0.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.9.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const collNames = new Set(collections.map(c => c.name));

  // ── Step 1: rename collection aichats → summons ─────────────────────
  if (collNames.has("aichats") && !collNames.has("summons")) {
    try {
      await db.collection("aichats").rename("summons");
      log.info("Seed/0.9.0", "renamed collection aichats → summons");
    } catch (err) {
      log.warn("Seed/0.9.0", `collection rename failed: ${err.message}`);
    }
  } else if (collNames.has("aichats") && collNames.has("summons")) {
    // Both exist (half-completed prior run). Fold aichats into summons.
    const src = db.collection("aichats");
    const dst = db.collection("summons");
    const cursor = src.find({});
    let moved = 0;
    for await (const doc of cursor) {
      try {
        await dst.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
        moved++;
      } catch (err) {
        log.warn("Seed/0.9.0", `could not move chat ${String(doc._id).slice(0, 8)}: ${err.message}`);
      }
    }
    if (moved > 0) log.info("Seed/0.9.0", `folded ${moved} chat doc(s) into summons`);
    try {
      await src.drop();
      log.info("Seed/0.9.0", "dropped legacy aichats collection");
    } catch (err) {
      log.warn("Seed/0.9.0", `could not drop legacy aichats collection: ${err.message}`);
    }
  }

  // ── Step 2: rename fields on summons ────────────────────────────────
  const summonsExist = (await db.listCollections({ name: "summons" }, { nameOnly: true }).toArray()).length > 0;
  if (summonsExist) {
    const summons = db.collection("summons");
    const rootRes = await summons.updateMany(
      { rootChatId: { $exists: true } },
      { $rename: { rootChatId: "rootSummonId" } },
    );
    if (rootRes.modifiedCount > 0) {
      log.info("Seed/0.9.0", `renamed rootChatId → rootSummonId on ${rootRes.modifiedCount} summon(s)`);
    }
    const parentRes = await summons.updateMany(
      { parentChatId: { $exists: true } },
      { $rename: { parentChatId: "parentSummonId" } },
    );
    if (parentRes.modifiedCount > 0) {
      log.info("Seed/0.9.0", `renamed parentChatId → parentSummonId on ${parentRes.modifiedCount} summon(s)`);
    }
  }

  // ── Step 3: rename chatId → summonId on dids ────────────────────────
  const didsExist = (await db.listCollections({ name: "dids" }, { nameOnly: true }).toArray()).length > 0;
  if (didsExist) {
    const dids = db.collection("dids");
    const didRes = await dids.updateMany(
      { chatId: { $exists: true } },
      { $rename: { chatId: "summonId" } },
    );
    if (didRes.modifiedCount > 0) {
      log.info("Seed/0.9.0", `renamed chatId → summonId on ${didRes.modifiedCount} did(s)`);
    }
  }

  // ── Step 4: sync indexes ────────────────────────────────────────────
  try {
    const Summon = (await import("../models/summon.js")).default;
    await Summon.syncIndexes();
    log.verbose("Seed/0.9.0", "summon indexes synced");
  } catch (err) {
    log.warn("Seed/0.9.0", `summon index sync failed: ${err.message}`);
  }
  try {
    const Did = (await import("../models/did.js")).default;
    await Did.syncIndexes();
    log.verbose("Seed/0.9.0", "did indexes synced");
  } catch (err) {
    log.warn("Seed/0.9.0", `did index sync failed: ${err.message}`);
  }
}
