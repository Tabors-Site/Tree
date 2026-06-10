// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Membership classes. The one storage primitive for "who's trusted
// here."
//
// Every Space carries a `members` Map of `className -> [beingId, ...]`.
// Each class is a named list of beings with authority at this position
// (and inherited downward via the ancestor walk).
//
// Canonical classes the seed ships with:
//
//   owner       singleton class, the position's structural owner.
//                Enforced at write time: setting members.owner to a
//                list longer than 1 throws. Owner-transfer is one
//                write (replace the single id); no separate verb.
//   contributor default trust class, peers of the owner. Grows up to
//                `maxContributorsPerSpace`. Removal allowed for the
//                resolved owner or self (the member removing
//                themselves).
//   angel       heaven-specific authority class. Reality operators
//                join this class via cherub.birth (the seed delegate
//                anointing flow) or by an existing angel adding them
//                via add-member at heaven.
//
// Operators can author additional classes per-position (auditor,
// editor, etc.) by writing `do:set-space` facts with
// `field: "members.<className>"`. Member classes survive for ownership
// bookkeeping; under roles-are-auth (seed/RolesAreAuth.md) the AUTH
// gate is the role-walk against qualities.roles, not member-class
// checks. Owner-class entries still matter — set-role / install-role
// authorization checks "is this caller an owner of the target space"
// at the substrate level — but the heaven angel class retired with
// the role-walk migration.
//
// Storage shape on a Space projection row:
//
//   space.members = {
//     owner:       ["<beingId>"],          // singleton invariant
//     contributor: ["<beingId>", ...],
//     angel:       ["<beingId>", ...],     // only at heaven
//     // operator-authored custom classes here
//   }
//
// Atomicity. Per-class writes go through `do:set-space` with
// `field: "members.<className>"` and `value: [beingId, ...]`. The
// reducer (applySetMembers in materials/reducerHelpers.js) writes the
// class's list into the members object without touching other classes.
// Read-modify-write callers (addSpaceMember, removeSpaceMember) hold
// the space lock around the read so the projection they recompute
// doesn't race a concurrent fold.
//
// Branch behavior. Membership reads here go through loadOrFold like
// every other behavioural read in the seed: each branch sees its
// effective view (inherited from main where nothing diverged,
// branch-local where a divergent set-space fact landed). Writes stamp
// on the calling branch's reel.
//
// Authorization vs invariants. authorize() approves the call before
// it reaches the handler. The class-specific invariants below
// (owner-singleton, no-promote-owner-to-contributor, etc.) are
// state-consistency checks that run after auth, refusing mutations
// that would leave the post-state incoherent. See seed/PERMISSIONS.md.

import { hooks } from "../../hooks.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { I_AM } from "../being/seedBeings.js";
import { acquireSpaceLock, releaseSpaceLock } from "./spaceLocks.js";
import { invalidateSpace } from "./ancestorCache.js";

const CLASS_NAME = /^[a-z][a-z0-9-]*$/;

// Singleton classes — writes are capped at length 1, and removing the
// last entry leaves the class empty (no transfer enforced beyond the
// resolved-owner invariant). Today only `owner` is singleton; future
// extensions can declare more, but the substrate ships with one.
const SINGLETON_CLASSES = new Set(["owner"]);

// ── Read side ─────────────────────────────────────────────────────

/**
 * Read the members object off a space row. Always returns an object,
 * never undefined. Empty when the space has no members at all.
 */
export function getSpaceMembersRaw(spaceRow) {
  if (!spaceRow) return {};
  const m = spaceRow.members;
  if (!m) return {};
  // Mongoose Map serializes to a plain object in lean reads, but
  // returns a Map on hydrated docs. Normalize either form.
  if (m instanceof Map) {
    const out = {};
    for (const [k, v] of m.entries()) out[k] = Array.isArray(v) ? v : [];
    return out;
  }
  if (typeof m === "object") {
    const out = {};
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (Array.isArray(v)) out[k] = v;
    }
    return out;
  }
  return {};
}

/**
 * Get the list of beings in a specific class at this space. Returns
 * an array of beingId strings; empty when the class has no members.
 */
export function getSpaceMembers(spaceRow, className) {
  const members = getSpaceMembersRaw(spaceRow);
  const list = members[className];
  return Array.isArray(list) ? list.map((id) => String(id)) : [];
}

/**
 * Get the singleton owner of a space, or null when unowned at this
 * position. Reads members.owner[0]; the singleton invariant is
 * enforced at write time so reads can trust there's at most one.
 */
export function getSpaceOwner(spaceRow) {
  const list = getSpaceMembers(spaceRow, "owner");
  return list.length > 0 ? list[0] : null;
}

/**
 * List every class name a being belongs to at this space (just this
 * row, not the ancestor walk). Order is undefined; callers consume
 * as a set.
 */
export function getSpaceMemberClasses(spaceRow, beingId) {
  if (!beingId) return [];
  const members = getSpaceMembersRaw(spaceRow);
  const out = [];
  const idStr = String(beingId);
  for (const [className, list] of Object.entries(members)) {
    if (Array.isArray(list) && list.some((id) => String(id) === idStr)) {
      out.push(className);
    }
  }
  return out;
}

/**
 * True if `beingId` is in `className` at this space (just this row).
 */
export function spaceHasMember(spaceRow, className, beingId) {
  if (!beingId) return false;
  const list = getSpaceMembers(spaceRow, className);
  const idStr = String(beingId);
  return list.some((id) => String(id) === idStr);
}

// ── Write side ────────────────────────────────────────────────────

/**
 * Add a being to a class at a space. The generic membership write.
 *
 * Authorize approves the call before it reaches here; this function
 * enforces state-consistency invariants the gate can't express:
 *   - className shape (kebab-case, starts with a letter)
 *   - target being exists
 *   - singleton classes (owner) reject when the class is already
 *     occupied (use `setSpaceOwner` to replace)
 *
 * `actor` is the being making the call (for the space-lock owner).
 * `summonCtx` carries the moment so doVerb stamps on the right
 * branch + reel.
 */
export async function addSpaceMember(spaceId, className, beingId, actor, branch, summonCtx = null) {
  if (typeof branch !== "string" || !branch) {
    throw new Error("addSpaceMember: branch is required (thread from summonCtx).");
  }
  if (typeof className !== "string" || !CLASS_NAME.test(className)) {
    throw new Error(`addSpaceMember: invalid class name "${className}"`);
  }
  if (!beingId) throw new Error("addSpaceMember: beingId is required");

  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("space", spaceId, branch);
  const space = slot ? slot.state : null;
  if (!space) throw new Error("Space not found");

  // Heaven is the one heaven space whose member classes grow at
  // runtime. Every other heaven space (.roles, .config, etc.) is
  // structurally immutable, including its members.
  if (space.heavenSpace && space.heavenSpace !== "heaven") {
    throw new Error("Cannot modify heaven spaces");
  }

  await assertBeingExists(beingId, branch);

  // Class-specific invariants.
  if (SINGLETON_CLASSES.has(className)) {
    const existing = getSpaceMembers(space, className);
    if (existing.length > 0 && existing[0] !== String(beingId)) {
      throw new Error(
        `Class "${className}" is singleton; use setSpaceOwner to transfer instead of add`
      );
    }
  }

  const locked = await acquireSpaceLock(spaceId, actor);
  if (!locked) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Space is being modified");
  }
  try {
    const curSlot = await loadOrFold("space", spaceId, branch);
    const current = curSlot ? curSlot.state : space;
    const list = getSpaceMembers(current, className);
    if (list.some((id) => String(id) === String(beingId))) return;
    const next = [...list, String(beingId)];

    await emitMembersFact(spaceId, className, next, actor, branch, summonCtx);
  } finally {
    releaseSpaceLock(spaceId, actor);
  }

  invalidateSpace(spaceId);
  hooks.run("afterMembersChange", {
    spaceId, action: "addSpaceMember", className, targetUserId: beingId,
  }).catch(() => {});
}

/**
 * Remove a being from a class at a space.
 *
 * Self-removal: callers passing `beingId === actor` always pass the
 * invariant check (a being can step out of any class they're in).
 * Otherwise the caller must be the resolved owner of the position.
 *
 * Removing the only owner is REFUSED (no orphaned subtrees). Transfer
 * via `setSpaceOwner` instead.
 */
export async function removeSpaceMember(spaceId, className, beingId, actor, branch, summonCtx = null) {
  if (typeof branch !== "string" || !branch) {
    throw new Error("removeSpaceMember: branch is required (thread from summonCtx).");
  }
  if (typeof className !== "string" || !CLASS_NAME.test(className)) {
    throw new Error(`removeSpaceMember: invalid class name "${className}"`);
  }
  if (!beingId) throw new Error("removeSpaceMember: beingId is required");

  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("space", spaceId, branch);
  const space = slot ? slot.state : null;
  if (!space) throw new Error("Space not found");
  if (space.heavenSpace && space.heavenSpace !== "heaven") {
    throw new Error("Cannot modify heaven spaces");
  }

  await assertBeingExists(beingId, branch);

  // Self-removal is always allowed. Otherwise the caller must own
  // this position.
  if (String(beingId) !== String(actor)) {
    await assertResolvedOwner(spaceId, actor, branch);
  }

  // Refuse to leave a space ownerless. Owner-class removal must go
  // through setSpaceOwner (which writes the replacement in the same
  // moment) or through removeSpaceOwner (which requires the parent
  // owner's authority and is permitted to clear).
  if (className === "owner") {
    throw new Error(
      "Use setSpaceOwner / removeSpaceOwner to mutate the owner class"
    );
  }

  const locked = await acquireSpaceLock(spaceId, actor);
  if (!locked) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Space is being modified");
  }
  try {
    const curSlot = await loadOrFold("space", spaceId, branch);
    const current = curSlot ? curSlot.state : space;
    const list = getSpaceMembers(current, className);
    if (!list.some((id) => String(id) === String(beingId))) return;
    const next = list.filter((id) => String(id) !== String(beingId));

    await emitMembersFact(spaceId, className, next, actor, branch, summonCtx);
  } finally {
    releaseSpaceLock(spaceId, actor);
  }

  invalidateSpace(spaceId);
  hooks.run("afterMembersChange", {
    spaceId, action: "removeSpaceMember", className, targetUserId: beingId,
  }).catch(() => {});
}

/**
 * Set a space's owner. Replaces members.owner with [newOwnerId]. The
 * canonical owner-transfer + initial-owner-set entrypoint.
 *
 * Authority: an existing owner can transfer; an unowned space with a
 * parent can be claimed by the parent's owner. The previous owner is
 * added to members.contributor so they retain write access to their
 * former subtree (matching the legacy transferOwnership semantic).
 */
export async function setSpaceOwner(spaceId, newOwnerId, actor, branch, summonCtx = null) {
  if (typeof branch !== "string" || !branch) {
    throw new Error("setSpaceOwner: branch is required (thread from summonCtx).");
  }
  if (!newOwnerId) throw new Error("setSpaceOwner: newOwnerId is required");

  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("space", spaceId, branch);
  const space = slot ? slot.state : null;
  if (!space) throw new Error("Space not found");
  if (space.heavenSpace) throw new Error("Cannot set ownership on heaven spaces");

  await assertBeingExists(newOwnerId, branch);

  const currentOwnerId = getSpaceOwner(space);
  if (currentOwnerId && String(currentOwnerId) === String(newOwnerId)) {
    throw new Error("Being is already the owner at this space");
  }

  // Two authorization shapes: (1) replacing an existing owner — only
  // that owner can; (2) claiming an unowned position — the parent
  // owner must approve.
  if (currentOwnerId && currentOwnerId !== I_AM) {
    if (String(currentOwnerId) !== String(actor)) {
      throw new Error("Only the current owner can reassign owner");
    }
  } else if (space.parent) {
    await assertResolvedOwner(space.parent, actor, branch);
  } else {
    throw new Error("Cannot set owner on a top-level space with no current owner");
  }

  const previousOwnerId = currentOwnerId;

  const locked = await acquireSpaceLock(spaceId, actor);
  if (!locked) throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Space ownership is being modified");
  try {
    // CAS check inside the lock: re-read owner, abort if a concurrent
    // writer raced past us.
    const curSlot = await loadOrFold("space", spaceId, branch);
    const current = curSlot ? curSlot.state : space;
    const currentOwnerNow = getSpaceOwner(current);
    if (String(currentOwnerNow ?? null) !== String(previousOwnerId ?? null)) {
      throw new Error("Ownership changed concurrently. Retry the operation.");
    }

    await emitMembersFact(
      spaceId, "owner", [String(newOwnerId)], actor, branch, summonCtx
    );

    // Auto-demote-to-contributor on owner transfer retired with the
    // contributor concept (RolesAreAuth: every non-owner authority is
    // a granted role). The previous owner keeps no implicit write
    // access; if they should retain editing rights, an explicit
    // `grant-role` against an operator-authored role grants them the
    // canDo they need. The owner singleton invariant is the ONE base
    // axiom; everything below it is roles.

    invalidateSpace(spaceId);
    hooks.run("afterMembersChange", {
      spaceId, action: "setSpaceOwner",
      targetUserId: newOwnerId, previousOwnerId,
    }).catch(() => {});
  } finally {
    releaseSpaceLock(spaceId, actor);
  }
}

/**
 * Clear ownership at a space (revoke a delegation). The parent's
 * owner authorizes the revoke; the delegate cannot revoke themselves.
 *
 * After the call, the space has no `owner` class entry, so the walker
 * inherits ownership from the parent again.
 */
export async function removeSpaceOwner(spaceId, actor, branch, summonCtx = null) {
  if (typeof branch !== "string" || !branch) {
    throw new Error("removeSpaceOwner: branch is required (thread from summonCtx).");
  }
  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("space", spaceId, branch);
  const space = slot ? slot.state : null;
  if (!space) throw new Error("Space not found");
  if (space.heavenSpace) throw new Error("Cannot modify heaven spaces");

  const ownerId = getSpaceOwner(space);
  if (!ownerId || ownerId === I_AM) throw new Error("Space has no owner to remove");

  if (space.parent) {
    await assertResolvedOwner(space.parent, actor, branch);
  } else {
    throw new Error("Cannot remove owner on a top-level root");
  }

  const removedOwnerId = ownerId;

  const locked = await acquireSpaceLock(spaceId, actor);
  if (!locked) throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Space ownership is being modified");
  try {
    await emitMembersFact(spaceId, "owner", [], actor, branch, summonCtx);
    invalidateSpace(spaceId);
    hooks.run("afterMembersChange", {
      spaceId, action: "removeSpaceOwner", targetUserId: removedOwnerId,
    }).catch(() => {});
  } finally {
    releaseSpaceLock(spaceId, actor);
  }
}

// ── Internal plumbing ─────────────────────────────────────────────

async function emitMembersFact(spaceId, className, nextList, actor, branch, summonCtx) {
  const target = { kind: "space", id: String(spaceId) };
  const { doVerb } = await import("../../ibp/verbs/do.js");
  await doVerb(
    target,
    "set-space",
    { field: `members.${className}`, value: nextList },
    { identity: { beingId: actor }, currentBranch: branch, summonCtx },
  );
}

// Resolved-owner invariant — the in-handler state-consistency check
// for membership ops. NOT a permission gate (authorize already
// approved); see seed/PERMISSIONS.md "Permissions vs invariants."
async function assertResolvedOwner(spaceId, beingId, branch) {
  const { resolveSpaceAccess } = await import("./spaces.js");
  const access = await resolveSpaceAccess(spaceId, beingId, branch);
  if (access.ok && access.isOwner) return;
  throw new Error("Only the resolved owner can perform this action");
}

async function assertBeingExists(beingId, branch) {
  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("being", beingId, branch);
  if (!slot) throw new Error("Being not found");
}
