// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// closure.js — being lifecycle closure (be:kill) predicates + gate.
//
// A being's cease is the structural end of its participation. Past
// acts + grants stay valid (facts at the time stand). Going forward:
//
//   - The dead being cannot act. No new Acts open on its chain;
//     no new Facts stamp with it as `through` (the being acted through).
//   - The dead being cannot be acted upon. No new Facts stamp with
//     it as `of.id` (recipient). Summons refuse. BE ops on it
//     refuse. Able grants/revocations refuse.
//
// The reducer (applyKill in reducerHelpers.js) lands the projection
// at `qualities.dead = { byActor }` (the ONE consistent cease marker
// across being/space/matter) AND scrubs every field that descriptor
// builders use to render the being at a position (position → null,
// coord → null, qualities.connection.inhabitedBy → null). The dead
// being disappears from every SEE projection without a per-call
// alive-filter. Identity-level state (name, defaultAble, ablesGranted,
// homeSpace, parentBeingId) stays — queryable as history. This module's
// `isBeingDead(beingId, history)` reads `qualities.dead` through
// `loadOrFold` so sub-histories that diverged see their effective view.
// The stamper (past/fact/facts.js emitFact) consults this predicate
// before every emit; refusal surfaces as an IbpError so upstream
// callers see a structured failure.
//
// The ONE exception: the be:kill fact itself is allowed through.
// It's the closing fact; without it the lock can never seal. The
// reducer's applyKill is idempotent, so a duplicate be:kill (after
// the chain already closed) is a no-op rather than a corruption.

import { loadOrFold } from "../projections.js";

/**
 * True if the being is dead (be:kill stamped). Reads
 * `qualities.dead`. History-aware via loadOrFold.
 *
 * Returns false for a missing being (no row to be closed) — callers
 * that need a being-existence check perform it separately.
 *
 * @param {string} beingId
 * @param {string} history  REQUIRED — no main-bias default
 * @returns {Promise<boolean>}
 */
export async function isBeingDead(beingId, history) {
  if (!beingId) return false;
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      "isBeingDead requires history as a non-empty string. " +
        "Pass moment?.actorAct?.history or the explicit history the " +
        "read is happening on — no main-bias default.",
    );
  }
  const slot = await loadOrFold("being", String(beingId), history);
  // Dead = the be:kill FACT folded (qualities.dead exists). No clock — the fact's existence IS the
  // cease; "when" is its chain position, not a timestamp.
  return !!slot?.state?.qualities?.dead;
}

/**
 * The one exception to the stamper's liveness gate: a be:kill fact
 * is allowed through even when its target is already (or becomes)
 * dead. Lets the lock seal without a chicken-and-egg failure;
 * applyKill is idempotent so a re-firing be:kill is a no-op.
 *
 * @param {object} fact
 * @returns {boolean}
 */
export function isKillFact(fact) {
  return fact?.verb === "be" && fact?.act === "kill";
}
