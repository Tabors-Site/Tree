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
import { stampsFact, stampsWordFact } from "../../../ibp/factResult.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getRoleSpecForGrant } from "../../../present/roles/spaceLookup.js";
import {
  normalizeAcquisition,
  alreadyHoldsRole,
} from "../../../present/roles/acquisition.js";
import { loadOrFold } from "../../../materials/projections.js";
import { registerRoleWord } from "../../../present/word/roleWordRegistry.js";
import { buildInternalGrant } from "../../../present/roles/internalGrant.js";

// Self-register this bundle's co-located `.word` slices (CONVERTING.md): importing
// this index (at seed boot, or in a DRY harness) registers them so
// resolveRoleWord("acquisition", <op>) finds them.
registerRoleWord(
  "acquisition",
  "take-role",
  new URL("./take-role.word", import.meta.url),
);
registerRoleWord(
  "acquisition",
  "ask-role",
  new URL("./ask-role.word", import.meta.url),
);

// ──────────────────────────────────────────────────────────────────
// ask-role
// ──────────────────────────────────────────────────────────────────

registerOperation("ask-role", {
  targets: ["space"],
  ownerExtension: "seed",
  // EVERY ask stamps its own do:ask-role fact (every act makes a fact). The auto path's
  // factParams carries the grant record (grantedBy/grantedAt) — applyRoleGrants folds the
  // role grant from a do:ask-role too. The queue/already/no-owner paths' factParams carry
  // just the outcome (no grantedBy): the ask is recorded, but nothing folds.
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
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "ask-role: target must be a space",
      );
    }

    // THE CONVERSION: ask-role's world strand is ask-role.word, run through the bridge.
    // The JS below is the clean-miss fallback.
    const viaWord = await _askRoleViaWord({
      caller: identity.beingId,
      role: roleName,
      space: hostSpaceId,
      moment,
    });
    if (viaWord) return viaWord;

    const history = moment?.actorAct?.history || "0";
    const { spec, hostSpaceId: foundHost } = await getRoleSpecForGrant(
      { role: roleName, anchorSpaceId: hostSpaceId },
      history,
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
    // (not yet folded) slot on this history.
    const callerSlot = await loadOrFold(
      "being",
      String(identity.beingId),
      history,
    );
    const existing = callerSlot?.state?.qualities?.rolesGranted || [];
    if (alreadyHoldsRole(existing, roleName, foundHost)) {
      // Idempotent re-ask: the role's already held (no grant record), but the ask is an
      // act — it stamps a do:ask-role in the being's history.
      return stampsFact(
        { already: true, role: roleName, anchorSpaceId: foundHost },
        { role: roleName, anchorSpaceId: foundHost, outcome: "already" },
        { kind: "being", id: identity.beingId },
      );
    }

    if (policy.asked === "auto") {
      // No self-emit: the act lays the grant record as a do:ask-role fact on the grantee's
      // reel (applyRoleGrants folds the grant from it); the dispatcher stamps it, caller-attributed.
      const { grant } = buildInternalGrant({
        granteeBeingId: String(identity.beingId),
        role: roleName,
        anchorSpaceId: foundHost,
        grantedBy: String(identity.beingId), // self-grant via the role's auto policy
      });
      return stampsFact(
        { granted: true, path: "auto", role: roleName, anchorSpaceId: foundHost },
        grant,
        { kind: "being", id: identity.beingId },
      );
    }

    // policy.asked === "queue" — summon the host's owner with intent
    // "role-request". The owner sees the request in their inbox and
    // approves/denies via the portal's inbox panel. Approve →
    // owner emits grant-role for the asker. Deny → reply summon with
    // {result:"denied"} clears the inbox row, no grant emitted.
    const hostSlot = await loadOrFold("space", foundHost, history);
    const ownerId = hostSlot?.state?.owner;
    if (!ownerId) {
      return stampsFact(
        { granted: false, path: "queue", role: roleName, anchorSpaceId: foundHost,
          message: `Role "${roleName}" needs manual approval but the host space has no owner to ask.` },
        { role: roleName, anchorSpaceId: foundHost, outcome: "queue-no-owner" },
        { kind: "being", id: identity.beingId },
      );
    }
    const ownerSlot = await loadOrFold("being", String(ownerId), history);
    const ownerName = ownerSlot?.state?.name;
    if (!ownerName) {
      return stampsFact(
        { granted: false, path: "queue", role: roleName, anchorSpaceId: foundHost,
          message: `Role "${roleName}" needs manual approval but the owner couldn't be addressed.` },
        { role: roleName, anchorSpaceId: foundHost, outcome: "queue-no-owner" },
        { kind: "being", id: identity.beingId },
      );
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
          from: askerStance,
          // Envelope intent: the caller's stated purpose. Read by the
          // auth gate (canSummon entries with intent: "role-request"),
          // routed by multi-role receivers, and surfaced by the inbox
          // panel as the dispatch key for its render surface.
          // See seed/SUMMON.md.
          intent: "role-request",
          content: {
            role: roleName,
            anchorSpaceId: foundHost,
            askerBeingId: String(identity.beingId),
            askerName: identity.name,
            reason: target?.reason || null,
          },
        },
        { identity, moment },
      );
    } catch (err) {
      return stampsFact(
        { granted: false, path: "queue", role: roleName, anchorSpaceId: foundHost,
          message: `Failed to send request to @${ownerName}: ${err?.message || err}` },
        { role: roleName, anchorSpaceId: foundHost, outcome: "queue-failed" },
        { kind: "being", id: identity.beingId },
      );
    }

    return stampsFact(
      { granted: false, path: "queue", role: roleName, anchorSpaceId: foundHost,
        message: `Requested. @${ownerName} will see this in their inbox.` },
      { role: roleName, anchorSpaceId: foundHost, outcome: "queue" },
      { kind: "being", id: identity.beingId },
    );
  },
});

// ──────────────────────────────────────────────────────────────────
// take-role
// ──────────────────────────────────────────────────────────────────

// The bridge into take-role.word: run the slice's CONTROL strand (the gate chain +
// idempotency) through the evaluator with the acquisition see escapes; the .word lays NO
// fact — EVERY take stamps a do:take-role (every act makes a fact): shimGrantResult promotes
// the returned factParams to _factParams + _factTarget, and the dispatcher's ONE auto-Fact
// lays it caller-attributed. The grab path's factParams carries the grant record (the reducer
// folds the grant); the idempotent path's carries just the outcome (no grant record → no
// fold). Returns null on a clean miss (not converted / no moment) so the JS handler runs. A
// WordRefusal (not installed / not grabbable) becomes the same IbpError the JS threw.
// ask-role's world strand is ask-role.word (the gate chain + the asked-policy §9 Match).
// Same cut shape: prefer the bridge, the JS body is the clean-miss fallback. EVERY ask stamps
// a do:ask-role — the auto path's factParams carries the grant record (grantedBy the asker);
// the queue path's carries just the outcome, and the CALL verb summons the owner (see owner-of
// + see role-request build the payload, keeping the asker identified in the inbox content
// regardless of the call envelope's `from`).
async function _askRoleViaWord({ caller, role, space, moment }) {
  if (!moment) return null;
  // HOST ESCAPE: ask-role is HOST-facilitated — the host (i-am) runs the .word THROUGH the asker's
  // being (`through: caller` → runRoleWord's being identity, i-am). So the auto-grant carries
  // I_AM authority and the queue summon reaches the owner FROM i-am (the host), not the asker (a
  // fresh asker holds no role permitting summon — it would be correctly denied). The asker rides
  // in the inbox CONTENT, not the call's `from` stance.
  const { resolveRoleWord, runRoleWord } =
    await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord(
    "acquisition",
    "ask-role",
    moment?.actorAct?.history,
  );
  if (!ir) return null;
  const { acquisitionHostEnv } = await import("./acquisitionHost.js");
  const history = moment?.actorAct?.history || "0";
  try {
    const { result } = await runRoleWord(ir, {
      moment,
      history,
      through: String(caller),
      trigger: {
        caller: String(caller),
        role: String(role),
        space: String(space),
        branch: history,
      },
      env: { host: acquisitionHostEnv() },
    });
    return result ? shimGrantResult(result, caller) : null;
  } catch (e) {
    if (e && e.__wordRefusal)
      throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message);
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
  const { resolveRoleWord, runRoleWord } =
    await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord(
    "acquisition",
    "take-role",
    moment?.actorAct?.history,
  );
  if (!ir) return null;
  const { acquisitionHostEnv } = await import("./acquisitionHost.js");
  const history = moment?.actorAct?.history || "0";
  try {
    const { result } = await runRoleWord(ir, {
      moment,
      history,
      trigger: {
        caller: String(caller),
        role: String(role),
        space: String(space),
        branch: history,
      },
      env: { host: acquisitionHostEnv() },
    });
    return result ? shimGrantResult(result, caller) : null;
  } catch (e) {
    if (e && e.__wordRefusal)
      throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message);
    throw e;
  }
}

// The dispatcher shim (mirrors create-matter's): EVERY path's .word returns `factParams`
// (every act makes a fact) → stampsWordFact promotes it to _factParams + forces _factTarget at
// the GRANTEE's being (the caller; resolveAuditTarget would otherwise pick the bare space
// target), so the dispatcher's ONE auto-Fact lays the caller-attributed do:take-role/do:ask-role.
// On the GRANT paths factParams carries the grant record (grantedBy/grantedAt) and the reducer
// folds the role grant; on the no-grant paths (idempotent already, ask-role's queue) factParams
// carries just the outcome (no grantedBy) so the act is recorded but nothing folds. The queue
// path's owner summon is its own CALL fact. `granteeBeingId` (the .word's hint) is dropped from the
// recorded result by stripForAudit's pass; we read it here as a sanity tie to the caller.
function shimGrantResult(result, caller) {
  // The .word authored the grant as `factParams` + `granteeBeingId` (the reel it lands on);
  // land it as the caller-attributed do:grant-role. No factParams on the no-grant paths
  // (idempotent / queue) → no fact. Defensive: the .word always sets granteeBeingId (= caller).
  if (result && typeof result === "object" && result.granteeBeingId == null) {
    result.granteeBeingId = String(caller);
  }
  return stampsWordFact(result, "being", "granteeBeingId");
}

registerOperation("take-role", {
  targets: ["space"],
  ownerExtension: "seed",
  // EVERY take stamps its own do:take-role fact (every act makes a fact). The grab path's
  // factParams carries the grant record (grantedBy/grantedAt) — applyRoleGrants folds the
  // role grant from a do:take-role too. The idempotent path's factParams carries just the
  // outcome (no grantedBy), so it records the take in the being's history but folds nothing.
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
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "take-role: `role` is required",
      );
    }
    const hostSpaceId = String(target?.id || target?.spaceId || "").trim();
    if (!hostSpaceId) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "take-role: target must be a space",
      );
    }

    // THE CONVERSION (2.md Phase 4): the take-role world-strand is take-role.word, run
    // through the bridge. The JS below is the clean-miss fallback. The .word lays NO fact —
    // it returns the grant record, the cut promotes it to _factParams + _factTarget, and the
    // dispatcher's ONE auto-Fact lays the caller-attributed (through = taker) do:grant-role;
    // a WordRefusal becomes the same IbpError.
    const viaWord = await _takeRoleViaWord({
      caller: identity.beingId,
      role: roleName,
      space: hostSpaceId,
      moment,
    });
    if (viaWord) return viaWord;

    const history = moment?.actorAct?.history || "0";
    const { spec, hostSpaceId: foundHost } = await getRoleSpecForGrant(
      { role: roleName, anchorSpaceId: hostSpaceId },
      history,
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

    const callerSlot = await loadOrFold(
      "being",
      String(identity.beingId),
      history,
    );
    const existing = callerSlot?.state?.qualities?.rolesGranted || [];
    if (alreadyHoldsRole(existing, roleName, foundHost)) {
      // Idempotent re-take: the role's already held, so no grant record (nothing folds) —
      // but the take is still an act, so it stamps a do:take-role in the being's history.
      return stampsFact(
        { already: true, role: roleName, anchorSpaceId: foundHost },
        { role: roleName, anchorSpaceId: foundHost, outcome: "already" },
        { kind: "being", id: identity.beingId },
      );
    }

    // No self-emit: the act lays the grant record as a do:grant-role fact on the
    // grantee's reel; the dispatcher's ONE auto-Fact stamps it, caller-attributed.
    const { grant } = buildInternalGrant({
      granteeBeingId: String(identity.beingId),
      role: roleName,
      anchorSpaceId: foundHost,
      grantedBy: String(identity.beingId),
    });
    return stampsFact(
      { granted: true, path: "grabbed", role: roleName, anchorSpaceId: foundHost },
      grant,
      { kind: "being", id: identity.beingId },
    );
  },
});
