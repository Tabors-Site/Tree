// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// foldPlace — the cross-reel weave for a being's moment.
//
// `fold(type, id)` brings ONE aggregate's projection up to date.
// `foldPlace(beingId)` runs the weave: fold the being, fold the space
// the being is at, fold every occupant of that space (its beings,
// matter, child spaces), and assemble the result.
//
// Per FOLD.md: "reach is one hop." foldPlace folds the being, its
// space, and that space's occupants. Child spaces are LISTED (their
// presence is known from the position index) but their interiors are
// not deep-folded. A being only deep-folds a child space when it
// moves into it.
//
// Per FOLD.md's cross-reel consistency decision: no global snapshot.
// Each reel folds to its own current, independently. If the space
// advances between folding the being and folding the space, the next
// moment re-folds. The actor model holds.

import { fold } from "./foldEngine.js";
import { findByPosition } from "../../../materials/projections.js";

/**
 * Fold the place a being sees for one moment.
 *
 * Returns:
 *   {
 *     self:      <being state, folded>,
 *     space:     <space state, folded> | null,   // null when self has no position
 *     occupants: [<{type, id, state}>, ...],     // beings, matter, child spaces at the space
 *   }
 *
 * The shape is deliberately small. Building the rich stamp face
 * (system prompt, role context, capabilities) sits one layer up in
 * the stamper's assemble path — foldPlace gives that layer the raw
 * folded state to compose against.
 *
 * @param {string} beingId
 * @returns {Promise<{ self: object, space: object|null, occupants: Array<{type:string,id:string,state:object}> }>}
 */
export async function foldPlace(beingId) {
  if (!beingId) throw new Error("foldPlace: beingId is required");

  // 1. Fold the being itself.
  const self = await fold("being", beingId);

  // 2. Find the being's position. Today reducers don't derive
  //    `position` for beings yet (the position-fact bypass isn't
  //    closed), so fall back to the legacy `currentSpace` field on
  //    the row. As the bypass closes, `position` becomes the source.
  const spaceId = self?.position || self?.currentSpace || null;
  if (!spaceId) {
    return { self, space: null, occupants: [] };
  }

  // 3. Fold the space the being is at.
  const space = await fold("space", spaceId);

  // 4. Find occupants of that space — beings + matter + child spaces
  //    whose projection.position equals the space id. Then fold each.
  //    findByPosition hits the per-collection position index.
  const occupantRefs = await findByPosition(spaceId);

  // Self is its own occupant of its position; filter it out so the
  // caller doesn't get the being twice.
  const others = occupantRefs.filter(
    (o) => !(o.type === "being" && o.id === String(beingId)),
  );

  // Fold each occupant. Folds run in parallel — different reels, no
  // contention. If one fold throws, surface it but don't block the
  // others; the caller decides whether to fail the moment.
  const occupants = await Promise.all(
    others.map(async (o) => {
      try {
        const state = await fold(o.type, o.id);
        return { type: o.type, id: o.id, state };
      } catch (err) {
        return { type: o.type, id: o.id, error: err.message };
      }
    }),
  );

  return { self, space, occupants };
}
