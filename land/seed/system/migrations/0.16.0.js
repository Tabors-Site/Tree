// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.16.0 — drop `intent` from inbox envelopes.
 *
 * The `intent` field carried no signal at use sites and has been removed
 * from the SUMMON wire envelope, inbox-entry shape, defaultSummon return,
 * and reply-emission helpers. Receivers distinguish trigger kinds (chat
 * vs do-trigger vs scheduled-wake) by inspecting the content shape.
 *
 * Inbox entries live in `metadata.inbox.entries` on space documents.
 * This migration removes the `intent` key from every entry on every
 * space. Summon documents carry no `intent` column, so nothing to do
 * there.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const db = mongoose.connection.db;
  if (!db) {
    log.warn("Seed/0.16.0", "no active mongoose connection; skipping");
    return;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  if (!collections.some((c) => c.name === "spaces")) {
    log.verbose("Seed/0.16.0", "no spaces collection; nothing to rewrite");
    return;
  }

  const spaces = db.collection("spaces");

  // Strip metadata.inbox.entries[].intent from every space carrying inbox entries.
  // $unset on a nested array element with a wildcard ($[]) is supported.
  const res = await spaces.updateMany(
    { "metadata.inbox.entries": { $exists: true, $type: "array" } },
    { $unset: { "metadata.inbox.entries.$[].intent": "" } },
  );
  if (res.modifiedCount > 0) {
    log.info("Seed/0.16.0",
      `stripped intent from inbox entries on ${res.modifiedCount} space(s)`);
  } else {
    log.verbose("Seed/0.16.0", "no spaces carry inbox-entry intent fields");
  }
}
