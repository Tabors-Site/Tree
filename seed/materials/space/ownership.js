// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Ownership — thin named convenience over the members primitive.
//
// Doctrine. Owner is the ONE base-axiom membership class — it grants
// implicit authority over the space + descendants without needing any
// able grant. Every OTHER form of delegated authority lives in the
// able registry: operators author ables and grant them via grant-able
// (per seed/AblesAreAuth.md).
//
// `addContributor` / `removeContributor` retired 2026-06-09 — the
// contributor concept is now just a able like any other. Replace
// with grant-able / revoke-able against an operator-authored able
// whose canDo covers the editing actions. See space/ops.js retirement
// note for the migration shape.

import {
  setSpaceOwner,
  removeSpaceOwner,
} from "./members.js";

/**
 * Set the resolved owner at a space. Replaces the singleton owner
 * class for this space. setSpaceOwner handles the underlying
 * primitive's invariants (owner is a singleton; transfers replace
 * atomically).
 */
export async function setOwner(spaceId, newOwnerId, beingId, history, moment = null) {
  return setSpaceOwner(spaceId, newOwnerId, beingId, history, moment);
}

/**
 * Clear the resolved owner at a space (revoke a delegation). The
 * parent's owner authorizes; the walker inherits ownership from above
 * after the clear.
 */
export async function removeOwner(spaceId, beingId, history, moment = null) {
  return removeSpaceOwner(spaceId, beingId, history, moment);
}

