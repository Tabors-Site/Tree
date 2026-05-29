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
 * Clamp a coord write against the matter's space size. Same shape as
 * the set-being clamp (being/ops.js): half-open [0, cap) per axis,
 * integer or continuous. If the matter's space has no size, the coord
 * passes through.
 */
async function clampMatterCoord(matterDoc, raw) {
  const out = {};
  for (const a of COORD_AXES) {
    if (typeof raw[a] === "number" && Number.isFinite(raw[a])) {
      out[a] = raw[a];
    }
  }
  if (Object.keys(out).length === 0) return null;
  const spaceId = matterDoc?.spaceId || null;
  if (!spaceId) return out;
  const space = await Space.findById(spaceId).select("size").lean();
  const size = space?.size || null;
  if (!size) return out;
  for (const a of COORD_AXES) {
    if (out[a] === undefined) continue;
    const cap = typeof size[a] === "number" && size[a] > 0 ? size[a] : null;
    if (cap === null) continue;
    if (Number.isInteger(out[a])) {
      out[a] = Math.max(0, Math.min(Math.trunc(cap) - 1, out[a]));
    } else {
      const high = cap - Number.EPSILON;
      out[a] = Math.max(0, Math.min(high, out[a]));
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
  const spaceId =
    targetKind === "space" ? targetIdOf(target) : (spec.spaceId ?? null);
  const parentMatterId =
    targetKind === "matter" ? targetIdOf(target) : (spec.parentMatterId ?? null);
  const enrichedSpec = {
    ...spec,
    spaceId,
    parentMatterId,
    beingId: identity?.beingId || spec.beingId || null,
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
    },
    summonCtx,
  );
  return { matterId, spaceId, parentMatterId };
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

async function setOnMatterHandler({ target, params }) {
  const { field, value, merge = true } = params || {};
  if (!field || typeof field !== "string") {
    throw new Error("set-matter: `field` is required");
  }
  // Load the row at the top — set-matter needs spaceId for coord
  // clamping plus the doc for id-emitting return shapes.
  target = await loadTargetRow(target, "matter");

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
    const clamped = await clampMatterCoord(target, value);
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
  const { deleteMatterAndFile } = await import("./matters.js");
  const beingId =
    identity?.beingId ||
    (await Matter.findById(matterId).select("beingId").lean())?.beingId;
  await deleteMatterAndFile({
    matterId,
    beingId: String(beingId || ""),
    actId: summonCtx?.actId || null,
    sessionId: summonCtx?.sessionId || null,
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
