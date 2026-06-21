// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// closure.js — being lifecycle closure (be:death) predicates + gate.
//
// A being's death is the structural end of its participation. Past
// acts + grants stay valid (facts at the time stand). Going forward:
//
//   - The dead being cannot act. No new Acts open on its chain;
//     no new Facts stamp with it as `through` (the vessel acted through).
//   - The dead being cannot be acted upon. No new Facts stamp with
//     it as `of.id` (recipient). Summons refuse. BE ops on it
//     refuse. Role grants/revocations refuse.
//
// The reducer (applyDeath in reducerHelpers.js) lands the projection
// at `qualities.death = { time, byActor }` AND scrubs every field
// that descriptor builders use to render the being at a position
// (position → null, coord → null, qualities.connection.inhabitedBy
// → null). The dead being disappears from every SEE projection
// without a per-call alive-filter. Identity-level state (name,
// defaultRole, rolesGranted, homeSpace, parentBeingId) stays —
// queryable as history. This module's `isBeingDead(beingId, history)`
// reads `qualities.death?.time` through `loadOrFold` so sub-histories
// that diverged see their effective view. The stamper (past/fact/facts.js emitFact) consults this
// predicate before every emit; refusal surfaces as an IbpError so
// upstream callers see a structured failure.
//
// The ONE exception: the be:death fact itself is allowed through.
// It's the closing fact; without it the lock can never seal. The
// reducer's applyDeath is idempotent, so a duplicate be:death (after
// the chain already closed) is a no-op rather than a corruption.

import { loadOrFold } from "../projections.js";

/**
 * True if the being is closed (be:death stamped). Reads
 * `qualities.death?.time`. History-aware via loadOrFold.
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
  const time = slot?.state?.qualities?.death?.time;
  return !!time;
}

/**
 * The one exception to the stamper's liveness gate: a be:death fact
 * is allowed through even when its target is already (or becomes)
 * dead. Lets the lock seal without a chicken-and-egg failure;
 * applyDeath is idempotent so a re-firing be:death is a no-op.
 *
 * @param {object} fact
 * @returns {boolean}
 */
export function isDeathFact(fact) {
  return fact?.verb === "be" && fact?.act === "death";
}
