// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// store/words/acquisition/index.js — DO ops for acquiring ables, carved
// out of present/ables/acquisitionOps.js into its own store-word bundle.
//
// Per seed/AblesAreAuth.md, every able declares an `acquisition`
// block that says HOW other beings can come to hold it. The two
// caller-facing ops here let a being initiate that intake:
//
//   ask-able   — ask the able's host for the able. Resolution depends
//                on the able's `acquisition.asked` policy:
//                  "auto"  → grant immediately
//                  "queue" → summon the able's host owner with intent
//                            "able-request" (manual approval by owner)
//                  false   → reject with FORBIDDEN
//
//   take-able  — walk in and take the able. Resolution depends on
//                `acquisition.grabbed`:
//                  true  → grant immediately
//                  false → reject with FORBIDDEN
//
// Both ops target the SPACE hosting the able. The grant lands on the
// caller's being projection via an internal grant-able emit. The
// caller's authority to acquire flows FROM the able's acquisition
// policy itself, not from any canDo they hold — the policy IS the
// gate. Once acquired, the able-walk authorize handles enforcement
// uniformly with all other grants (no special branches).
//
// (SEE used to also flow through internalGrant via an auto-on-entry hook that silently emitted
// the grant — REMOVED: a space is a NOUN and can't grant a being. A being now reads a space's
// `autoOnEntry` policy and self-takes the able through THIS same take-able path. The acquisition
// `.word`s are the one acquire surface: caller-authorized by the able's own policy, dispatcher stamps.)

import { registerOperation } from "../../../ibp/operations.js";
import { stampsFact, stampsWordFact } from "../../../ibp/factResult.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getAbleSpecForGrant } from "../../../present/ables/spaceLookup.js";
import {
  normalizeAcquisition,
  alreadyHoldsAble,
} from "../../../present/ables/acquisition.js";
import { loadOrFold } from "../../../materials/projections.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { buildInternalGrant } from "../../../present/ables/internalGrant.js";

// Self-register this bundle's co-located `.word` slices (CONVERTING.md): importing
// this index (at seed boot, or in a DRY harness) registers them so
// resolveAbleWord("acquisition", <op>) finds them.
registerAbleWord(
  "acquisition",
  "take-able",
  new URL("./take-able.word", import.meta.url),
);
registerAbleWord(
  "acquisition",
  "ask-able",
  new URL("./ask-able.word", import.meta.url),
);

// ──────────────────────────────────────────────────────────────────
// ask-able
// ──────────────────────────────────────────────────────────────────

registerOperation("ask-able", {
  targets: ["space"],
  ownerExtension: "seed",
  // EVERY ask stamps its own do:ask-able fact (every act makes a fact). The auto path's
  // factParams carries the grant record (grantedBy/grantedAt) — applyAbleGrants folds the
  // able grant from a do:ask-able too. The queue/already/no-owner paths' factParams carry
  // just the outcome (no grantedBy): the ask is recorded, but nothing folds.
  factAction: "ask-able",
  args: {
    able: { type: "text", label: "Able to ask for", required: true },
  },
  handler: async ({ target, params, identity, moment }) => {
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "ask-able: identity required");
    }
    const ableName = String(params?.able || "").trim();
    if (!ableName) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "ask-able: `able` is required");
    }
    const hostSpaceId = String(target?.id || target?.spaceId || "").trim();
    if (!hostSpaceId) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "ask-able: target must be a space",
      );
    }

    // THE CONVERSION: ask-able's world strand is ask-able.word, run through the bridge.
    // The JS below is the clean-miss fallback.
    const viaWord = await _askAbleViaWord({
      caller: identity.beingId,
      able: ableName,
      space: hostSpaceId,
      moment,
    });
    if (viaWord) return viaWord;

    const history = moment?.actorAct?.history || "0";
    const { spec, hostSpaceId: foundHost } = await getAbleSpecForGrant(
      { able: ableName, anchorSpaceId: hostSpaceId },
      history,
    );
    if (!spec) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `ask-able: able "${ableName}" not installed on this space or any ancestor`,
      );
    }

    const policy = normalizeAcquisition(spec);
    if (policy.asked === false) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `ask-able: able "${ableName}" is not ask-acquirable (acquisition.asked=false)`,
      );
    }

    // Idempotent: skip if the caller already holds the able at this
    // host. loadOrFold: the caller's grants may live on an inherited
    // (not yet folded) slot on this history.
    const callerSlot = await loadOrFold(
      "being",
      String(identity.beingId),
      history,
    );
    const existing = callerSlot?.state?.qualities?.ablesGranted || [];
    if (alreadyHoldsAble(existing, ableName, foundHost)) {
      // Idempotent re-ask: the able's already held (no grant record), but the ask is an
      // act — it stamps a do:ask-able in the being's history.
      return stampsFact(
        { already: true, able: ableName, anchorSpaceId: foundHost },
        { able: ableName, anchorSpaceId: foundHost, outcome: "already" },
        { kind: "being", id: identity.beingId },
      );
    }

    if (policy.asked === "auto") {
      // No self-emit: the act lays the grant record as a do:ask-able fact on the grantee's
      // reel (applyAbleGrants folds the grant from it); the dispatcher stamps it, caller-attributed.
      const { grant } = buildInternalGrant({
        granteeBeingId: String(identity.beingId),
        able: ableName,
        anchorSpaceId: foundHost,
        grantedBy: String(identity.beingId), // self-grant via the able's auto policy
      });
      return stampsFact(
        { granted: true, path: "auto", able: ableName, anchorSpaceId: foundHost },
        grant,
        { kind: "being", id: identity.beingId },
      );
    }

    // policy.asked === "queue" — summon the host's owner with intent
    // "able-request". The owner sees the request in their inbox and
    // approves/denies via the portal's inbox panel. Approve →
    // owner emits grant-able for the asker. Deny → reply summon with
    // {result:"denied"} clears the inbox row, no grant emitted.
    const hostSlot = await loadOrFold("space", foundHost, history);
    const ownerId = hostSlot?.state?.owner;
    if (!ownerId) {
      return stampsFact(
        { granted: false, path: "queue", able: ableName, anchorSpaceId: foundHost,
          message: `Able "${ableName}" needs manual approval but the host space has no owner to ask.` },
        { able: ableName, anchorSpaceId: foundHost, outcome: "queue-no-owner" },
        { kind: "being", id: identity.beingId },
      );
    }
    const ownerSlot = await loadOrFold("being", String(ownerId), history);
    const ownerName = ownerSlot?.state?.name;
    if (!ownerName) {
      return stampsFact(
        { granted: false, path: "queue", able: ableName, anchorSpaceId: foundHost,
          message: `Able "${ableName}" needs manual approval but the owner couldn't be addressed.` },
        { able: ableName, anchorSpaceId: foundHost, outcome: "queue-no-owner" },
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
          // auth gate (canSummon entries with intent: "able-request"),
          // routed by multi-able receivers, and surfaced by the inbox
          // panel as the dispatch key for its render surface.
          // See seed/SUMMON.md.
          intent: "able-request",
          content: {
            able: ableName,
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
        { granted: false, path: "queue", able: ableName, anchorSpaceId: foundHost,
          message: `Failed to send request to @${ownerName}: ${err?.message || err}` },
        { able: ableName, anchorSpaceId: foundHost, outcome: "queue-failed" },
        { kind: "being", id: identity.beingId },
      );
    }

    return stampsFact(
      { granted: false, path: "queue", able: ableName, anchorSpaceId: foundHost,
        message: `Requested. @${ownerName} will see this in their inbox.` },
      { able: ableName, anchorSpaceId: foundHost, outcome: "queue" },
      { kind: "being", id: identity.beingId },
    );
  },
});

// ──────────────────────────────────────────────────────────────────
// take-able
// ──────────────────────────────────────────────────────────────────

// The bridge into take-able.word: run the slice's CONTROL strand (the gate chain +
// idempotency) through the evaluator with the acquisition see escapes; the .word lays NO
// fact — EVERY take stamps a do:take-able (every act makes a fact): shimGrantResult promotes
// the returned factParams to _factParams + _factTarget, and the dispatcher's ONE auto-Fact
// lays it caller-attributed. The grab path's factParams carries the grant record (the reducer
// folds the grant); the idempotent path's carries just the outcome (no grant record → no
// fold). Returns null on a clean miss (not converted / no moment) so the JS handler runs. A
// WordRefusal (not installed / not grabbable) becomes the same IbpError the JS threw.
// ask-able's world strand is ask-able.word (the gate chain + the asked-policy §9 Match).
// Same cut shape: prefer the bridge, the JS body is the clean-miss fallback. EVERY ask stamps
// a do:ask-able — the auto path's factParams carries the grant record (grantedBy the asker);
// the queue path's carries just the outcome, and the CALL verb summons the owner (see owner-of
// + see able-request build the payload, keeping the asker identified in the inbox content
// regardless of the call envelope's `from`).
async function _askAbleViaWord({ caller, able, space, moment }) {
  if (!moment) return null;
  // HOST ESCAPE: ask-able is HOST-facilitated — the host (i-am) runs the .word THROUGH the asker's
  // being (`through: caller` → runAbleWord's being identity, i-am). So the auto-grant carries
  // I_AM authority and the queue summon reaches the owner FROM i-am (the host), not the asker (a
  // fresh asker holds no able permitting summon — it would be correctly denied). The asker rides
  // in the inbox CONTENT, not the call's `from` stance.
  const { resolveAbleWord, runAbleWord } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord(
    "acquisition",
    "ask-able",
    moment?.actorAct?.history,
  );
  if (!ir) return null;
  const { acquisitionHostEnv } = await import("./acquisitionHost.js");
  const history = moment?.actorAct?.history || "0";
  try {
    const { result } = await runAbleWord(ir, {
      moment,
      history,
      through: String(caller),
      trigger: {
        caller: String(caller),
        able: String(able),
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

async function _takeAbleViaWord({ caller, able, space, moment }) {
  if (!moment) return null;
  // take-able is a SELF-act: the taker IS the actor, so the grant is attributed to the CALLER
  // (authorized by the auto-policy). The .word runs AS the caller — thread the identity onto the
  // moment (a kernel moment carries none). NOT a host escape like ask-able, whose queue summon
  // reaches the owner FROM i-am; take-able has no summon, so nothing escapes to the host.
  if (!moment.identity?.beingId) moment.identity = { beingId: String(caller) };
  const { resolveAbleWord, runAbleWord } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord(
    "acquisition",
    "take-able",
    moment?.actorAct?.history,
  );
  if (!ir) return null;
  const { acquisitionHostEnv } = await import("./acquisitionHost.js");
  const history = moment?.actorAct?.history || "0";
  try {
    const { result } = await runAbleWord(ir, {
      moment,
      history,
      trigger: {
        caller: String(caller),
        able: String(able),
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
// target), so the dispatcher's ONE auto-Fact lays the caller-attributed do:take-able/do:ask-able.
// On the GRANT paths factParams carries the grant record (grantedBy/grantedAt) and the reducer
// folds the able grant; on the no-grant paths (idempotent already, ask-able's queue) factParams
// carries just the outcome (no grantedBy) so the act is recorded but nothing folds. The queue
// path's owner summon is its own CALL fact. `granteeBeingId` (the .word's hint) is dropped from the
// recorded result by stripForAudit's pass; we read it here as a sanity tie to the caller.
function shimGrantResult(result, caller) {
  // The .word authored the grant as `factParams` + `granteeBeingId` (the reel it lands on);
  // land it as the caller-attributed do:grant-able. No factParams on the no-grant paths
  // (idempotent / queue) → no fact. Defensive: the .word always sets granteeBeingId (= caller).
  if (result && typeof result === "object" && result.granteeBeingId == null) {
    result.granteeBeingId = String(caller);
  }
  return stampsWordFact(result, "being", "granteeBeingId");
}

registerOperation("take-able", {
  targets: ["space"],
  ownerExtension: "seed",
  // EVERY take stamps its own do:take-able fact (every act makes a fact). The grab path's
  // factParams carries the grant record (grantedBy/grantedAt) — applyAbleGrants folds the
  // able grant from a do:take-able too. The idempotent path's factParams carries just the
  // outcome (no grantedBy), so it records the take in the being's history but folds nothing.
  factAction: "take-able",
  args: {
    able: { type: "text", label: "Able to take", required: true },
  },
  handler: async ({ target, params, identity, moment }) => {
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "take-able: identity required");
    }
    const ableName = String(params?.able || "").trim();
    if (!ableName) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "take-able: `able` is required",
      );
    }
    const hostSpaceId = String(target?.id || target?.spaceId || "").trim();
    if (!hostSpaceId) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "take-able: target must be a space",
      );
    }

    // THE CONVERSION (2.md Phase 4): the take-able world-strand is take-able.word, run
    // through the bridge. The JS below is the clean-miss fallback. The .word lays NO fact —
    // it returns the grant record, the cut promotes it to _factParams + _factTarget, and the
    // dispatcher's ONE auto-Fact lays the caller-attributed (through = taker) do:grant-able;
    // a WordRefusal becomes the same IbpError.
    const viaWord = await _takeAbleViaWord({
      caller: identity.beingId,
      able: ableName,
      space: hostSpaceId,
      moment,
    });
    if (viaWord) return viaWord;

    const history = moment?.actorAct?.history || "0";
    const { spec, hostSpaceId: foundHost } = await getAbleSpecForGrant(
      { able: ableName, anchorSpaceId: hostSpaceId },
      history,
    );
    if (!spec) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `take-able: able "${ableName}" not installed on this space or any ancestor`,
      );
    }

    const policy = normalizeAcquisition(spec);
    if (!policy.grabbed) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `take-able: able "${ableName}" is not take-acquirable (acquisition.grabbed=false). Try ask-able.`,
      );
    }

    const callerSlot = await loadOrFold(
      "being",
      String(identity.beingId),
      history,
    );
    const existing = callerSlot?.state?.qualities?.ablesGranted || [];
    if (alreadyHoldsAble(existing, ableName, foundHost)) {
      // Idempotent re-take: the able's already held, so no grant record (nothing folds) —
      // but the take is still an act, so it stamps a do:take-able in the being's history.
      return stampsFact(
        { already: true, able: ableName, anchorSpaceId: foundHost },
        { able: ableName, anchorSpaceId: foundHost, outcome: "already" },
        { kind: "being", id: identity.beingId },
      );
    }

    // No self-emit: the act lays the grant record as a do:grant-able fact on the
    // grantee's reel; the dispatcher's ONE auto-Fact stamps it, caller-attributed.
    const { grant } = buildInternalGrant({
      granteeBeingId: String(identity.beingId),
      able: ableName,
      anchorSpaceId: foundHost,
      grantedBy: String(identity.beingId),
    });
    return stampsFact(
      { granted: true, path: "grabbed", able: ableName, anchorSpaceId: foundHost },
      grant,
      { kind: "being", id: identity.beingId },
    );
  },
});
