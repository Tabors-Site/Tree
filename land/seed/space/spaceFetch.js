// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Read-only queries over the space tree. Five small primitives all
// of which walk the ancestor chain in some way:
//
//   getSpaceName       lookup a space's display name by id
//   buildPathString    "Root > Branch > Leaf" path
//   resolveRootSpace   walk up to the rootOwner-bearing tree root
//   isDescendant       does one space sit beneath another
//   resolveSpaceAccess does a being have read/write at this space

import Space from "../models/space.js";
import { SEED_BEING } from "./seedSpaces.js";
import { ERR } from "../ibp/protocol.js";
import { getAncestorChain, resolveSpaceAccessFromChain } from "./ancestorCache.js";

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

  while (!space.rootOwner || space.rootOwner === SEED_BEING) {
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
      error: ERR.INVALID_INPUT,
      message: "spaceId is required",
    };
  }
  const safeUserId = beingId ? String(beingId) : null;
  const ancestors = await getAncestorChain(String(spaceId));
  if (!ancestors) {
    return {
      ok: false,
      error: ERR.SPACE_NOT_FOUND,
      message: "Space not found.",
    };
  }
  return resolveSpaceAccessFromChain(String(spaceId), safeUserId, ancestors);
}
