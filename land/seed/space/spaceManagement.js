// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Space management — create, rename, retype, move, delete, revive.
//
// Naming rules (one source of truth in `assertValidSpaceName`):
//
//   - 1 to 80 characters
//   - first character: ASCII letter or digit
//   - rest: letters, digits, dot, underscore, hyphen
//
// Everything else is rejected. This keeps every space addressable in a
// URL path without encoding — no slashes, no spaces, no HTML, no @ /
// ~ / ? / # prefixes that the IBP address grammar reserves. Land seed
// spaces (dot-prefixed) bypass these rules via `createLandSeedSpace`
// because the seed planted them.

import mongoose from "mongoose";

import Space from "../models/space.js";
import Being from "../models/being.js";
import { createMatter } from "../matter/matters.js";
import { logDid } from "./dids.js";
import { resolveSpaceAccess, isDescendant } from "./spaceFetch.js";
import { acquireSpaceLock, releaseSpaceLock, acquireMultiple, releaseMultiple } from "./spaceLocks.js";
import { invalidateAll, invalidateSpace } from "./ancestorCache.js";
import { hooks } from "../system/hooks.js";
import { getLandRootId } from "../landRoot.js";
import { getLandConfigValue } from "../landConfig.js";
import log from "../system/log.js";
import { ERR, ProtocolError } from "../ibp/protocol.js";
import { DELETED, SEED_BEING } from "./seedSpaces.js";
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
 * trimmed name on success.
 */
function assertValidSpaceName(raw) {
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
 * Returns the normalized type (string or null).
 */
function assertValidSpaceType(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new Error("Space type must be a string or null");
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
async function assertNameAvailableAt(parentId, name, { excludeSpaceId = null } = {}) {
  if (!parentId) return;
  const q = { parent: parentId, name };
  if (excludeSpaceId) q._id = { $ne: excludeSpaceId };
  const conflict = await Space.findOne(q).select("_id").lean();
  if (conflict) {
    throw new ProtocolError(409, ERR.RESOURCE_CONFLICT,
      `A space named "${name}" already exists at this position`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a space.
 *
 *   - `isRoot: true` plants a new tree under the land root, with the
 *     caller as `rootOwner`.
 *   - `isRoot: false` requires `parentId` and creates a child of that
 *     space (which must not be a land seed space).
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
  parentId       = null,
  isRoot         = false,
  beingId,
  type           = null,
  note           = null,
  metadata       = null,
  validatedBeing = null,
  summonId       = null,
  sessionId      = null,
} = {}) {
  name = assertValidSpaceName(name);
  type = assertValidSpaceType(type);

  if (!isRoot && !parentId) throw new Error("Non-root spaces require a parentId");

  const being = validatedBeing ?? (await getBeingOrThrow(beingId));

  // beforeSpaceCreate: extensions may modify or cancel. Pass parent
  // type so extensions can validate parent/child type compatibility.
  let parentType = null;
  if (parentId) {
    const parentDoc = await Space.findById(parentId).select("type").lean();
    parentType = parentDoc?.type || null;
  }
  const hookData = {
    name, type, parentId, parentType, isRoot,
    beingId: being._id,
    metadata: metadata || new Map(),
  };
  const hookResult = await hooks.run("beforeSpaceCreate", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
    throw new ProtocolError(500, code, hookResult.reason || "Space creation blocked");
  }
  // Hooks may have edited name/type; re-validate before save.
  name = assertValidSpaceName(hookData.name);
  type = assertValidSpaceType(hookData.type);

  // Name must be unique among siblings at the target parent so
  // path-based fetching (`/foo/bar/baz`) resolves unambiguously.
  const siblingParentId = isRoot ? getLandRootId() : parentId;
  await assertNameAvailableAt(siblingParentId, name);

  const newSpace = new Space({
    name,
    type,
    children:     [],
    parent:       isRoot ? getLandRootId() : (parentId || null),
    rootOwner:    isRoot ? being._id : null,
    contributors: [],
    metadata:     hookData.metadata instanceof Map ? hookData.metadata : new Map(),
  });
  await newSpace.save();

  // Structural mutation: lock the parent while adding to its children[].
  const lockTarget = isRoot ? getLandRootId() : parentId;
  if (lockTarget) {
    const locked = await acquireSpaceLock(lockTarget, sessionId);
    if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Parent space is being modified");
  }
  try {
    // Children cap: a wide space loads its entire children[] on every
    // parent query, so we cap one space's children to prevent memory
    // spikes. Default 1000; configurable via `maxChildrenPerSpace`.
    const maxChildren = parseInt(getLandConfigValue("maxChildrenPerSpace") || "1000", 10);

    if (isRoot) {
      const landRootId = getLandRootId();
      if (landRootId) {
        const landRoot = await Space.findById(landRootId).select("children").lean();
        if (landRoot?.children?.length >= maxChildren) {
          throw new ProtocolError(400, ERR.INVALID_INPUT,
            `Land root has reached the maximum of ${maxChildren} children`);
        }
        await Space.findByIdAndUpdate(landRootId, { $addToSet: { children: newSpace._id } });
      }
    } else if (parentId) {
      const parentSpace = await Space.findById(parentId).select("seedSpace children").lean();
      if (!parentSpace) throw new Error("Parent space not found");
      if (parentSpace.seedSpace) throw new Error("Cannot create spaces under land seed spaces");
      if (parentSpace.children?.length >= maxChildren) {
        throw new ProtocolError(400, ERR.INVALID_INPUT,
          `Parent space has reached the maximum of ${maxChildren} children`);
      }
      await Space.findByIdAndUpdate(parentId, { $addToSet: { children: newSpace._id } });

    }
  } finally {
    if (lockTarget) releaseSpaceLock(lockTarget, sessionId);
  }

  // Did audit is the dispatcher's job (one Did per verb emission).
  // Helpers no longer write Dids; the wrapping op's handler returns
  // _didTarget hinting at the new space so the dispatcher names the
  // substrate event (not the call's parent target).

  if (note?.trim()) {
    await createMatter({
      origin:   MATTER_ORIGIN.IBP,
      content:  note,
      beingId:  being._id,
      spaceId:  newSpace._id,
      summonId, sessionId,
    });
  }

  // Root creation awaits afterSpaceCreate so navigation can update
  // metadata.nav.roots before the caller receives the response.
  // Non-root creation fires and forgets (hooks are independent).
  if (isRoot) {
    await hooks.run("afterSpaceCreate", { space: newSpace, beingId: being._id }).catch(() => {});
  } else {
    hooks.run("afterSpaceCreate", { space: newSpace, beingId: being._id }).catch(() => {});
  }

  return newSpace;
}

/**
 * Create a land seed space. Owner: I-am. Audited via logDid.
 *
 * Two kinds of Space exist; this function makes the second kind.
 * Normal space (createSpace) is made BY beings FOR beings to live
 * in — addressable by stance, gated by auth. Land seed space (this
 * function) is made by I-am at boot: the fixed nine (.identity,
 * .config, .peers, .extensions, .flow, .tools, .roles, .operations,
 * .source) that hold I-am's own working memory, surfaced as spaces
 * so SEE reads them through the same protocol everything else does.
 * See point 5 of THE PHILOSOPHY OF THE SEED in seed/space/seedSpaces.js.
 *
 * Skips `createSpace`'s name validator (I-am owns the dot-namespace
 * — the validator's job is to keep every OTHER being out) and the
 * beforeSpaceCreate hook (extensions exist because I-am planted
 * .extensions; authority flows outward and can't loop back to gate
 * its own precondition — point 9). Everything else is the same
 * write that `createSpace` performs.
 */
export async function createLandSeedSpace({ name, parentId, seedSpace, metadata = null }) {
  if (!name || typeof name !== "string") throw new Error("Land seed space name is required");
  if (!parentId) throw new Error("Land seed space requires a parent");

  const { v4: uuidv4 } = await import("uuid");
  const id = uuidv4();

  const newSpace = new Space({
    _id: id,
    name,
    parent:       parentId,
    rootOwner:    SEED_BEING,
    seedSpace:    seedSpace || null,
    children:     [],
    contributors: [],
    metadata:     metadata instanceof Map ? metadata : new Map(),
  });
  await newSpace.save();
  await Space.findByIdAndUpdate(parentId, { $addToSet: { children: id } });

  // Audit the genesis act. The I-am is doing it; the Did
  // names it. Resolves via populate once ensureSeedBeing creates
  // the Being row in the same boot pass.
  try {
    await logDid({
      verb:    "do",
      action:  "create",
      beingId: SEED_BEING,
      target:  { kind: "space", id },
      params:  { name, seedSpace: seedSpace || null },
    });
  } catch (err) {
    log.warn("Land", `Did write for seed-space "${name}" failed: ${err.message}`);
  }

  return newSpace;
}

/**
 * Create a space and recursively create its children. Each level
 * carries the same shape:
 *
 *   { name, type?, note?, metadata?, children?: [...] }
 *
 * Every level runs the same validation `createSpace` enforces.
 */
export async function createSpaceBranch(branchData, parentId, beingId, summonId = null, sessionId = null) {
  const being = await getBeingOrThrow(beingId);
  return _createBranch(branchData, parentId, being, summonId, sessionId);
}

async function _createBranch(branchData, parentId, being, summonId, sessionId) {
  const { name, note, type, metadata } = branchData;
  const children = Array.isArray(branchData.children) ? branchData.children : [];

  let metadataMap = null;
  if (metadata instanceof Map) {
    metadataMap = metadata;
  } else if (metadata && typeof metadata === "object" && Object.keys(metadata).length > 0) {
    metadataMap = new Map(Object.entries(metadata));
  }

  const newSpace = await createSpace({
    name, parentId,
    beingId:        being._id,
    type:           type || null,
    note:           note || null,
    metadata:       metadataMap,
    validatedBeing: being,
    summonId, sessionId,
  });

  let totalCreated = 1;
  for (const childData of children) {
    const result = await _createBranch(childData, newSpace._id, being, summonId, sessionId);
    totalCreated += result.totalCreated;
  }
  return { rootId: newSpace._id, rootName: newSpace.name, totalCreated };
}

// ─────────────────────────────────────────────────────────────────────────
// RENAME / RETYPE
// ─────────────────────────────────────────────────────────────────────────

export async function editSpaceName({ spaceId, newName, beingId, summonId = null, sessionId = null }) {
  newName = assertValidSpaceName(newName);

  const space = await Space.findById(spaceId);
  if (!space)           throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify land seed spaces");

  // Reject collision with a sibling under the same parent. Skip the
  // check when the name isn't actually changing (re-saving same name).
  if (space.name !== newName) {
    await assertNameAvailableAt(space.parent, newName, { excludeSpaceId: spaceId });
  }

  const oldName = space.name;
  await Space.findByIdAndUpdate(spaceId, { $set: { name: newName } });

  return { space, oldName, newName };
}

export async function editSpaceType({ spaceId, newType, beingId, summonId = null, sessionId = null }) {
  newType = assertValidSpaceType(newType);

  const space = await Space.findById(spaceId);
  if (!space)           throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify land seed spaces");

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
  childId, newParentId, beingId,
  summonId = null, sessionId = null, opts = {},
) {
  const child = await Space.findById(childId);
  if (!child) throw new Error("Child space not found");
  if (child.rootOwner && child.rootOwner !== SEED_BEING) {
    throw new Error("Cannot change a tree root's parent");
  }
  if (child.parent.toString() === newParentId.toString()) {
    throw new Error("Space already has this parent");
  }

  const oldParentId = child.parent;
  const oldParent   = oldParentId ? await Space.findById(oldParentId) : null;
  const newParent   = await Space.findById(newParentId);

  if (!newParent)           throw new Error("New parent space not found");
  if (newParent.seedSpace) throw new Error("Cannot move into a land seed space");
  if (await isDescendant(childId, newParentId)) {
    throw new Error("Cannot move a space into its own descendant");
  }

  // Authorization. Same tree → write access. Cross-tree → both-roots ownership.
  const childAccess     = await resolveSpaceAccess(childId,     beingId);
  const newParentAccess = await resolveSpaceAccess(newParentId, beingId);

  if (childAccess.rootId === newParentAccess.rootId) {
    if (!childAccess.canWrite) throw new Error("Must be owner or contributor");
  } else {
    if (!childAccess.isOwner || !newParentAccess.isOwner) {
      throw new Error("Cannot move spaces across trees unless you own both roots");
    }
  }

  // Lock all three spaces in sorted order (deadlock prevention).
  const lockIds = [childId, oldParentId, newParentId].filter(Boolean).map(String);
  const locked  = await acquireMultiple(lockIds, sessionId);
  if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Spaces are being modified by another operation");

  // Try a transaction (replica set). Fall back to sequential on standalone.
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    await Space.findOne({}).limit(1).session(session).lean(); // probe
  } catch {
    if (session) {
      try { await session.abortTransaction(); } catch {}
      try { session.endSession(); } catch {}
    }
    session = null;
    log.verbose("Space", "MongoDB transactions unavailable; move runs without atomicity guarantees");
  }
  const txOpts = session ? { session } : {};

  try {
    if (oldParent) {
      await Space.findByIdAndUpdate(oldParent._id, { $pull: { children: childId } }, txOpts);
    }
    await Space.findByIdAndUpdate(childId,     { $set:      { parent:   newParentId } }, txOpts);
    await Space.findByIdAndUpdate(newParentId, { $addToSet: { children: childId    } }, txOpts);

    if (session) await session.commitTransaction();
  } catch (err) {
    if (session) { try { await session.abortTransaction(); } catch {} }
    releaseMultiple(lockIds, sessionId);
    throw err;
  } finally {
    if (session) session.endSession();
  }

  if (!opts.skipCacheInvalidation) invalidateAll();
  releaseMultiple(lockIds, sessionId);

  hooks.run("afterSpaceMove", {
    spaceId:     childId.toString(),
    oldParentId: oldParentId.toString(),
    newParentId: newParentId.toString(),
    beingId,
  }).catch(() => {});

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
export async function deleteSpaceBranch(spaceId, beingId, summonId = null, sessionId = null) {
  const spaceToDelete = await Space.findById(spaceId);
  if (!spaceToDelete) throw new Error("Space not found");

  const access = await resolveSpaceAccess(spaceId, beingId);
  if (!access.isOwner || (!access.isRoot && !!spaceToDelete.rootOwner)) {
    throw new Error("Must be owner and not root");
  }
  if (spaceToDelete.rootOwner && spaceToDelete.rootOwner !== SEED_BEING) {
    throw new Error("Root spaces can only be retired from root view");
  }
  if (spaceToDelete.parent === DELETED) {
    throw new Error("Space has already been deleted");
  }

  const hookResult = await hooks.run("beforeSpaceDelete", { space: spaceToDelete, beingId });
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
    throw new ProtocolError(500, code, hookResult.reason || "Space deletion blocked");
  }

  const oldParent = spaceToDelete.parent;
  const lockIds = [
    spaceId.toString(),
    oldParent && oldParent !== DELETED ? oldParent.toString() : null,
  ].filter(Boolean);

  const locked = await acquireMultiple(lockIds, sessionId);
  if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Spaces are being modified");

  try {
    spaceToDelete.rootOwner = beingId;
    spaceToDelete.parent    = DELETED;
    await spaceToDelete.save();

    if (oldParent && oldParent !== DELETED) {
      await Space.findByIdAndUpdate(oldParent, { $pull: { children: spaceId } });
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
 * Atomic `$set`. Did logged.
 */
export async function reorderChildren({
  spaceId, children: newOrder,
  beingId, summonId = null, sessionId = null,
}) {
  if (!Array.isArray(newOrder)) throw new Error("children must be an array");

  const space = await Space.findById(spaceId);
  if (!space)           throw new Error("Space not found");
  if (space.seedSpace) throw new Error("Cannot modify land seed spaces");

  const currentSet = new Set(space.children.map(String));
  const newSet     = new Set(newOrder.map(String));
  if (currentSet.size !== newSet.size || ![...currentSet].every((id) => newSet.has(id))) {
    throw new Error("Reorder must contain the same children IDs");
  }

  await Space.updateOne({ _id: spaceId }, { $set: { children: newOrder } });

  return { space };
}
