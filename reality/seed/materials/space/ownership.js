// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Ownership — thin named convenience over the members primitive.
//
// Doctrine. Owner is the ONE base-axiom membership class — it grants
// implicit authority over the space + descendants without needing any
// role grant. Every OTHER form of delegated authority lives in the
// role registry: operators author roles and grant them via grant-role
// (per seed/RolesAreAuth.md).
//
// `addContributor` / `removeContributor` retired 2026-06-09 — the
// contributor concept is now just a role like any other. Replace
// with grant-role / revoke-role against an operator-authored role
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
export async function setOwner(spaceId, newOwnerId, beingId, branch, summonCtx = null) {
  return setSpaceOwner(spaceId, newOwnerId, beingId, branch, summonCtx);
}

/**
 * Clear the resolved owner at a space (revoke a delegation). The
 * parent's owner authorizes; the walker inherits ownership from above
 * after the clear.
 */
export async function removeOwner(spaceId, beingId, branch) {
  return removeSpaceOwner(spaceId, beingId, branch, null);
}

