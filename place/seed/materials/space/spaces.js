// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Operations on spaces. Reads and writes, every shape the tree
// takes — create, rename, retype, move, delete, reorder, revive,
// look up, resolve access, walk the chain.
//
// Space comes first. Without it nothing else has a where to be —
// so the writes that shape the tree are the most consequential
// substrate mutations on the place. They run under tier-3 locks
// (spaceLocks.js) and they all flow through this file. Reads sit
// alongside writes here, mirroring matter/matters.js — one ops
// file per material.
//
// Naming rules (one source of truth in `assertValidSpaceName`):
//
//   - 1 to 80 characters
//   - first character: ASCII letter or digit
//   - rest: letters, digits, dot, underscore, hyphen
//
// Everything else is rejected. The rule keeps every space
// addressable in a URL path without encoding — no slashes, no
// spaces, no HTML, no @ / ~ / ? / # prefixes that the IBP address
// grammar reserves for stance qualifiers. Place seed spaces
// (dot-prefixed) bypass the rule via `createPlaceSeedSpace` because
// I plant them at boot and the validator's job is to keep every
// OTHER being out of the dot-namespace.

import mongoose from "mongoose";

import Space from "./space.js";
import Being from "../being/being.js";
import { createMatter } from "../matter/matters.js";
import { logFact } from "../../past/fact/facts.js";
import {
  acquireSpaceLock,
  releaseSpaceLock,
  acquireMultiple,
  releaseMultiple,
} from "./spaceLocks.js";
import {
  invalidateAll,
  invalidateSpace,
  getAncestorChain,
  resolveSpaceAccessFromChain,
} from "./ancestorCache.js";
import { hooks } from "../../system/hooks.js";
import { getPlaceRootId } from "../../placeRoot.js";
import { getPlaceConfigValue } from "../../placeConfig.js";
import log from "../../system/log.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { DELETED } from "./seedSpaces.js";
import { I_AM } from "../being/seedBeings.js";
import { MATTER_ORIGIN } from "../matter/origins.js";

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

const SPACE_NAME_MAX = 80;
const SPACE_TYPE_MAX = 32;
// Letter or digit start, then letter / digit / dot / underscore / hyphen.
// No slashes, no spaces, no HTML, no IBP-address sigils (@ ~ # ?).
const SPACE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SPACE_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validate (and trim) a space name. Throws on rejection. Returns the
 * trimmed name on success. Exported so the verb-side `do:set` handler
 * can validate without going through editSpaceName (which writes).
 */
export function assertValidSpaceName(raw) {
  if (typeof raw !== "string") throw new Error("Space name must be a string");
  const name = raw.trim();
  if (!name) throw new Error("Space name is required");
  if (name.length > SPACE_NAME_MAX) {
    throw new Error(`Space name must be ${SPACE_NAME_MAX} characters or fewer`);
  }
  if (!SPACE_NAME_RE.test(name)) {
    throw new Error(
      "Space name must contain only letters, digits, dot, underscore, or hyphen, " +
        "and must start with a letter or digit",
    );
  }
  return name;
}

/**
 * Validate (and trim) a space type. Null is allowed (untyped space).
 * Returns the normalized type (string or null). Exported alongside
 * assertValidSpaceName for verb-side validation.
 */
export function assertValidSpaceType(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string")
    throw new Error("Space type must be a string or null");
  const type = raw.trim();
  if (!type) return null;
  if (type.length > SPACE_TYPE_MAX) {
    throw new Error(`Space type must be ${SPACE_TYPE_MAX} characters or fewer`);
  }
  if (!SPACE_TYPE_RE.test(type)) {
    throw new Error(
      "Space type must contain only letters, digits, dot, underscore, or hyphen, " +
        "and must start with a letter or digit",
    );
  }
  return type;
}

async function getBeingOrThrow(beingId) {
  if (!beingId) throw new Error("beingId is required");
  const being = await Being.findById(beingId);
  if (!being) throw new Error("Being not found");
  return being;
}

/**
 * Reject if a non-deleted sibling at `parentId` already carries `name`.
 *
 * Two spaces with the same name at the same parent would silently
 * collide on every path-based lookup — `treeos.ai/foo/bar` resolves to
 * whichever the resolver hits first. Names are case-sensitive
 * (matching URL-path behavior); "Foo" and "foo" can coexist as
 * siblings even though that's usually a bad idea.
 *
 * Pass `excludeSpaceId` for renames so the space whose name we're
 * changing doesn't count itself as a collision.
 */
export async function assertNameAvailableAt(
  parentId,
  name,
  { excludeSpaceId = null } = {},
) {
  if (!parentId) return;
  const q = { parent: parentId, name };
  if (excludeSpaceId) q._id = { $ne: excludeSpaceId };
  const conflict = await Space.findOne(q).select("_id").lean();
  if (conflict) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT,
      `A space named "${name}" already exists at this position`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a space.
 *
 *   - `isRoot: true` plants a new tree under the place root, with the
 *     caller as `rootOwner`.
 *   - `isRoot: false` requires `parentId` and creates a child of that
 *     space (which must not be a place seed space).
 *
 * Initial matter content can be planted via `note` (creates one
 * IBP-origin Matter on the new space).
 *
 * Hooks: `beforeSpaceCreate` may modify or cancel; `afterSpaceCreate`
 * is awaited only for root creation so navigation can update its index
 * before the response returns.
 */
export async function createSpace({
  name,
  parentId = null,
  isRoot = false,
  beingId,
  type = null,
  note = null,
  qualities = null,
  validatedBeing = null,
  actId = null,
  sessionId = null,
} = {}) {
  name = assertValidSpaceName(name);
  type = assertValidSpaceType(type);

  if (!isRoot && !parentId)
    throw new Error("Non-root spaces require a parentId");

  const being = validatedBeing ?? (await getBeingOrThrow(beingId));

  // beforeSpaceCreate: extensions may modify or cancel. Pass parent
  // type so extensions can validate parent/child type compatibility.
  let parentType = null;
  if (parentId) {
    const parentDoc = await Space.findById(parentId).select("type").lean();
    parentType = parentDoc?.type || null;
  }
  const hookData = {
    name,
    type,
    parentId,
    parentType,
    isRoot,
    beingId: being._id,
    qualities: qualities || new Map(),
  };
  const hookResult = await hooks.run("beforeSpaceCreate", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? IBP_ERR.HOOK_TIMEOUT : IBP_ERR.HOOK_CANCELLED;
    throw new IbpError(code,
      hookResult.reason || "Space creation blocked",
    );
  }
  // Hooks may have edited name/type; re-validate before save.
  name = assertValidSpaceName(hookData.name);
  type = assertValidSpaceType(hookData.type);

  // Name must be unique among siblings at the target parent so
  // path-based fetching (`/foo/bar/baz`) resolves unambiguously.
  const siblingParentId = isRoot ? getPlaceRootId() : parentId;
  await assertNameAvailableAt(siblingParentId, name);

  const newSpace = new Space({
    name,
    type,
    children: [],
    parent: isRoot ? getPlaceRootId() : parentId || null,
    rootOwner: isRoot ? being._id : null,
    contributors: [],
    qualities:
      hookData.qualities instanceof Map ? hookData.qualities : new Map(),
  });
  await newSpace.save();

  // Structural mutation: lock the parent while adding to its children[].
  const lockTarget = isRoot ? getPlaceRootId() : parentId;
  if (lockTarget) {
    const locked = await acquireSpaceLock(lockTarget, sessionId);
    if (!locked)
      throw new IbpError(IBP_ERR.RESOURCE_CONFLICT,
        "Parent space is being modified",
      );
  }
  try {
    // Children cap: a wide space loads its entire children[] on every
    // parent query, so we cap one space's children to prevent memory
    // spikes. Default 1000; configurable via `maxChildrenPerSpace`.
    const maxChildren = parseInt(
      getPlaceConfigValue("maxChildrenPerSpace") || "1000",
      10,
    );

    if (isRoot) {
      const placeRootId = getPlaceRootId();
      if (placeRootId) {
        const placeRoot = await Space.findById(placeRootId)
          .select("children")
          .lean();
        if (placeRoot?.children?.length >= maxChildren) {
          throw new IbpError(IBP_ERR.INVALID_INPUT,
            `Place root has reached the maximum of ${maxChildren} children`,
          );
        }
        await Space.findByIdAndUpdate(placeRootId, {
          $addToSet: { children: newSpace._id },
        });
      }
    } else if (parentId) {
      const parentSpace = await Space.findById(parentId)
        .select("seedSpace children")
        .lean();
      if (!parentSpace) throw new Error("Parent space not found");
      if (parentSpace.seedSpace)
        throw new Error("Cannot create spaces under place seed spaces");
      if (parentSpace.children?.length >= maxChildren) {
        throw new IbpError(IBP_ERR.INVALID_INPUT,
          `Parent space has reached the maximum of ${maxChildren} children`,
        );
      }
      await Space.findByIdAndUpdate(parentId, {
        $addToSet: { children: newSpace._id },
      });
    }
  } finally {
    if (lockTarget) releaseSpaceLock(lockTarget, sessionId);
  }

  // Fact stamping is the dispatcher's job (one Fact per verb emission).
  // Helpers no longer stamp Facts; the wrapping op's handler returns
  // _factTarget hinting at the new space so the dispatcher names the
  // substrate event (not the call's parent target).

  if (note?.trim()) {
    await createMatter({
      origin: MATTER_ORIGIN.IBP,
      content: note,
      beingId: being._id,
      spaceId: newSpace._id,
      actId,
      sessionId,
    });
  }

  // Root creation awaits afterSpaceCreate so navigation can update
  // qualities.nav.roots before the caller receives the response.
  // Non-root creation fires and forgets (hooks are independent).
  if (isRoot) {
    await hooks
      .run("afterSpaceCreate", { space: newSpace, beingId: being._id })
      .catch(() => {});
  } else {
    hooks
      .run("afterSpaceCreate", { space: newSpace, beingId: being._id })
      .catch(() => {});
  }

  return newSpace;
}

/**
 * Create a place seed space. Owner: I_AM. Stamps a Fact via logFact.
 *
 * Two kinds of Space exist; this function makes the second kind.
 * Normal space (createSpace) is made BY beings FOR beings to live
 * in — addressable by stance, gated by auth. Place seed space (this
 * function) is made by I_AM at boot: the fixed (.identity, .config,
 * .peers, .extensions, .tools, .roles, .operations, .source,
 * .threads) that hold I_AM's own working memory, surfaced as spaces
 * so SEE reads them through the same protocol everything else does.
 * See point 5 of THE PHILOSOPHY OF THE SEED in seed/materials/space/seedSpaces.js.
 *
 * Skips `createSpace`'s name validator (I_AM owns the dot-namespace
 * — the validator's job is to keep every OTHER being out) and the
 * beforeSpaceCreate hook (extensions exist because I_AM planted
 * .extensions; authority flows outward and can't loop back to gate
 * its own precondition — point 9). Everything else is the same
 * write that `createSpace` performs.
 */
export async function createPlaceSeedSpace({
  name,
  parentId,
  seedSpace,
  qualities = null,
}) {
  if (!name || typeof name !== "string")
    throw new Error("Place seed space name is required");
  if (!parentId) throw new Error("Place seed space requires a parent");

  const { v4: uuidv4 } = await import("uuid");
  const id = uuidv4();

  const newSpace = new Space({
    _id: id,
    name,
    parent: parentId,
    rootOwner: I_AM,
    seedSpace: seedSpace || null,
    children: [],
    contributors: [],
    qualities: qualities instanceof Map ? qualities : new Map(),
  });
  await newSpace.save();
  await Space.findByIdAndUpdate(parentId, { $addToSet: { children: id } });

  // Act the genesis act. The I_AM is doing it; the Fact
  // names it. Resolves via populate once ensureIAm creates
  // the Being row in the same boot pass.
  try {
    await logFact({
      verb: "do",
      action: "create",
      beingId: I_AM,
      target: { kind: "space", id },
      params: { name, seedSpace: seedSpace || null },
    });
  } catch (err) {
    log.warn(
      "Place",
      `Fact stamp for seed-space "${name}" failed: ${err.message}`,
    );
  }

  return newSpace;
}

/**
 * Create a space and recursively create its children. Each level
 * carries the same shape:
 *
 *   { name, type?, note?, qualities?, children?: [...] }
 *
 * Every level runs the same validation `createSpace` enforces.
 */
export async function createSpaceBranch(
  branchData,
  parentId,
  beingId,
  actId = null,
  sessionId = null,
) {
  const being = await getBeingOrThrow(beingId);
  return _createBranch(branchData, parentId, being, actId, sessionId);
}

async function _createBranch(branchData, parentId, being, actId, sessionId) {
  const { name, note, type, qualities } = branchData;
  const children = Array.isArray(branchData.children)
    ? branchData.children
    : [];

  let qualitiesMap = null;
  if (qualities instanceof Map) {
    qualitiesMap = qualities;
  } else if (
    qualities &&
    typeof qualities === "object" &&
    Object.keys(qualities).length > 0
  ) {
    qualitiesMap = new Map(Object.entries(qualities));
  }

  const newSpace = await createSpace({
    name,
    parentId,
    beingId: being._id,
    type: type || null,
    note: note || null,
    qualities: qualitiesMap,
    validatedBeing: being,
    actId,
    sessionId,
  });

  let totalCreated = 1;
  for (const childData of children) {
    const result = await _createBranch(
      childData,
      newSpace._id,
      being,
      actId,
      sessionId,
    );
    totalCreated += result.totalCreated;
  }
  return { rootId: newSpace._id, rootName: newSpace.name, totalCreated };
}

// ─────────────────────────────────────────────────────────────────────────
// RENAME / RETYPE
// ─────────────────────────────────────────────────────────────────────────

export async function editSpaceName({
  spaceId,
  newName,
  beingId,
  actId = null,
  sessionId = null,
}) {
  newName = assertValidSpaceName(newName);

  const space = await Space.findById(spaceId);
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify place seed spaces");

  // Reject collision with a sibling under the same parent. Skip the
  // check when the name isn't actually changing (re-saving same name).
  if (space.name !== newName) {
    await assertNameAvailableAt(space.parent, newName, {
      excludeSpaceId: spaceId,
    });
  }

  const oldName = space.name;
  await Space.findByIdAndUpdate(spaceId, { $set: { name: newName } });

  return { space, oldName, newName };
}

export async function editSpaceType({
  spaceId,
  newType,
  beingId,
  actId = null,
  sessionId = null,
}) {
  newType = assertValidSpaceType(newType);

  const space = await Space.findById(spaceId);
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify place seed spaces");

  const oldType = space.type;
  await Space.findByIdAndUpdate(spaceId, { $set: { type: newType } });

  return { space, oldType, newType };
}

// ─────────────────────────────────────────────────────────────────────────
// MOVE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Move a space to a new parent.
 *
 *   - Same tree: caller must have write access (owner or contributor).
 *   - Cross-tree: caller must own BOTH tree roots.
 *
 * Runs the three structural writes ($pull from old parent, $set parent,
 * $addToSet on new parent) under a transaction when MongoDB is a
 * replica set; falls back to sequential ops on standalone with a
 * verbose warning.
 *
 * Pass `opts.skipCacheInvalidation` for batched moves so the caller
 * can invalidate once at the end.
 */
export async function updateParentRelationship(
  childId,
  newParentId,
  beingId,
  actId = null,
  sessionId = null,
  opts = {},
) {
  const child = await Space.findById(childId);
  if (!child) throw new Error("Child space not found");
  if (child.rootOwner && child.rootOwner !== I_AM) {
    throw new Error("Cannot change a tree root's parent");
  }
  if (child.parent.toString() === newParentId.toString()) {
    throw new Error("Space already has this parent");
  }

  const oldParentId = child.parent;
  const oldParent = oldParentId ? await Space.findById(oldParentId) : null;
  const newParent = await Space.findById(newParentId);

  if (!newParent) throw new Error("New parent space not found");
  if (newParent.seedSpace)
    throw new Error("Cannot move into a place seed space");
  if (await isDescendant(childId, newParentId)) {
    throw new Error("Cannot move a space into its own descendant");
  }

  // Authorization. Same tree → write access. Cross-tree → both-roots ownership.
  const childAccess = await resolveSpaceAccess(childId, beingId);
  const newParentAccess = await resolveSpaceAccess(newParentId, beingId);

  if (childAccess.rootId === newParentAccess.rootId) {
    if (!childAccess.canWrite) throw new Error("Must be owner or contributor");
  } else {
    if (!childAccess.isOwner || !newParentAccess.isOwner) {
      throw new Error(
        "Cannot move spaces across trees unless you own both roots",
      );
    }
  }

  // Lock all three spaces in sorted order (deadlock prevention).
  const lockIds = [childId, oldParentId, newParentId]
    .filter(Boolean)
    .map(String);
  const locked = await acquireMultiple(lockIds, sessionId);
  if (!locked)
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT,
      "Spaces are being modified by another operation",
    );

  // Try a transaction (replica set). Fall back to sequential on standalone.
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    await Space.findOne({}).limit(1).session(session).lean(); // probe
  } catch {
    if (session) {
      try {
        await session.abortTransaction();
      } catch {}
      try {
        session.endSession();
      } catch {}
    }
    session = null;
    log.verbose(
      "Space",
      "MongoDB transactions unavailable; move runs without atomicity guarantees",
    );
  }
  const txOpts = session ? { session } : {};

  try {
    if (oldParent) {
      await Space.findByIdAndUpdate(
        oldParent._id,
        { $pull: { children: childId } },
        txOpts,
      );
    }
    await Space.findByIdAndUpdate(
      childId,
      { $set: { parent: newParentId } },
      txOpts,
    );
    await Space.findByIdAndUpdate(
      newParentId,
      { $addToSet: { children: childId } },
      txOpts,
    );

    if (session) await session.commitTransaction();
  } catch (err) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch {}
    }
    releaseMultiple(lockIds, sessionId);
    throw err;
  } finally {
    if (session) session.endSession();
  }

  if (!opts.skipCacheInvalidation) invalidateAll();
  releaseMultiple(lockIds, sessionId);

  hooks
    .run("afterSpaceMove", {
      spaceId: childId.toString(),
      oldParentId: oldParentId.toString(),
      newParentId: newParentId.toString(),
      beingId,
    })
    .catch(() => {});

  return { child, newParent };
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE / REVIVE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Soft-delete a space. Sets the space's `parent` to DELETED and stamps
 * its `rootOwner` so the deleted-revive extension can restore it later.
 * Root spaces (tree anchors) can only be retired from root view.
 */
export async function deleteSpaceBranch(
  spaceId,
  beingId,
  actId = null,
  sessionId = null,
) {
  const spaceToDelete = await Space.findById(spaceId);
  if (!spaceToDelete) throw new Error("Space not found");

  const access = await resolveSpaceAccess(spaceId, beingId);
  if (!access.isOwner || (!access.isRoot && !!spaceToDelete.rootOwner)) {
    throw new Error("Must be owner and not root");
  }
  if (spaceToDelete.rootOwner && spaceToDelete.rootOwner !== I_AM) {
    throw new Error("Root spaces can only be retired from root view");
  }
  if (spaceToDelete.parent === DELETED) {
    throw new Error("Space has already been deleted");
  }

  const hookResult = await hooks.run("beforeSpaceDelete", {
    space: spaceToDelete,
    beingId,
  });
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? IBP_ERR.HOOK_TIMEOUT : IBP_ERR.HOOK_CANCELLED;
    throw new IbpError(code,
      hookResult.reason || "Space deletion blocked",
    );
  }

  const oldParent = spaceToDelete.parent;
  const lockIds = [
    spaceId.toString(),
    oldParent && oldParent !== DELETED ? oldParent.toString() : null,
  ].filter(Boolean);

  const locked = await acquireMultiple(lockIds, sessionId);
  if (!locked)
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT,
      "Spaces are being modified",
    );

  try {
    spaceToDelete.rootOwner = beingId;
    spaceToDelete.parent = DELETED;
    await spaceToDelete.save();

    if (oldParent && oldParent !== DELETED) {
      await Space.findByIdAndUpdate(oldParent, {
        $pull: { children: spaceId },
      });
    }
  } finally {
    releaseMultiple(lockIds, sessionId);
  }

  invalidateSpace(spaceId);
  return spaceToDelete;
}

// ─────────────────────────────────────────────────────────────────────────
// REORDER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reorder a space's children. The new order must contain exactly the
 * same IDs as the current `children`, just in a different sequence.
 * Atomic `$set`. Fact stamped.
 */
export async function reorderChildren({
  spaceId,
  children: newOrder,
  beingId,
  actId = null,
  sessionId = null,
}) {
  if (!Array.isArray(newOrder)) throw new Error("children must be an array");

  const space = await Space.findById(spaceId);
  if (!space) throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify place seed spaces");

  const currentSet = new Set(space.children.map(String));
  const newSet = new Set(newOrder.map(String));
  if (
    currentSet.size !== newSet.size ||
    ![...currentSet].every((id) => newSet.has(id))
  ) {
    throw new Error("Reorder must contain the same children IDs");
  }

  await Space.updateOne({ _id: spaceId }, { $set: { children: newOrder } });

  return { space };
}

// ─────────────────────────────────────────────────────────────────────────
// READS (merged from former spaceFetch.js)
// ─────────────────────────────────────────────────────────────────────────

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
      throw new Error("Invalid tree: reached place seed space boundary");
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
 * place root yields user-created tree roots, not .config / .tools /
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
 * directly under the place root with rootOwner === beingId.
 */
export async function listBeingSpaces(beingId, { limit = 500 } = {}) {
  if (!beingId) return [];
  const placeRootId = getPlaceRootId();
  if (!placeRootId) return [];
  return Space.find({
    parent: placeRootId,
    rootOwner: beingId,
    seedSpace: null,
  })
    .select("_id name type dateCreated qualities")
    .sort({ dateCreated: -1 })
    .limit(limit)
    .lean();
}
