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
  assertValidSpaceSize,
  assertNameAvailableAt,
} from "./spaces.js";
import { getRealityDomain } from "../../ibp/address.js";
import { IbpError, IBP_ERR, mapPatternsToIbpError } from "../../ibp/protocol.js";
import { I_AM } from "../being/seedBeings.js";
import { detectTargetKind, targetIdOf, loadTargetRow } from "../_targetShape.js";
import {
  setOwner,
  removeOwner,
} from "./ownership.js";

// Namespaces NOT writable through set-space qualities (each has its own verb).
const RESERVED_SET_META_NS = new Set([
  "inbox", // per-being inbox; written through SUMMON
]);

// ─────────────────────────────────────────────────────────────────────
// create-space
// ─────────────────────────────────────────────────────────────────────
//
// params: { name, type?, size?, ... } — flat
//
// The fact stamped is `{ params: { ...flat fields } }` — no `spec:`
// wrapper anywhere in the substrate. Reducers, walkers, and replicate
// paths all read flat. See seed/done/Chain-Rebuild.md "How symmetrical are
// the fact shapes" for the rationale.
//
// skipAudit because the branch stamps its own birth Fact directly
// (the handler owns the actId + target + spec). One Fact per birth on
// the new aggregate's reel; eager-fold materializes the row via the
// reducer's applyCreateSpace.

async function createSpaceHandler(ctx) {
  const { target, params, identity, summonCtx } = ctx;
  const spec = params || {};
  const targetKind = detectTargetKind(target);
  return createSpaceChild({
    target,
    params: spec,
    identity,
    summonCtx,
    kind: targetKind,
  });
}

// ─────────────────────────────────────────────────────────────────────
// set-space
// ─────────────────────────────────────────────────────────────────────
//
// params: { field, value, merge=true }
// field paths:
//   "name" / "type" / "parent" / "llmDefault" / "rootOwner"
//                                                    → schema-field writes
//   "qualities.<namespace>"                          → set/merge that namespace
//   "qualities.<namespace>.<innerKey>"               → merge one inner key
//   value=null on a qualities path                   → unset

async function setOnSpaceHandler({ target, params, identity, summonCtx }) {
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
      // Authorization is handled by the verb dispatcher's role-walk
      // before reaching this handler (RolesAreAuth). The earlier
      // belt-and-suspenders hasAccess check via resolveSpaceAccess
      // retired with the contributor class — the role's canDo +
      // reach is the single source of truth.
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
      // Authorization runs in the verb dispatcher's role-walk; this
      // handler trusts that. The hasAccess gate via resolveSpaceAccess
      // retired with the contributor class (RolesAreAuth).
      const { loadOrFold } = await import("../projections.js");
      const _slot1 = await loadOrFold("space", spaceId, summonCtx?.actorAct?.branch || "0");
      const row = _slot1 ? { _id: _slot1.id, ...(_slot1.state || {}) } : null;
      if (!row) {
        throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Space not found");
      }
      if (row.heavenSpace) {
        throw new Error("set-space: cannot rename heaven spaces");
      }
      if (row.name !== normalized) {
        await assertNameAvailableAt(row.parent, normalized, {
          excludeSpaceId: String(spaceId),
        });
      }
      return { spaceId: String(spaceId), name: normalized };
    }
    // Typed-space path. Identical validation; reducer writes.
    const row = await loadTargetRow(target, "space", { summonCtx });
    if (row.heavenSpace) {
      throw new Error("set-space: cannot rename heaven spaces");
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
    if (kind === "space" && target.heavenSpace) {
      throw new Error("set-space: cannot change type on heaven spaces");
    }
    if (kind === "stance") {
      // Single-writer: no direct Space.type write here. The op handler
      // validates seed-space immutability via the row check below,
      // then returns the shape; doVerb auto-stamps do:set-space and
      // the space reducer's applySetField writes Space.type.
      const { loadOrFold } = await import("../projections.js");
      const _slot2 = await loadOrFold("space", spaceId, summonCtx?.actorAct?.branch || "0");
      const row = _slot2 ? { heavenSpace: _slot2.state?.heavenSpace } : null;
      if (!row) {
        throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Space not found");
      }
      if (row.heavenSpace) {
        throw new Error("set-space: cannot change type on heaven spaces");
      }
    }
    return { spaceId, type: normalized };
  }

  if (field === "parent") {
    // Bare space-id, null, or the DELETED sentinel string. Soft-delete
    // marks parent = "deleted" so the space drops out of listings.
    const { DELETED } = await import("./heavenSpaces.js");
    const spaceId = targetIdOf(target);
    if (value === null || value === undefined) {
      return { spaceId, parent: null };
    }
    if (value === DELETED) {
      return { spaceId, parent: DELETED };
    }
    if (typeof value !== "string" || !value.length) {
      throw new Error(
        `set-space: parent must be a space id string, null, or the DELETED sentinel . got ${typeof value}`,
      );
    }
    return { spaceId, parent: value };
  }

  if (field === "llmDefault") {
    if (value !== null && value !== undefined && typeof value !== "string") {
      throw new Error("set-space: `llmDefault` value must be a connectionId string or null");
    }
    const spaceId = targetIdOf(target);
    return { spaceId, llmDefault: value || null };
  }

  // owner — the position's structural owner. Value is a beingId
  // string or null. Handler-level authorization (current owner
  // authorizes transfer; parent owner claims unowned position) lives
  // in materials/space/members.js; this validator enforces only the
  // wire shape.
  if (field === "owner") {
    if (value !== null && value !== undefined && (typeof value !== "string" || !value.length)) {
      throw new Error("set-space: `owner` value must be a beingId string or null");
    }
    const spaceId = targetIdOf(target);
    return { spaceId, owner: value || null };
  }

  // coord: this space's position INSIDE its parent. Sibling of `size`
  // ("how big am I") . coord is "where do I sit in my parent." The
  // unified `move` op also writes here for space targets; this branch
  // is the explicit set-space form (used by the portal's move tool
  // and direct IBP calls). Shape `{ x, y, z? }` or null to unset.
  // Clamped against the parent's size; out-of-bounds throws.
  if (field === "coord") {
    const spaceId = targetIdOf(target);
    if (value === null || value === undefined) {
      return { spaceId, coord: null };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "set-space: coord must be {x, y, z?} or null");
    }
    const out = {};
    for (const a of ["x", "y", "z"]) {
      if (value[a] === undefined) continue;
      if (typeof value[a] !== "number" || !Number.isFinite(value[a])) {
        throw new IbpError(IBP_ERR.INVALID_INPUT, `set-space: coord.${a} must be a finite number`);
      }
      out[a] = value[a];
    }
    if (Object.keys(out).length === 0) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "set-space: coord requires at least one axis");
    }
    // Bounds-check against the parent's size. Same doctrine as
    // set-being:coord (assertCoordInBounds in being/ops.js): silent
    // clamping was a lie; throw and let cognition reface.
    const { loadOrFold } = await import("../projections.js");
    const _selfSlot = await loadOrFold("space", spaceId, summonCtx?.actorAct?.branch || "0");
    const parentId = _selfSlot?.state?.parent;
    if (parentId) {
      const _parentSlot = await loadOrFold("space", parentId, summonCtx?.actorAct?.branch || "0");
      const parentRow = _parentSlot ? { size: _parentSlot.state?.size } : null;
      const parentSize = parentRow?.size || null;
      if (parentSize) {
        for (const a of ["x", "y", "z"]) {
          if (out[a] === undefined) continue;
          const cap = typeof parentSize[a] === "number" && parentSize[a] > 0 ? parentSize[a] : null;
          if (cap === null) continue;
          const high = Number.isInteger(out[a]) ? Math.trunc(cap) - 1 : cap - Number.EPSILON;
          if (out[a] < 0 || out[a] > high) {
            throw new IbpError(
              IBP_ERR.INVALID_INPUT,
              `set-space: coord.${a}=${out[a]} is out of bounds (0..${high} for the parent space)`,
              { axis: a, value: out[a], cap: high },
            );
          }
        }
      }
    }
    return { spaceId, coord: out };
  }

  // size: the space's bounding box. Shape `{ x, y, z? }` or null to
  // unset (the space becomes unbounded). Beings inside this space
  // have their `coord` clamped against this size on each set-being
  // write. assertValidSpaceSize enforces the configured maxSpaceSize
  // cap and the per-axis shape rules; null passes through to unset.
  if (field === "size") {
    const spaceId = targetIdOf(target);
    if (value === null || value === undefined) {
      return { spaceId, size: null };
    }
    const out = assertValidSpaceSize(value, { applyDefault: false });
    return { spaceId, size: out };
  }

  throw new Error(
    `set-space: unknown field "${field}". Supported: name, type, parent, owner, llmDefault, size, coord, qualities.<namespace>[.<innerKey>]`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// end-space
// ─────────────────────────────────────────────────────────────────────

async function endSpaceHandler({ target, identity, summonCtx }) {
  const spaceId = targetIdOf(target);
  // The actor is whoever called. I_AM-internal flows (registry mirror
  // sync at genesis + boot) pass `identity: I_AM`.
  const actorBeingId = identity?.beingId || null;
  // Forward the open moment's actId so deleteSpaceBranch's internal
  // do.set-space writes ride the same Act.
  const deleted = await deleteSpaceBranch(spaceId, actorBeingId, summonCtx?.actId || null);
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
  args: {
    name: { type: "text", label: "Name (kebab-case)", required: true },
    type: { type: "text", label: "Type (optional, e.g. 2d / 3d)", required: false },
    size: { type: "json", label: "Size (optional)", required: false, placeholder: '{"x":50,"y":50}' },
  },
  handler: createSpaceHandler,
});

registerOperation("set-space", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  factAction: "set-space",
  // authorize keys this as do:set-space:<namespace> when the field is
  // qualities.<namespace>... so operators can author per-namespace
  // rules. See operations.js isNamespaceKeyedAction.
  useNamespaceKey: true,
  args: {
    field: { type: "text", label: "Field (e.g. name, status, qualities.<ns>.<key>)", required: true },
    value: { type: "json", label: "Value (JSON; null to clear)", required: false },
    merge: { type: "bool", label: "Merge (for qualities objects)", default: true, required: false },
  },
  handler: setOnSpaceHandler,
});

registerOperation("end-space", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "end-space",
  args: {},
  handler: endSpaceHandler,
});

// ─────────────────────────────────────────────────────────────────────
// Ownership — the owner roster on a place.
// ─────────────────────────────────────────────────────────────────────
//
// Thin DO wrappers over the ownership.js functions. Each self-enforces
// authority and stamps its change as an inner set-space fact, so these
// wrappers carry skipAudit:true — one logical write, one fact. The
// actor is the caller's being; the place is the resolved target (a
// space target's id, or a stance's spaceId).
//
// Owner is the ONE base-axiom membership class — implicit authority
// over the space + descendants without any role grant. All other
// authority shapes (including what was contributor) are roles
// delegated via grant-role per seed/RolesAreAuth.md.

// Resolve the space id from a DO target that may be a space row/envelope
// or a resolved stance (which carries `.spaceId`).
function spaceIdFromTarget(target) {
  const kind = detectTargetKind(target);
  if (kind === "stance") {
    if (!target?.spaceId) {
      throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Resolved position has no spaceId");
    }
    return String(target.spaceId);
  }
  const id = targetIdOf(target);
  if (!id) throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Target does not resolve to a space");
  return String(id);
}

function requireActor(identity) {
  if (!identity?.beingId) {
    throw new IbpError(IBP_ERR.UNAUTHORIZED, "An authenticated being is required");
  }
  return String(identity.beingId);
}

// ownership.js throws plain Errors; map their messages to IBP codes so
// the portal shows FORBIDDEN / NOT_FOUND rather than a generic 500.
const PERMISSION_ERROR_PATTERNS = [
  [/only the .*owner|cannot add the owner|already the owner|cannot modify heaven|cannot set ownership|stance authorization/i, IBP_ERR.FORBIDDEN],
  [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
  [/being is being modified|concurrently/i, IBP_ERR.RESOURCE_CONFLICT],
  [/maximum|required|cannot/i, IBP_ERR.INVALID_INPUT],
];

// add-contributor / remove-contributor RETIRED 2026-06-09. Under
// RolesAreAuth, "contributor" is just a role like any other. Granting
// editing authority over a space is: grant-role to a being whose role
// has the relevant canDo at this space.
//
// Migration:
//   OLD: do(<space>, "add-contributor",    { contributorId })
//   NEW: do(<being>, "grant-role",         { role: "contributor",
//                                            anchorSpaceId: <space> })
//
//   OLD: do(<space>, "remove-contributor", { contributorId })
//   NEW: do(<being>, "revoke-role",        { role: "contributor",
//                                            anchorSpaceId: <space>,
//                                            grantedBy: <originalGrantor> })
//
// Operators define their own contributor role via the role-manager UI
// (set-role) with whatever canDo entries fit their reality.

registerOperation("set-owner", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  skipAudit: true,
  args: {
    newOwnerId: { type: "text", label: "New owner being id", required: true },
  },
  handler: async ({ target, params, identity, summonCtx }) => {
    const spaceId = spaceIdFromTarget(target);
    const actor = requireActor(identity);
    const newOwnerId = String(params?.newOwnerId || "").trim();
    if (!newOwnerId) throw new IbpError(IBP_ERR.INVALID_INPUT, "`newOwnerId` is required");
    try {
      await setOwner(spaceId, newOwnerId, actor, summonCtx?.actorAct?.branch || "0", summonCtx);
    } catch (err) {
      throw mapPatternsToIbpError(err, PERMISSION_ERROR_PATTERNS);
    }
    return { ownerSet: true, spaceId, newOwnerId };
  },
});

registerOperation("remove-owner", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  skipAudit: true,
  args: {},
  handler: async ({ target, identity, summonCtx }) => {
    const spaceId = spaceIdFromTarget(target);
    const actor = requireActor(identity);
    try {
      await removeOwner(spaceId, actor, summonCtx?.actorAct?.branch || "0");
    } catch (err) {
      throw mapPatternsToIbpError(err, PERMISSION_ERROR_PATTERNS);
    }
    return { ownerRemoved: true, spaceId };
  },
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
    [/place heaven spaces|reserved|invalid/i, IBP_ERR.INVALID_INPUT],
    [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
  ],
  rename: [
    [/place heaven spaces/i, IBP_ERR.FORBIDDEN],
    [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
    [/cannot|reserved|invalid|characters|empty/i, IBP_ERR.INVALID_INPUT],
  ],
};

async function createSpaceChild({ target, params, identity, summonCtx, kind }) {
  const beingId = identity?.beingId || null;
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
      "Cannot create-child at the place root. Create inside your home (~) instead.",
    );
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

