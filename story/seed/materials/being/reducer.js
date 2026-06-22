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
// Other Being fields (name, password, ables, etc.) still come from
// direct-mutation paths; their reducer cases land when their write
// sites convert.
//
// The reducer is pure: same (state, fact) → same state, every time.
// No I/O. No clocks. No reads of anything outside `state` and `fact`.
// Pure-ness is what lets concurrent folds compute identical state
// and what makes rebuild deterministic.

import {
  applySetQualities,
  applySetField,
  applyCreateBeing,
  applyConnectionState,
  applyDeath,
  applyTrueName,
  applyAbleGrants,
} from "../reducerHelpers.js";

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
  // before birthBeing landed.
  next = applyCreateBeing(next, fact);

  // be:connect / be:release — maintains qualities.connection.inhabitedBy
  // as a projection of the connect/release fact stream. beingCognition()
  // in identity/lookups.js reads this projection to flip effective
  // cognition to "human" when an inhabitor is present.
  next = applyConnectionState(next, fact);

  // be:death — locks the being's lifecycle. Writes qualities.death =
  // { time, byActor }. Idempotent (first death wins). Consumers test
  // `qualities.death?.time != null` for is-dead. Past acts + grants
  // remain valid; new acts targeting this being refuse upstream
  // (beVerb + callVerb gate on isDead).
  next = applyDeath(next, fact);

  // be:truename — re-point this being at a declared Name (the trueName
  // transfer). Folds state.trueName onto the row; the being's _id (frozen
  // birth-event hash) is untouched, so the reel + chain survive the move.
  next = applyTrueName(next, fact);

  // do:set — scalar fields (name/type) and qualities paths.
  next = applySetField(next, fact);
  next = applySetQualities(next, fact);

  // do:grant-able / do:revoke-able — append/remove entries on
  // qualities.ablesGranted. Per seed/AblesAreAuth.md, grants are
  // facts; revocations are facts; the projection is the fold.
  next = applyAbleGrants(next, fact);

  // Position change. Writes `position` — the universal projection-
  // index field. Legacy `currentSpace` retired 2026-05-29; readers
  // use Being.position uniformly.
  if (fact?.params?.toPosition !== undefined) {
    next = {
      ...next,
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
