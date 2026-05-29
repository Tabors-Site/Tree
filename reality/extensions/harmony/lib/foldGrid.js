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
//
// PARALLEL FACTS — Strategy A (deterministic-bump cell collision).
//
// Two beings can stamp move-to-the-same-cell facts in the same tick.
// Both facts land on the reel (append-only, no rejection). At fold
// time the bump rule resolves the contention: earlier-seq holds the
// cell, later-seq is placed in the nearest free neighbor, searched
// in a fixed direction order and outward in rings. The fact is NOT
// rewritten; the grid simply renders the loser one cell over.
//
// THE GRID IS AUTHORITATIVE. The dancer's own qualities.harmony.coords
// keeps what the move-fact said ("I stepped to (3,4)") — honest about
// the act. But where the dancer actually IS post-bump lives only here,
// in the grid's fold. Dancers reading the world MUST consult this fold,
// not their own qualities row.
//
// Replay-identical: the neighbor-order constant and the seq-ordered
// walk produce the same placements every fold, every run.

import mongoose from "mongoose";

// Deterministic search order for the bump (PARALLEL FACTS §4.3).
// Eight compass directions, clockwise from N. Ring r searches every
// cell at Chebyshev distance r from the target, ordered by direction
// first, then by ring expansion. Replay reads this same constant.
const NEIGHBOR_DIRS = [
  { dx:  0, dy: -1 }, // N
  { dx:  1, dy: -1 }, // NE
  { dx:  1, dy:  0 }, // E
  { dx:  1, dy:  1 }, // SE
  { dx:  0, dy:  1 }, // S
  { dx: -1, dy:  1 }, // SW
  { dx: -1, dy:  0 }, // W
  { dx: -1, dy: -1 }, // NW
];

// Cap the ring search. Past this the grid is functionally full;
// the bump degenerates and we accept "no placement" (the loser sits
// at its requested cell on top of the winner). For real harmony
// boards this never triggers; the cap is here so a pathological
// reel can't spin forever.
const MAX_BUMP_RING = 16;

const cellKey = (x, y) => `${x},${y}`;

// Grid bounds default. When the grid space has no Space.size set
// (legacy plant, or a space the operator never sized), the fold
// degrades gracefully: every cell is in-bounds, the bump can land
// anywhere. Practical grids always carry size; this default exists
// so foldGrid doesn't throw on an un-sized space.
const UNBOUNDED = Object.freeze({ gridW: Infinity, gridH: Infinity });

/**
 * Read the grid bounds from the Space.size schema field. Returns
 * { gridW, gridH }. Falls back to UNBOUNDED when size is unset or
 * unreadable (the fold then treats every cell as in-bounds).
 *
 * The bounds are loaded once per fold (constant across the replay
 * of one grid) and passed through applyEvent → findNearestFree so
 * the bump search never produces an off-grid cell.
 */
async function loadGridBounds(gridSpaceId) {
  if (!gridSpaceId) return UNBOUNDED;
  try {
    const Space = mongoose.model("Space");
    const s = await Space.findById(String(gridSpaceId)).select("size").lean();
    const w = Number(s?.size?.x);
    const h = Number(s?.size?.y);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return UNBOUNDED;
    }
    return { gridW: w, gridH: h };
  } catch {
    return UNBOUNDED;
  }
}

function inBounds(x, y, bounds) {
  return x >= 0 && x < bounds.gridW && y >= 0 && y < bounds.gridH;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Walk outward from a target cell in deterministic order. For each
 * ring r ∈ [1, MAX_BUMP_RING], walk the 8 base directions, scaling
 * dx/dy by r. Yields the first cell that is in-bounds AND not in
 * `occupied`. Out-of-bounds cells are silently skipped so the bump
 * cannot place a being outside the grid space it belongs to.
 *
 * Returns { x, y } for the first free in-bounds cell, or null if
 * the search cap is exhausted.
 *
 * The walk is deterministic in seq+constant+bounds: same inputs =
 * same bump cell. Replay reproduces.
 */
function findNearestFree(targetX, targetY, occupied, bounds) {
  for (let r = 1; r <= MAX_BUMP_RING; r++) {
    for (const dir of NEIGHBOR_DIRS) {
      const x = targetX + dir.dx * r;
      const y = targetY + dir.dy * r;
      if (!inBounds(x, y, bounds)) continue;
      if (!occupied.has(cellKey(x, y))) {
        return { x, y };
      }
    }
  }
  return null;
}

/**
 * Apply one grid-event to (occupants, board). Pure given the inputs.
 * Mutates both maps in place because the fold caller composes many
 * events into one final state.
 *
 *   occupants : Map<"x,y", beingId>     — what's at each cell
 *   board     : Map<beingId, {x, y}>    — where each being is (post-bump)
 *   bounds    : { gridW, gridH }        — grid size; clamp/skip OOB cells
 *
 * Event shape: { event, beingId, to: {x, y}, from?: {x, y} }.
 *
 * Bounds handling:
 *   - The fact's `to` is clamped to the grid before the bump rule
 *     runs. A being can't be outside the space it's in; doctrine
 *     calls this out at the Space.size schema clamp. The fold
 *     enforces the same invariant on the projection — the Being row
 *     was clamped at set-being time, the grid-event fact carries
 *     the unclamped intent, the fold reconciles by clamping here.
 *   - The bump search is also in-bounds-only (findNearestFree),
 *     so a contested cell on an edge never places the loser off
 *     the grid.
 *
 * Bump rule (cell already occupied by SOMEONE ELSE):
 *   - search NEIGHBOR_DIRS outward in rings (in-bounds only)
 *   - first free cell wins
 *   - the fact's `to` is NOT mutated; only the grid's `board` reflects
 *     the bumped position
 *
 * Self-reoccupy (the cell is occupied by THIS being, e.g. a move to
 * the same cell): no-op on occupants, board re-set.
 */
function applyEvent(occupants, board, event, bounds) {
  if (!event || !event.beingId || !event.to) return;
  if (event.event !== "move" && event.event !== "place") return;

  const beingId = String(event.beingId);

  // Clamp the requested cell to the grid. The bump rule below
  // assumes a valid in-bounds target; an OOB request becomes the
  // nearest in-bounds cell (which may itself collide, in which
  // case the bump still applies).
  const reqX = bounds.gridW === Infinity
    ? event.to.x
    : clamp(Number(event.to.x) | 0, 0, bounds.gridW - 1);
  const reqY = bounds.gridH === Infinity
    ? event.to.y
    : clamp(Number(event.to.y) | 0, 0, bounds.gridH - 1);

  const requestedKey = cellKey(reqX, reqY);
  const previous = board.get(beingId) || null;

  // Vacate the being's previous cell (if it currently holds one).
  if (previous) {
    const prevKey = cellKey(previous.x, previous.y);
    if (occupants.get(prevKey) === beingId) {
      occupants.delete(prevKey);
    }
  }

  // Already at the requested cell? Idempotent re-place.
  const occupant = occupants.get(requestedKey);
  if (!occupant || occupant === beingId) {
    occupants.set(requestedKey, beingId);
    board.set(beingId, { x: reqX, y: reqY });
    return;
  }

  // Collision: someone else holds the requested cell. Find the nearest
  // free in-bounds neighbor deterministically.
  const free = findNearestFree(reqX, reqY, occupants, bounds);
  if (!free) {
    // Grid functionally full within the search cap (or so small that
    // every in-bounds neighbor is taken). Park at the requested cell
    // stacked on top (last-resort). The winner keeps the occupants
    // entry; the loser still gets a board entry so the dancer has
    // SOMEWHERE to be — and that somewhere is in-bounds because
    // requestedKey was clamped above.
    board.set(beingId, { x: reqX, y: reqY });
    return;
  }
  occupants.set(cellKey(free.x, free.y), beingId);
  board.set(beingId, { x: free.x, y: free.y });
}

export async function foldGridUpToSeq(gridSpaceId, tickSeq) {
  if (!gridSpaceId) return new Map();
  const bounds = await loadGridBounds(gridSpaceId);
  const Fact = mongoose.model("Fact");
  const facts = await Fact.find({
    "target.kind": "space",
    "target.id":   String(gridSpaceId),
    action:        "harmony:grid-event",
    seq:           { $lte: Number(tickSeq) || 0, $type: "number" },
  })
    .sort({ seq: 1 })
    .lean();

  const occupants = new Map();
  const board = new Map();
  for (const f of facts) {
    applyEvent(occupants, board, f.params || {}, bounds);
  }
  return board;
}

/**
 * Same as foldGridUpToSeq but also returns the occupants map (the
 * resolved "who is at each cell" view) and a placements map (alias
 * of board, named to match the PARALLEL FACTS spec language).
 *
 * Verification scripts use this to inspect both sides of the fold
 * without re-running it.
 */
export async function foldGridResolved(gridSpaceId, tickSeq) {
  if (!gridSpaceId) return { board: new Map(), occupants: new Map(), placements: new Map() };
  const bounds = await loadGridBounds(gridSpaceId);
  const Fact = mongoose.model("Fact");
  const facts = await Fact.find({
    "target.kind": "space",
    "target.id":   String(gridSpaceId),
    action:        "harmony:grid-event",
    seq:           tickSeq === undefined
                     ? { $type: "number" }
                     : { $lte: Number(tickSeq) || 0, $type: "number" },
  })
    .sort({ seq: 1 })
    .lean();

  const occupants = new Map();
  const board = new Map();
  for (const f of facts) {
    applyEvent(occupants, board, f.params || {}, bounds);
  }
  return { board, occupants, placements: board };
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

// Constants exposed for verification scripts that want to compute
// expected placements without re-running the fold.
export { NEIGHBOR_DIRS, MAX_BUMP_RING, findNearestFree, applyEvent };
