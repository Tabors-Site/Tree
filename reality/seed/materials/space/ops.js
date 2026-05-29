// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// space/ops.js — DO operations that target Space.
//
//   create-space — bring a new Space into existence under target
//   set-space    — write a Space field (schema fields or qualities)
//   end-space    — chain-disconnect target Space from the projection
//
// These self-register at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../ibp/operations.js";
import Space from "./space.js";
import {
  createSpace,
  deleteSpaceBranch,
  assertValidSpaceName,
  assertValidSpaceType,
  assertNameAvailableAt,
  resolveSpaceAccess,
} from "./spaces.js";
import { getRealityDomain } from "../../ibp/address.js";
import { IbpError, IBP_ERR, mapPatternsToIbpError } from "../../ibp/protocol.js";
import { I_AM } from "../being/seedBeings.js";
import { detectTargetKind, targetIdOf, loadTargetRow } from "../_targetShape.js";

// Namespaces NOT writable through set-space qualities (each has its own verb).
const RESERVED_SET_META_NS = new Set([
  "inbox", // per-being inbox; written through SUMMON
]);

// ─────────────────────────────────────────────────────────────────────
// create-space
// ─────────────────────────────────────────────────────────────────────
//
// params: { spec: { name, type? } }
//
// skipAudit because the branch stamps its own birth Fact directly
// (the handler owns the actId + target + spec). One Fact per birth on
// the new aggregate's reel; eager-fold materializes the row via the
// reducer's applyCreateSpace.

async function createSpaceHandler(ctx) {
  const { target, params, identity, summonCtx, scaffold } = ctx;
  const { spec = {} } = params || {};
  const targetKind = detectTargetKind(target);
  return createSpaceChild({
    target,
    params: spec,
    identity,
    summonCtx,
    scaffold,
    kind: targetKind,
  });
}

// ─────────────────────────────────────────────────────────────────────
// set-space
// ─────────────────────────────────────────────────────────────────────
//
// params: { field, value, merge=true }
// field paths:
//   "name" / "type" / "parent" / "llmDefault" / "rootOwner" /
//   "contributors"                                  → schema-field writes
//   "qualities.<namespace>"                          → set/merge that namespace
//   "qualities.<namespace>.<innerKey>"               → merge one inner key
//   value=null on a qualities path                   → unset

async function setOnSpaceHandler({ target, params, identity }) {
  const { field, value, merge = true } = params || {};
  if (!field || typeof field !== "string") {
    throw new Error("set-space: `field` is required");
  }
  const kind = detectTargetKind(target);

  // ── qualities paths ────────────────────────────────────
  //
  // The handler validates input + resolves the target. The actual
  // write happens inside the verb dispatcher's logFact → eager-fold
  // pipeline: the fact is stamped, the reducer derives the new
  // qualities state, and applyProjection writes it. One projection
  // writer in the system — fold.
  if (field.startsWith("qualities.")) {
    const rest = field.slice("qualities.".length);
    const parts = rest.split(".");
    const namespace = parts[0];
    if (RESERVED_SET_META_NS.has(namespace)) {
      throw new Error(
        `set-space: qualities namespace "${namespace}" is not writable through set-space; it has a dedicated verb.`,
      );
    }

    if (kind === "stance") {
      if (parts.length > 2) {
        throw new Error(
          `set-space: deep qualities path "${field}" not supported (max depth: qualities.<namespace>.<innerKey>)`,
        );
      }
      if (!target.spaceId) {
        throw new IbpError(
          IBP_ERR.SPACE_NOT_FOUND,
          "Resolved address has no spaceId",
        );
      }
      const access = await resolveSpaceAccess(
        target.spaceId,
        identity?.beingId || null,
      );
      if (!access?.ok || access.write !== true) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "Not authorized to write qualities at this place",
        );
      }
      return {
        written: true,
        spaceId: String(target.spaceId),
        namespace,
        kind: "space",
        _factTarget: { kind: "space", id: String(target.spaceId) },
      };
    }

    if (parts.length === 1 && value !== null) {
      if (typeof value !== "object") {
        throw new Error("set-space: qualities-namespace value must be an object");
      }
    }

    const spaceId = targetIdOf(target);
    return {
      written: true,
      spaceId,
      ...(parts.length === 1 ? { namespace } : { field }),
      ...(value === null ? { unset: true } : {}),
    };
  }

  // ── schema-field writes ────────────────────────────────

  if (field === "name") {
    if (!value || typeof value !== "string") {
      throw new Error("set-space: `value` must be a string for field=name");
    }
    const normalized = assertValidSpaceName(value);

    // Single-writer doctrine. The op handler validates the rename
    // (access, seed-space immutability, sibling-name uniqueness) and
    // returns the shape. doVerb's auto-stamp lands a do:set-space
    // fact carrying { field: "name", value: normalized }; the space
    // reducer's applySetField is the one writer of Space.name.
    // Direct findByIdAndUpdate inside this handler used to double-
    // write the same field, racing the reducer.
    if (kind === "stance") {
      const spaceId = target?.spaceId;
      if (!spaceId) {
        throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Resolved address has no spaceId");
      }
      const beingId = identity?.beingId || null;
      const access = await resolveSpaceAccess(spaceId, beingId);
      if (!access?.ok || access.write !== true) {
        throw new IbpError(IBP_ERR.FORBIDDEN, "Not authorized to rename at this place");
      }
      const row = await Space.findById(spaceId).select("name parent seedSpace").lean();
      if (!row) {
        throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Space not found");
      }
      if (row.seedSpace) {
        throw new Error("set-space: cannot rename seed spaces");
      }
      if (row.name !== normalized) {
        await assertNameAvailableAt(row.parent, normalized, {
          excludeSpaceId: String(spaceId),
        });
      }
      return { spaceId: String(spaceId), name: normalized };
    }
    // Typed-space path. Identical validation; reducer writes.
    const row = await loadTargetRow(target, "space");
    if (row.seedSpace) {
      throw new Error("set-space: cannot rename seed spaces");
    }
    if (row.name !== normalized) {
      await assertNameAvailableAt(row.parent, normalized, {
        excludeSpaceId: String(row._id),
      });
    }
    return { spaceId: String(row._id), name: normalized };
  }

  if (field === "type") {
    const spaceId = targetIdOf(target);
    const normalized = assertValidSpaceType(value);
    if (kind === "space" && target.seedSpace) {
      throw new Error("set-space: cannot change type on seed spaces");
    }
    if (kind === "stance") {
      // Single-writer: no direct Space.type write here. The op handler
      // validates seed-space immutability via the row check below,
      // then returns the shape; doVerb auto-stamps do:set-space and
      // the space reducer's applySetField writes Space.type.
      const row = await Space.findById(spaceId).select("seedSpace").lean();
      if (!row) {
        throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Space not found");
      }
      if (row.seedSpace) {
        throw new Error("set-space: cannot change type on seed spaces");
      }
    }
    return { spaceId, type: normalized };
  }

  if (field === "parent") {
    if (value !== null && value !== undefined && typeof value !== "string") {
      throw new Error("set-space: `parent` value must be a spaceId string or null");
    }
    const spaceId = targetIdOf(target);
    return { spaceId, parent: value || null };
  }

  if (field === "llmDefault") {
    if (value !== null && value !== undefined && typeof value !== "string") {
      throw new Error("set-space: `llmDefault` value must be a connectionId string or null");
    }
    const spaceId = targetIdOf(target);
    return { spaceId, llmDefault: value || null };
  }

  if (field === "rootOwner") {
    if (value !== null && value !== undefined && typeof value !== "string") {
      throw new Error("set-space: `rootOwner` value must be a beingId string or null");
    }
    const spaceId = targetIdOf(target);
    return { spaceId, rootOwner: value || null };
  }

  if (field === "contributors") {
    if (!Array.isArray(value)) {
      throw new Error("set-space: `contributors` value must be an array of beingIds");
    }
    for (const id of value) {
      if (typeof id !== "string") {
        throw new Error("set-space: `contributors` array must contain beingId strings");
      }
    }
    const spaceId = targetIdOf(target);
    return { spaceId, contributors: value };
  }

  // size: the space's bounding box. Shape `{ x, y, z? }` or null to
  // unset (the space becomes unbounded). Beings inside this space
  // have their `coord` clamped against this size on each set-being
  // write. We accept positive finite numbers per axis; anything
  // else is ignored.
  if (field === "size") {
    const spaceId = targetIdOf(target);
    if (value === null || value === undefined) {
      return { spaceId, size: null };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("set-space: `size` value must be an object {x,y,z?} or null");
    }
    const out = {};
    for (const a of ["x", "y", "z"]) {
      if (typeof value[a] === "number" && Number.isFinite(value[a]) && value[a] > 0) {
        out[a] = value[a];
      }
    }
    if (Object.keys(out).length === 0) {
      throw new Error("set-space: `size` requires at least one positive numeric axis");
    }
    return { spaceId, size: out };
  }

  throw new Error(
    `set-space: unknown field "${field}". Supported: name, type, parent, llmDefault, rootOwner, contributors, size, qualities.<namespace>[.<innerKey>]`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// end-space
// ─────────────────────────────────────────────────────────────────────

async function endSpaceHandler({ target, identity, scaffold }) {
  const spaceId = targetIdOf(target);
  // Scaffold-mode acts as I_AM. The registry mirror sync (genesis +
  // boot) calls end-space against stale registry entries under
  // I_AM authority; without this fall-through, deleteSpaceBranch's
  // owner check rejects a null beingId and the sync warns.
  const actorBeingId = identity?.beingId || (scaffold ? I_AM : null);
  const deleted = await deleteSpaceBranch(spaceId, actorBeingId);
  return { deathSpaceId: String(deleted?._id || spaceId) };
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

registerOperation("create-space", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  factAction: "create-space",
  skipAudit: true,
  handler: createSpaceHandler,
});

registerOperation("set-space", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  factAction: "set-space",
  handler: setOnSpaceHandler,
});

registerOperation("end-space", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "end-space",
  handler: endSpaceHandler,
});

// ─────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────
//
// Stance-arrival handler for create-space. When the op's target arrives
// from the IBP wire, it's a resolved stance (carries `.chain`,
// `.spaceId`, `.isSpaceRoot`, `.isHomeRoot`). The inline branch above
// handles Mongoose-doc shapes; this helper handles the wire shape.

const KERNEL_ERROR_PATTERNS = {
  createChild: [
    [/cancelled by extension/i, IBP_ERR.FORBIDDEN],
    [/place seed spaces|reserved|invalid/i, IBP_ERR.INVALID_INPUT],
    [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
  ],
  rename: [
    [/place seed spaces/i, IBP_ERR.FORBIDDEN],
    [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
    [/cannot|reserved|invalid|characters|empty/i, IBP_ERR.INVALID_INPUT],
  ],
};

async function createSpaceChild({ target, params, identity, summonCtx, scaffold, kind }) {
  const beingId = identity?.beingId || (scaffold ? I_AM : null);
  const actId = summonCtx?.actId || null;
  const { name, type = null, size = null } = params || {};
  if (!name || typeof name !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`name` is required");
  }

  // Non-stance path: trust the caller, parent is the target. Accepts
  // any of the shapes targetIdOf() handles (Mongoose doc, plain
  // {_id} / {id} / {spaceId} envelope, raw string id).
  if (kind !== "stance") {
    try {
      const newSpace = await createSpace({
        name,
        type,
        size,
        parentId: targetIdOf(target),
        beingId,
        actId,
        summonCtx,
        scaffold,
      });
      return shapeNewSpace(newSpace);
    } catch (err) {
      throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
    }
  }

  // Stance-arrival path.
  if (target.isSpaceRoot) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "Cannot create-child at the place root. Create the tree under your home (~) instead.",
    );
  }
  if (target.isHomeRoot) {
    if (String(target.beingId) !== String(beingId)) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "Cannot create a tree root in another being's home",
      );
    }
    try {
      const newSpace = await createSpace({ name, type, size, isRoot: true, beingId, actId, summonCtx, scaffold });
      return shapeNewSpace(newSpace);
    } catch (err) {
      throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
    }
  }
  if (!target.spaceId) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      "Resolved position has no spaceId",
    );
  }
  try {
    const newSpace = await createSpace({
      name,
      type,
      size,
      parentId: target.spaceId,
      beingId,
      actId,
    });
    return shapeNewSpace(newSpace);
  } catch (err) {
    throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
  }
}

function shapeNewSpace(newSpace) {
  const spaceId = String(newSpace._id);
  return {
    spaceId,
    name: newSpace.name,
    position: `${getRealityDomain()}/${spaceId}`,
    _factTarget: { kind: "space", id: spaceId },
  };
}

