// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ReelHead. The per-aggregate seq counter.
//
// Every aggregate (being, space, matter) has a reel — its own
// append-only chain of facts. The reel needs a head: the highest
// seq number stamped on it. `allocSeq(type, id)` is the only path
// that advances a head, and it advances atomically (single-doc
// `$inc` with upsert on first allocation).
//
// Why a separate collection and not a field on the aggregate row:
// per [STAMPER.md](../factory/stamper/STAMPER.md) the projection cache
// (the Space/Being/Matter row) is read-side, written only by `fold`.
// Putting the write-side counter on the same row couples writer and
// reader. Dedicated collection keeps the projection pure.
//
// One document per (type, id). `_id` is `<type>:<id>` so a single
// `findOneAndUpdate` upserts the head doc and returns the new value
// in one round trip.

import mongoose from "mongoose";

const ReelHeadSchema = new mongoose.Schema({
  _id:  { type: String },           // "<type>:<id>"
  type: { type: String, required: true, enum: ["being", "space", "matter"] },
  id:   { type: String, required: true },
  head: { type: Number, required: true, default: 0 },
});

const ReelHead = mongoose.model("ReelHead", ReelHeadSchema, "reelHeads");
export default ReelHead;
