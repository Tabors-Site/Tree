// TreeOS Harmony extension. AGPL-3.0.
//
// gridReducer.js. The single writer of position for beings on a
// harmony grid.
//
// Doctrine — schema-as-projection.
//
// Position on a grid is a projection field. Its truthful writer is
// the fold over harmony:grid-event facts with the PARALLEL FACTS
// §4 Strategy A bump rule applied. The verb handler (harmony:move,
// harmony:place-being) stamps the act of intent on the grid reel.
// This reducer is what walks the reel, applies the bump, and
// writes the resolved post-bump position to Being.coord and
// PositionProjection.
//
// One writer, one source of truth, one shape of data everywhere:
//   - the SEE descriptor reads Being.coord (this reducer wrote it)
//   - the live delta channel reads PositionProjection (this
//     reducer wrote it) and pushes afterPositionUpdate
//   - replay from genesis walks the same facts in the same seq
//     order with the same deterministic bump and ends at byte-
//     identical state
//
// The dancer's own role still calls foldGridLive() each tick to
// pick its next step; that's the role's decision input, separate
// from the projection write. The projection write here is the
// canonical "where the dancer ended up after this tick's collisions
// resolved" — read by everyone else.
//
// Idempotency. Cross-cutting handlers are called per-fact on live
// fold AND on rebuild (replay from genesis). Both paths must reach
// the same final state. Two guards keep that:
//
//   1. Per-grid in-memory `lastAppliedSeq` skips facts whose seq is
//      already accounted for, so replay doesn't re-apply events.
//   2. Each DB write uses a seq guard ($lt: fact.seq) so a stale
//      fact can't overwrite a newer projection. Concurrent rebuild
//      + live fold race is safe.
//
// State maintained per grid:
//   { lastAppliedSeq, occupants: Map<"x,y", beingId>, board: Map<beingId, {x,y}> }
//
// The occupants + board mirrors foldGrid.js's structures but is
// kept incrementally rather than rebuilt per call. First touch on
// a grid bootstraps state by full-folding up to fact.seq − 1, then
// applying the current fact; subsequent live appends just apply
// the new event.

import mongoose from "mongoose";
import log from "../../../seed/seedReality/log.js";
import { hooks } from "../../../seed/hooks.js";
import { registerCrossCuttingHandler } from "../../../seed/present/beats/2-fold/foldEngine.js";
import PositionProjection, { positionRowId } from "../../../seed/past/projections/position/positionProjection.js";
import { applyEvent, loadGridBounds, foldGridResolved } from "../lib/foldGrid.js";

// Per-grid state. Map<gridSpaceId, { lastAppliedSeq, occupants, board, bounds }>.
// Kept in-process across transactions; rebuilds from the reel on
// first touch after boot (or first touch on a never-seen grid).
const _gridState = new Map();

async function _stateForGrid(gridSpaceId, factSeq) {
  let state = _gridState.get(gridSpaceId);
  if (state) return state;

  // First touch on this grid in this process. Bootstrap by reading
  // every earlier fact and folding it up. If this is a brand-new
  // grid (no earlier facts), the bootstrap is a cheap no-op.
  const bounds = await loadGridBounds(gridSpaceId);
  const upTo = Number.isFinite(factSeq) && factSeq > 1 ? factSeq - 1 : 0;
  const { board, occupants } = await foldGridResolved(gridSpaceId, upTo);
  state = {
    lastAppliedSeq: upTo,
    occupants,
    board,
    bounds,
  };
  _gridState.set(gridSpaceId, state);
  return state;
}

async function handleHarmonyGridEvent(fact /*, type, id*/) {
  if (fact?.verb !== "do" || fact?.action !== "harmony:grid-event") return;
  if (fact.target?.kind !== "space" || !fact.target?.id) return;
  if (typeof fact.seq !== "number") return;

  const params = fact.params || {};
  const event = params.event;
  if (event !== "move" && event !== "place") return;
  const beingId = params.beingId ? String(params.beingId) : null;
  if (!beingId) return;
  if (!params.to || !Number.isFinite(params.to.x) || !Number.isFinite(params.to.y)) return;

  const gridSpaceId = String(fact.target.id);

  const state = await _stateForGrid(gridSpaceId, fact.seq);

  // Idempotency guard. Replay may dispatch a fact we've already
  // applied to the in-memory state. The DB writes also carry a seq
  // guard below, so duplicate dispatches degrade to no-op even if
  // this guard is somehow bypassed.
  if (fact.seq <= state.lastAppliedSeq) return;

  // Apply the bump rule. applyEvent mutates state.occupants and
  // state.board in place; the resolved cell for THIS being lives in
  // board after the call.
  applyEvent(state.occupants, state.board, params, state.bounds);
  state.lastAppliedSeq = fact.seq;

  const resolved = state.board.get(beingId);
  if (!resolved) {
    // The event was structurally invalid (rejected by applyEvent's
    // own guards). Nothing to write; state is unchanged.
    return;
  }

  const now = fact.date instanceof Date ? fact.date : new Date(fact.date || Date.now());

  // Write 1. Being.coord. The descriptor reads this directly; this
  // is the field the 3D portal renders.
  //
  // Seq guard: `qualities.harmony.lastGridSeq` records the last
  // grid-event seq we wrote for this being. Only advance on a
  // strictly newer fact. Stored under our extension namespace so
  // it does not collide with seed-owned qualities.
  const Being = mongoose.model("Being");
  try {
    await Being.updateOne(
      {
        _id: beingId,
        $or: [
          { "qualities.harmony.lastGridSeq": { $lt: fact.seq } },
          { "qualities.harmony.lastGridSeq": { $exists: false } },
        ],
      },
      {
        $set: {
          "coord.x": resolved.x,
          "coord.y": resolved.y,
          "qualities.harmony.lastGridSeq": fact.seq,
          updatedAt: now,
        },
      },
    );
  } catch (err) {
    log.warn("GridReducer", `Being.coord write failed for ${beingId.slice(0,8)} seq=${fact.seq}: ${err.message}`);
  }

  // Write 2. PositionProjection. The cross-cutting (beingId,
  // spaceId) view; portals subscribe to this for live deltas via
  // afterPositionUpdate.
  const _id = positionRowId(beingId, gridSpaceId);
  const $set = {
    beingId,
    spaceId: gridSpaceId,
    x: resolved.x,
    y: resolved.y,
    lastMoveSeq: fact.seq,
    updatedAt: now,
  };
  let result;
  try {
    result = await PositionProjection.updateOne(
      {
        _id,
        $or: [
          { lastMoveSeq: { $lt: fact.seq } },
          { lastMoveSeq: { $exists: false } },
        ],
      },
      { $set, $setOnInsert: { _id } },
      { upsert: true },
    );
  } catch (err) {
    if (err && (err.code === 11000 || err.code === 11001)) {
      // Concurrent upsert race: someone else inserted; retry as
      // strict update under the seq guard.
      result = await PositionProjection.updateOne(
        { _id, lastMoveSeq: { $lt: fact.seq } },
        { $set },
      );
    } else {
      log.warn("GridReducer", `PositionProjection write failed for ${beingId.slice(0,8)} seq=${fact.seq}: ${err.message}`);
      return;
    }
  }

  const changed =
    (result?.upsertedCount && result.upsertedCount > 0) ||
    (result?.modifiedCount && result.modifiedCount > 0);
  if (changed) {
    try {
      await hooks.run("afterPositionUpdate", {
        spaceId: gridSpaceId,
        beingId,
        x: resolved.x,
        y: resolved.y,
        lastMoveSeq: fact.seq,
      });
    } catch (err) {
      log.warn("GridReducer", `afterPositionUpdate hook fan failed: ${err.message}`);
    }
  }
}

registerCrossCuttingHandler(handleHarmonyGridEvent);

// Test seam. Drops in-memory grid state so verification tests can
// force a rebuild from the reel.
export function _resetGridState() {
  _gridState.clear();
}
