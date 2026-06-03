// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// being/ops.js — DO operations that target Being.
//
//   set-being             — write a Being field (schema fields or qualities)
//   end-being             — chain-disconnect target Being from the projection
//   add-llm-connection    — register a new LLM connection on a Being
//   update-llm-connection — change fields on an existing connection
//   delete-llm-connection — remove a connection
//   assign-llm-slot       — bind a connection to a slot (polymorphic across
//                           Being and Space targets — the LLM resolution
//                           chain walks both)
//
// Being birth has NO DO op. Identity is BE territory: `be.register`,
// `summonCreateBeing`. There is no `create-being`.
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
 * retries; the substrate stays the floor for what's legal, the role
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
async function assertCoordInBounds(beingDoc, raw, branch = "0") {
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
  const _sSlot = await loadOrFold("space", spaceId, branch);
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
//   "name" / "roles" / "defaultRole" / "homeSpace" /
//   "llmDefault" / "parentBeingId"                  → schema-field writes
//   "qualities.<namespace>"                          → set/merge that namespace
//   "qualities.<namespace>.<innerKey>"               → merge one inner key
//   value=null on a qualities path                   → unset
//   ("cognition" lives at qualities.cognition.defaultKind, written via
//    the qualities.* paths, not as a schema-field write.)

async function setOnBeingHandler({ target, params, summonCtx }) {
  const { field, value, merge = true } = params || {};
  if (!field || typeof field !== "string") {
    throw new Error("set-being: `field` is required");
  }
  // The verb layer hands us a typed identity ({kind, id}) or a bare
  // string id. set-being needs row contents (qualities namespaces
  // for merge, current name for uniqueness check, current position
  // for the clamp helper). Load the row once at the top — the rest
  // of the handler reads from the doc. summonCtx threads the moment's
  // deltaF so an in-flight being just stamped in the same scaffold
  // can be set without waiting for sealAct.
  target = await loadTargetRow(target, "being", { summonCtx });

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
    const branch = summonCtx?.branch || "0";
    const { findByName } = await import("../projections.js");
    const existing = await findByName("being", value, branch);
    if (existing && String(existing.id) !== String(target._id)) {
      throw new Error(`set-being: name "${value}" already taken on branch ${branch}`);
    }
    return { beingId: String(target._id), name: value };
  }

  if (field === "parentBeingId") {
    if (value !== null && value !== undefined && typeof value !== "string") {
      throw new Error("set-being: `parentBeingId` value must be a beingId string or null");
    }
    return { beingId: String(target._id), parentBeingId: value || null };
  }

  if (field === "llmDefault") {
    if (value !== null && value !== undefined && typeof value !== "string") {
      throw new Error("set-being: `llmDefault` value must be a connectionId string or null");
    }
    if (value) {
      const conns =
        target.qualities instanceof Map
          ? target.qualities.get("llmConnections")
          : target.qualities?.llmConnections;
      if (!conns || !conns[value]) {
        throw new Error(`set-being: connection "${value}" not found on @${target.name}`);
      }
      return { beingId: String(target._id), llmDefault: value };
    }
    return { beingId: String(target._id), llmDefault: null };
  }

  if (
    field === "defaultRole" ||
    field === "homeSpace"
  ) {
    if (
      value !== null && value !== undefined &&
      typeof value !== "string"
    ) {
      throw new Error(`set-being: \`${field}\` value must be a string or null`);
    }
    return { beingId: String(target._id), [field]: value };
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
    if (value !== null && typeof value !== "string") {
      throw new Error("set-being: `position` value must be a spaceId string or null");
    }
    // Capture the OLD position into the fact's params so the live-SEE
    // hook fan can invalidate BOTH rooms — the one the being left and
    // the one they entered. Without this, anyone subscribed to the old
    // room sees a "ghost being" still sitting there until they refetch
    // manually (the bug that made the 2D flat app show tabor at root
    // while the 3D portal had already walked him into a tree).
    const fromPosition = target?.position ? String(target.position) : null;
    if (fromPosition && fromPosition !== value) {
      params.fromPosition = fromPosition;
    }
    return { beingId: String(target._id), position: value, fromPosition };
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
    const validated = await assertCoordInBounds(target, value, summonCtx?.branch || "0");
    return { beingId: String(target._id), coord: validated };
  }

  throw new Error(
    `set-being: unknown field "${field}". Supported: name, defaultRole, homeSpace, llmDefault, parentBeingId, password, position, coord, qualities.<namespace>[.<innerKey>]`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// end-being
// ─────────────────────────────────────────────────────────────────────
//
// Symmetry stub. No current internal callers; identity-ending lives on
// the BE verb where the rest of identity logic lives.

async function endBeingHandler({ target }) {
  throw new Error(
    "end-being is not implemented at the DO layer. Identity-ending belongs on BE (be.unregister, etc.).",
  );
}

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
// `skipAudit: true` on every op because the helpers route their
// writes through `do.set-being`, and the inner set IS the canonical
// audit Fact. Without skipAudit the outer op would double-stamp.

async function addLlmConnectionHandler({ target, params, identity, summonCtx }) {
  const { name, baseUrl, apiKey, model } = params || {};
  if (!name || !baseUrl || !model) {
    throw new Error(
      "add-llm-connection: `name`, `baseUrl`, and `model` are required",
    );
  }
  // Load the row to read llmDefault for the auto-assign-on-first-connection branch.
  const beingRow = await loadTargetRow(target, "being", { summonCtx });
  const { addLlmConnection, assignConnection } = await import(
    "../../present/cognition/llm/connect.js"
  );
  const beingId = String(beingRow._id);
  const connection = await addLlmConnection(
    beingId,
    { name, baseUrl, apiKey: apiKey || "none", model },
    { identity, summonCtx },
  );
  try {
    if (!beingRow.llmDefault) {
      await assignConnection(beingId, "main", connection._id, {
        identity, summonCtx,
      });
    }
  } catch {}
  return { connection };
}

async function updateLlmConnectionHandler({ target, params, identity, summonCtx }) {
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
    { identity, summonCtx },
  );
  return { connection };
}

async function deleteLlmConnectionHandler({ target, params, identity, summonCtx }) {
  const { connectionId } = params || {};
  if (!connectionId)
    throw new Error("delete-llm-connection: `connectionId` is required");
  const { deleteLlmConnection } = await import(
    "../../present/cognition/llm/connect.js"
  );
  await deleteLlmConnection(targetIdOf(target), connectionId, { identity, summonCtx });
  return { removed: true, connectionId };
}

async function assignLlmSlotHandler({ target, params, identity, summonCtx }) {
  const { slot, connectionId } = params || {};
  if (!slot) throw new Error("assign-llm-slot: `slot` is required");
  const kind = detectTargetKind(target);
  const id = targetIdOf(target);
  const { assignConnection, assignSpaceConnection } = await import(
    "../../present/cognition/llm/connect.js"
  );
  if (kind === "being") {
    return assignConnection(id, slot, connectionId || null, {
      identity, summonCtx,
    });
  }
  if (kind === "space" || kind === "stance") {
    return assignSpaceConnection(id, slot, connectionId || null, {
      ownerBeingId: identity?.beingId || null,
      identity,
      summonCtx,
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
  handler: setOnBeingHandler,
});

registerOperation("end-being", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "end-being",
  handler: endBeingHandler,
});

registerOperation("add-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  skipAudit: true,
  handler: addLlmConnectionHandler,
});

registerOperation("update-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  skipAudit: true,
  handler: updateLlmConnectionHandler,
});

registerOperation("delete-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  skipAudit: true,
  handler: deleteLlmConnectionHandler,
});

registerOperation("assign-llm-slot", {
  targets: ["being", "space"],
  ownerExtension: "seed",
  skipAudit: true,
  handler: assignLlmSlotHandler,
});
