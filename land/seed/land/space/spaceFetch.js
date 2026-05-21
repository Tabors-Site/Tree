// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Reading the space-tree.
//
//   getSpaceName        lookup a space's display name by id
//   buildPathString     "Root > Branch > Leaf" path
//   resolveRootSpace    walk up to the rootOwner-bearing tree root
//   isDescendant        does one space sit beneath another
//   resolveSpaceAccess  does a being have read/write at this space
//   listSpaceChildren   list the immediate children of a space
//   listBeingSpaces     list every space-tree root a being owns
//
// All read-only. Writes live in spaceManagement.js. The walks here
// route through getAncestorChain so the same cached snapshot serves
// every resolution path within one conversation turn.

import Space from "../../models/space.js";
import { I_AM } from "./seedSpaces.js";
import { IBP_ERR } from "../../ibp/protocol.js";
import { getAncestorChain, resolveSpaceAccessFromChain } from "./ancestorCache.js";
import { getLandRootId } from "../../landRoot.js";

/**
 * Get a space's name by ID. Returns null if not found.
 */
export async function getSpaceName(spaceId) {
  if (!spaceId) return null;
  const doc = await Space.findById(spaceId, "name").lean();
  return doc?.name || null;
}

/**
 * Build the display path "Root > Branch > Leaf" for a space. Walks the
 * ancestor cache once; sub-paths share entries across calls.
 */
export async function buildPathString(spaceId) {
  const chain = await getAncestorChain(spaceId);
  if (!chain || chain.length === 0) return "";
  const segments = [];
  for (const ancestor of chain) {
    if (ancestor.seedSpace) break;
    if (ancestor.name) segments.push(ancestor.name);
  }
  // Chain is ordered space-to-root. Path is root-to-space.
  segments.reverse();
  return segments.join(" > ");
}

/**
 * Walk up the parent chain to the rootOwner-bearing tree root. The
 * .source self-tree counts as its own root (everything beneath it is
 * navigable but the tree-ownership boundary is .source itself).
 */
export async function resolveRootSpace(spaceId) {
  if (!spaceId) throw new Error("spaceId is required");

  let space = await Space.findById(spaceId)
    .select("parent rootOwner contributors seedSpace")
    .lean()
    .exec();

  if (!space) throw new Error("Space not found");
  if (space.seedSpace === "source") return space;

  while (!space.rootOwner || space.rootOwner === I_AM) {
    if (!space.parent) throw new Error("Invalid tree: no rootOwner found");
    space = await Space.findById(space.parent)
      .select("parent rootOwner contributors seedSpace")
      .lean()
      .exec();
    if (!space) throw new Error("Broken tree");
    if (space.seedSpace) {
      if (space.seedSpace === "source") return space;
      throw new Error("Invalid tree: reached land seed space boundary");
    }
  }
  return space;
}

/**
 * Does `spaceId` sit beneath `ancestorId`? Walks up from `spaceId`,
 * stopping at depth 100 (safety cap).
 */
export async function isDescendant(ancestorId, spaceId) {
  let current = await Space.findById(spaceId).select("parent").lean();
  let depth = 0;
  const maxDepth = 100;
  while (current && current.parent && depth < maxDepth) {
    if (current.parent.toString() === ancestorId.toString()) return true;
    current = await Space.findById(current.parent).select("parent").lean();
    depth++;
  }
  return false;
}

/**
 * Resolve a being's access at a space. Ownership resolves at the first
 * ancestor with rootOwner set ("the owner from this point down").
 * Contributors accumulate along the walk: write access if the being is
 * in contributors[] at ANY ancestor between the position and the
 * ownership boundary.
 *
 * beingId is normalized to string; callers can pass ObjectId or string.
 *
 * Convenience wrapper: hands the ancestor chain to
 * `resolveSpaceAccessFromChain`. Callers that already have the chain
 * snapshotted should call the chain-form directly.
 */
export async function resolveSpaceAccess(spaceId, beingId) {
  if (!spaceId) {
    return {
      ok: false,
      error: IBP_ERR.INVALID_INPUT,
      message: "spaceId is required",
    };
  }
  const safeBeingId = beingId ? String(beingId) : null;
  const ancestors = await getAncestorChain(String(spaceId));
  if (!ancestors) {
    return {
      ok: false,
      error: IBP_ERR.SPACE_NOT_FOUND,
      message: "Space not found.",
    };
  }
  return resolveSpaceAccessFromChain(String(spaceId), safeBeingId, ancestors);
}

/**
 * List the immediate children of a space. Skips seed spaces (so the
 * land root yields user-created tree roots, not .config / .tools /
 * etc.). Returns at most `limit` rows, newest-creation first.
 */
export async function listSpaceChildren(parentId, { exclude = null, limit = 500 } = {}) {
  if (!parentId) return [];
  const query = { parent: parentId, seedSpace: null };
  if (exclude) query._id = { $ne: exclude };
  return Space.find(query)
    .select("_id name type dateCreated qualities")
    .sort({ dateCreated: 1 })
    .limit(limit)
    .lean();
}

/**
 * List every space-tree root a being owns. A space-tree root sits
 * directly under the land root with rootOwner === beingId.
 */
export async function listBeingSpaces(beingId, { limit = 500 } = {}) {
  if (!beingId) return [];
  const landRootId = getLandRootId();
  if (!landRootId) return [];
  return Space.find({
    parent: landRootId,
    rootOwner: beingId,
    seedSpace: null,
  })
    .select("_id name type dateCreated qualities")
    .sort({ dateCreated: -1 })
    .limit(limit)
    .lean();
}
