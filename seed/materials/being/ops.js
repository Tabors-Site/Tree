// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// being/ops.js — DO operations that target Being.
//
//   set-being             — write a Being field (schema fields or qualities)
//   add-llm-connection    — register a new LLM connection on a Being
//   update-llm-connection — change fields on an existing connection
//   delete-llm-connection — remove a connection
//   assign-llm-slot       — bind a connection to a slot (polymorphic across
//                           Being and Space targets — the LLM resolution
//                           chain walks both)
//
// Being birth has NO DO op. Identity is BE territory: `be.register`,
// `birthBeing`. There is no `create-being` DO op.
//
// These self-register at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { registerAbleWord } from "../../present/word/ableWordRegistry.js";
import { detectTargetKind, targetIdOf } from "../_targetShape.js";
import { setBeingHostEnv } from "./setBeingHost.js";

// Self-register the co-located world strand so resolveAbleWord("being", "set-being") finds it.
// set-being is WORD-SOLE: set-being.word is the ONLY path (do.js runOpWord runs it); there is no
// JS handler. The genuine substrate reads (name-uniqueness, coord-bounds) bottom out in
// resolve-set-being-spec (setBeingHost.js), reusing assertCoordInBounds (exported below) + findByName.
registerAbleWord("being", "set-being", new URL("./set-being.word", import.meta.url));

// revoke-able is WORD-SOLE: revoke-able.word is the ONLY path (do.js runOpWord runs it). A PURE own-
// fact op — NO substrate read (revoke removes regardless, like revoke-inheritation). The word gates
// the inputs and authors no factParams; the auto-Fact falls back to ctx.params (able + anchor +
// explicit grantedBy), and applyAbleGrants drops the matching grant (grantedBy = params.grantedBy ||
// fact.through). Mirrors grant-able.
registerAbleWord("being", "revoke-able", new URL("./revoke-able.word", import.meta.url));

// SPATIAL axes the clamp considers. Two-dimensional by default; z is
// allowed when both the being's coord write and the space's size
// carry it.
const COORD_AXES = ["x", "y", "z"];

/**
 * Clamp a coord write against the being's current position space
 * size. Reads Space.size at write time (the bound that's in force
 * right now); if the being has no position, or the space has no size,
 * the coord passes through as written.
 *
 * Pure in the sense that two concurrent writers see the same Space
 * row (it doesn't move during the lock window) and compute the same
 * clamp. The seal-time lock on the Being's reel serializes coord
 * writes per-being.
 */
/**
 * Validate a coord write against the being's containing space size.
 * Throws IbpError(INVALID_INPUT) if any axis is out of bounds — the
 * fact never seals. Cognition catches the rejection and refaces or
 * retries; the substrate stays the floor for what's legal, the able
 * stays decoupled from the rules.
 *
 * Doctrine: silent clamping was a quiet lie. The reel showed "moved
 * to (10,5)" when the row stored (9,5); replay from the chain
 * disagreed with the live fold. Throwing instead keeps the chain
 * honest — if a fact says the being moved to (x,y), the row reflects
 * (x,y), period. PAST FIXED applies because the fact only seals when
 * the destination was legal at write time.
 *
 * When the being has no containing space, or the space has no size,
 * any coord passes. The check is "stay inside the declared box";
 * without a box there's nothing to enforce.
 */
// Exported for setBeingHost.js (set-being.word's resolve-set-being-spec floor read reuses the
// SAME clamp the handler ran — no reimplementation).
export async function assertCoordInBounds(beingDoc, raw, history = "0") {
  const out = {};
  for (const a of COORD_AXES) {
    if (typeof raw[a] === "number" && Number.isFinite(raw[a])) {
      out[a] = raw[a];
    }
  }
  if (Object.keys(out).length === 0) {
    return null;
  }
  const spaceId = beingDoc?.position || beingDoc?.homeSpace || null;
  if (!spaceId) return out;
  const { loadOrFold } = await import("../projections.js");
  const _sSlot = await loadOrFold("space", spaceId, history);
  const space = _sSlot ? { size: _sSlot.state?.size } : null;
  const size = space?.size || null;
  if (!size) return out;
  for (const a of COORD_AXES) {
    if (out[a] === undefined) continue;
    const cap = typeof size[a] === "number" && size[a] > 0 ? size[a] : null;
    if (cap === null) continue;
    const high = Number.isInteger(out[a]) ? Math.trunc(cap) - 1 : cap - Number.EPSILON;
    if (out[a] < 0 || out[a] > high) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-being: coord.${a}=${out[a]} is out of bounds (0..${high} for this space)`,
        { axis: a, value: out[a], cap: high },
      );
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// set-being — WORD-SOLE (registered below). No JS handler.
// ─────────────────────────────────────────────────────────────────────
//
// Write one Being field — a schema scalar (name / defaultAble / homeSpace / parentBeingId /
// password / position / coord) or a qualities path (qualities.<ns>[.<inner>]).
//
// set-being.word is the SOLE path. The CONTROL strand (the `field`-required gate + the return)
// is the .word; the genuine substrate READS — load the being row, the per-history name-UNIQUENESS
// check (findByName), and the COORD-BOUNDS check (assertCoordInBounds, above, reads Space.size and
// THROWS out-of-bounds) — are the host see-op resolve-set-being-spec (setBeingHost.js), reaching
// loadTargetRow + findByName + assertCoordInBounds (the SAME primitives the old handler called). The
// .word returns { beingId, factParams }; do.js's runOpWord promotes factParams + the being target
// (idFrom:"beingId") via stampsWordFact, so the lone do:set-being fact lands on the being's reel and
// applySetField / applySetQualities fold it exactly as before — the same { field, value[, merge]
// [, fromPosition] } the dispatcher stamped when a JS handler stood here.

// (end-being removed 2026-06-21: it was a throwing symmetry stub — "not implemented at the DO layer"
// — with no internal callers and no reducer fold. Identity-ending lives on the BE verb, where the
// rest of identity logic lives. A do-op that always throws is dirty; deleted rather than carried.
// NOTE: seedPlant's graft-rollback still stamps a do:end-being AUDIT fact directly via emitFact —
// inert in the being fold today; reversing a grafted being properly is a separate seed/graft concern.)

// ─────────────────────────────────────────────────────────────────────
// LLM connection ops
// ─────────────────────────────────────────────────────────────────────
//
// Connection records live in `Being.qualities.llmConnections` as a
// Map keyed by connection uuid. Each entry: `{ name, baseUrl,
// encryptedApiKey, model, createdAt, lastUsedAt }`. These ops wrap
// the seed/present/cognition/llm/connect.js helpers behind the IBP
// grammar so operators / CLI clients have a single dispatch surface.
//
// These llm-connection ops are now `.word`s in store/words/llm-connection/ — NO skipAudit. Each
// lays its own fact cleanly: the atomic ones (update/delete) via the dispatcher's one stamp, add
// via runWordToStore's deeds (ranAsMoments). The update/delete handlers BELOW are dead (shadowed
// by the bundle's registrations); cleanup follows with the rest of the cluster.

// add-llm-connection moved to store/words/llm-connection/ (add-llm-connection.word, the
// multi-moment composite run via runWordToStore — two deeds, two moments, no skipAudit).
// This JS handler + its registration are retired.

async function updateLlmConnectionHandler({ target, params, identity, moment }) {
  const { connectionId, name, baseUrl, apiKey, model } = params || {};
  if (!connectionId)
    throw new Error("update-llm-connection: `connectionId` is required");
  if (!baseUrl || !model) {
    throw new Error(
      "update-llm-connection: `baseUrl` and `model` are required",
    );
  }
  // Only need the id; the helper takes a beingId string.
  const beingId = targetIdOf(target);
  const { updateLlmConnection } = await import(
    "../../present/cognition/llm/connect.js"
  );
  const connection = await updateLlmConnection(
    beingId,
    connectionId,
    { name, baseUrl, apiKey, model },
    { identity, moment },
  );
  return { connection };
}

async function deleteLlmConnectionHandler({ target, params, identity, moment }) {
  const { connectionId } = params || {};
  if (!connectionId)
    throw new Error("delete-llm-connection: `connectionId` is required");
  const { deleteLlmConnection } = await import(
    "../../present/cognition/llm/connect.js"
  );
  await deleteLlmConnection(targetIdOf(target), connectionId, { identity, moment });
  return { removed: true, connectionId };
}

async function assignLlmSlotHandler({ target, params, identity, moment }) {
  const { slot, connectionId } = params || {};
  if (!slot) throw new Error("assign-llm-slot: `slot` is required");
  const kind = detectTargetKind(target);
  const id = targetIdOf(target);
  const { assignConnection, assignSpaceConnection } = await import(
    "../../present/cognition/llm/connect.js"
  );
  if (kind === "being") {
    return assignConnection(id, slot, connectionId || null, {
      identity, moment,
    });
  }
  if (kind === "space" || kind === "stance") {
    return assignSpaceConnection(id, slot, connectionId || null, {
      ownerBeingId: identity?.beingId || null,
      identity,
      moment,
    });
  }
  throw new Error(`assign-llm-slot: target kind "${kind}" not supported`);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

// WORD-SOLE: set-being.word is the only path (do.js runOpWord). idFrom:"beingId" targets the
// fact at the being and promotes the word's factParams ({field, value[, merge][, fromPosition]});
// resolve-set-being-spec (setBeingHostEnv) is the lone host READ (load + name-uniqueness +
// coord-bounds). No handler.
registerOperation("set-being", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "set-being",
  // authorize keys this as do:set-being:<namespace> when the field is
  // qualities.<namespace>... See operations.js isNamespaceKeyedAction.
  useNamespaceKey: true,
  args: {
    field: { type: "text", label: "Field (e.g. coord, qualities.<ns>.<key>)", required: true },
    value: { type: "json", label: "Value (JSON; null to clear)", required: false },
    merge: { type: "bool", label: "Merge (for qualities objects)", default: true, required: false },
  },
  word: { noun: "being", able: "being", idFrom: "beingId" },
  hostEnv: setBeingHostEnv,
});


// ────────────────────────────────────────────────────────────────────
// grant-able / revoke-able
// ────────────────────────────────────────────────────────────────────
//
// Ables are auth (seed/AblesAreAuth.md). A being holds a able by
// being granted it; authorize walks ablesGranted and matches the
// able's canX against the verb+action.
//
// Both ops emit one Fact each on the target being's reel. The being
// reducer (applyAbleGrants in reducerHelpers.js) folds them into
// qualities.ablesGranted:
//   grant-able  → append { able, anchorSpaceId|anchorBeingId, grantedBy }
//   revoke-able → remove the matching tuple (able, anchor*, grantedBy)
//
// Duplicate grants from different grantors live as separate entries,
// each separately revocable. The being holds the able until ALL
// grants of (able, anchor) are revoked.
//
// Auth: the caller's right to grant able X is encoded in their own
// granted ables' canDo: a able with canDo entry `grant-able:X` (or
// `grant-able:*` for super-grantors like angel) permits granting X.
// Same shape for revoke-able:X. This means anyone who has been
// authored as a grantor for X via the canDo declaration on their
// able can hand X out. The chain back to I-Am is structural.

// WORD-SOLE: revoke-able.word is the only path (do.js runOpWord). A PURE own-fact op — NO host
// read. The word authors no factParams; the auto-Fact falls back to ctx.params (able + anchor +
// the explicit grantedBy when the caller named one), and applyAbleGrants drops the matching grant
// (grantedBy = params.grantedBy || fact.through — an omitted grantedBy revokes the CALLER's own
// grant, byte-equal to the old handler defaulting grantedBy to identity.beingId). No handler,
// no hostEnv. authAction keeps the per-able scoping (`revoke-able:<able>`), unchanged.
registerOperation("revoke-able", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "revoke-able",
  args: {
    able:          { type: "text", label: "Able to revoke",       required: true },
    anchorSpaceId: { type: "text", label: "Anchor space id",      required: false },
    anchorBeingId: { type: "text", label: "Anchor being id",      required: false },
    grantedBy:     { type: "text", label: "Grantor whose grant to revoke (defaults to self)", required: false },
  },
  // Same per-able scoping as grant-able.
  authAction: ({ params }) =>
    typeof params?.able === "string" && params.able.length
      ? `revoke-able:${params.able}`
      : "revoke-able",
  word: { noun: "being" },
});

// add-llm-connection CARVED OUT → store/words/llm-connection/ (add-llm-connection.word — the
// MULTI-MOMENT composite run via runWordToStore: `do set-being` then `If first, do assign-llm-slot`,
// two deeds = two moments, no skipAudit). The JS handler is retired (the bundle owns the op).

// update-llm-connection CARVED OUT → store/words/llm-connection/ (update-llm-connection.word
// + llmHost.js). Lays its ONE do:set-being fact through the dispatcher (no skipAudit, no
// self-emit) via resolve-connection-update. updateLlmConnectionHandler above is now dead
// (the bundle owns the op); cleanup is a follow-up with the rest of the cluster.

// delete-llm-connection CARVED OUT → store/words/llm-connection/ (delete-llm-connection.word
// + llmHost.js). Lays its ONE do:set-being fact (unset, value:null) through the dispatcher
// (no skipAudit, no self-emit); the slot-clears run-on is dropped (the dangling ref folds).
// deleteLlmConnectionHandler above is now dead (the bundle owns the op).

// assign-llm-slot CARVED OUT → store/words/llm-connection/ (assign-llm-slot.word + llmHost.js).
// Polymorphic (being=set-being / space=set-space) via a conditional deed; runs through
// runWordToStore + ranAsMoments (no skipAudit, no self-emit). assignLlmSlotHandler above is now
// dead (the bundle owns the op).
