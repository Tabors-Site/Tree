// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Projections — the cache the fold writes to and the engine reads from.
//
// A projection IS the Space / Being / Matter row, extended with two
// projection-only fields: `foldedSeq` (the highest fact-seq applied)
// and `position` (reducer-derived occupant key).
//
// Per FOLD.md / STAMPER.md, this module is the **only** writer of
// projection state outside of legacy direct writes. The fold engine
// calls `applyProjection(type, id, {state, foldedSeq, position}, expectedFoldedSeq)`
// to advance the row; the compare-and-set on `foldedSeq` prevents
// marker regression when concurrent folds race.
//
// State shape: the `state` object holds the fields the reducer decided
// to derive. Today reducers are minimal — they advance foldedSeq and
// (when known) position, leaving the rest of the row untouched. As
// reducers gain content, they'll write more fields here; the row's
// non-projection fields (today the source of truth) will be replaced
// piece-by-piece as the bypass closure progresses.

import Being from "../models/being.js";
import Space from "../models/space.js";
import Matter from "../models/matter.js";

const MODELS = {
  being:  Being,
  space:  Space,
  matter: Matter,
};

function modelFor(type) {
  const M = MODELS[type];
  if (!M) throw new Error(`projections: unknown type "${type}"`);
  return M;
}

/**
 * Read the current projection state for an aggregate. Returns null
 * when the aggregate row doesn't exist. The shape is the full row
 * (since today the row IS the cache); reducers and the fold engine
 * read `foldedSeq` and `position` plus whatever fields they derive.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getProjection(type, id) {
  if (!id) return null;
  const M = modelFor(type);
  return await M.findById(id).lean();
}

/**
 * Conditional advance — CAS update on an existing projection row.
 * Only writes when current `foldedSeq` equals `expectedFoldedSeq`.
 * Returns true on success, false when the precondition failed
 * (someone else advanced first — caller lets the next fold catch up).
 *
 * Used by the incremental fold path. For first-fold / rebuild (where
 * the row may not exist), use `initProjection` instead.
 *
 * The `state` object IS the row's content. The reducer is the source
 * of truth for what a being/space/matter looks like; this method
 * writes whatever the reducer produced. There is no "required field"
 * negotiation between the schema and the projection — the schema is a
 * cache shape, not an authority.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {{state: object, foldedSeq: number, position: string|null}} next
 * @param {number|null} expectedFoldedSeq  the foldedSeq the caller read
 * @returns {Promise<boolean>} true when the advance landed
 */
export async function applyProjection(type, id, next, expectedFoldedSeq) {
  if (!id) return false;
  const M = modelFor(type);
  const { state = {}, foldedSeq, position } = next;
  if (typeof foldedSeq !== "number") {
    throw new Error("applyProjection: next.foldedSeq must be a number");
  }

  const $set = { ...state, foldedSeq };
  if (position !== undefined) $set.position = position;

  const guard = expectedFoldedSeq == null
    ? { $or: [{ foldedSeq: null }, { foldedSeq: { $exists: false } }] }
    : { foldedSeq: expectedFoldedSeq };

  const result = await M.updateOne(
    { _id: id, ...guard },
    { $set },
  );
  return result.matchedCount > 0;
}

/**
 * Insert-or-overwrite the projection. Used by rebuild and the
 * first-fold path where the row may not yet exist. Unconditional —
 * the reducer's output is authoritative, the row IS that output.
 *
 * `state` should contain the `_id` either implicitly (via the
 * `id` arg) or explicitly. We set `_id` from the arg via
 * `$setOnInsert` so the row materializes correctly when missing.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {{state: object, foldedSeq: number, position: string|null}} next
 * @returns {Promise<void>}
 */
export async function initProjection(type, id, next) {
  if (!id) throw new Error("initProjection: id is required");
  const M = modelFor(type);
  const { state = {}, foldedSeq, position } = next;
  if (typeof foldedSeq !== "number") {
    throw new Error("initProjection: next.foldedSeq must be a number");
  }

  const $set = { ...state, foldedSeq };
  if (position !== undefined) $set.position = position;
  // Strip _id from $set if present — it goes in $setOnInsert.
  delete $set._id;

  await M.updateOne(
    { _id: id },
    {
      $set,
      $setOnInsert: { _id: id },
    },
    { upsert: true },
  );
}

/**
 * Find aggregates positioned at a given space. Returns
 * [{type, id, foldedSeq, position}, ...] for every being and matter
 * whose projection.position equals the given spaceId, plus every
 * child Space whose position equals the parent.
 *
 * The query hits the per-collection position index (sparse). Spaces,
 * Beings, and Matter each have their own index on `position`.
 *
 * @param {string} spaceId  the space to find occupants of
 * @returns {Promise<Array<{type:string, id:string, foldedSeq:number|null, position:string|null}>>}
 */
export async function findByPosition(spaceId) {
  if (!spaceId) return [];
  const [beings, spaces, matters] = await Promise.all([
    Being.find({ position: spaceId }).select("_id foldedSeq position").lean(),
    Space.find({ position: spaceId }).select("_id foldedSeq position").lean(),
    Matter.find({ position: spaceId }).select("_id foldedSeq position").lean(),
  ]);
  return [
    ...beings.map((d) => ({ type: "being",  id: String(d._id), foldedSeq: d.foldedSeq ?? null, position: d.position ?? null })),
    ...spaces.map((d) => ({ type: "space",  id: String(d._id), foldedSeq: d.foldedSeq ?? null, position: d.position ?? null })),
    ...matters.map((d) => ({ type: "matter", id: String(d._id), foldedSeq: d.foldedSeq ?? null, position: d.position ?? null })),
  ];
}
