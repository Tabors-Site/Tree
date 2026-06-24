// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ownerHost.js — host-escape READS for set-owner / remove-owner. Both are COMPOSITES now (the
// unified word model): each `.word` GATES the ownership authority (may-set-owner / may-remove-owner,
// pure reads mirroring members.js's setSpaceOwner / removeSpaceOwner rules) and then `do set-space`s
// the owner field — the set-space LEAF lays the fact in its own moment and holds its own reel lock.
// No own-fact, no host-see-returns-a-block, no lock here: an owner op IS a gated set-space ("apple is
// do"). Its fact on the chain is the leaf's do:set-space {field:owner}, never a synthetic
// do:set-owner / do:remove-owner.
//
// NOTE (flagged): may-set-owner / may-remove-owner duplicate members.js's authority rules — a second
// source of truth. They should collapse to shared reads extracted from members.js. And the old
// setOwner/removeOwner fired an afterMembersChange hook; the leaf-call drops it — a fold-hook on
// do:set-space {field:owner} is its proper home (like the LLM cache-bust).
import { detectTargetKind, targetIdOf } from "../../../materials/_targetShape.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { I } from "../../../materials/being/seedBeings.js";

// Resolve the space id from a space row/envelope OR a resolved stance (which carries .spaceId).
// Mirrors space/ops.js spaceIdFromTarget — a derive-from-inputs read, no fact.
function spaceIdOf(target) {
  if (detectTargetKind(target) === "stance") {
    if (!target?.spaceId)
      throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Resolved position has no spaceId");
    return String(target.spaceId);
  }
  const id = targetIdOf(target);
  if (!id)
    throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Target does not resolve to a space");
  return String(id);
}

const historyOf = (ctx) => ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function ownerHostEnv() {
  return {
    // space-id-of(target) -> the space id, from a space target or a resolved stance. A
    // derive-from-inputs read (no fact).
    "space-id-of": ({ args: [target] }) => spaceIdOf(target),

    // may-set-owner(spaceId, newOwnerId, caller) -> may the caller set this space's owner? A PURE
    // READ mirroring members.js setSpaceOwner's rule: not a heaven space, not already that owner, and
    // either the caller IS the current owner (reassign) or — for an unowned / I-owned position — the
    // caller is the resolved owner of the PARENT (the parent-owner approves the claim).
    "may-set-owner": async ({ args: [spaceId, newOwnerId, caller] }, ctx) => {
      const history = historyOf(ctx);
      const { loadOrFold } = await import("../../../materials/projections.js");
      const slot = await loadOrFold("space", String(spaceId), history);
      const space = slot?.state;
      if (!space || space.heavenSpace) return false;
      const { getSpaceOwner } = await import("../../../materials/space/members.js");
      const currentOwner = getSpaceOwner(space);
      if (currentOwner && String(currentOwner) === String(newOwnerId)) return false; // already owner
      if (currentOwner && String(currentOwner) !== String(I)) {
        return String(currentOwner) === String(caller); // reassign: only the current owner
      }
      if (space.parent) {
        const { resolveSpaceAccess } = await import("../../../materials/space/spaces.js");
        const access = await resolveSpaceAccess(String(space.parent), String(caller), history);
        return !!(access?.ok && access?.isOwner); // claim: the parent's owner approves
      }
      return false; // top-level with no current owner
    },

    // may-remove-owner(spaceId, caller) -> may the caller clear this space's owner? A PURE READ
    // mirroring members.js removeSpaceOwner's rule: not heaven, it HAS a non-genesis owner to remove,
    // it has a parent, and the caller is the resolved owner of that PARENT (the parent-owner approves
    // the revoke).
    "may-remove-owner": async ({ args: [spaceId, caller] }, ctx) => {
      const history = historyOf(ctx);
      const { loadOrFold } = await import("../../../materials/projections.js");
      const slot = await loadOrFold("space", String(spaceId), history);
      const space = slot?.state;
      if (!space || space.heavenSpace) return false;
      const { getSpaceOwner } = await import("../../../materials/space/members.js");
      const ownerId = getSpaceOwner(space);
      if (!ownerId || String(ownerId) === String(I)) return false; // no (removable) owner
      if (!space.parent) return false; // top-level root
      const { resolveSpaceAccess } = await import("../../../materials/space/spaces.js");
      const access = await resolveSpaceAccess(String(space.parent), String(caller), history);
      return !!(access?.ok && access?.isOwner); // the parent's owner approves the revoke
    },
  };
}
