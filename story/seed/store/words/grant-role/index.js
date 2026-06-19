// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// store/words/grant-role/index.js — the grant-role DO op, carved out of
// materials/being/ops.js into its own store-word bundle.
//
// Roles are auth (seed/RolesAreAuth.md). A being holds a role by
// being granted it; authorize walks rolesGranted and matches the
// role's canX against the verb+action.
//
// grant-role emits one Fact on the target being's reel. The being
// reducer (applyRoleGrants in reducerHelpers.js) folds it into
// qualities.rolesGranted:
//   grant-role  → append { role, anchorSpaceId|anchorBeingId, grantedBy, grantedAt }
//
// Duplicate grants from different grantors live as separate entries,
// each separately revocable. The being holds the role until ALL
// grants of (role, anchor) are revoked.
//
// Auth: the caller's right to grant role X is encoded in their own
// granted roles' canDo: a role with canDo entry `grant-role:X` (or
// `grant-role:*` for super-grantors like angel) permits granting X.
// The chain back to I-Am is structural.
//
// This self-registers at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerRoleWord } from "../../../present/word/roleWordRegistry.js";
import { targetIdOf } from "../../../materials/_targetShape.js";
import { grantHostEnv } from "./grantHost.js";

async function grantRoleHandler({ target, params, identity, moment }) {
  // THE CONVERSION: grant-role's validation + record is grant-role.word (caller mode). The
  // .word returns the record; the cut enriches the op params with grantedBy/grantedAt so
  // the dispatcher's auto-emitted grant-role fact carries them (the being reducer reads
  // them from fact.params). JS body = clean-miss fallback.
  const viaWord = await _grantRoleViaWord({ caller: identity?.beingId, target, role: params?.role, anchorSpaceId: params?.anchorSpaceId, anchorBeingId: params?.anchorBeingId, moment });
  if (viaWord) {
    if (params) { params.grantedBy = viaWord.grantedBy; params.grantedAt = viaWord.grantedAt; }
    return viaWord;
  }

  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "grant-role: identity required (the grantor's beingId)",
    );
  }
  if (!params || typeof params !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "grant-role: params required");
  }
  const { role, anchorSpaceId = null, anchorBeingId = null } = params;
  if (typeof role !== "string" || !role.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "grant-role: `role` is required");
  }
  if (!anchorSpaceId && !anchorBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "grant-role: one of `anchorSpaceId` or `anchorBeingId` is required",
    );
  }
  if (anchorSpaceId && anchorBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "grant-role: only one of `anchorSpaceId` or `anchorBeingId` may be set",
    );
  }
  // Validate the role exists in the registry — can't grant a non-role.
  const { getRole } = await import("../../../present/roles/registry.js");
  const roleSpec = getRole(role);
  if (!roleSpec) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, `grant-role: role "${role}" is not registered`);
  }
  // Enrich params in-place so the auto-emitted Fact carries the full
  // grant record (grantedBy + grantedAt). The being reducer reads
  // these from fact.params and appends to qualities.rolesGranted.
  // No expiry: wall-clock expiry is a human-time concept the story
  // has no clock for; a grant lasts until revoked. Time-bound grants
  // arrive with story-time (moments), not ISO timestamps — see
  // present/roles/acquisition.js.
  const grantedBy = String(identity.beingId);
  const grantedAt = new Date().toISOString();
  params.grantedBy = grantedBy;
  params.grantedAt = grantedAt;
  return {
    granted: true,
    role,
    granteeBeingId: String(targetIdOf(target)),
    anchorSpaceId,
    anchorBeingId,
    grantedBy,
    grantedAt,
  };
}

// grant-role's world strand is grant-role.word (the gates + the role-registry check + the
// record). CALLER mode. Returns {granted, role, granteeBeingId, anchorSpaceId,
// anchorBeingId, grantedBy, grantedAt} or null on a clean miss so the JS body runs.
registerRoleWord("being", "grant-role", new URL("./grant-role.word", import.meta.url));
async function _grantRoleViaWord({ caller, target, role, anchorSpaceId, anchorBeingId, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("being", "grant-role", moment?.actorAct?.history);
  if (!ir) return null;
  const { grantHostEnv } = await import("./grantHost.js");
  const branch = moment?.actorAct?.history;
  try {
    const { result } = await runRoleWord(ir, {
      moment, branch,
      trigger: { caller: caller ? String(caller) : null, target: target ? String(targetIdOf(target)) : null, role: role ?? null, anchorSpaceId: anchorSpaceId ?? null, anchorBeingId: anchorBeingId ?? null, branch },
      env: { host: grantHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

registerOperation("grant-role", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "grant-role",
  args: {
    role:          { type: "text", label: "Role to grant",       required: true },
    anchorSpaceId: { type: "text", label: "Anchor space id",     required: false },
    anchorBeingId: { type: "text", label: "Anchor being id",     required: false },
  },
  // The role-walk authorizes the FULL action `grant-role:<role>` so
  // canDo entries can scope grantors per-role: `grant-role:human`
  // grants only human; `grant-role:*` (or bare `grant-role`, the
  // namespace match) is the super-grantor shape. Without this, the
  // per-role contract documented above was never enforced — the walk
  // only ever saw the bare op name, so any grantor could grant ANY
  // role and `grant-role:X` entries matched nothing.
  authAction: ({ params }) =>
    typeof params?.role === "string" && params.role.length
      ? `grant-role:${params.role}`
      : "grant-role",
  handler: grantRoleHandler,
});
