// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// being/inheritationOps.js — the two DO ops that move authority around
// the being-tree:
//
//   grant-inheritation    a Name with authority over a being-tree
//                         position hands ANOTHER Name an inheritation
//                         point there. The granted Name gains authority
//                         over that position and its whole subtree
//                         (downward), without owning any of it. This is
//                         delegation.
//   revoke-inheritation   the asymmetric counterpart. Removes a point
//                         previously granted. Read as latest-of-two by
//                         date in inheritation.js (the lineage.js
//                         attach/detach pattern), so a later revoke wins
//                         over an earlier grant and vice-versa.
//
// Both target a being (the position). The granted Name rides in
// params.name. The fact lands on the POSITION being's reel (so
// inheritation.js can find points by target.id = position), attributed
// to the granting/revoking Name (the actor) on its own act-chain.
//
// Authority to grant or revoke at a position is authority OVER that
// position — exactly what hasAuthorityOver answers. authorize.js gates
// these the same way (inheritation coverage as a do-on-being fallback),
// but the handler re-checks for defense in depth and for direct-call
// paths that bypass authorize. I_AM (universal authority) always may.
//
// These self-register at module load; seed/services.js imports this
// file for side effects.

import { registerOperation } from "../../ibp/operations.js";
import { targetsFact } from "../../ibp/factResult.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { I_AM } from "./seedBeings.js";
import { hasAuthorityOver } from "./identity/inheritation.js";

function positionBeingIdOf(target) {
  if (target && typeof target === "object" && target.kind === "being" && target.id) {
    return String(target.id);
  }
  if (typeof target === "string") return target;
  throw new IbpError(
    IBP_ERR.INVALID_INPUT,
    "inheritation op requires a being-tree position (target.kind='being')",
  );
}

// The acting Name (the granter/revoker). DO acts carry identity.nameId
// post-split; the I_AM seed paths carry the I_AM being/name instead.
function actingNameOf(identity) {
  if (identity?.nameId) return String(identity.nameId);
  if (identity?.name === I_AM || identity?.beingId === I_AM) return String(I_AM);
  return null;
}

// The granted Name must be a declared, non-banished Name on this
// story. Mirrors birth.js's explicit-trueName validation so you can't
// hand a point to a typo or a banished Name.
async function assertGrantableName(grantedName, history) {
  const { loadProjection } = await import("../projections.js");
  const nameSlot = await loadProjection("name", grantedName, history);
  if (!nameSlot?.state) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `grant-inheritation: "${grantedName.slice(0, 12)}…" is not a declared Name on this story.`,
    );
  }
  const { isNameBanished } = await import("../name/closure.js");
  if (await isNameBanished(grantedName)) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `grant-inheritation: "${grantedName.slice(0, 12)}…" is banished.`,
    );
  }
}

async function assertAuthorityOverPosition(actingName, position, history, opName) {
  const ok = await hasAuthorityOver(actingName, position, history);
  if (!ok) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `${opName}: acting Name has no authority over this being-tree position`,
      { actingName: actingName.slice(0, 12), position: position.slice(0, 8) },
    );
  }
}

// grant-inheritation. Hand `params.name` an inheritation point at the
// target position. SINGLE-WRITER: the fact lands on the position
// being's reel (the point lives where it's read), attributed to the
// granting Name. The granted Name is recorded in params + result.
registerOperation("grant-inheritation", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "grant-inheritation",
  handler: async ({ target, params, identity, history }) => {
    const position = positionBeingIdOf(target);
    const actingName = actingNameOf(identity);
    if (!actingName) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "grant-inheritation requires an identified acting Name",
      );
    }
    const grantedName = (params && typeof params.name === "string" && params.name.trim())
      ? params.name.trim()
      : null;
    if (!grantedName) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "grant-inheritation requires params.name (the Name to grant authority to)",
      );
    }
    await assertGrantableName(grantedName, history);
    await assertAuthorityOverPosition(actingName, position, history, "grant-inheritation");
    return targetsFact({
      name: grantedName,
      position,
      grantedBy: actingName,
    }, { kind: "being", id: position });
  },
});

// revoke-inheritation. Remove the point `params.name` holds at the
// target position. Same authority + same reel as grant; the later of
// the two facts (by date) decides liveness in inheritation.js. Revoking
// a never-granted point is a harmless no-op fact (the latest-of-two
// read just sees a revoke with no live grant).
registerOperation("revoke-inheritation", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "revoke-inheritation",
  handler: async ({ target, params, identity, history }) => {
    const position = positionBeingIdOf(target);
    const actingName = actingNameOf(identity);
    if (!actingName) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "revoke-inheritation requires an identified acting Name",
      );
    }
    const grantedName = (params && typeof params.name === "string" && params.name.trim())
      ? params.name.trim()
      : null;
    if (!grantedName) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "revoke-inheritation requires params.name (the Name whose point to remove)",
      );
    }
    await assertAuthorityOverPosition(actingName, position, history, "revoke-inheritation");
    return targetsFact({
      name: grantedName,
      position,
      revokedBy: actingName,
    }, { kind: "being", id: position });
  },
});
