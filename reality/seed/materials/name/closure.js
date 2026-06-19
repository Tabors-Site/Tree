// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// closure.js — Name lifecycle closure (name:banish) predicates + gate.
//
// A Name's banish is the structural end of its authority. Past facts it
// signed stay valid (history stands). Going forward, no fact can ever be
// signed by it again — the gate lives in the stamper (past/fact/facts.js
// logFact), beside the be:death gate, and keys on the fact's ACTOR
// (fact.nameId): a banished Name cannot be the actor of any new fact.
//
// A Name is story-wide — its reel does not fork (identity is above the
// branch timeline) — so its closed marker lives on main ("0") regardless of
// which branch a fact is being stamped on. Hence isNameBanished takes no
// branch, unlike isBeingDead.
//
// The ONE exception: the name:banish fact itself is allowed through (mirror
// closure.js's be:death carve-out), so the tombstone can seal. The Name
// reducer's applyCloseName is idempotent, so a re-firing banish is a no-op.

import { loadProjection } from "../projections.js";
import { I_AM } from "../being/seedBeings.js";

/**
 * True if the Name is banished (name:banish stamped). Reads the Name
 * projection's `closedAt` on main. False for a missing Name (no row to
 * close) and for I_AM (never banished in practice — banishing the story
 * root would brick it).
 *
 * @param {string} nameId
 * @returns {Promise<boolean>}
 */
export async function isNameBanished(nameId) {
  if (!nameId) return false;
  // I_AM is the story root — never banished (it would brick the story);
  // short-circuit so the stamper's per-fact gate skips a read on the common
  // case (today every actor is i-am).
  if (nameId === I_AM) return false;
  const slot = await loadProjection("name", String(nameId), "0");
  return !!slot?.state?.closedAt;
}

/**
 * The one exception to the stamper's banish gate: a name:banish fact is
 * allowed through even as it marks its actor closed, so the tombstone can
 * seal. applyCloseName is idempotent.
 *
 * @param {object} fact
 * @returns {boolean}
 */
export function isBanishFact(fact) {
  return fact?.verb === "name" && (fact?.act === "banish" || fact?.act === "close");
}
