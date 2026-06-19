// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Matter reducer. (state, fact) → state.
//
// One pure function per material type, per FOLD.md. The fold engine
// hands this reducer each fact in seq order; the returned state
// accumulates into the Matter projection.
//
// **Today this reducer is minimal.** It advances foldedSeq (which the
// fold engine writes) and derives `position` from facts that name the
// matter's space. Every other Matter field stays where direct mutation
// code paths put it. The reducer grows as more verbs emit facts.
//
// A Matter's `position` is the space it lives in (its `spaceId`). If
// matter ever moves between spaces, the position-change fact updates
// this; until then the projection's `position` matches the matter's
// `spaceId` field on creation.

import { applySetQualities, applySetField, applyCreateMatter, applyMove, applyPurgeContent } from "../reducerHelpers.js";
import { DELETED } from "../space/heavenSpaces.js";

/**
 * Empty initial state. Today: empty — the fold derives qualities +
 * position; other fields land as their write sites convert.
 */
export function initial() {
  return {};
}

/**
 * Apply one fact to the state.
 *
 * Recognized facts:
 *   - `do:set` with field=`qualities.<ns>...` → derive qualities state.
 *   - any fact whose `params.spaceId` or `params.toPosition` is set →
 *     derive `position` (the space the matter sits in).
 *
 * @param {object} state
 * @param {object} fact
 * @returns {object} new state
 */
export function reduce(state, fact) {
  let next = state;

  // do:birth — produces the initial row state from spec.
  next = applyCreateMatter(next, fact);

  // do:set — scalar fields and qualities paths.
  next = applySetField(next, fact);
  next = applySetQualities(next, fact);

  // do:move — picks up a matter and puts it in a new space.
  // Updates both spaceId and position; one fact, one intent recorded.
  next = applyMove(next, fact);

  // do:purge-content — the bytes behind the current content hash were
  // physically removed from the content store; mark the ref purged.
  next = applyPurgeContent(next, fact);

  // Position change.
  const explicit = fact?.params?.toPosition ?? fact?.params?.spaceId;
  if (explicit !== undefined) {
    next = { ...next, position: explicit };
  }

  // updatedAt is reducer-owned (no Mongoose defaults, no pre-save
  // hook). applyCreateMatter seeds it on do:create; this catches
  // every later mutating fact so rebuild from the reel produces the
  // same value the live fold landed on.
  if (next !== state) {
    next = { ...next, updatedAt: fact.date };
  }

  return next === state ? { ...state } : next;
}

/**
 * Gone-predicate the fold engine consults after reducing. Ended
 * matter (end-matter writes spaceId=DELETED; the row stays on the
 * reel for audit) must TOMBSTONE its projection slot: tombstoning
 * frees the per-branch unique name index (partial filter
 * tombstoned:false) and drops the slot from findByName, so a new
 * matter can take the name and ended matter stops resolving. Without
 * this the name stays locked forever while the chain says "created"
 * — the chain and the fold cache disagree.
 *
 * @param {object} state
 * @returns {boolean}
 */
export function isGone(state) {
  return state?.spaceId === DELETED;
}
