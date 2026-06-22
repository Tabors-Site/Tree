// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// store/words/grant-able/index.js — the grant-able DO op, carved out of
// materials/being/ops.js into its own store-word bundle.
//
// Ables are auth (seed/AblesAreAuth.md). A being holds a able by
// being granted it; authorize walks ablesGranted and matches the
// able's canX against the verb+action.
//
// grant-able emits one Fact on the target being's reel. The being
// reducer (applyAbleGrants in reducerHelpers.js) folds it into
// qualities.ablesGranted:
//   grant-able  → append { able, anchorSpaceId|anchorBeingId, grantedBy, grantedAt }
//
// Duplicate grants from different grantors live as separate entries,
// each separately revocable. The being holds the able until ALL
// grants of (able, anchor) are revoked.
//
// Auth: the caller's right to grant able X is encoded in their own
// granted ables' canDo: a able with canDo entry `grant-able:X` (or
// `grant-able:*` for super-grantors like angel) permits granting X.
// The chain back to I-Am is structural.
//
// This self-registers at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { targetIdOf } from "../../../materials/_targetShape.js";

async function grantAbleHandler({ target, params, identity, moment }) {
  // THE CONVERSION: grant-able's validation + record is grant-able.word (caller mode). The
  // .word returns the record; the cut enriches the op params with grantedBy/grantedAt so
  // the dispatcher's auto-emitted grant-able fact carries them (the being reducer reads
  // them from fact.params). JS body = clean-miss fallback.
  const viaWord = await _grantAbleViaWord({ caller: identity?.beingId, target, able: params?.able, anchorSpaceId: params?.anchorSpaceId, anchorBeingId: params?.anchorBeingId, moment });
  if (viaWord) {
    if (params) { params.grantedBy = viaWord.grantedBy; params.grantedAt = viaWord.grantedAt; }
    return viaWord;
  }

  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "grant-able: identity required (the grantor's beingId)",
    );
  }
  if (!params || typeof params !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "grant-able: params required");
  }
  const { able, anchorSpaceId = null, anchorBeingId = null } = params;
  if (typeof able !== "string" || !able.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "grant-able: `able` is required");
  }
  if (!anchorSpaceId && !anchorBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "grant-able: one of `anchorSpaceId` or `anchorBeingId` is required",
    );
  }
  if (anchorSpaceId && anchorBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "grant-able: only one of `anchorSpaceId` or `anchorBeingId` may be set",
    );
  }
  // Validate the able exists in the registry — can't grant a non-able.
  const { getAble } = await import("../../../present/ables/registry.js");
  const ableSpec = getAble(able);
  if (!ableSpec) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, `grant-able: able "${able}" is not registered`);
  }
  // Enrich params in-place so the auto-emitted Fact carries the full
  // grant record (grantedBy + grantedAt). The being reducer reads
  // these from fact.params and appends to qualities.ablesGranted.
  // No expiry: wall-clock expiry is a human-time concept the story
  // has no clock for; a grant lasts until revoked. Time-bound grants
  // arrive with story-time (moments), not ISO timestamps — see
  // present/ables/acquisition.js.
  const grantedBy = String(identity.beingId);
  const grantedAt = new Date().toISOString();
  params.grantedBy = grantedBy;
  params.grantedAt = grantedAt;
  return {
    granted: true,
    able,
    granteeBeingId: String(targetIdOf(target)),
    anchorSpaceId,
    anchorBeingId,
    grantedBy,
    grantedAt,
  };
}

// grant-able's world strand is grant-able.word (the gates + the able-registry check + the
// record). CALLER mode. Returns {granted, able, granteeBeingId, anchorSpaceId,
// anchorBeingId, grantedBy, grantedAt} or null on a clean miss so the JS body runs.
registerAbleWord("being", "grant-able", new URL("./grant-able.word", import.meta.url));
async function _grantAbleViaWord({ caller, target, able, anchorSpaceId, anchorBeingId, moment }) {
  if (!moment) return null;
  const { resolveAbleWord, runAbleWord } = await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("being", "grant-able", moment?.actorAct?.history);
  if (!ir) return null;
  const { grantHostEnv } = await import("./grantHost.js");
  const history = moment?.actorAct?.history;
  try {
    const { result } = await runAbleWord(ir, {
      moment, history,
      trigger: { caller: caller ? String(caller) : null, target: target ? String(targetIdOf(target)) : null, able: able ?? null, anchorSpaceId: anchorSpaceId ?? null, anchorBeingId: anchorBeingId ?? null, branch: history },
      env: { host: grantHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

registerOperation("grant-able", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "grant-able",
  args: {
    able:          { type: "text", label: "Able to grant",       required: true },
    anchorSpaceId: { type: "text", label: "Anchor space id",     required: false },
    anchorBeingId: { type: "text", label: "Anchor being id",     required: false },
  },
  // The able-walk authorizes the FULL action `grant-able:<able>` so
  // canDo entries can scope grantors per-able: `grant-able:human`
  // grants only human; `grant-able:*` (or bare `grant-able`, the
  // namespace match) is the super-grantor shape. Without this, the
  // per-able contract documented above was never enforced — the walk
  // only ever saw the bare op name, so any grantor could grant ANY
  // able and `grant-able:X` entries matched nothing.
  authAction: ({ params }) =>
    typeof params?.able === "string" && params.able.length
      ? `grant-able:${params.able}`
      : "grant-able",
  handler: grantAbleHandler,
});
