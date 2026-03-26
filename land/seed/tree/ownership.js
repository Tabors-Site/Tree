// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Ownership and contributor mutations.
 *
 * All mutations resolve the current owner by walking the parent chain
 * via resolveTreeAccess. Only the resolved owner (or admin) can modify
 * rootOwner or contributors at any position.
 *
 * rootOwner means "the owner from this point down." Setting rootOwner
 * on a branch delegates that entire sub-tree to a new owner. The owner
 * above can revoke it. The delegate cannot revoke the owner above.
 */

import Node from "../models/node.js";
import User from "../models/user.js";
import { resolveTreeAccess } from "./treeAccess.js";
import { invalidateNode } from "./ancestorCache.js";
import { hooks } from "../hooks.js";
import { getLandConfigValue } from "../landConfig.js";
import { SYSTEM_OWNER } from "../protocol.js";

/**
 * Add a contributor to a node. Only the resolved owner or admin can do this.
 * Uses $addToSet for atomic dedup.
 */
export async function addContributor(nodeId, contributorId, actorId) {
  const node = await Node.findById(nodeId).select("systemRole").lean();
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  await assertUserExists(contributorId);
  await assertOwnerOrAdmin(nodeId, actorId);

  // Prevent adding the resolved owner as a contributor (redundant, logically wrong)
  const targetAccess = await resolveTreeAccess(nodeId, contributorId);
  if (targetAccess.ok && targetAccess.isOwner) {
    throw new Error("Cannot add the owner as a contributor");
  }

  // Cap contributors array to prevent unbounded growth on shared nodes
  const MAX_CONTRIBUTORS = Number(getLandConfigValue("maxContributorsPerNode")) || 500;
  const fullNode = await Node.findById(nodeId).select("contributors").lean();
  if (fullNode?.contributors?.length >= MAX_CONTRIBUTORS) {
    throw new Error(`Node has reached the maximum of ${MAX_CONTRIBUTORS} contributors`);
  }

  await Node.updateOne(
    { _id: nodeId },
    { $addToSet: { contributors: contributorId } },
  );
  invalidateNode(nodeId); // contributors[] changed
  hooks.run("afterOwnershipChange", { nodeId, action: "addContributor", targetUserId: contributorId }).catch(() => {});
}

/**
 * Remove a contributor from a node.
 * The resolved owner, an admin, or the contributor themselves can remove.
 */
export async function removeContributor(nodeId, contributorId, actorId) {
  const node = await Node.findById(nodeId).select("systemRole").lean();
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  await assertUserExists(contributorId);

  // Self-removal is always allowed
  if (contributorId !== actorId) {
    await assertOwnerOrAdmin(nodeId, actorId);
  }

  await Node.updateOne(
    { _id: nodeId },
    { $pull: { contributors: contributorId } },
  );
  invalidateNode(nodeId); // contributors[] changed
  hooks.run("afterOwnershipChange", { nodeId, action: "removeContributor", targetUserId: contributorId }).catch(() => {});
}

/**
 * Set rootOwner on a node (delegate ownership of a sub-tree).
 * Only the resolved owner above this position, or admin, can delegate.
 * Cannot set rootOwner on system nodes.
 */
export async function setOwner(nodeId, newOwnerId, actorId) {
  const node = await Node.findById(nodeId).select("systemRole rootOwner parent").lean();
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot set ownership on system nodes");

  await assertUserExists(newOwnerId);

  if (node.rootOwner && node.rootOwner.toString() === newOwnerId) {
    throw new Error("User is already the owner at this node");
  }

  // If this node already has rootOwner, only that owner or an admin can change it.
  // If it doesn't, resolve the owner above.
  if (node.rootOwner && node.rootOwner !== SYSTEM_OWNER) {
    // Current owner or admin can reassign
    const isCurrentOwner = node.rootOwner.toString() === actorId;
    if (!isCurrentOwner) {
      await assertAdmin(actorId);
    }
  } else if (node.parent) {
    // No rootOwner here. Check the owner above.
    await assertOwnerOrAdmin(node.parent, actorId);
  } else {
    // No parent, no rootOwner. Only admin can set on orphaned nodes.
    await assertAdmin(actorId);
  }

  const previousOwnerId = node.rootOwner ? node.rootOwner.toString() : null;

  // Atomic CAS: only update if rootOwner hasn't changed since we read it.
  // Prevents TOCTOU race where ownership changes between the check above and the write.
  const filter = { _id: nodeId };
  if (previousOwnerId) {
    filter.rootOwner = previousOwnerId;
  } else {
    filter.rootOwner = null;
  }

  const result = await Node.updateOne(
    filter,
    {
      $set: { rootOwner: newOwnerId },
      $pull: { contributors: newOwnerId },
    },
  );

  if (result.matchedCount === 0) {
    throw new Error("Ownership changed concurrently. Retry the operation.");
  }

  invalidateNode(nodeId); // rootOwner changed
  hooks.run("afterOwnershipChange", { nodeId, action: "setOwner", targetUserId: newOwnerId, previousOwnerId }).catch(() => {});
}

/**
 * Remove rootOwner from a node (revoke delegation).
 * Only the owner ABOVE this node in the chain, or admin, can revoke.
 * The delegate cannot revoke themselves (that would orphan the sub-tree
 * from their own authority, which makes no sense).
 */
export async function removeOwner(nodeId, actorId) {
  const node = await Node.findById(nodeId).select("systemRole rootOwner parent").lean();
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");
  if (!node.rootOwner || node.rootOwner === SYSTEM_OWNER) throw new Error("Node has no owner to remove");

  // Only the owner above, or admin, can revoke
  if (node.parent) {
    await assertOwnerOrAdmin(node.parent, actorId);
  } else {
    // Top-level root. Only admin can remove the top owner.
    await assertAdmin(actorId);
  }

  const removedOwnerId = node.rootOwner.toString();

  await Node.updateOne(
    { _id: nodeId },
    { $set: { rootOwner: null } },
  );
  invalidateNode(nodeId); // rootOwner removed
  hooks.run("afterOwnershipChange", { nodeId, action: "removeOwner", targetUserId: removedOwnerId }).catch(() => {});
}

/**
 * Transfer ownership: set a new rootOwner on a node that already has one.
 * Only the current rootOwner on this node, or admin, can transfer.
 */
export async function transferOwnership(nodeId, newOwnerId, actorId) {
  const node = await Node.findById(nodeId).select("systemRole rootOwner").lean();
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");
  if (!node.rootOwner || node.rootOwner === SYSTEM_OWNER) throw new Error("Node has no owner to transfer from");

  await assertUserExists(newOwnerId);

  const oldOwnerId = node.rootOwner.toString();

  if (oldOwnerId === newOwnerId) {
    throw new Error("User is already the owner at this node");
  }

  const isCurrentOwner = oldOwnerId === actorId;
  if (!isCurrentOwner) {
    await assertAdmin(actorId);
  }

  // Atomic transfer: bulkWrite executes both operations in a single
  // server round-trip. If the process crashes mid-write, MongoDB's
  // ordered bulkWrite ensures partial state is visible (step 1 done,
  // step 2 not). Integrity check repairs on next boot.
  await Node.bulkWrite([
    {
      updateOne: {
        filter: { _id: nodeId },
        update: { $set: { rootOwner: newOwnerId }, $pull: { contributors: newOwnerId } },
      },
    },
    {
      updateOne: {
        filter: { _id: nodeId },
        update: { $addToSet: { contributors: oldOwnerId } },
      },
    },
  ]);
  invalidateNode(nodeId); // rootOwner transferred
  hooks.run("afterOwnershipChange", { nodeId, action: "transferOwnership", targetUserId: newOwnerId, previousOwnerId: oldOwnerId }).catch(() => {});
}

// ── Helpers ──

async function assertOwnerOrAdmin(nodeId, actorId) {
  const access = await resolveTreeAccess(nodeId, actorId);
  if (access.ok && access.isOwner) return;

  const actor = await User.findById(actorId).select("isAdmin").lean();
  if (actor?.isAdmin) return;

  throw new Error("Only the tree owner or admin can perform this action");
}

async function assertAdmin(actorId) {
  const actor = await User.findById(actorId).select("isAdmin").lean();
  if (!actor?.isAdmin) {
    throw new Error("Only an admin can perform this action");
  }
}

async function assertUserExists(userId) {
  if (!userId) throw new Error("User ID is required");
  const user = await User.findById(userId).select("_id").lean();
  if (!user) throw new Error("User not found");
}
