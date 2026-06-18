// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Operations on spaces. Reads and writes, every shape the tree
// takes — create, rename, retype, move, delete, reorder, revive,
// look up, resolve access, walk the chain.
//
// Space comes first. Without it nothing else has a where to be —
// so the writes that shape the tree are the most consequential
// substrate mutations on the reality. They run under tier-3 locks
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
// grammar reserves for stance qualifiers. Place heaven spaces
// (dot-prefixed) bypass the rule via `createRealityHeavenSpace` because
// I plant them at boot and the validator's job is to keep every
// OTHER being out of the dot-namespace.

import mongoose from "mongoose";
import { randomUUID as uuidv4 } from "node:crypto";
import { getInternalConfigValue } from "../../internalConfig.js";

import Space from "./space.js";
import Being from "../being/being.js";
import { createMatter } from "../matter/matters.js";
import { emitFact } from "../../past/fact/facts.js";
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
import { hooks } from "../../hooks.js";
import { getSpaceRootId } from "../../sprout.js";
import { getRealityConfigValue, CONFIG_DEFAULTS } from "../../realityConfig.js";
import log from "../../seedReality/log.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { DELETED, HEAVEN_SPACE } from "./heavenSpaces.js";
import { I_AM } from "../being/seedBeings.js";

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
 * Validate (and optionally default) a space size. Shape `{ x, y, z? }`.
 *
 *   - null / undefined size: returns `defaultSpaceSize` from config when
 *     `applyDefault: true`, otherwise null. Lets create-* paths fall
 *     through to a sensible grid without forcing every caller to pass
 *     a size, while set-space:size keeps "null unsets" semantics.
 *   - non-object: INVALID_INPUT.
 *   - per-axis: positive finite number. Each axis is capped at
 *     `maxSpaceSize[axis]` from config; exceeding throws INVALID_INPUT
 *     with the axis named. Missing axes pass through (a 2D `{x, y}`
 *     stays 2D).
 *   - empty after filtering: default-substitute when `applyDefault`,
 *     else INVALID_INPUT (existing set-space behavior).
 *
 * Reads config via getRealityConfigValue; falls back to CONFIG_DEFAULTS
 * so the helper works at boot (ensureSpaceRoot runs before
 * initRealityConfig) and after.
 */
export function assertValidSpaceSize(raw, { applyDefault = false } = {}) {
  const defaultSize = getRealityConfigValue("defaultSpaceSize") || CONFIG_DEFAULTS.defaultSpaceSize;
  const maxSize     = getRealityConfigValue("maxSpaceSize")     || CONFIG_DEFAULTS.maxSpaceSize;

  if (raw === null || raw === undefined) {
    return applyDefault ? deepCopySize(defaultSize) : null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "size must be an object {x, y, z?} or null");
  }
  const out = {};
  for (const axis of ["x", "y", "z"]) {
    if (raw[axis] === undefined) continue;
    const v = raw[axis];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `size.${axis} must be a positive finite number; got ${v}`,
        { axis, value: v },
      );
    }
    const cap = maxSize?.[axis];
    if (typeof cap === "number" && Number.isFinite(cap) && v > cap) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `size.${axis} (${v}) exceeds maxSpaceSize.${axis} (${cap}). ` +
          `Raise maxSpaceSize via set-config to permit larger spaces.`,
        { axis, requested: v, max: cap },
      );
    }
    out[axis] = v;
  }
  if (Object.keys(out).length === 0) {
    if (applyDefault) return deepCopySize(defaultSize);
    throw new IbpError(IBP_ERR.INVALID_INPUT, "size requires at least one positive numeric axis");
  }
  return out;
}

function deepCopySize(s) {
  if (!s || typeof s !== "object") return null;
  const out = {};
  for (const axis of ["x", "y", "z"]) {
    if (typeof s[axis] === "number" && Number.isFinite(s[axis]) && s[axis] > 0) {
      out[axis] = s[axis];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
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

async function getBeingOrThrow(beingId, branch = "0") {
  if (!beingId) throw new Error("beingId is required");
  // loadOrFold so a being created in main is visible from any branch
  // before it's been touched there. Without this, the user's first
  // create-space on a fresh branch throws "Being not found" because
  // their being slot hasn't been cold-folded onto the branch yet.
  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("being", beingId, branch);
  if (!slot) throw new Error("Being not found");
  return { _id: slot.id, position: slot.position, ...slot.state };
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
  { excludeSpaceId = null, branch = "0" } = {},
) {
  if (!parentId) return;
  // Per-branch sibling name uniqueness via direct projection query.
  const { default: Projection } = await import("../branch/projection.js");
  const q = {
    branch, type: "space",
    "state.parent": parentId,
    "state.name": name,
    tombstoned: { $ne: true },
  };
  if (excludeSpaceId) q._id = { $ne: `${branch}:space:${excludeSpaceId}` };
  const conflict = await Projection.findOne(q).select("id").lean();
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
 *     caller as owner.
 *   - `isRoot: false` requires `parentId` and creates a child of that
 *     space (which must not be a place heaven space).
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
  size = null,
  coord = null,
  validatedBeing = null,
  actId = null,
  sessionId = null,
  moment = null,
} = {}) {
  name = assertValidSpaceName(name);
  type = assertValidSpaceType(type);
  // Substitute the configured defaultSpaceSize when the caller didn't
  // specify one, so portals always have a walkable grid to render and
  // beings have bounds to clamp coords against. Max-cap any explicit
  // size at maxSpaceSize; throws INVALID_INPUT when exceeded.
  size = assertValidSpaceSize(size, { applyDefault: true });

  if (!isRoot && !parentId)
    throw new Error("Non-root spaces require a parentId");

  // Branch the create runs on. Threaded from the moment ctx so a
  // create under #1 reads parents from #1's lineage (with branchPoint
  // fall-through) and stamps its birth fact onto #1's reel.
  const branch = moment?.actorAct?.branch || "0";

  // Assign a default coord inside the parent's size when the caller
  // didn't pass one. Without this every child space falls back to the
  // portal's hash-derived ring 22-76 units off-origin (the "trees
  // scattered in the distance" effect). Skip the default for root
  // spaces (no parent, nothing to position inside) and for spaces
  // whose parent has no size (nothing to randomize against).
  if (coord === null || coord === undefined) {
    if (!isRoot && parentId) {
      try {
        const { loadOrFold: _lP } = await import("../projections.js");
        const _pSlot = await _lP("space", parentId, branch);
        const parentSize = _pSlot?.state?.size || null;
        if (parentSize && Number.isFinite(parentSize.x) && Number.isFinite(parentSize.y) &&
            parentSize.x > 0 && parentSize.y > 0) {
          coord = {
            x: Math.floor(Math.random() * parentSize.x),
            y: Math.floor(Math.random() * parentSize.y),
          };
        }
      } catch { /* defensive: any lookup failure leaves coord null */ }
    }
  }

  // A child of the space root is a tree root by definition: it carries
  // an owner, lives at the reality's top level, and is reachable both
  // as `<reality>/<name>` (from the place root walk) AND as
  // `<reality>/~<owner-name>/<name>` (from the owner's home walk). The
  // home walk applies an owner filter (`rootOwner: <beingId>`), so if
  // a space sits at parent=spaceRoot WITHOUT rootOwner set, the home-
  // walk path can't find it and plant-after-create breaks even though
  // create succeeded. Promote any spaceRoot-parented create to a tree
  // root regardless of how the caller labeled it.
  const spaceRootId = getSpaceRootId();
  if (!isRoot && parentId && spaceRootId && String(parentId) === String(spaceRootId)) {
    isRoot = true;
  }

  const being = validatedBeing ?? (await getBeingOrThrow(beingId, branch));

  // beforeSpaceCreate: extensions may modify or cancel. Pass parent
  // type so extensions can validate parent/child type compatibility.
  let parentType = null;
  if (parentId) {
    const { loadOrFold: _lP2 } = await import("../projections.js");
    const _pDoc = await _lP2("space", parentId, branch);
    parentType = _pDoc?.state?.type || null;
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
  const siblingParentId = isRoot ? getSpaceRootId() : parentId;
  await assertNameAvailableAt(siblingParentId, name, { branch });

  // Fact-driven (Slice C, 2026-05-23). The new space's row is NOT
  // written directly. Instead the handler stamps a `do:birth` Fact on
  // the new space's reel; eager-fold runs the Space reducer's
  // applyCreateSpace and applyProjection materializes the row. Per
  // STAMPER.md / FOLD.md: one writer (fold), one source of truth (facts).
  //
  // The parent's space lock guards the max-children check + the fact
  // stamp window. Concurrent creates under the same parent serialize;
  // creates under different parents stay parallel.
  const resolvedParentId = isRoot ? getSpaceRootId() : (parentId || null);
  const lockTarget = resolvedParentId;
  if (lockTarget) {
    const locked = await acquireSpaceLock(lockTarget, sessionId);
    if (!locked)
      throw new IbpError(IBP_ERR.RESOURCE_CONFLICT,
        "Parent space is being modified",
      );
  }

  const id = uuidv4();
  try {
    // Children cap: count by parent (the parent-side children[] cache
    // is retired). countDocuments is O(1) on the parent index.
    const maxChildren = parseInt(
      getInternalConfigValue("maxChildrenPerSpace") || "1000",
      10,
    );

    const { default: _Proj } = await import("../branch/projection.js");
    if (isRoot) {
      if (resolvedParentId) {
        const childCount = await _Proj.countDocuments({
          branch, type: "space",
          "state.parent": resolvedParentId,
          tombstoned: { $ne: true },
        });
        if (childCount >= maxChildren) {
          throw new IbpError(IBP_ERR.INVALID_INPUT,
            `Place root has reached the maximum of ${maxChildren} children`,
          );
        }
      }
    } else if (parentId) {
      const { loadOrFold: _lP3 } = await import("../projections.js");
      const _pSlot3 = await _lP3("space", parentId, branch);
      const parentSpace = _pSlot3 ? { heavenSpace: _pSlot3.state?.heavenSpace } : null;
      // The parent may be pending earlier in this same moment's ΔF
      // (forward reference within one act) — accept either a
      // materialized row or a pending fact in moment.deltaF.
      if (!parentSpace) {
        const pendingInBatch = moment?.deltaF?.find(
          (f) =>
            f?.verb === "do" &&
            f?.act === "create-space" &&
            f?.of?.kind === "space" &&
            String(f?.of?.id) === String(parentId),
        );
        if (!pendingInBatch) throw new Error("Parent space not found");
      } else if (
        parentSpace.heavenSpace &&
        parentSpace.heavenSpace !== HEAVEN_SPACE.SPACE_ROOT &&
        beingId !== I_AM
      ) {
        // User-being protection: extension code / operators may not
        // create children directly under a seed dot-namespace
        // (.config, .tools, .extensions, …). The I-Am acts as itself
        // (genesis, manifest sync, registry mirrors) and owns the dot-
        // namespace — `beingId === I_AM` bypasses the check.
        //
        // SPACE_ROOT is exempt: the place root carries
        // heavenSpace=SPACE_ROOT for ancestor-chain identity, but it
        // IS the operator-visible root where every plant, every
        // user tree, every dance-floor lives. Treating it as
        // protected breaks the plant verb itself.
        throw new Error("Cannot create spaces under heaven spaces");
      }
      const childCount = await _Proj.countDocuments({
        branch, type: "space",
        "state.parent": parentId,
        tombstoned: { $ne: true },
      });
      if (childCount >= maxChildren) {
        throw new IbpError(IBP_ERR.INVALID_INPUT,
          `Parent space has reached the maximum of ${maxChildren} children`,
        );
      }
    }

    // Stamp the birth Fact. Inside a moment (moment provided) the
    // fact joins ctx.deltaF and seals with the rest of the moment.
    // Outside any moment (legacy standalone callers without moment),
    // emitFact falls back to sealFacts singleton — eager commit.
    const specQualities = hookData.qualities instanceof Map
      ? Object.fromEntries(hookData.qualities)
      : (hookData.qualities || {});
    await emitFact({
      verb:    "do",
      act:     "create-space",
      through: String(being._id),
      of:      { kind: "space", id },
      params:  {
        name,
        type:      type ?? null,
        parent:    resolvedParentId ? String(resolvedParentId) : null,
        // Tree roots get their creator as owner; sub-spaces inherit
        // ownership through the walker and start with no owner.
        ...(isRoot ? { owner: String(being._id) } : {}),
        qualities: specQualities,
        ...(size  ? { size }  : {}),
        ...(coord ? { coord } : {}),
      },
      actId: moment?.actId || actId,
      sessionId,
      // Branch this space is created on — a plant under #1 must land
      // its child-space facts on #1's reel so reads on #1 see them.
      branch: moment?.actorAct?.branch || "0",
    }, moment);
  } finally {
    if (lockTarget) releaseSpaceLock(lockTarget, sessionId);
  }

  // Inside a moment the row materializes at seal — return a pending
  // view carrying the id so the caller can keep operating without a
  // read-back. Outside a moment the eager singleton commit ran, so
  // the row exists and we read it back.
  if (moment) {
    return {
      _id: id,
      _pending: true,
      name,
      parent: resolvedParentId,
      heavenSpace: null,
    };
  }
  const { loadProjection: _lPnew } = await import("../projections.js");
  const _newSlot = await _lPnew("space", id, "0");
  if (!_newSlot) {
    throw new Error(`createSpace: birth Fact stamped but row ${id} not materialized`);
  }
  const newSpace = { _id: _newSlot.id, ...(_newSlot.state || {}) };

  if (note?.trim()) {
    await createMatter({
      content: note,
      beingId: being._id,
      spaceId: newSpace._id,
      actId,
      sessionId,
      moment,
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
 * Create a place heaven space. Owner: I_AM. Stamps a Fact via logFact.
 *
 * Two kinds of Space exist; this function makes the second kind.
 * Normal space (createSpace) is made BY beings FOR beings to live
 * in — addressable by stance, gated by auth. Place heaven space (this
 * function) is made by I_AM at boot: the fixed (.identity, .config,
 * .peers, .extensions, .tools, .roles, .operations, .source,
 * .threads) that hold I_AM's own working memory, surfaced as spaces
 * so SEE reads them through the same protocol everything else does.
 * See point 5 of THE PHILOSOPHY OF THE SEED in seed/materials/space/heavenSpaces.js.
 *
 * Skips `createSpace`'s name validator (I_AM owns the dot-namespace
 * — the validator's job is to keep every OTHER being out) and the
 * beforeSpaceCreate hook (extensions exist because I_AM planted
 * .extensions; authority flows outward and can't loop back to gate
 * its own precondition — point 9). Everything else is the same
 * write that `createSpace` performs.
 */
export async function createRealityHeavenSpace({
  name,
  parentId,
  heavenSpace,
  qualities = null,
  size = null,
}) {
  if (!name || typeof name !== "string")
    throw new Error("Seed space name is required");
  if (!parentId) throw new Error("Seed space requires a parent");

  const id = uuidv4();
  const specQualities = qualities instanceof Map
    ? Object.fromEntries(qualities)
    : (qualities || {});
  // Optional sized room (host/factory children): a size turns on the
  // grid render and gives occupants' coords meaning.
  const validatedSize = size ? assertValidSpaceSize(size) : null;

  const { withIAmAct } = await import("../../sprout.js");
  await withIAmAct(`I create the ${name} heaven space`, async (ctx) => {
    await emitFact({
      verb:    "do",
      act:     "create-space",
      through: I_AM,
      of:      { kind: "space", id },
      params:  {
        name,
        type:      null,
        parent:    parentId ? String(parentId) : null,
        owner: I_AM,
        heavenSpace: heavenSpace || null,
        ...(validatedSize ? { size: validatedSize } : {}),
        qualities: specQualities,
      },
      actId: ctx.actId,
      branch: "0",
    }, ctx);
  });
  // Row materializes at the per-moment seal (returned by now).
  return { _id: id, name, parent: parentId, heavenSpace };
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
  // Legacy bypass API. Direct Space row mutations are gone (the row is
  // no longer a projection cache; the projections collection is). New
  // callers route through doVerb("set-space", {field:"name"}) instead.
  // This stub throws so any lingering caller surfaces clearly.
  throw new Error(
    "editSpaceName is retired. Use do:set-space with field=\"name\" via doVerb instead. " +
    "args were: " + JSON.stringify({ spaceId, newName, beingId })
  );
}

export async function editSpaceType({
  spaceId,
  newType,
  beingId,
  actId = null,
  sessionId = null,
}) {
  // Legacy bypass API. Direct Space row mutations are gone; new callers
  // route through doVerb("set-space", {field:"type"}).
  throw new Error(
    "editSpaceType is retired. Use do:set-space with field=\"type\" via doVerb instead. " +
    "args were: " + JSON.stringify({ spaceId, newType, beingId })
  );
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
  // Retired. Direct space-parent mutation now flows through
  // do:set-space field="parent" so the move is fact-driven. This stub
  // alerts any straggling caller.
  throw new Error(
    "updateParentRelationship is retired. Use do:set-space with field=\"parent\" via doVerb instead. " +
    "args: " + JSON.stringify({ childId, newParentId, beingId })
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE / REVIVE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Soft-delete a space. Sets the space's `parent` to DELETED and stamps
 * its owner class to the deleter so the deleted-revive extension can
 * restore it later. Root spaces (tree anchors) can only be retired by
 * the resolved owner.
 */
export async function deleteSpaceBranch(
  spaceId,
  beingId,
  actId = null,
  sessionId = null,
) {
  const { loadProjection: _lPdel } = await import("../projections.js");
  const { getSpaceOwner } = await import("./members.js");
  const _delSlot = await _lPdel("space", spaceId, "0");
  const spaceToDelete = _delSlot ? { _id: _delSlot.id, ...(_delSlot.state || {}) } : null;
  if (!spaceToDelete) throw new Error("Space not found");

  const ownerIdAtSpace = getSpaceOwner(spaceToDelete);

  if (beingId !== I_AM) {
    const access = await resolveSpaceAccess(spaceId, beingId);
    if (!access.isOwner || (!access.isRoot && !!ownerIdAtSpace)) {
      throw new Error("Must be owner and not root");
    }
    if (ownerIdAtSpace && ownerIdAtSpace !== I_AM) {
      throw new Error("Root spaces can only be retired from root view");
    }
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
    // Fact-driven soft-delete (2026-05-23, refit 2026-06-07). Two
    // do:set facts on the space's reel: members.owner becomes the
    // deleter (revival audit), parent flips to DELETED (the sentinel
    // that hides the space from parent-query readers). The per-reel
    // lock around the pair keeps them visible-together to a concurrent
    // fold.
    const { doVerb } = await import("../../ibp/verbs/do.js");
    const opts = {
      identity: beingId ? { beingId: String(beingId) } : I_AM,
      moment: actId ? { actId } : null,
    };
    const target = { kind: "space", id: String(spaceId) };
    await doVerb(
      target,
      "set-space",
      { field: "owner", value: String(beingId) },
      opts,
    );
    await doVerb(
      target,
      "set-space",
      { field: "parent", value: DELETED },
      opts,
    );
    spaceToDelete.owner = String(beingId);
    spaceToDelete.parent = DELETED;
  } finally {
    releaseMultiple(lockIds, sessionId);
  }

  invalidateSpace(spaceId);
  return spaceToDelete;
}

// reorderChildren retired (2026-05-23) along with the children[] cache.
// Sibling order is derived from createdAt by listSpaceChildren; an
// explicit-order feature would live in qualities (e.g. qualities.order
// keyed by child id) and be applied by the reader.

// ─────────────────────────────────────────────────────────────────────────
// READS (merged from former spaceFetch.js)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get a space's name by ID. Returns null if not found.
 */
export async function getSpaceName(spaceId) {
  if (!spaceId) return null;
  const { loadProjection } = await import("../projections.js");
  const slot = await loadProjection("space", spaceId, "0");
  return slot?.state?.name || null;
}

/**
 * Walk up the parent chain to the owner-bearing tree root. The
 * .source self-tree counts as its own root (everything beneath it is
 * navigable but the tree-ownership boundary is .source itself).
 */
export async function resolveRootSpace(spaceId) {
  if (!spaceId) throw new Error("spaceId is required");
  const { loadProjection } = await import("../projections.js");
  const { getSpaceOwner } = await import("./members.js");
  const slotToObj = (s) => s ? {
    _id: s.id,
    parent:     s.state?.parent || null,
    owner:      s.state?.owner || null,
    heavenSpace: s.state?.heavenSpace || null,
    name:       s.state?.name,
  } : null;

  let space = slotToObj(await loadProjection("space", spaceId, "0"));
  if (!space) throw new Error("Space not found");
  if (space.heavenSpace === "source") return space;

  let ownerId = getSpaceOwner(space);
  while (!ownerId || ownerId === I_AM) {
    if (!space.parent) throw new Error("Invalid tree: no owner found");
    space = slotToObj(await loadProjection("space", space.parent, "0"));
    if (!space) throw new Error("Broken tree");
    if (space.heavenSpace) {
      if (space.heavenSpace === "source") return space;
      throw new Error("Invalid tree: reached heaven space boundary");
    }
    ownerId = getSpaceOwner(space);
  }
  return space;
}

/**
 * Does `spaceId` sit beneath `ancestorId`? Walks up from `spaceId`,
 * stopping at depth 100 (safety cap).
 */
export async function isDescendant(ancestorId, spaceId) {
  const { loadProjection } = await import("../projections.js");
  let curSlot = await loadProjection("space", spaceId, "0");
  let currentParentId = curSlot?.state?.parent || null;
  let depth = 0;
  const maxDepth = 100;
  while (currentParentId && depth < maxDepth) {
    if (currentParentId === ancestorId.toString()) return true;
    curSlot = await loadProjection("space", currentParentId, "0");
    currentParentId = curSlot?.state?.parent || null;
    depth++;
  }
  return false;
}

/**
 * Resolve a being's access at a space. Ownership resolves at the first
 * ancestor with an owner set ("the owner from this point down").
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
export async function resolveSpaceAccess(spaceId, beingId, branch) {
  if (!spaceId) {
    return {
      ok: false,
      error: IBP_ERR.INVALID_INPUT,
      message: "spaceId is required",
    };
  }
  const safeBeingId = beingId ? String(beingId) : null;
  const ancestors = await getAncestorChain(String(spaceId), branch);
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
 * List the immediate children of a space. Skips heaven spaces (so the
 * place root yields user-created tree roots, not .config / .tools /
 * etc.). Returns at most `limit` rows, newest-creation first.
 */
export async function listSpaceChildren(parentId, { exclude = null, limit = 500, branch = "0", includeHeavenChildren = false } = {}) {
  if (!parentId) return [];
  // Heaven routing: children of a heaven parent are themselves
  // heaven; the parent-children query lives on MAIN regardless of
  // caller's branch. Without this, a SEE from #1 on `.roles` would
  // find no children even though heaven roles live on MAIN.
  if (branch !== "0") {
    const { isHeavenSpace } = await import("./heavenLineage.js");
    if (await isHeavenSpace(parentId)) branch = "0";
  }
  const { default: Projection } = await import("../branch/projection.js");
  const buildQuery = (b) => {
    const q = {
      branch: b, type: "space",
      "state.parent": parentId,
      tombstoned: { $ne: true },
    };
    // Heaven-marked children (host/factory tiers) are filtered from
    // ordinary listings; a heaven-region parent asks for them
    // explicitly. Heaven-marked rows only ever live under
    // heaven-marked parents, so the flag is collision-safe.
    if (!includeHeavenChildren) {
      q.$or = [
        { "state.heavenSpace": null },
        { "state.heavenSpace": { $exists: false } },
      ];
    }
    if (exclude) q._id = { $ne: `${b}:space:${exclude}` };
    return q;
  };
  const toRow = (s) => ({ _id: s.id, ...(s.state || {}) });

  if (branch === "0") {
    const rows = await Projection.find(buildQuery("0"))
      .sort({ "state.createdAt": 1 })
      .limit(limit)
      .lean();
    return rows.map(toRow);
  }

  // Non-main: union the branch's own children with main's children
  // that EXISTED at branch creation (branchPoint check). A child
  // created in main AFTER the branch was made must not leak through.
  const { getBranchPoint } = await import("../branch/branches.js");
  const [branchRows, mainRows] = await Promise.all([
    Projection.find(buildQuery(branch)).lean(),
    Projection.find(buildQuery("0")).lean(),
  ]);
  // Branch slots: kept as-is (planted on this branch).
  const branchOut = branchRows.map(toRow);
  const shadowedIds = new Set(branchRows.map((s) => s.id));
  // Also shadow tombstones on this branch — a space killed in branch
  // shouldn't reappear from main.
  const tombs = await Projection.find({
    branch, type: "space", tombstoned: true,
  }).select("id").lean();
  for (const t of tombs) shadowedIds.add(t.id);
  // Filter main candidates by branchPoint: only spaces that had any
  // fact at-or-before branch creation are in scope.
  const mainOut = [];
  for (const cand of mainRows) {
    if (shadowedIds.has(cand.id)) continue;
    const bp = await getBranchPoint(branch, "space", cand.id);
    if (bp && bp > 0) mainOut.push(toRow(cand));
  }
  const all = [...mainOut, ...branchOut];
  all.sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return at - bt;
  });
  return all.slice(0, limit);
}

