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

import { applySetQualities, applySetField, applyCreateMatter } from "../reducerHelpers.js";

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

  // Position change.
  const explicit = fact?.params?.toPosition ?? fact?.params?.spaceId;
  if (explicit !== undefined) {
    next = { ...next, position: explicit };
  }

  return next === state ? { ...state } : next;
}
