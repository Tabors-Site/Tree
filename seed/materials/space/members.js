// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Ownership — the one structural authority field on a Space.
//
// Every Space carries `owner: String` (a beingId, or null when
// unowned at this position — in which case the ancestor walk inherits
// from the parent). Owner of a space implicitly has authority over it
// + descendants without any able grant. Every other authority shape
// lives in qualities.ables + qualities.ablesGranted per
// seed/AblesAreAuth.md; able-walk authorize() is the gate.
//
// Authorization vs invariants. authorize() approves the call before
// it reaches the handler. The state-consistency checks below
// (current-owner-authorizes-transfer, parent-owner-claims-unowned)
// refuse mutations that would leave the post-state incoherent.

import { hooks } from "../../hooks.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { I } from "../being/seedBeings.js";
import { acquireSpaceLock, releaseSpaceLock } from "./spaceLocks.js";
import { invalidateSpace } from "./ancestorCache.js";

// ── Read side ─────────────────────────────────────────────────────

/**
 * Read the owner off a space row. Returns the beingId string, or null
 * when the space has no owner at this position (the ancestor walk
 * inherits from the parent in that case).
 */
export function getSpaceOwner(spaceRow) {
  if (!spaceRow) return null;
  return spaceRow.owner ? String(spaceRow.owner) : null;
}

// ── Write side ────────────────────────────────────────────────────

/**
 * Set a space's owner. The canonical owner-transfer + initial-owner-
 * set entrypoint.
 *
 * Authority: an existing owner can transfer; an unowned space with a
 * parent can be claimed by the parent's owner. The previous owner
 * keeps NO implicit write access on transfer — under AblesAreAuth,
 * any continued authority requires a granted able.
 */
export async function setSpaceOwner(
  spaceId,
  newOwnerId,
  actor,
  history,
  moment = null,
) {
  if (typeof history !== "string" || !history) {
    throw new Error("setSpaceOwner: history is required (thread from moment).");
  }
  if (!newOwnerId) throw new Error("setSpaceOwner: newOwnerId is required");

  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("space", spaceId, history);
  const space = slot ? slot.state : null;
  if (!space) throw new Error("Space not found");
  if (space.heavenSpace)
    throw new Error("Cannot set ownership on heaven spaces");

  await assertBeingExists(newOwnerId, history);

  const currentOwnerId = getSpaceOwner(space);
  if (currentOwnerId && String(currentOwnerId) === String(newOwnerId)) {
    throw new Error("Being is already the owner at this space");
  }

  // Two authorization shapes: (1) replacing an existing owner — only
  // that owner can; (2) claiming an unowned position — the parent
  // owner must approve.
  if (currentOwnerId && currentOwnerId !== I) {
    if (String(currentOwnerId) !== String(actor)) {
      throw new Error("Only the current owner can reassign owner");
    }
  } else if (space.parent) {
    await assertResolvedOwner(space.parent, actor, history);
  } else {
    throw new Error(
      "Cannot set owner on a top-level space with no current owner",
    );
  }

  const previousOwnerId = currentOwnerId;

  const locked = await acquireSpaceLock(spaceId, actor);
  if (!locked)
    throw new IbpError(
      IBP_ERR.RESOURCE_CONFLICT,
      "Space ownership is being modified",
    );
  // CAS check inside the lock: re-read owner, abort if a concurrent writer
  // raced past us. On the abort path the lock is released immediately; on
  // the success path the lock is handed to afterSeal so it SPANS the
  // dispatcher's stamp — the CAS-check and the owner fact stay atomic, so a
  // concurrent reassign that slips in afterward re-reads the new owner and
  // aborts. (A failed seal that never runs afterSeal leaks the lock only
  // until its 30s TTL, which the sweep + boot integrity-check reclaim.)
  try {
    const curSlot = await loadOrFold("space", spaceId, history);
    const current = curSlot ? curSlot.state : space;
    const currentOwnerNow = getSpaceOwner(current);
    if (String(currentOwnerNow ?? null) !== String(previousOwnerId ?? null)) {
      throw new Error("Ownership changed concurrently. Retry the operation.");
    }
  } catch (err) {
    releaseSpaceLock(spaceId, actor);
    throw err;
  }

  // ONE act, ONE fact (23.md): set-owner returns its OWN do:set-owner fact —
  // the dispatcher stamps it and applySetField folds the `owner` scalar
  // (set-owner is in SET_ACTIONS). No inner emitOwnerFact, no skipAudit. The
  // post-seal cleanup (release lock + invalidate + hook) rides afterSeal so the
  // held lock brackets the stamp.
  const cleanup = () => {
    releaseSpaceLock(spaceId, actor);
    invalidateSpace(spaceId);
    hooks
      .run("afterMembersChange", {
        spaceId,
        action: "setSpaceOwner",
        targetUserId: newOwnerId,
        previousOwnerId,
      })
      .catch(() => {});
  };
  if (moment?.afterSeal) moment.afterSeal.push(cleanup);
  else cleanup();

  return { field: "owner", value: String(newOwnerId) };
}

/**
 * Clear ownership at a space (revoke a delegation). The parent's
 * owner authorizes the revoke; the delegate cannot revoke themselves.
 *
 * After the call, the space has no owner at this position, so the
 * walker inherits ownership from the parent again.
 */
export async function removeSpaceOwner(spaceId, actor, history, moment = null) {
  if (typeof history !== "string" || !history) {
    throw new Error(
      "removeSpaceOwner: history is required (thread from moment).",
    );
  }
  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("space", spaceId, history);
  const space = slot ? slot.state : null;
  if (!space) throw new Error("Space not found");
  if (space.heavenSpace) throw new Error("Cannot modify heaven spaces");

  const ownerId = getSpaceOwner(space);
  if (!ownerId || ownerId === I)
    throw new Error("Space has no owner to remove");

  if (space.parent) {
    await assertResolvedOwner(space.parent, actor, history);
  } else {
    throw new Error("Cannot remove owner on a top-level root");
  }

  const removedOwnerId = ownerId;

  const locked = await acquireSpaceLock(spaceId, actor);
  if (!locked)
    throw new IbpError(
      IBP_ERR.RESOURCE_CONFLICT,
      "Space ownership is being modified",
    );

  // ONE act, ONE fact (23.md): remove-owner returns its do:remove-owner fact
  // (owner=null, folded by applySetField); the lock + cleanup ride afterSeal so
  // the held lock spans the dispatcher's stamp, mirroring setSpaceOwner. No inner
  // emitOwnerFact, no skipAudit.
  const cleanup = () => {
    releaseSpaceLock(spaceId, actor);
    invalidateSpace(spaceId);
    hooks
      .run("afterMembersChange", {
        spaceId,
        action: "removeSpaceOwner",
        targetUserId: removedOwnerId,
      })
      .catch(() => {});
  };
  if (moment?.afterSeal) moment.afterSeal.push(cleanup);
  else cleanup();

  return { field: "owner", value: null };
}

// ── Internal plumbing ─────────────────────────────────────────────

async function assertResolvedOwner(spaceId, beingId, history) {
  const { resolveSpaceAccess } = await import("./spaces.js");
  const access = await resolveSpaceAccess(spaceId, beingId, history);
  if (access.ok && access.isOwner) return;
  throw new Error("Only the resolved owner can perform this action");
}

async function assertBeingExists(beingId, history) {
  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("being", beingId, history);
  if (!slot) throw new Error("Being not found");
}
