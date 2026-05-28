// foldGridUpToSeq — replay the grid space's reel up to a seq ceiling.
//
// The grid space's reel is the canonical record of every dancer's
// position-event. Each move/place op stamps a fact on the grid reel
// with params { event: "place"|"move", beingId, from?, to }. To know
// where everyone is at the start of a tick:
//
//   board = foldGridUpToSeq(gridSpaceId, tickSeq);
//   // board : Map<beingId, { x, y }>
//
// Each dancer this tick folds with the same tickSeq → all see the
// same start-of-tick board even while their move-writes interleave
// into the next tick's window (seq > tickSeq). That's the lockstep
// discipline: reads-before-writes enforced by a seq ceiling, not by
// a handed-out snapshot.
//
// Action filter ("harmony:grid-event") keeps the fold pure to our
// move-event shape, ignoring other facts that might land on the
// grid reel (e.g. do.set on grid's own qualities).

import mongoose from "mongoose";

export async function foldGridUpToSeq(gridSpaceId, tickSeq) {
  if (!gridSpaceId) return new Map();
  const Fact = mongoose.model("Fact");
  const facts = await Fact.find({
    "target.kind": "space",
    "target.id":   String(gridSpaceId),
    action:        "harmony:grid-event",
    seq:           { $lte: Number(tickSeq) || 0, $type: "number" },
  })
    .sort({ seq: 1 })
    .lean();

  const board = new Map();
  for (const f of facts) {
    const p = f.params || {};
    if ((p.event === "move" || p.event === "place") && p.beingId && p.to) {
      board.set(String(p.beingId), { x: p.to.x, y: p.to.y });
    }
  }
  return board;
}

/**
 * Fold WITHOUT a seq ceiling — for replay/audit tools that want the
 * live board state from the reel. Used by the replay tool (rung 5)
 * and the V2 verification (replay-matches-live).
 */
export async function foldGridLive(gridSpaceId) {
  return foldGridUpToSeq(gridSpaceId, Number.MAX_SAFE_INTEGER);
}

/**
 * Yield the move-event stream from the grid reel, oldest first. The
 * timelapse data source for the replay tool.
 */
export async function getGridEventStream(gridSpaceId) {
  if (!gridSpaceId) return [];
  const Fact = mongoose.model("Fact");
  const facts = await Fact.find({
    "target.kind": "space",
    "target.id":   String(gridSpaceId),
    action:        "harmony:grid-event",
    seq:           { $type: "number" },
  })
    .sort({ seq: 1 })
    .lean();
  return facts.map((f) => ({
    seq:  f.seq,
    date: f.date,
    actorBeingId: f.beingId ? String(f.beingId) : null,
    ...(f.params || {}),
  }));
}
