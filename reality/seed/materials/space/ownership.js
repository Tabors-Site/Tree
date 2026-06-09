// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Ownership and contributors — thin compatibility shims over the
// membership-class primitive.
//
// Doctrine. There is exactly one membership-class storage primitive
// (`space.members`, see materials/space/members.js). Owner and
// contributor are NOT separate concepts; they are two named classes
// in the members map (owner is a singleton class by invariant).
// Generic add-member / remove-member ops mutate any class; the four
// named functions here exist purely as named convenience for
// addContributor / removeContributor / setOwner / removeOwner /
// transferOwnership callers, all of which now delegate to the generic
// primitive in materials/space/members.js.
//
// New code should call the members.js primitives directly. These
// shims are kept while peripheral readers migrate to the new shape.

import {
  addSpaceMember,
  removeSpaceMember,
  setSpaceOwner,
  removeSpaceOwner,
} from "./members.js";

/**
 * Add a contributor to a space. Thin shim over addSpaceMember(
 *   ..., "contributor", ...).
 */
export async function addContributor(spaceId, contributorId, beingId, branch, summonCtx = null) {
  return addSpaceMember(spaceId, "contributor", contributorId, beingId, branch, summonCtx);
}

/**
 * Remove a contributor from a space. Thin shim over removeSpaceMember(
 *   ..., "contributor", ...). Self-removal is allowed (the underlying
 * primitive handles it).
 */
export async function removeContributor(spaceId, contributorId, beingId, branch, summonCtx = null) {
  return removeSpaceMember(spaceId, "contributor", contributorId, beingId, branch, summonCtx);
}

/**
 * Set the resolved owner at a space. Replaces the singleton owner
 * class. The previous owner (if any) is demoted to contributor so
 * they retain write access to their former subtree.
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

/**
 * Transfer ownership at a space. Reuses setSpaceOwner — the
 * underlying primitive already adds the previous owner as a
 * contributor in the same moment.
 */
export async function transferOwnership(spaceId, newOwnerId, beingId, branch, summonCtx = null) {
  return setSpaceOwner(spaceId, newOwnerId, beingId, branch, summonCtx);
}
