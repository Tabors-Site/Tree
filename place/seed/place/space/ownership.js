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

import Space from "../../models/space.js";
import Being from "../../models/being.js";
import { resolveSpaceAccess } from "./spaceFetch.js";
import { invalidateSpace } from "./ancestorCache.js";
import { hooks } from "../../system/hooks.js";
import { getPlaceConfigValue } from "../../placeConfig.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { I_AM } from "./seedSpaces.js";
import { acquireSpaceLock, releaseSpaceLock } from "./spaceLocks.js";

/**
 * Add a contributor to a space. Only the resolved owner can do this.
 * Uses $addToSet for atomic dedup.
 */
export async function addContributor(spaceId, contributorId, beingId) {
  const space = await Space.findById(spaceId).select("seedSpace").lean();
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify place seed spaces");

  await assertBeingExists(contributorId);
  await assertOwner(spaceId, beingId);

  // Prevent adding the resolved owner as a contributor (redundant, logically wrong)
  const targetAccess = await resolveSpaceAccess(spaceId, contributorId);
  if (targetAccess.ok && targetAccess.isOwner) {
    throw new Error("Cannot add the owner as a contributor");
  }

  // Cap contributors array to prevent unbounded growth on shared spaces
  const MAX_CONTRIBUTORS = Number(getPlaceConfigValue("maxContributorsPerSpace")) || 500;
  const fullNode = await Space.findById(spaceId).select("contributors").lean();
  if (fullNode?.contributors?.length >= MAX_CONTRIBUTORS) {
    throw new Error(`Space has reached the maximum of ${MAX_CONTRIBUTORS} contributors`);
  }

  await Space.updateOne(
    { _id: spaceId },
    { $addToSet: { contributors: contributorId } },
  );
  invalidateSpace(spaceId); // contributors[] changed
  hooks.run("afterOwnershipChange", { spaceId, action: "addContributor", targetUserId: contributorId }).catch(() => {});
}

/**
 * Remove a contributor from a space.
 * The resolved owner or the contributor themselves can remove.
 */
export async function removeContributor(spaceId, contributorId, beingId) {
  const space = await Space.findById(spaceId).select("seedSpace").lean();
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify place seed spaces");

  await assertBeingExists(contributorId);

  // Self-removal is always allowed
  if (contributorId !== beingId) {
    await assertOwner(spaceId, beingId);
  }

  await Space.updateOne(
    { _id: spaceId },
    { $pull: { contributors: contributorId } },
  );
  invalidateSpace(spaceId); // contributors[] changed
  hooks.run("afterOwnershipChange", { spaceId, action: "removeContributor", targetUserId: contributorId }).catch(() => {});
}

/**
 * Set rootOwner on a space (delegate ownership of a sub-tree).
 * Only the resolved owner above this position can delegate.
 * Cannot set rootOwner on place seed spaces.
 */
export async function setOwner(spaceId, newOwnerId, beingId) {
  const space = await Space.findById(spaceId).select("seedSpace rootOwner parent").lean();
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot set ownership on place seed spaces");

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
    const filter = { _id: spaceId };
    if (previousOwnerId) {
      filter.rootOwner = previousOwnerId;
    } else {
      filter.rootOwner = null;
    }

    const result = await Space.updateOne(
      filter,
      {
        $set: { rootOwner: newOwnerId },
        $pull: { contributors: newOwnerId },
      },
    );

    if (result.matchedCount === 0) {
      throw new Error("Ownership changed concurrently. Retry the operation.");
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
  const space = await Space.findById(spaceId).select("seedSpace rootOwner parent").lean();
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify place seed spaces");
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
    await Space.updateOne(
      { _id: spaceId },
      { $set: { rootOwner: null } },
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
 */
export async function transferOwnership(spaceId, newOwnerId, beingId) {
  const space = await Space.findById(spaceId).select("seedSpace rootOwner").lean();
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify place seed spaces");
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
    await Space.bulkWrite([
      {
        updateOne: {
          filter: { _id: spaceId },
          update: { $set: { rootOwner: newOwnerId }, $pull: { contributors: newOwnerId } },
        },
      },
      {
        updateOne: {
          filter: { _id: spaceId },
          update: { $addToSet: { contributors: oldOwnerId } },
        },
      },
    ]);
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

async function assertBeingExists(beingId) {
  if (!beingId) throw new Error("Being id is required");
  const being = await Being.findById(beingId).select("_id").lean();
  if (!being) throw new Error("Being not found");
}
