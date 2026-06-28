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

import { applySetQualities, applySetField, applyCreateSpace, applyMakeHeaven, applyMove } from "../reducerHelpers.js";
import { DELETED } from "./heavenSpaces.js";

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

  // do:make-heaven — the HEAVEN WORD. AFTER applyCreateSpace so a space's
  // birth (heavenSpace:null) lands first; this sets the real flag. Heaven-ness
  // is decomposed out of birth — its own fact, exactly like owner/qualities.
  next = applyMakeHeaven(next, fact);

  // do:set — scalar fields (name, type, parent, owner, ...) and
  // qualities paths. Both appliers gate themselves on their own
  // field-shape prefixes, so they're safe to compose; only one will
  // mutate state for any given fact.
  next = applySetField(next, fact);
  next = applySetQualities(next, fact);

  // do:move — picks up a space and puts it under a new parent.
  // Updates both parent and position; one fact, one intent recorded.
  next = applyMove(next, fact);

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
  if (fact?.act === "set-space" && fact?.params?.field === "parent") {
    next = { ...next, position: fact.params.value ?? null };
  }

  // do:delete (the end-space op) — the space is DELETED. ONE act, ONE fact (a THING is deleted); the
  // reducer FOLDS the consequences. The DELETED sentinel folding stays exactly as-is: parent=DELETED
  // (the sentinel that hides it from parent-query readers, mirrored onto position) and
  // members.owner=the deleter (revival audit), derived from the fact's `through` (the actor IS the
  // deleter). ADDED: qualities.dead = { byActor } — the ONE consistent cease marker across
  // being/space/matter (tombstoned = state.qualities.dead present, one check in qualities like
  // everything else). byActor = params.byActor ?? fact.through (exactly as applyKill).
  if (fact?.act === "delete" && fact?.of?.kind === "space") {
    const byActor = fact?.params?.byActor ?? fact?.through ?? null;
    const qualities = next.qualities || {};
    next = {
      ...next,
      parent: DELETED,
      position: DELETED,
      owner: String(fact.through || next.owner || ""),
      qualities: { ...qualities, dead: { byActor } },
    };
  }

  // No wall-clock is folded into space state. The "when" of any
  // mutation is its fact's position on the reel (chain order), not a
  // folded date. A folded updatedAt would be a clock read for truth,
  // so it is dropped; fact.date survives only as the per-fact witness.
  return next === state ? { ...state } : next;
}
