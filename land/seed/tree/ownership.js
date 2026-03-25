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
  if (node.rootOwner && node.rootOwner !== "SYSTEM") {
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

  // Set owner and remove from contributors (owner access supersedes contributor)
  await Node.updateOne(
    { _id: nodeId },
    {
      $set: { rootOwner: newOwnerId },
      $pull: { contributors: newOwnerId },
    },
  );
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
  if (!node.rootOwner || node.rootOwner === "SYSTEM") throw new Error("Node has no owner to remove");

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
  if (!node.rootOwner || node.rootOwner === "SYSTEM") throw new Error("Node has no owner to transfer from");

  await assertUserExists(newOwnerId);

  const oldOwnerId = node.rootOwner.toString();

  if (oldOwnerId === newOwnerId) {
    throw new Error("User is already the owner at this node");
  }

  const isCurrentOwner = oldOwnerId === actorId;
  if (!isCurrentOwner) {
    await assertAdmin(actorId);
  }

  // Step 1: Set new owner + remove new owner from contributors
  await Node.updateOne(
    { _id: nodeId },
    {
      $set: { rootOwner: newOwnerId },
      $pull: { contributors: newOwnerId },
    },
  );
  // Step 2: Demote old owner to contributor (separate op: MongoDB
  // cannot $pull and $addToSet on the same array in one update)
  await Node.updateOne(
    { _id: nodeId },
    { $addToSet: { contributors: oldOwnerId } },
  );
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
