// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// store/words/acquisition/index.js — DO ops for acquiring roles, carved
// out of present/roles/acquisitionOps.js into its own store-word bundle.
//
// Per seed/RolesAreAuth.md, every role declares an `acquisition`
// block that says HOW other beings can come to hold it. The two
// caller-facing ops here let a being initiate that intake:
//
//   ask-role   — ask the role's host for the role. Resolution depends
//                on the role's `acquisition.asked` policy:
//                  "auto"  → grant immediately
//                  "queue" → summon the role's host owner with intent
//                            "role-request" (manual approval by owner)
//                  false   → reject with FORBIDDEN
//
//   take-role  — walk in and take the role. Resolution depends on
//                `acquisition.grabbed`:
//                  true  → grant immediately
//                  false → reject with FORBIDDEN
//
// Both ops target the SPACE hosting the role. The grant lands on the
// caller's being projection via an internal grant-role emit. The
// caller's authority to acquire flows FROM the role's acquisition
// policy itself, not from any canDo they hold — the policy IS the
// gate. Once acquired, the role-walk authorize handles enforcement
// uniformly with all other grants (no special branches).
//
// SEE's auto-on-entry hook also flows through the SAME shared
// internalGrant module: when SEE on a space succeeds and the space
// hosts roles with `autoOnEntry: true`, the seed silently emits the
// same internal grant for the actor.

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getRoleSpecForGrant } from "../../../present/roles/spaceLookup.js";
import { normalizeAcquisition, alreadyHoldsRole } from "../../../present/roles/acquisition.js";
import { loadOrFold } from "../../../materials/projections.js";
import { registerRoleWord } from "../../../present/word/roleWordRegistry.js";
import { emitInternalGrant } from "../../../present/roles/internalGrant.js";

// Self-register this bundle's co-located `.word` slices (CONVERTING.md): importing
// this index (at seed boot, or in a DRY harness) registers them so
// resolveRoleWord("acquisition", <op>) finds them.
registerRoleWord("acquisition", "take-role", new URL("./take-role.word", import.meta.url));
registerRoleWord("acquisition", "ask-role", new URL("./ask-role.word", import.meta.url));

// ──────────────────────────────────────────────────────────────────
// ask-role
// ──────────────────────────────────────────────────────────────────

registerOperation("ask-role", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "ask-role",
  args: {
    role: { type: "text", label: "Role to ask for", required: true },
  },
  handler: async ({ target, params, identity, moment }) => {
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "ask-role: identity required");
    }
    const roleName = String(params?.role || "").trim();
    if (!roleName) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "ask-role: `role` is required");
    }
    const hostSpaceId = String(target?.id || target?.spaceId || "").trim();
    if (!hostSpaceId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "ask-role: target must be a space");
    }

    // THE CONVERSION: ask-role's world strand is ask-role.word, run through the bridge.
    // The JS below is the clean-miss fallback.
    const viaWord = await _askRoleViaWord({ caller: identity.beingId, role: roleName, space: hostSpaceId, moment });
    if (viaWord) return viaWord;

    const branch = moment?.actorAct?.history || "0";
    const { spec, hostSpaceId: foundHost } = await getRoleSpecForGrant(
      { role: roleName, anchorSpaceId: hostSpaceId },
      branch,
    );
    if (!spec) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `ask-role: role "${roleName}" not installed on this space or any ancestor`,
      );
    }

    const policy = normalizeAcquisition(spec);
    if (policy.asked === false) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `ask-role: role "${roleName}" is not ask-acquirable (acquisition.asked=false)`,
      );
    }

    // Idempotent: skip if the caller already holds the role at this
    // host. loadOrFold: the caller's grants may live on an inherited
    // (not yet folded) slot on this branch.
    const callerSlot = await loadOrFold("being", String(identity.beingId), branch);
    const existing   = callerSlot?.state?.qualities?.rolesGranted || [];
    if (alreadyHoldsRole(existing, roleName, foundHost)) {
      return {
        already: true,
        role: roleName,
        anchorSpaceId: foundHost,
      };
    }

    if (policy.asked === "auto") {
      await emitInternalGrant({
        granteeBeingId: String(identity.beingId),
        role:           roleName,
        anchorSpaceId:  foundHost,
        grantedBy:      String(identity.beingId), // self-grant via the role's auto policy
        moment,
        branch,
      });
      return {
        granted: true,
        path: "auto",
        role: roleName,
        anchorSpaceId: foundHost,
      };
    }

    // policy.asked === "queue" — summon the host's owner with intent
    // "role-request". The owner sees the request in their inbox and
    // approves/denies via the portal's inbox panel. Approve →
    // owner emits grant-role for the asker. Deny → reply summon with
    // {result:"denied"} clears the inbox row, no grant emitted.
    const hostSlot = await loadOrFold("space", foundHost, branch);
    const ownerId = hostSlot?.state?.owner;
    if (!ownerId) {
      return {
        granted: false,
        path: "queue",
        role: roleName,
        anchorSpaceId: foundHost,
        message: `Role "${roleName}" needs manual approval but the host space has no owner to ask.`,
      };
    }
    const ownerSlot = await loadOrFold("being", String(ownerId), branch);
    const ownerName = ownerSlot?.state?.name;
    if (!ownerName) {
      return {
        granted: false,
        path: "queue",
        role: roleName,
        anchorSpaceId: foundHost,
        message: `Role "${roleName}" needs manual approval but the owner couldn't be addressed.`,
      };
    }

    const { callVerb } = await import("../../../ibp/verbs/call.js");
    const { getStoryDomain } = await import("../../../ibp/address.js");
    const story = getStoryDomain();
    const ownerStance = `${story}/@${ownerName}`;
    const askerStance = `${story}/@${identity.name}`;
    try {
      await callVerb(
        ownerStance,
        {
          from:    askerStance,
          // Envelope intent: the caller's stated purpose. Read by the
          // auth gate (canSummon entries with intent: "role-request"),
          // routed by multi-role receivers, and surfaced by the inbox
          // panel as the dispatch key for its render surface.
          // See seed/SUMMON.md.
          intent:  "role-request",
          content: {
            role:          roleName,
            anchorSpaceId: foundHost,
            askerBeingId:  String(identity.beingId),
            askerName:     identity.name,
            reason:        target?.reason || null,
          },
        },
        { identity, moment },
      );
    } catch (err) {
      return {
        granted: false,
        path: "queue",
        role: roleName,
        anchorSpaceId: foundHost,
        message: `Failed to send request to @${ownerName}: ${err?.message || err}`,
      };
    }

    return {
      granted: false,
      path:    "queue",
      role:    roleName,
      anchorSpaceId: foundHost,
      message: `Requested. @${ownerName} will see this in their inbox.`,
    };
  },
});

// ──────────────────────────────────────────────────────────────────
// take-role
// ──────────────────────────────────────────────────────────────────

// The bridge into take-role.word: run the slice's CONTROL strand (the gate chain +
// idempotency) through the evaluator with the acquisition host escapes; return the
// {role, anchorSpaceId, granted|already} result, or null on a clean miss (not converted /
// no moment) so the JS handler runs. The grant fact lands on the real moment. A WordRefusal
// (not installed / not grabbable) becomes the same IbpError the JS threw.
// ask-role's world strand is ask-role.word (the gate chain + the asked-policy §9 Match).
// Same cut shape as take-role: prefer the bridge, the JS body is the clean-miss fallback.
// The auto path's grant is I_AM-authority (like take-role); the queue path reaches the
// owner with the CALL verb (see owner-of + see role-request build the payload, which keeps
// the asker identified in the inbox content regardless of the call envelope's `from`).
async function _askRoleViaWord({ caller, role, space, moment }) {
  if (!moment) return null;
  // HOST ESCAPE: ask-role is HOST-facilitated — the host (i-am) runs the .word THROUGH the asker's
  // being (`through: caller` → runRoleWord's vessel identity, i-am). So the auto-grant carries
  // I_AM authority and the queue summon reaches the owner FROM i-am (the host), not the asker (a
  // fresh asker holds no role permitting summon — it would be correctly denied). The asker rides
  // in the inbox CONTENT, not the call's `from` stance.
  const { resolveRoleWord, runRoleWord } = await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("acquisition", "ask-role", moment?.actorAct?.history);
  if (!ir) return null;
  const { acquisitionHostEnv } = await import("./acquisitionHost.js");
  const branch = moment?.actorAct?.history || "0";
  try {
    const { result } = await runRoleWord(ir, {
      moment, branch, through: String(caller),
      trigger: { caller: String(caller), role: String(role), space: String(space), branch },
      env: { host: acquisitionHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message);
    throw e;
  }
}

async function _takeRoleViaWord({ caller, role, space, moment }) {
  if (!moment) return null;
  // take-role is a SELF-act: the taker IS the actor, so the grant is attributed to the CALLER
  // (authorized by the auto-policy). The .word runs AS the caller — thread the identity onto the
  // moment (a kernel moment carries none). NOT a host escape like ask-role, whose queue summon
  // reaches the owner FROM i-am; take-role has no summon, so nothing escapes to the host.
  if (!moment.identity?.beingId) moment.identity = { beingId: String(caller) };
  const { resolveRoleWord, runRoleWord } = await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("acquisition", "take-role", moment?.actorAct?.history);
  if (!ir) return null;
  const { acquisitionHostEnv } = await import("./acquisitionHost.js");
  const branch = moment?.actorAct?.history || "0";
  try {
    const { result } = await runRoleWord(ir, {
      moment, branch,
      trigger: { caller: String(caller), role: String(role), space: String(space), branch },
      env: { host: acquisitionHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message);
    throw e;
  }
}

registerOperation("take-role", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "take-role",
  args: {
    role: { type: "text", label: "Role to take", required: true },
  },
  handler: async ({ target, params, identity, moment }) => {
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "take-role: identity required");
    }
    const roleName = String(params?.role || "").trim();
    if (!roleName) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "take-role: `role` is required");
    }
    const hostSpaceId = String(target?.id || target?.spaceId || "").trim();
    if (!hostSpaceId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "take-role: target must be a space");
    }

    // THE CONVERSION (2.md Phase 4): the take-role world-strand is take-role.word, run
    // through the bridge. The JS below is the clean-miss fallback. The grant lands on the
    // real moment (emitInternalGrant's beingId=I_AM — the policy IS the substrate's
    // authority, grantedBy the taker); a WordRefusal becomes the same IbpError.
    const viaWord = await _takeRoleViaWord({ caller: identity.beingId, role: roleName, space: hostSpaceId, moment });
    if (viaWord) return viaWord;

    const branch = moment?.actorAct?.history || "0";
    const { spec, hostSpaceId: foundHost } = await getRoleSpecForGrant(
      { role: roleName, anchorSpaceId: hostSpaceId },
      branch,
    );
    if (!spec) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `take-role: role "${roleName}" not installed on this space or any ancestor`,
      );
    }

    const policy = normalizeAcquisition(spec);
    if (!policy.grabbed) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `take-role: role "${roleName}" is not take-acquirable (acquisition.grabbed=false). Try ask-role.`,
      );
    }

    const callerSlot = await loadOrFold("being", String(identity.beingId), branch);
    const existing   = callerSlot?.state?.qualities?.rolesGranted || [];
    if (alreadyHoldsRole(existing, roleName, foundHost)) {
      return {
        already: true,
        role: roleName,
        anchorSpaceId: foundHost,
      };
    }

    await emitInternalGrant({
      granteeBeingId: String(identity.beingId),
      role:           roleName,
      anchorSpaceId:  foundHost,
      grantedBy:      String(identity.beingId),
      moment,
      branch,
    });
    return {
      granted: true,
      path: "grabbed",
      role: roleName,
      anchorSpaceId: foundHost,
    };
  },
});
