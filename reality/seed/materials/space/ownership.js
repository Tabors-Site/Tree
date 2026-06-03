// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Ownership and contributors. Who can act here.
//
// Every Space carries two access fields: rootOwner (one being who
// owns this position and everything beneath it) and contributors[]
// (beings invited to write here without taking ownership). Both
// resolve up the parent chain — a Space without its own rootOwner
// inherits the nearest ancestor's. resolveSpaceAccess does the walk;
// this file is the write side that mutates the fields.
//
// rootOwner means "owner from this point down." Setting it on a
// branch delegates the whole sub-tree to a new being. The owner
// above can revoke the delegation; the delegate cannot revoke the
// owner above.
//
// Every mutation here gates on resolveSpaceAccess: only the resolved
// owner at the position can change ownership or contributors.
// Self-removal is the one exception — a contributor can step out
// without owner permission. Stance authorization will eventually
// express these rules uniformly; until then each method checks
// inline.
//
// Fact-driven (slice F-ownership, 2026-05-23). Every write here
// emits a `do:set` Fact on the Space's reel — rootOwner as a scalar
// field, contributors[] as a whole-array replace. The space lock
// serializes the read-modify-write window so concurrent contributor
// changes on the same Space don't race.

import Space from "./space.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import Being from "../being/being.js";
import { resolveSpaceAccess } from "./spaces.js";
import { invalidateSpace } from "./ancestorCache.js";
import { hooks } from "../../hooks.js";
import { getRealityConfigValue } from "../../realityConfig.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { I_AM } from "../being/seedBeings.js";
import { acquireSpaceLock, releaseSpaceLock } from "./spaceLocks.js";

/**
 * Add a contributor to a space. Only the resolved owner can do this.
 * Read-modify-write under the space lock; whole-array fact replace.
 */
export async function addContributor(spaceId, contributorId, beingId) {
  const { loadProjection } = await import("../projections.js");
  const _spaceSlot = await loadProjection("space", spaceId, "0");
  const space = _spaceSlot ? { seedSpace: _spaceSlot.state?.seedSpace } : null;
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify seed spaces");

  await assertBeingExists(contributorId);
  await assertOwner(spaceId, beingId);

  // Prevent adding the resolved owner as a contributor (redundant, logically wrong)
  const targetAccess = await resolveSpaceAccess(spaceId, contributorId);
  if (targetAccess.ok && targetAccess.isOwner) {
    throw new Error("Cannot add the owner as a contributor");
  }

  const MAX_CONTRIBUTORS = Number(getInternalConfigValue("maxContributorsPerSpace")) || 500;

  const locked = await acquireSpaceLock(spaceId, beingId);
  if (!locked) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Space is being modified");
  }
  try {
    const { loadProjection: _loadP } = await import("../projections.js");
    const _curSlot = await _loadP("space", spaceId, "0");
    const current = _curSlot ? { contributors: _curSlot.state?.contributors } : null;
    const list = current?.contributors || [];
    if (list.length >= MAX_CONTRIBUTORS) {
      throw new Error(`Space has reached the maximum of ${MAX_CONTRIBUTORS} contributors`);
    }
    if (list.includes(contributorId)) return; // already a contributor
    const next = [...list, contributorId];

    const target = { kind: "space", id: String(spaceId) };
    const { doVerb } = await import("../../ibp/verbs/do.js");
    await doVerb(
      target,
      "set-space",
      { field: "contributors", value: next },
      { identity: { beingId } },
    );
  } finally {
    releaseSpaceLock(spaceId, beingId);
  }

  invalidateSpace(spaceId);
  hooks.run("afterOwnershipChange", { spaceId, action: "addContributor", targetUserId: contributorId }).catch(() => {});
}

/**
 * Remove a contributor from a space.
 * The resolved owner or the contributor themselves can remove.
 */
export async function removeContributor(spaceId, contributorId, beingId) {
  const { loadProjection } = await import("../projections.js");
  const _spaceSlot = await loadProjection("space", spaceId, "0");
  const space = _spaceSlot ? { seedSpace: _spaceSlot.state?.seedSpace } : null;
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify seed spaces");

  await assertBeingExists(contributorId);

  // Self-removal is always allowed
  if (contributorId !== beingId) {
    await assertOwner(spaceId, beingId);
  }

  const locked = await acquireSpaceLock(spaceId, beingId);
  if (!locked) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Space is being modified");
  }
  try {
    const { loadProjection: _loadP } = await import("../projections.js");
    const _curSlot = await _loadP("space", spaceId, "0");
    const current = _curSlot ? { contributors: _curSlot.state?.contributors } : null;
    const list = current?.contributors || [];
    if (!list.includes(contributorId)) return; // already absent
    const next = list.filter((id) => id !== contributorId);

    const target = { kind: "space", id: String(spaceId) };
    const { doVerb } = await import("../../ibp/verbs/do.js");
    await doVerb(
      target,
      "set-space",
      { field: "contributors", value: next },
      { identity: { beingId } },
    );
  } finally {
    releaseSpaceLock(spaceId, beingId);
  }

  invalidateSpace(spaceId);
  hooks.run("afterOwnershipChange", { spaceId, action: "removeContributor", targetUserId: contributorId }).catch(() => {});
}

/**
 * Set rootOwner on a space (delegate ownership of a sub-tree).
 * Only the resolved owner above this position can delegate.
 * Cannot set rootOwner on place seed spaces.
 *
 * Two facts in sequence: the rootOwner write, then a contributors
 * prune (the new owner is removed from contributors[] if they were
 * one). Both under the space lock so the projection's contributors
 * list is consistent with the new ownership at the moment the second
 * fact lands.
 */
export async function setOwner(spaceId, newOwnerId, beingId) {
  const { loadProjection: _loadP1 } = await import("../projections.js");
  const _ownerSlot = await _loadP1("space", spaceId, "0");
  const space = _ownerSlot ? {
    seedSpace: _ownerSlot.state?.seedSpace,
    rootOwner: _ownerSlot.state?.rootOwner,
    parent:    _ownerSlot.state?.parent,
  } : null;
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot set ownership on seed spaces");

  await assertBeingExists(newOwnerId);

  if (space.rootOwner && space.rootOwner.toString() === newOwnerId) {
    throw new Error("Being is already the owner at this space");
  }

  // If this space already has rootOwner, only that owner can change it.
  // If it doesn't, resolve the owner above.
  if (space.rootOwner && space.rootOwner !== I_AM) {
    if (space.rootOwner.toString() !== beingId) {
      throw new Error("Only the current owner can reassign rootOwner");
    }
  } else if (space.parent) {
    // No rootOwner here. Check the owner above.
    await assertOwner(space.parent, beingId);
  } else {
    // Orphaned space with no parent and no owner. No path forward
    // without stance authorization rules; refuse for now.
    throw new Error("Cannot set owner on a top-level space with no current owner (stance authorization pending)");
  }

  const previousOwnerId = space.rootOwner ? space.rootOwner.toString() : null;

  const locked = await acquireSpaceLock(spaceId, beingId);
  if (!locked) throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Space ownership is being modified");
  try {
    // CAS check on rootOwner inside the lock: if a concurrent writer
    // changed ownership between our initial read and lock acquire, the
    // previousOwnerId we computed above is stale — abort.
    const { loadProjection: _loadP2 } = await import("../projections.js");
    const _curSlot2 = await _loadP2("space", spaceId, "0");
    const current = _curSlot2 ? {
      rootOwner:    _curSlot2.state?.rootOwner,
      contributors: _curSlot2.state?.contributors,
    } : null;
    const currentOwner = current?.rootOwner ? String(current.rootOwner) : null;
    if (currentOwner !== previousOwnerId) {
      throw new Error("Ownership changed concurrently. Retry the operation.");
    }

    const target = { kind: "space", id: String(spaceId) };
    const { doVerb } = await import("../../ibp/verbs/do.js");
    await doVerb(
      target,
      "set-space",
      { field: "rootOwner", value: newOwnerId },
      { identity: { beingId } },
    );

    const list = current?.contributors || [];
    if (list.includes(newOwnerId)) {
      const next = list.filter((id) => id !== newOwnerId);
      // (no row load; typed target above already names this space)
      await doVerb(
        target,
        "set-space",
        { field: "contributors", value: next },
        { identity: { beingId } },
      );
    }

    invalidateSpace(spaceId);
    hooks.run("afterOwnershipChange", { spaceId, action: "setOwner", targetUserId: newOwnerId, previousOwnerId }).catch(() => {});
  } finally {
    releaseSpaceLock(spaceId, beingId);
  }
}

/**
 * Remove rootOwner from a space (revoke delegation).
 * Only the owner ABOVE this space in the chain can revoke.
 * The delegate cannot revoke themselves (that would orphan the sub-tree
 * from their own authority, which makes no sense).
 */
export async function removeOwner(spaceId, beingId) {
  const { loadProjection: _loadP3 } = await import("../projections.js");
  const _rmSlot = await _loadP3("space", spaceId, "0");
  const space = _rmSlot ? {
    seedSpace: _rmSlot.state?.seedSpace,
    rootOwner: _rmSlot.state?.rootOwner,
    parent:    _rmSlot.state?.parent,
  } : null;
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify seed spaces");
  if (!space.rootOwner || space.rootOwner === I_AM) throw new Error("Space has no owner to remove");

  // Only the owner ABOVE this space can revoke. Top-level roots can't
  // have their owner removed under the current rules; stance
  // authorization will eventually grant exceptions per place policy.
  if (space.parent) {
    await assertOwner(space.parent, beingId);
  } else {
    throw new Error("Cannot remove owner on a top-level root (stance authorization pending)");
  }

  const removedOwnerId = space.rootOwner.toString();

  const locked = await acquireSpaceLock(spaceId, beingId);
  if (!locked) throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Space ownership is being modified");
  try {
    const target = { kind: "space", id: String(spaceId) };
    const { doVerb } = await import("../../ibp/verbs/do.js");
    await doVerb(
      target,
      "set-space",
      { field: "rootOwner", value: null },
      { identity: { beingId } },
    );
    invalidateSpace(spaceId);
    hooks.run("afterOwnershipChange", { spaceId, action: "removeOwner", targetUserId: removedOwnerId }).catch(() => {});
  } finally {
    releaseSpaceLock(spaceId, beingId);
  }
}

/**
 * Transfer ownership: set a new rootOwner on a space that already has one.
 * Only the current rootOwner on this space can transfer.
 *
 * Two facts under the lock: rootOwner flips to the new owner; the
 * previous owner is added as a contributor so they don't lose write
 * access to their former tree. The new owner is also pruned from
 * contributors if they had been one.
 */
export async function transferOwnership(spaceId, newOwnerId, beingId) {
  const { loadProjection: _loadP4 } = await import("../projections.js");
  const _txSlot = await _loadP4("space", spaceId, "0");
  const space = _txSlot ? {
    seedSpace: _txSlot.state?.seedSpace,
    rootOwner: _txSlot.state?.rootOwner,
  } : null;
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify seed spaces");
  if (!space.rootOwner || space.rootOwner === I_AM) throw new Error("Space has no owner to transfer from");

  await assertBeingExists(newOwnerId);

  const oldOwnerId = space.rootOwner.toString();

  if (oldOwnerId === newOwnerId) {
    throw new Error("User is already the owner at this space");
  }

  if (oldOwnerId !== beingId) {
    throw new Error("Only the current owner can transfer ownership");
  }

  const locked = await acquireSpaceLock(spaceId, beingId);
  if (!locked) throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Space ownership is being modified");
  try {
    const { loadProjection: _loadP } = await import("../projections.js");
    const _curSlot = await _loadP("space", spaceId, "0");
    const current = _curSlot ? { contributors: _curSlot.state?.contributors } : null;
    const list = current?.contributors || [];
    const filtered = list.includes(newOwnerId) ? list.filter((id) => id !== newOwnerId) : list;
    const next = filtered.includes(oldOwnerId) ? filtered : [...filtered, oldOwnerId];

    const target = { kind: "space", id: String(spaceId) };
    const { doVerb } = await import("../../ibp/verbs/do.js");
    await doVerb(
      target,
      "set-space",
      { field: "rootOwner", value: newOwnerId },
      { identity: { beingId } },
    );
    // (no row load; typed target above already names this space)
    await doVerb(
        target,
      "set-space",
      { field: "contributors", value: next },
      { identity: { beingId } },
    );

    invalidateSpace(spaceId);
    hooks.run("afterOwnershipChange", { spaceId, action: "transferOwnership", targetUserId: newOwnerId, previousOwnerId: oldOwnerId }).catch(() => {});
  } finally {
    releaseSpaceLock(spaceId, beingId);
  }
}

// ── Helpers ──

// Owner-only gate. Only the tree's owner passes; stance authorization
// will eventually grant per-stance exceptions, but not yet.
async function assertOwner(spaceId, beingId) {
  const access = await resolveSpaceAccess(spaceId, beingId);
  if (access.ok && access.isOwner) return;
  throw new Error("Only the tree owner can perform this action");
}

async function assertBeingExists(beingId, branch = "0") {
  if (!beingId) throw new Error("Being id is required");
  const { loadProjection } = await import("../projections.js");
  const slot = await loadProjection("being", beingId, branch);
  if (!slot) throw new Error("Being not found");
}
