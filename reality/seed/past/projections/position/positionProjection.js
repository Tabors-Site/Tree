// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// PositionProjection. The cross-cutting fold of beings' current coord
// per space.
//
// A move emits one fact on the being's own reel: a do:set-being fact
// with `field: "coord"`. Single-writer holds. The being's own reducer
// records the coord in the Being row's `coord` schema field (one
// current value, per being). PositionProjection is the cross-cutting
// view of the same source: one row per (beingId, spaceId), so the
// answer to "who is at this space, where" is a single indexed read
// instead of a scan across Being.position filters.
//
// Two folds, one source of truth (the chain of do:set-being:coord
// facts on each being's reel). Replay rebuilds either from zero. The
// schema is a cache; the chain is the record.
//
// Lifecycle:
//   do:set-being with params.field === "coord" appears on a being's
//   reel → upsert PositionProjection row at (beingId, spaceId) with
//   the new {x,y[,z]} and the fact's seq as lastMoveSeq. The seq
//   guard prevents stale folds from overwriting newer state when
//   concurrent rebuild + live fold race.
//
// Why the seq guard. Out-of-order delivery on the wire is one reason
// (clients reading the projection don't see stale states). Out-of-
// order fold application is the other: a being's reel might be
// re-walked from genesis while a live fold is appending to the head.
// Both writers upsert the same row; whichever carries the higher
// lastMoveSeq wins. Idempotent under any replay shape.
//
// What "the space" means here. The fact carries `of = { kind:
// "being", id: beingId }` — there's no spaceId in the fact body
// because single-writer landed it on the being's reel. The fold
// handler reads the being's current `position` to know which row to
// update. Two timing notes:
//   - In live mode, the eager-fold runs in the same withTransaction
//     as the seal, so Being.position reflects the at-fact state.
//   - In rebuild mode, walking the whole reel may apply older coord
//     facts under the being's CURRENT position, not the position the
//     being was in when the older fact landed. For movement within
//     one space (the harmony case) this is fine; for beings that move
//     between spaces over their lifetime, rung 4+ work threads the
//     authoritative spaceId on the fact (or reads from the moment's
//     ibpAddress). Rung 0 records what's read.
//
// Three-slot schema. Identity (`_id` = "<beingId>:<spaceId>"). Figure
// (beingId, spaceId, x, y, z?, lastMoveSeq, updatedAt). Cache-control
// is the lastMoveSeq guard at fold-apply time; no foldedSeq field
// because cross-cutting projections don't carry the per-aggregate
// marker. Same shape as InboxProjection / ThreadsProjection.

import mongoose from "mongoose";

const PositionProjectionSchema = new mongoose.Schema({
  // Composite key. One row per (being, space).
  _id: { type: String, required: true },

  beingId: { type: String, ref: "Being", required: true, index: true },
  spaceId: { type: String, ref: "Space", required: true, index: true },

  x: { type: Number, required: true },
  y: { type: Number, required: true },
  z: { type: Number, default: undefined },

  // The seq of the do:set-being:coord fact that produced this row.
  // The fold handler refuses to apply a fact with seq ≤ lastMoveSeq,
  // which makes the projection robust to replay and out-of-order
  // fold application.
  lastMoveSeq: { type: Number, required: true, index: true },

  updatedAt: { type: Date, required: true },
}, { _id: false, minimize: false });

// "Who is at this space, where" — the primary read pattern from the
// portal subscription and from the descriptor's per-space build.
PositionProjectionSchema.index({ spaceId: 1, lastMoveSeq: 1 });

// "Where is this being, in every space they've moved in" — replay
// audits, debugging.
PositionProjectionSchema.index({ beingId: 1, spaceId: 1 });

const PositionProjection = mongoose.model(
  "PositionProjection",
  PositionProjectionSchema,
  "position_projection",
);

/**
 * Build the composite _id from (beingId, spaceId). Single-source so
 * fold and reads can't drift.
 */
export function positionRowId(beingId, spaceId) {
  return `${String(beingId)}:${String(spaceId)}`;
}

export default PositionProjection;
