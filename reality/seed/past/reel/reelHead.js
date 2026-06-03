// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ReelHead. The per-aggregate, per-branch seq counter.
//
// Every aggregate (being, space, matter) has a reel — its own
// append-only chain of facts — in every branch where it has been
// written to. The reel needs a head: the highest seq number stamped
// on it in THAT branch. `allocSeq(type, id, { branch })` is the only
// path that advances a head, and it advances atomically (single-doc
// `$inc` with upsert on first allocation).
//
// Per-branch heads are how divergent worlds share history without
// stepping on each other. Each branch (#0 = main, #1, #1a, #1a1...)
// has its own ReelHead doc per aggregate. The first fact in branch X
// for reel Y allocates seq = branchPoint[Y] + 1 — picking up where
// the parent's reel left off at branch time.
//
// Why a separate collection and not a field on the aggregate row:
// per [STAMPER.md](../factory/stamper/STAMPER.md) the projection cache
// (the Space/Being/Matter row) is read-side, written only by `fold`.
// Putting the write-side counter on the same row couples writer and
// reader. Dedicated collection keeps the projection pure.
//
// `_id` shape: `<branch>:<type>:<id>` for ALL branches including main
// (so `0:being:xyz` for tabor on main, `1a:being:xyz` for tabor on
// branch #1a). Pre-branch legacy rows used `<type>:<id>` without the
// branch prefix; a one-shot boot migration rewrites them to the new
// shape with `branch: "0"`. See seed/seedReality/migrations/.

import mongoose from "mongoose";

const ReelHeadSchema = new mongoose.Schema({
  _id:    { type: String },           // "<branch>:<type>:<id>"
  branch: { type: String, required: true, default: "0", index: true },
  type:   { type: String, required: true, enum: ["being", "space", "matter"] },
  id:     { type: String, required: true },
  head:   { type: Number, required: true, default: 0 },
});

// Sparse compound index for the common branch-scoped lookup. The _id
// shape already supports this query, but the explicit index makes
// queries that filter by (branch, type, id) without _id (e.g.
// migration scans) fast.
ReelHeadSchema.index({ branch: 1, type: 1, id: 1 }, { unique: true });

const ReelHead = mongoose.model("ReelHead", ReelHeadSchema, "reelHeads");
export default ReelHead;
