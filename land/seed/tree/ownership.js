// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
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
import Being from "../models/being.js";
import { resolveTreeAccess } from "./treeAccess.js";
import { invalidateNode } from "./ancestorCache.js";
import { hooks } from "../core/hooks.js";
import { getLandConfigValue } from "../landConfig.js";
import { SYSTEM_OWNER, ERR, ProtocolError } from "../core/protocol.js";
import { acquireNodeLock, releaseNodeLock } from "./nodeLocks.js";

/**
 * Add a contributor to a node. Only the resolved owner or admin can do this.
 * Uses $addToSet for atomic dedup.
 */
export async function addContributor(nodeId, contributorId, actorId) {
  const node = await Node.findById(nodeId).select("systemRole").lean();
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  await assertUserExists(contributorId);
  await assertOwner(nodeId, actorId);

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
    await assertOwner(nodeId, actorId);
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
    // Only the current owner can reassign. (Admin bypass retired
    // 2026-05-18; stance authorization replaces it.)
    if (node.rootOwner.toString() !== actorId) {
      throw new Error("Only the current owner can reassign rootOwner");
    }
  } else if (node.parent) {
    // No rootOwner here. Check the owner above.
    await assertOwner(node.parent, actorId);
  } else {
    // Orphaned node with no parent and no owner. No path forward
    // without stance authorization rules; refuse for now.
    throw new Error("Cannot set owner on a top-level node with no current owner (stance authorization pending)");
  }

  const previousOwnerId = node.rootOwner ? node.rootOwner.toString() : null;

  const locked = await acquireNodeLock(nodeId, actorId);
  if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Node ownership is being modified");
  try {
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

    invalidateNode(nodeId);
    hooks.run("afterOwnershipChange", { nodeId, action: "setOwner", targetUserId: newOwnerId, previousOwnerId }).catch(() => {});
  } finally {
    releaseNodeLock(nodeId, actorId);
  }
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

  // Only the owner ABOVE this node can revoke. Top-level roots can't
  // have their owner removed under the current rules; stance
  // authorization will eventually grant exceptions per land policy.
  if (node.parent) {
    await assertOwner(node.parent, actorId);
  } else {
    throw new Error("Cannot remove owner on a top-level root (stance authorization pending)");
  }

  const removedOwnerId = node.rootOwner.toString();

  const locked = await acquireNodeLock(nodeId, actorId);
  if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Node ownership is being modified");
  try {
    await Node.updateOne(
      { _id: nodeId },
      { $set: { rootOwner: null } },
    );
    invalidateNode(nodeId);
    hooks.run("afterOwnershipChange", { nodeId, action: "removeOwner", targetUserId: removedOwnerId }).catch(() => {});
  } finally {
    releaseNodeLock(nodeId, actorId);
  }
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

  // Only the current owner can transfer. Admin bypass retired
  // 2026-05-18 ([[project_stance_authorization]] is the replacement).
  if (oldOwnerId !== actorId) {
    throw new Error("Only the current owner can transfer ownership");
  }

  const locked = await acquireNodeLock(nodeId, actorId);
  if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Node ownership is being modified");
  try {
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
    invalidateNode(nodeId);
    hooks.run("afterOwnershipChange", { nodeId, action: "transferOwnership", targetUserId: newOwnerId, previousOwnerId: oldOwnerId }).catch(() => {});
  } finally {
    releaseNodeLock(nodeId, actorId);
  }
}

// ── Helpers ──

// `isAdmin` retired 2026-05-18. The fallback "admin bypass" is gone;
// only the tree's owner can perform owner-only actions. Future
// stance-authorization rules ([[project_stance_authorization]]) replace
// the admin-bypass with proper per-stance grants.
async function assertOwner(nodeId, actorId) {
  const access = await resolveTreeAccess(nodeId, actorId);
  if (access.ok && access.isOwner) return;
  throw new Error("Only the tree owner can perform this action");
}

// assertAdmin is dead. Callers that used it had owner fallbacks via
// assertOwner; pure-admin gates retire pending stance authorization.

async function assertUserExists(beingId) {
  if (!beingId) throw new Error("User ID is required");
  const user = await Being.findById(beingId).select("_id").lean();
  if (!user) throw new Error("User not found");
}
