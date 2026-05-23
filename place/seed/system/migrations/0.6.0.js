// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Seed Migration 0.6.0 — Chat.ibpAddress introduction.
 *
 * 0.6.0 introduces `ibpAddress` on Chat as the canonical identifier
 * for "the conversation context this chat belongs to." The shape is
 * `<stance> :: <stance>` (canonical sorted), matching the protocol's
 * IBP Address grammar (see /place/seed/ibp/address.js and
 * seed/present/stamped/stampIBPAddress.js). New chats compute and write it at
 * creation time.
 *
 * What this migration does:
 *
 * 1. Clean up any previously-shipped `threadKey` field (renamed to
 *    `ibpAddress` mid-development). Mongoose strict mode strips
 *    unknown fields on read but persisted docs may still carry it
 *    from earlier 0.6.0 dev runs. $unset removes the orphan field.
 *
 * 2. Clean up the previously-shipped per-chat position fields
 *    (`askerPosition`, `addresseePosition`). Their information is now
 *    encoded in the IBP Address itself — stance includes the
 *    position — so the separate fields are redundant. Same $unset
 *    treatment as threadKey above.
 *
 * What this migration does NOT do:
 *
 * Historical chats are not backfilled with ibpAddress. Reconstruct-
 * ing each chat's stance pair would require knowing where each being
 * was when that chat happened — data we never captured. Using the
 * being's CURRENT position to synthesize a historical IBP Address
 * would rewrite the past against today's state, which is exactly the
 * provenance break the position-based threading model is built to
 * avoid. Old chats keep `ibpAddress: null`; new chats get accurate
 * IBP Addresses from creation forward.
 *
 * Non-destructive and idempotent. $unset on a missing field is a
 * no-op, so re-running this migration on already-cleaned data does
 * nothing.
 */

import mongoose from "mongoose";
import log from "../log.js";

export default async function migrate() {
  const coll = mongoose.connection.collection("aichats");

  const result = await coll.updateMany(
    {
      $or: [
        { threadKey:         { $exists: true } },
        { askerPosition:     { $exists: true } },
        { addresseePosition: { $exists: true } },
      ],
    },
    {
      $unset: {
        threadKey:         "",
        askerPosition:     "",
        addresseePosition: "",
      },
    },
  );

  if (result.modifiedCount > 0) {
    log.info("Seed/0.6.0",
      `cleaned ${result.modifiedCount} aichats row(s) — removed legacy threadKey / askerPosition / addresseePosition fields`);
  } else {
    log.info("Seed/0.6.0", "no legacy chat fields to clean — IBP Address is the new identifier");
  }
}
