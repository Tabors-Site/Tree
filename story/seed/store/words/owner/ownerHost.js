// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ownerHost.js — host-escape glue for set-owner / remove-owner. The auth + per-space lock + CAS
// live in ownership.js (setOwner / removeOwner) — the genuine FLOOR (concurrency control +
// content-addressing), so the `.word` reaches them through `see` escapes. Each see RETURNS the
// {field:"owner", value} block the dispatcher stamps as the ONE do:set-owner / do:remove-owner
// fact (applySetField folds it); it lays no fact and reimplements nothing.
import { detectTargetKind, targetIdOf } from "../../../materials/_targetShape.js";
import { setOwner, removeOwner } from "../../../materials/space/ownership.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";

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
    // derive-from-inputs see (no fact).
    "space-id-of": ({ args: [target] }) => spaceIdOf(target),

    // set-owner-block(spaceId, newOwnerId, caller) -> the {field:"owner", value} block AFTER
    // setOwner's auth + per-space lock + CAS (the floor; it hands the lock to afterSeal on the
    // moment). A compute see: returns the block, lays no fact.
    "set-owner-block": async ({ args: [spaceId, newOwnerId, caller] }, ctx) =>
      setOwner(
        String(spaceId),
        String(newOwnerId),
        String(caller),
        historyOf(ctx),
        ctx?.moment || null,
      ),

    // remove-owner-block(spaceId, caller) -> the {field:"owner", value:null} block AFTER
    // removeOwner's auth + lock + CAS. A compute see.
    "remove-owner-block": async ({ args: [spaceId, caller] }, ctx) =>
      removeOwner(
        String(spaceId),
        String(caller),
        historyOf(ctx),
        ctx?.moment || null,
      ),
  };
}
