// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Being reducer. (state, fact) → state.
//
// One pure function per material type, per FOLD.md. The fold engine
// hands this reducer each fact in seq order and accumulates the
// returned state into the projection cache.
//
// As the bypass closure progresses, this reducer grows to handle
// more (verb, action) cases. Today it handles:
//   - `do:set` with field=`qualities.<ns>...` → derive qualities state
//   - any fact carrying params.toPosition → derive position
// Other Being fields (name, password, roles, etc.) still come from
// direct-mutation paths; their reducer cases land when their write
// sites convert.
//
// The reducer is pure: same (state, fact) → same state, every time.
// No I/O. No clocks. No reads of anything outside `state` and `fact`.
// Pure-ness is what lets concurrent folds compute identical state
// and what makes rebuild deterministic.

import { applySetQualities, applySetField, applyCreateBeing } from "../reducerHelpers.js";

/**
 * Empty initial state. Reducers grow this as they take ownership of
 * more fields. Today: empty — the fold derives qualities + position;
 * other fields land as their write sites convert.
 */
export function initial() {
  return {};
}

/**
 * Apply one fact to the state.
 *
 * Recognized facts:
 *   - `do:set` with field=`qualities.<ns>...` → derive qualities state
 *     (see reducerHelpers.applySetQualities for the rules).
 *   - any fact whose `params.toPosition` is set → derive `position`.
 *
 * @param {object} state  current accumulated state
 * @param {object} fact   the fact to apply
 * @returns {object} new state
 */
export function reduce(state, fact) {
  let next = state;

  // be:register — produces the initial row state from spec. No-op for
  // legacy slim-params facts (no .spec); safe to compose now even
  // before summonCreateBeing converts.
  next = applyCreateBeing(next, fact);

  // do:set — scalar fields (name/type) and qualities paths.
  next = applySetField(next, fact);
  next = applySetQualities(next, fact);

  // Position change. Writes BOTH `currentSpace` (legacy field, the
  // source for in-memory position cache and most existing readers)
  // AND `position` (the projection-index field that findByPosition
  // queries). They're the same value semantically; the dual write
  // keeps legacy readers working through the cutover.
  if (fact?.params?.toPosition !== undefined) {
    next = {
      ...next,
      currentSpace: fact.params.toPosition,
      position: fact.params.toPosition,
    };
  }

  // updatedAt is reducer-owned (no Mongoose timestamps on Being). On
  // any state-mutating apply, bump to the current fact's date so
  // rebuild from the reel produces the same value the live fold
  // landed on. applyCreateBeing already seeds both createdAt and
  // updatedAt on be:register; this catches every later mutating
  // fact and keeps the row deterministic from the reel alone.
  if (next !== state) {
    next = { ...next, updatedAt: fact.date };
  }

  return next === state ? { ...state } : next;
}
