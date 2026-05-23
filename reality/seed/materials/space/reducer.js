// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Space reducer. (state, fact) → state.
//
// One pure function per material type, per FOLD.md. The fold engine
// hands this reducer each fact in seq order; the returned state
// accumulates into the Space projection.
//
// **Today this reducer is minimal.** It advances foldedSeq (which the
// fold engine writes) and derives `position` from facts that set the
// space's parent. Every other Space field stays where direct mutation
// code paths put it. The reducer grows as more verbs emit facts.
//
// A Space's `position` is its parent space — the space it sits inside.
// The root space has `position: null`. This lets `findByPosition(P)`
// return every child space of P alongside beings and matter at P.

import { applySetQualities, applySetField, applyCreateSpace } from "../reducerHelpers.js";

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
 *   - any fact whose `params.parent` or `params.parentId` is set →
 *     derive `position` (the space's parent).
 *
 * @param {object} state
 * @param {object} fact
 * @returns {object} new state
 */
export function reduce(state, fact) {
  let next = state;

  // do:birth — derives the initial row state from spec. No-op for
  // legacy birth facts that lack .spec; safe to compose now.
  next = applyCreateSpace(next, fact);

  // do:set — scalar fields and qualities paths.
  next = applySetField(next, fact);
  next = applySetQualities(next, fact);

  const explicit = fact?.params?.parent ?? fact?.params?.parentId;
  if (explicit !== undefined) {
    next = { ...next, position: explicit };
  }

  // do:set { field:"parent", value:X } also moves the space. applySetField
  // updates state.parent above; mirror it onto position so foldPlace's
  // occupant index reflects the move. (The free-form `params.parent`
  // branch above handles facts that ship a parent in params directly,
  // e.g. spec-bearing birth facts; this branch handles the do:set shape
  // where the new value rides params.value.)
  if (fact?.action === "set" && fact?.params?.field === "parent") {
    next = { ...next, position: fact.params.value ?? null };
  }

  return next === state ? { ...state } : next;
}
