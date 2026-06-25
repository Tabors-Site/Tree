// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// PositionProjection fold handler — the cross-cutting projection
// builder. Registered on the fold engine at module load; runs once
// per fact applied (via dispatchCrossCutting in foldEngine.js).
//
// One handler, one fact shape:
//
//   do:set-being with params.field === "coord"  → upsert the row at
//                                                  (beingId, spaceId)
//                                                  with the new coord
//                                                  and seq as
//                                                  lastMoveSeq.
//
// The fact lives on the being's reel (of.kind === "being",
// of.id === beingId). Single-writer holds — only the actor stamps
// onto their own reel — so the cross-cutting handler reads of.id
// as the beingId and looks up the being's current spaceId to scope
// the row.
//
// Idempotent: the upsert refuses to write when fact.seq <=
// lastMoveSeq on the existing row. Replay (rebuild from genesis) and
// concurrent live folds both end at the same row. Drop the row, walk
// the reel, get the same state — that's the discipline.

import { FileCollection } from "../../projStore.js";
import { registerCrossCuttingHandler } from "../../../present/stamper/2-fold/foldEngine.js";
import { hooks } from "../../../hooks.js";
import log from "../../../seedStory/log.js";

// Cross-cutting fold of beings' current coord per space. One row per
// (beingId, spaceId): "who is at this space, where" is a single indexed
// read instead of a scan across being position filters. The chain of
// do:set-being:coord facts on each being's reel is the record; this
// file-backed collection (one JSON file per row + a small index under
// <storeRoot>/proj/position) is the rebuildable cache.
const PositionProjection = new FileCollection("position");

// Build the composite _id from (beingId, spaceId). Single-source so fold
// and reads can't drift.
export function positionRowId(beingId, spaceId) {
  return `${String(beingId)}:${String(spaceId)}`;
}

async function handleSetBeingCoord(fact /*, type, id*/) {
  if (fact?.verb !== "do" || fact?.act !== "set-being") return;
  const params = fact.params || {};
  if (params.field !== "coord") return;
  if (fact.of?.kind !== "being" || !fact.of?.id) return;
  if (typeof fact.seq !== "number") return;

  const value = params.value;
  // Null/undefined means "unset coord", which is structurally the
  // same as removing the row (the being has no spatial position).
  if (value === null || value === undefined) {
    const beingId = String(fact.of.id);
    await PositionProjection.deleteMany({ beingId });
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) return;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return;

  const beingId = String(fact.of.id);

  // Resolve which space this coord belongs in. The fact carries the
  // being's reel only; the being's current `position` names the
  // space the coord is within. History-aware: a fact on #1 lives in
  // #1's projection slot. logFact refuses any fact without history;
  // a missing history here is upstream-broken and we want it loud.
  const { loadOrFold, assertHistoryOrThrow } = await import("../../../materials/projections.js");
  const history = assertHistoryOrThrow(fact.history, "positionProjectionFold(set-coord)");
  const slot = await loadOrFold("being", beingId, history);
  const spaceId = slot?.position ? String(slot.position) : null;
  if (!spaceId) return;

  const _id = positionRowId(beingId, spaceId);
  // INERT display witness only (the fact's frozen seal-time). The position's
  // truth-ordering is lastMoveSeq (the seq guard below), never updatedAt, and
  // nothing sorts on updatedAt. Drop the old `|| Date.now()` live-clock fallback
  // . folding a fresh wall-clock is forbidden (the same bug the inbox/threads
  // sweep killed). null when the fact carries no date.
  const updatedWitness = fact.date instanceof Date
    ? fact.date
    : (fact.date != null ? new Date(fact.date) : null);

  const $set = {
    beingId,
    spaceId,
    x: value.x,
    y: value.y,
    // Clock-free truth-ordering key (the move fact's per-reel seq).
    lastMoveSeq: fact.seq,
    // Inert display witness only; never sorted/compared/folded-as-fallback.
    updatedAt: updatedWitness,
  };
  if (Number.isFinite(value.z)) $set.z = value.z;

  // Seq guard. Only advance when the incoming fact is newer than
  // what we last wrote. The query matches when either no row exists
  // OR the existing row's lastMoveSeq is strictly less than this
  // fact's seq. A re-folded stale fact finds neither condition and
  // does nothing.
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
      {
        $set,
        $setOnInsert: { _id },
      },
      { upsert: true },
    );
  } catch (err) {
    // Upsert with the conditional $or can race two folds: both miss
    // the row, both try to insert, second hits duplicate-_id. Retry
    // as a strict update; whichever upsert won, the other reaches
    // the row already at or above this seq and the guard no-ops.
    if (err && (err.code === 11000 || err.code === 11001)) {
      result = await PositionProjection.updateOne(
        { _id, lastMoveSeq: { $lt: fact.seq } },
        { $set },
      );
    } else {
      throw err;
    }
  }

  // Real change → notify subscribers. The hook fires AFTER the row
  // commits so any listener that reads the projection sees the same
  // state the push announces. If the seq guard rejected the write
  // (stale fact, no movement), upsertedCount and modifiedCount are
  // both 0; the hook does not fire.
  const changed =
    (result?.upsertedCount && result.upsertedCount > 0) ||
    (result?.modifiedCount && result.modifiedCount > 0);
  if (changed) {
    const payload = {
      spaceId,
      beingId,
      x: value.x,
      y: value.y,
      lastMoveSeq: fact.seq,
    };
    if (Number.isFinite(value.z)) payload.z = value.z;
    try {
      await hooks.run("afterPositionUpdate", payload);
    } catch (err) {
      log.warn("PositionProjection", `afterPositionUpdate hook fan failed: ${err.message}`);
    }
  }
}

registerCrossCuttingHandler(handleSetBeingCoord);

/**
 * Read every position in a space. The portal subscribes to a space
 * and reads from here for the "who is at this space, where" answer.
 * Returns plain objects, sorted by lastMoveSeq for stable ordering.
 */
export async function readPositionsInSpace(spaceId) {
  if (!spaceId) return [];
  return await PositionProjection
    .find({ spaceId: String(spaceId) })
    .sort({ lastMoveSeq: 1 })
    .lean();
}

/**
 * Read a single being's row in a given space. Returns null when the
 * being hasn't moved in that space yet.
 */
export async function readPosition(beingId, spaceId) {
  if (!beingId || !spaceId) return null;
  return await PositionProjection
    .findById(positionRowId(beingId, spaceId))
    .lean();
}
