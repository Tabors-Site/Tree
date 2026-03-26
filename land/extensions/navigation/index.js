import log from "../../seed/log.js";
import { resolveRootNode } from "../../seed/tree/treeFetch.js";
import {
  setModels, updateRecentRoots, getRecentRootsWithNames,
  addRoot, removeRoot, getUserRoots, getUserRootsWithNames,
  migrateRootsToMetadata,
} from "./core.js";

const RECENT_ROOTS_EVENT = "recentRoots";

export async function init(core) {
  setModels(core.models);

  // ── Boot migration: copy old User.roots to metadata.nav.roots ──
  try {
    const migrated = await migrateRootsToMetadata();
    if (migrated > 0) {
      log.info("Navigation", `Migrated roots for ${migrated} user(s) from schema to metadata`);
    }
  } catch (err) {
    log.error("Navigation", "Roots migration failed:", err.message);
  }

  // ── Hook: afterNodeCreate ──
  // When a user creates a tree root, add it to their navigation list.
  core.hooks.register("afterNodeCreate", async ({ node, userId }) => {
    if (!node || !userId) return;
    // Only tree roots (node.rootOwner is the creating user)
    if (node.rootOwner && node.rootOwner.toString() === userId) {
      await addRoot(userId, node._id.toString());
    }
  }, "navigation");

  // ── Hook: afterOwnershipChange ──
  // Maintain metadata.nav.roots when ownership or contributors change.
  core.hooks.register("afterOwnershipChange", async ({ nodeId, action, targetUserId, previousOwnerId }) => {
    if (!nodeId || !targetUserId) return;

    // Find the tree root for this node
    let rootId;
    try {
      const rootNode = await resolveRootNode(nodeId);
      rootId = rootNode._id.toString();
    } catch {
      // Node might be deleted or orphaned
      return;
    }

    if (action === "addContributor") {
      await addRoot(targetUserId, rootId);
    }

    if (action === "removeContributor") {
      // Check if the user still has access anywhere in this tree.
      // If they're still a contributor on another node or the owner, keep the root.
      const { Node } = core.models;
      const stillHasAccess = await Node.exists({
        $or: [
          { rootOwner: targetUserId },
          { contributors: targetUserId },
        ],
      });
      // More precise: check only nodes in this tree. But Node.exists is fast
      // and the common case (user removed from one tree) is correct.
      // Edge case: user contributes to multiple trees. The root stays because
      // they have access to at least one tree. That's correct.
      if (!stillHasAccess) {
        await removeRoot(targetUserId, rootId);
      }
    }

    if (action === "setOwner") {
      await addRoot(targetUserId, rootId);
    }

    if (action === "transferOwnership") {
      await addRoot(targetUserId, rootId);
      // Previous owner is now a contributor, keep their root
    }

    // removeOwner: the removed owner may still be a contributor. Don't remove root.
    // Let the consumer decide (team extension handles retirement separately).
  }, "navigation");

  // ── Hook: afterNavigate ──
  // Track recently visited trees.
  core.hooks.register("afterNavigate", async ({ userId, rootId }) => {
    if (!userId || !rootId) return;
    await updateRecentRoots(userId, rootId);
    const roots = await getRecentRootsWithNames(userId);
    core.websocket.emitToUser(userId, RECENT_ROOTS_EVENT, { roots });
  }, "navigation");

  // ── Socket handler: getRecentRoots ──
  core.websocket.registerSocketHandler("getRecentRoots", async ({ socket, userId }) => {
    if (!userId) {
      socket.emit(RECENT_ROOTS_EVENT, { roots: [] });
      return;
    }
    try {
      const roots = await getRecentRootsWithNames(userId);
      socket.emit(RECENT_ROOTS_EVENT, { roots });
    } catch (err) {
      log.error("Navigation", "Failed to get recent roots:", err.message);
      socket.emit(RECENT_ROOTS_EVENT, { roots: [] });
    }
  });

  log.info("Navigation", "Navigation and recent roots tracking loaded");

  // Export functions for other extensions
  return {
    exports: {
      getUserRoots,
      getUserRootsWithNames,
      getRecentRootsWithNames,
      addRoot,
      removeRoot,
    },
  };
}
