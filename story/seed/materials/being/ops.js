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
import Being from "./being.js";
import Space from "../space/space.js";
import { detectTargetKind, targetIdOf, loadTargetRow } from "../_targetShape.js";

const RESERVED_SET_META_NS = new Set([
  "inbox", // per-being inbox; written through SUMMON
]);

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
async function assertCoordInBounds(beingDoc, raw, history = "0") {
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
// set-being
// ─────────────────────────────────────────────────────────────────────
//
// params: { field, value, merge=true }
// field paths:
//   "name" / "ables" / "defaultAble" / "homeSpace" /
//   "parentBeingId"                                  → schema-field writes
//   "qualities.<namespace>"                          → set/merge that namespace
//   "qualities.<namespace>.<innerKey>"               → merge one inner key
//   value=null on a qualities path                   → unset
//   ("cognition" lives at qualities.cognition.defaultKind, written via
//    the qualities.* paths, not as a schema-field write.)

async function setOnBeingHandler({ target, params, moment }) {
  const { field, value, merge = true } = params || {};
  if (!field || typeof field !== "string") {
    throw new Error("set-being: `field` is required");
  }
  // The verb layer hands us a typed identity ({kind, id}) or a bare
  // string id. set-being needs row contents (qualities namespaces
  // for merge, current name for uniqueness check, current position
  // for the clamp helper). Load the row once at the top — the rest
  // of the handler reads from the doc. moment threads the moment's
  // deltaF so an in-flight being just stamped in the same scaffold
  // can be set without waiting for sealAct.
  target = await loadTargetRow(target, "being", { moment });

  // ── qualities paths ────────────────────────────────────
  if (field.startsWith("qualities.")) {
    const rest = field.slice("qualities.".length);
    const parts = rest.split(".");
    const namespace = parts[0];
    if (RESERVED_SET_META_NS.has(namespace)) {
      throw new Error(
        `set-being: qualities namespace "${namespace}" is not writable through set-being; it has a dedicated verb.`,
      );
    }
    if (parts.length === 1 && value !== null) {
      if (typeof value !== "object") {
        throw new Error("set-being: qualities-namespace value must be an object");
      }
    }
    return {
      written: true,
      beingId: String(target._id),
      ...(parts.length === 1 ? { namespace } : { field }),
      ...(value === null ? { unset: true } : {}),
    };
  }

  // ── schema-field writes ────────────────────────────────

  if (field === "name") {
    if (!value || typeof value !== "string") {
      throw new Error("set-being: `value` must be a string for field=name");
    }
    const history = moment?.actorAct?.history || "0";
    const { findByName } = await import("../projections.js");
    const existing = await findByName("being", value, history);
    if (existing && String(existing.id) !== String(target._id)) {
      throw new Error(`set-being: name "${value}" already taken on history ${history}`);
    }
    return { beingId: String(target._id), name: value };
  }

  if (field === "parentBeingId") {
    if (value === null || value === undefined) {
      return { beingId: String(target._id), parentBeingId: null };
    }
    if (typeof value !== "string" || !value.length) {
      throw new Error(
        `set-being: parentBeingId must be a being id string or null . got ${typeof value}`,
      );
    }
    return { beingId: String(target._id), parentBeingId: value };
  }

  if (field === "defaultAble") {
    if (
      value !== null && value !== undefined &&
      typeof value !== "string"
    ) {
      throw new Error(`set-being: \`defaultAble\` value must be a string or null`);
    }
    return { beingId: String(target._id), defaultAble: value };
  }

  if (field === "homeSpace") {
    if (value === null || value === undefined) {
      return { beingId: String(target._id), homeSpace: null };
    }
    if (typeof value !== "string" || !value.length) {
      throw new Error(
        `set-being: homeSpace must be a space id string or null . got ${typeof value}`,
      );
    }
    return { beingId: String(target._id), homeSpace: value };
  }

  // password is bcrypt-hashed by the caller (credential ops, register
  // flow) before set-being is called. The op records the hash on the
  // Being's reel; the reducer's applySetField writes state.password.
  // Plaintext never reaches this layer.
  if (field === "password") {
    if (typeof value !== "string" || !value.length) {
      throw new Error("set-being: `password` value must be the bcrypt hash string");
    }
    return { beingId: String(target._id), password: value };
  }

  // position: the Space this being is in. The DO-side counterpart to
  // be:occupy; either form lands the same Being.position write
  // through the reducer. The portal emits this on navigate-to-sized-
  // space so the being shows up in descriptor.occupantsByPosition
  // for everyone else in that space.
  if (field === "position") {
    if (value !== null && value !== undefined && (typeof value !== "string" || !value.length)) {
      throw new Error(
        `set-being: position must be a space id string or null . got ${typeof value}`,
      );
    }
    const newId = value || null;
    // Capture the OLD position into the fact's params so the live-SEE
    // hook fan can invalidate BOTH rooms — the one the being left and
    // the one they entered.
    const fromId = target?.position || null;
    if (fromId && fromId !== newId) {
      params.fromPosition = fromId;
    }
    return { beingId: String(target._id), position: newId, fromPosition: fromId };
  }

  // coord: the being's coord inside its position space. Shape `{ x, y, z? }`
  // or null to unset. The seed clamps each axis to the bounding box on
  // the being's position space (Space.size) so a being structurally
  // cannot exist outside the space it's in. When the space has no
  // size, the coord passes through as written.
  if (field === "coord") {
    if (value === null || value === undefined) {
      return { beingId: String(target._id), coord: null };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("set-being: `coord` value must be an object {x,y,z?} or null");
    }
    const validated = await assertCoordInBounds(target, value, moment?.actorAct?.history || "0");
    return { beingId: String(target._id), coord: validated };
  }

  throw new Error(
    `set-being: unknown field "${field}". Supported: name, defaultAble, homeSpace, parentBeingId, password, position, coord, qualities.<namespace>[.<innerKey>]`,
  );
}

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
  handler: setOnBeingHandler,
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
//   grant-able  → append { able, anchorSpaceId|anchorBeingId, grantedBy, grantedAt }
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

async function revokeAbleHandler({ target, params, identity, moment }) {
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "revoke-able: identity required (the revoker's beingId)",
    );
  }
  if (!params || typeof params !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "revoke-able: params required");
  }
  const { able, anchorSpaceId = null, anchorBeingId = null, grantedBy = null } = params;
  if (typeof able !== "string" || !able.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "revoke-able: `able` is required");
  }
  if (!anchorSpaceId && !anchorBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "revoke-able: one of `anchorSpaceId` or `anchorBeingId` is required",
    );
  }
  // Enrich grantedBy in-place. grantedBy identifies the SPECIFIC grant
  // to revoke (defaults to the caller's own beingId — revoking my own
  // grant). The being reducer matches on (able, anchor, grantedBy).
  const targetGrantedBy = grantedBy ? String(grantedBy) : String(identity.beingId);
  params.grantedBy = targetGrantedBy;
  return {
    revoked: true,
    able,
    granteeBeingId: String(targetIdOf(target)),
    anchorSpaceId,
    anchorBeingId,
    grantedBy: targetGrantedBy,
  };
}

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
  handler: revokeAbleHandler,
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
