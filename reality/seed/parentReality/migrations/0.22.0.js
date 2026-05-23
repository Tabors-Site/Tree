// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.22.0 — Canonicalize the I_AM being name.
 *
 * The first being (the runtime itself) has gone by several names across
 * earlier versions: "seed-being" (pre-0.16), "I-am" (0.16–0.21), and
 * "i-am" (a brief lowercase variant). 0.22.0 settles on a single
 * canonical value: "I_AM". The JS constant changes name in the same
 * release (SEED_BEING -> I_AM in seed/materials/space/seedSpaces.js).
 *
 * This migration rewrites every reference to the prior names in the
 * three places they appear in the DB:
 *
 *   1. beings.name           — the Being row itself.
 *   2. dids.beingId          — audit-log actor attribution.
 *   3. spaces.rootOwner      — ownership pointer for seed-owned spaces.
 *
 * Idempotent. Safe to re-run. Counts and logs anything it rewrites.
 */

import mongoose from "mongoose";
import log from "../log.js";

const OLD_NAMES = ["seed-being", "I-am", "i-am"];
const NEW_NAME = "I_AM";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.22.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((c) => c.name));

  // 1) beings.name — rename the row(s). If duplicate rows exist
  //    (shouldn't, but defensive), keep the earliest by _id and delete
  //    the rest so the unique-name semantic survives.
  let beingsRenamed = 0;
  let beingsDeduped = 0;
  if (names.has("beings")) {
    const stale = await db
      .collection("beings")
      .find({ name: { $in: OLD_NAMES } })
      .sort({ _id: 1 })
      .toArray();
    const canonical = await db
      .collection("beings")
      .findOne({ name: NEW_NAME });

    let keeper = canonical || stale[0] || null;
    for (const row of stale) {
      if (keeper && String(row._id) === String(keeper._id)) continue;
      if (keeper) {
        await db.collection("beings").deleteOne({ _id: row._id });
        beingsDeduped++;
      } else {
        keeper = row;
      }
    }
    if (keeper && keeper.name !== NEW_NAME) {
      await db
        .collection("beings")
        .updateOne({ _id: keeper._id }, { $set: { name: NEW_NAME } });
      beingsRenamed = 1;
    }
  }

  // 2) dids.beingId — actor attribution. The seed writes the name
  //    string (not an ObjectId) for the I_AM actor, so a $set sweep
  //    covers every audit row attributed to the seed being.
  let didsPatched = 0;
  if (names.has("dids")) {
    const result = await db
      .collection("dids")
      .updateMany(
        { beingId: { $in: OLD_NAMES } },
        { $set: { beingId: NEW_NAME } },
      );
    didsPatched = result.modifiedCount || 0;
  }

  // 3) spaces.rootOwner — ownership pointer. Same logic; the seed-
  //    owned spaces (.identity, .config, .peers, .extensions, .flow,
  //    .tools, .roles, .operations, .source, and the place root) carry
  //    the I_AM name string in rootOwner.
  let spacesPatched = 0;
  if (names.has("spaces")) {
    const result = await db
      .collection("spaces")
      .updateMany(
        { rootOwner: { $in: OLD_NAMES } },
        { $set: { rootOwner: NEW_NAME } },
      );
    spacesPatched = result.modifiedCount || 0;
  }

  const total = beingsRenamed + beingsDeduped + didsPatched + spacesPatched;
  if (total > 0) {
    log.info(
      "Seed/0.22.0",
      `Canonicalized I_AM (renamed ${beingsRenamed} Being row, ` +
        `deduped ${beingsDeduped}, patched ${didsPatched} Did(s), ` +
        `patched ${spacesPatched} Space(s))`,
    );
  } else {
    log.verbose("Seed/0.22.0", "already canonical; nothing to rewrite");
  }
}
