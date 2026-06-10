// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// acquisitionOps.js — DO ops for acquiring roles.
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
// SEE's auto-on-entry hook also flows through here: when SEE on a
// space succeeds and the space hosts roles with `autoOnEntry: true`,
// the seed silently emits the same internal grant for the actor.

import { registerOperation } from "../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { getRoleSpecForGrant } from "./spaceLookup.js";
import { normalizeAcquisition, alreadyHoldsRole } from "./acquisition.js";
import { loadProjection } from "../../materials/projections.js";
import { I_AM } from "../../materials/being/seedBeings.js";

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
  handler: async ({ target, params, identity, summonCtx }) => {
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

    const branch = summonCtx?.actorAct?.branch || "0";
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

    // Idempotent: skip if the caller already holds the role at this host.
    const callerSlot = await loadProjection("being", String(identity.beingId), branch);
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
        summonCtx,
      });
      return {
        granted: true,
        path: "auto",
        role: roleName,
        anchorSpaceId: foundHost,
      };
    }

    // policy.asked === "queue" — summon the host's owner with intent
    // "role-request". For now, return a structured response so the
    // portal can surface the message; the summon plumbing lands when
    // there's a UI to consume it.
    return {
      granted: false,
      path: "queue",
      role: roleName,
      anchorSpaceId: foundHost,
      message: `Role "${roleName}" requires manual approval. Notify the host's owner directly.`,
    };
  },
});

// ──────────────────────────────────────────────────────────────────
// take-role
// ──────────────────────────────────────────────────────────────────

registerOperation("take-role", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "take-role",
  args: {
    role: { type: "text", label: "Role to take", required: true },
  },
  handler: async ({ target, params, identity, summonCtx }) => {
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

    const branch = summonCtx?.actorAct?.branch || "0";
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

    const callerSlot = await loadProjection("being", String(identity.beingId), branch);
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
      summonCtx,
    });
    return {
      granted: true,
      path: "grabbed",
      role: roleName,
      anchorSpaceId: foundHost,
    };
  },
});

// ──────────────────────────────────────────────────────────────────
// Internal: emit a grant-role fact on the grantee's reel.
//
// Bypasses the grant-role op's "caller must have canDo grant-role:X"
// check — the role's own acquisition policy is the gate that already
// fired. The substrate writes the grant on I-Am's authority since
// the policy decision IS the substrate's authority.
// ──────────────────────────────────────────────────────────────────

export async function emitInternalGrant({
  granteeBeingId,
  role,
  anchorSpaceId,
  grantedBy,
  summonCtx,
}) {
  const { emitFact } = await import("../../past/fact/facts.js");
  await emitFact({
    verb:    "do",
    action:  "grant-role",
    beingId: I_AM,
    target:  { kind: "being", id: String(granteeBeingId) },
    params:  {
      role,
      anchorSpaceId: anchorSpaceId ? String(anchorSpaceId) : null,
      anchorBeingId: null,
      grantedBy:     grantedBy ? String(grantedBy) : I_AM,
      grantedAt:     new Date().toISOString(),
      expiresAt:     null,
    },
    branch: summonCtx?.actorAct?.branch || "0",
    actId:  summonCtx?.actId || null,
  }, summonCtx);
}
