// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// matter/ops.js — DO operations that target Matter.
//
//   create-matter — bring a new Matter into existence under target
//                   (target may be a space or another matter parent)
//   set-matter    — write a Matter field (schema fields or qualities)
//   end-matter    — chain-disconnect target Matter from the projection
//
// These self-register at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { emitFact } from "../../past/fact/facts.js";
import Matter from "./matter.js";
import Space from "../space/space.js";
import { I_AM } from "../being/seedBeings.js";
import { v4 as uuidv4 } from "uuid";
import { detectTargetKind, targetIdOf, loadTargetRow } from "../_targetShape.js";

const COORD_AXES = ["x", "y", "z"];

/**
 * Validate a coord write against the matter's space size. Throws
 * IbpError(INVALID_INPUT) on an out-of-bounds axis — the fact never
 * seals. Same doctrine as set-being:coord (see being/ops.js header
 * for assertCoordInBounds): silent clamping was a lie; throwing
 * keeps the chain honest.
 */
async function assertMatterCoordInBounds(matterDoc, raw, branch = "0") {
  const out = {};
  for (const a of COORD_AXES) {
    if (typeof raw[a] === "number" && Number.isFinite(raw[a])) {
      out[a] = raw[a];
    }
  }
  if (Object.keys(out).length === 0) return null;
  // matterDoc.spaceId is a space-Ref (REFS.md) or DELETED sentinel.
  // For coord-clamping we need the bare id to look up the space.
  // Refs round-trip through Mongoose Mixed; extract via refId.
  const { refId, isAggregateRef } = await import("../ref.js");
  const spaceIdRaw = matterDoc?.spaceId || null;
  const spaceId = isAggregateRef(spaceIdRaw) ? refId(spaceIdRaw) : spaceIdRaw;
  if (!spaceId || spaceId === "deleted") return out;
  const { loadOrFold } = await import("../projections.js");
  const spaceSlot = await loadOrFold("space", spaceId, branch);
  const size = spaceSlot?.state?.size || null;
  if (!size) return out;
  for (const a of COORD_AXES) {
    if (out[a] === undefined) continue;
    const cap = typeof size[a] === "number" && size[a] > 0 ? size[a] : null;
    if (cap === null) continue;
    const high = Number.isInteger(out[a]) ? Math.trunc(cap) - 1 : cap - Number.EPSILON;
    if (out[a] < 0 || out[a] > high) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-matter: coord.${a}=${out[a]} is out of bounds (0..${high} for this space)`,
        { axis: a, value: out[a], cap: high },
      );
    }
  }
  return out;
}

const RESERVED_SET_META_NS = new Set([
  // none today; the set kept for symmetry with space/being
]);

// ─────────────────────────────────────────────────────────────────────
// create-matter
// ─────────────────────────────────────────────────────────────────────
//
// params: { spec: { ... } }
//
// skipAudit because the handler stamps the do:create-matter Fact
// directly on the new matter's reel; eager-fold inside logFact runs
// applyCreateMatter to materialize the row. One Fact per birth.

async function createMatterHandler(ctx) {
  const { target, params, identity, summonCtx, scaffold } = ctx;
  const { spec = {} } = params || {};
  const targetKind = detectTargetKind(target);

  const matterId = uuidv4();

  // spaceId is a typed space-Ref (REFS.md). Two sources:
  //   1. target is a space — wrap targetIdOf into ref("space", id).
  //   2. spec.spaceId from the caller — must already be a space-Ref;
  //      no DELETED sentinel on create (deletion goes through
  //      set-matter where the sentinel is accepted).
  let spaceId;
  if (targetKind === "space") {
    const { ref } = await import("../ref.js");
    spaceId = ref("space", targetIdOf(target));
  } else if (spec.spaceId === null || spec.spaceId === undefined) {
    spaceId = null;
  } else {
    const { isAggregateRef, refKind } = await import("../ref.js");
    if (!isAggregateRef(spec.spaceId) || refKind(spec.spaceId) !== "space") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `create-matter: spec.spaceId requires a space-Ref . got ${typeof spec.spaceId === "object" ? JSON.stringify(spec.spaceId) : typeof spec.spaceId}`,
      );
    }
    spaceId = spec.spaceId;
  }

  // parentMatterId is a typed matter-Ref (REFS.md). Two sources:
  //   1. target is a matter (nested creation under a parent matter) —
  //      wrap targetIdOf into a Ref here.
  //   2. spec.parentMatterId from the caller — must already be a Ref
  //      or null; validated below.
  // Legacy bare-string callers fail validation rather than silently
  // round-trip through the substrate as a mixed-shape field.
  let parentMatterId;
  if (targetKind === "matter") {
    const { ref } = await import("../ref.js");
    parentMatterId = ref("matter", targetIdOf(target));
  } else if (spec.parentMatterId === null || spec.parentMatterId === undefined) {
    parentMatterId = null;
  } else {
    const { isAggregateRef, refKind } = await import("../ref.js");
    if (!isAggregateRef(spec.parentMatterId) || refKind(spec.parentMatterId) !== "matter") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `create-matter: spec.parentMatterId requires a matter-Ref or null . got ${typeof spec.parentMatterId === "object" ? JSON.stringify(spec.parentMatterId) : typeof spec.parentMatterId}`,
      );
    }
    parentMatterId = spec.parentMatterId;
  }

  // beingId is a typed being-Ref (REFS.md). identity.beingId is bare
  // (substrate-internal actor id); wrap it. spec.beingId may already
  // be a Ref from migrated callers OR I_AM sentinel from scaffold
  // (genesis / source.js mirror) paths.
  const { ref: _ref, isAggregateRef: _isRef } = await import("../ref.js");
  let beingIdValue;
  const rawCreator = identity?.beingId || spec.beingId || null;
  if (rawCreator === null) {
    beingIdValue = null;
  } else if (_isRef(rawCreator)) {
    beingIdValue = rawCreator;
  } else {
    // Bare string — could be I_AM sentinel or a substrate-internal
    // actor id. Wrap into a being-Ref for storage consistency. The
    // I_AM constant rides as a Ref too (its id field is "i-am"); the
    // I_AM-as-bare-sentinel coexistence applies to fields the schema
    // explicitly allows it on (Space.rootOwner), not here.
    beingIdValue = _ref("being", String(rawCreator));
  }

  const enrichedSpec = {
    ...spec,
    spaceId,
    parentMatterId,
    beingId: beingIdValue,
    origin: spec.origin || "ibp",
  };
  const actorBeingId = identity?.beingId || (scaffold ? I_AM : null);
  if (!actorBeingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "create-matter requires identity or scaffold flow",
    );
  }
  await emitFact(
    {
      verb: "do",
      action: "create-matter",
      beingId: String(actorBeingId),
      target: { kind: "matter", id: matterId },
      params: { spec: enrichedSpec },
      actId: summonCtx?.actId || null,
      // Branch this matter is created on — sourced from the moment ctx
      // so a plant under #1 lands matter on #1's reel, not main's.
      branch: summonCtx?.branch || "0",
    },
    summonCtx,
  );
  // Return bare ids alongside the Ref shapes the fact carries. The
  // downstream resolveAuditTarget reads result.spaceId / .matterId /
  // .parentMatterId as bare strings to build the outer DO audit fact;
  // Refs live on the spec, bare ids ride the return.
  const { refId, isAggregateRef } = await import("../ref.js");
  return {
    matterId,
    spaceId:        isAggregateRef(spaceId) ? refId(spaceId) : spaceId,
    parentMatterId: isAggregateRef(parentMatterId) ? refId(parentMatterId) : parentMatterId,
  };
}

// ─────────────────────────────────────────────────────────────────────
// set-matter
// ─────────────────────────────────────────────────────────────────────
//
// params: { field, value, merge=true }
// field paths:
//   "name" / "content"                              → schema-field writes
//   "qualities.<namespace>"                          → set/merge that namespace
//   "qualities.<namespace>.<innerKey>"               → merge one inner key
//   value=null on a qualities path                   → unset

async function setOnMatterHandler({ target, params, summonCtx }) {
  const { field, value, merge = true } = params || {};
  if (!field || typeof field !== "string") {
    throw new Error("set-matter: `field` is required");
  }
  // Load the row at the top — set-matter needs spaceId for coord
  // clamping plus the doc for id-emitting return shapes. Passes
  // summonCtx so an in-moment chain (create-matter → set-matter
  // before seal) reads the in-flight spec from deltaF when the row
  // hasn't materialized yet.
  target = await loadTargetRow(target, "matter", { summonCtx });

  // ── qualities paths ────────────────────────────────────
  if (field.startsWith("qualities.")) {
    const rest = field.slice("qualities.".length);
    const parts = rest.split(".");
    const namespace = parts[0];
    if (RESERVED_SET_META_NS.has(namespace)) {
      throw new Error(
        `set-matter: qualities namespace "${namespace}" is not writable through set-matter; it has a dedicated verb.`,
      );
    }
    if (parts.length === 1 && value !== null) {
      if (typeof value !== "object") {
        throw new Error("set-matter: qualities-namespace value must be an object");
      }
    }
    return {
      written: true,
      matterId: String(target._id),
      ...(parts.length === 1 ? { namespace } : { field }),
      ...(value === null ? { unset: true } : {}),
    };
  }

  // ── schema-field writes ────────────────────────────────

  if (field === "name") {
    if (!value || typeof value !== "string") {
      throw new Error("set-matter: `value` must be a string for field=name");
    }
    return { matterId: String(target._id), name: value };
  }

  // spaceId: where the matter sits. Two valid value shapes:
  //   - space-Ref { __ref: "space", id }  (transfer to a new space)
  //   - DELETED sentinel ("deleted")       (soft-delete marker)
  // Same Ref-or-sentinel pattern as Space.rootOwner's I_AM exemption.
  if (field === "spaceId") {
    const { DELETED } = await import("../space/seedSpaces.js");
    if (value === DELETED) {
      return { matterId: String(target._id), spaceId: DELETED };
    }
    const { isAggregateRef, refKind } = await import("../ref.js");
    if (!isAggregateRef(value) || refKind(value) !== "space") {
      throw new Error(
        `set-matter: spaceId requires a space-Ref or the DELETED sentinel . got ${typeof value === "object" ? JSON.stringify(value) : typeof value}`,
      );
    }
    return { matterId: String(target._id), spaceId: value };
  }

  // beingId: who created the matter. Set-matter uses this only at
  // delete time to record DELETED. Live writes during create-matter
  // ride on the create-matter handler, not here.
  if (field === "beingId") {
    const { DELETED } = await import("../space/seedSpaces.js");
    if (value === DELETED) {
      return { matterId: String(target._id), beingId: DELETED };
    }
    throw new Error(
      `set-matter: beingId only accepts the DELETED sentinel through set-matter; the creator is fixed at birth`,
    );
  }

  // coord: the matter's position inside spaceId. Same shape and
  // semantics as Being.coord — `{ x, y, z? }` clamped to Space.size.
  // A being moving matter inside a space writes here through the
  // standard set-matter path.
  if (field === "coord") {
    if (value === null || value === undefined) {
      return { matterId: String(target._id), coord: null };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("set-matter: `coord` value must be an object {x,y,z?} or null");
    }
    const clamped = await assertMatterCoordInBounds(target, value, summonCtx?.branch || "0");
    return { matterId: String(target._id), coord: clamped };
  }

  throw new Error(
    `set-matter: unknown field "${field}". Supported: name, coord, qualities.<namespace>[.<innerKey>]`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// end-matter
// ─────────────────────────────────────────────────────────────────────

async function endMatterHandler({ target, identity, summonCtx }) {
  const matterId = targetIdOf(target);
  if (!matterId) throw new Error("end-matter: matterId required");
  const branch = summonCtx?.branch || "0";
  const { deleteMatterAndFile } = await import("./matters.js");
  let beingId = identity?.beingId;
  if (!beingId) {
    const { loadOrFold } = await import("../projections.js");
    const matterSlot = await loadOrFold("matter", matterId, branch);
    // state.beingId is a typed being-Ref (REFS.md); extract bare id.
    const { refId: _refId, isAggregateRef: _isRef } = await import("../ref.js");
    const raw = matterSlot?.state?.beingId;
    beingId = _isRef(raw) ? _refId(raw) : raw;
  }
  await deleteMatterAndFile({
    matterId,
    beingId: String(beingId || ""),
    actId: summonCtx?.actId || null,
    sessionId: summonCtx?.sessionId || null,
    summonCtx,
  });
  return { removed: true, matterId };
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

registerOperation("create-matter", {
  targets: ["space", "matter", "stance"],
  ownerExtension: "seed",
  factAction: "create-matter",
  skipAudit: true,
  handler: createMatterHandler,
});

registerOperation("set-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "set-matter",
  handler: setOnMatterHandler,
});

registerOperation("end-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "end-matter",
  handler: endMatterHandler,
});
