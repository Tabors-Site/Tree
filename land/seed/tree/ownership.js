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

/**
 * Add a contributor to a node. Only the resolved owner or admin can do this.
 * Uses $addToSet for atomic dedup.
 */
export async function addContributor(nodeId, contributorId, actorId) {
  const node = await Node.findById(nodeId).select("systemRole").lean();
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  await assertOwnerOrAdmin(nodeId, actorId);

  await Node.updateOne(
    { _id: nodeId },
    { $addToSet: { contributors: contributorId } },
  );
  invalidateNode(nodeId); // contributors[] changed
}

/**
 * Remove a contributor from a node.
 * The resolved owner, an admin, or the contributor themselves can remove.
 */
export async function removeContributor(nodeId, contributorId, actorId) {
  const node = await Node.findById(nodeId).select("systemRole").lean();
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  // Self-removal is always allowed
  if (contributorId !== actorId) {
    await assertOwnerOrAdmin(nodeId, actorId);
  }

  await Node.updateOne(
    { _id: nodeId },
    { $pull: { contributors: contributorId } },
  );
  invalidateNode(nodeId); // contributors[] changed
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

  await Node.updateOne(
    { _id: nodeId },
    { $set: { rootOwner: newOwnerId } },
  );
  invalidateNode(nodeId); // rootOwner changed
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

  await Node.updateOne(
    { _id: nodeId },
    { $set: { rootOwner: null } },
  );
  invalidateNode(nodeId); // rootOwner removed
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

  const isCurrentOwner = node.rootOwner.toString() === actorId;
  if (!isCurrentOwner) {
    await assertAdmin(actorId);
  }

  await Node.updateOne(
    { _id: nodeId },
    { $set: { rootOwner: newOwnerId } },
  );
  invalidateNode(nodeId); // rootOwner transferred
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
