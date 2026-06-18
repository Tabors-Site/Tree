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
// `birthBeing`. There is no `create-being` DO op.
//
// These self-register at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { registerRoleWord } from "../../present/word/roleWordRegistry.js";
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
    const branch = moment?.actorAct?.branch || "0";
    const { findByName } = await import("../projections.js");
    const existing = await findByName("being", value, branch);
    if (existing && String(existing.id) !== String(target._id)) {
      throw new Error(`set-being: name "${value}" already taken on branch ${branch}`);
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

  if (field === "defaultRole") {
    if (
      value !== null && value !== undefined &&
      typeof value !== "string"
    ) {
      throw new Error(`set-being: \`defaultRole\` value must be a string or null`);
    }
    return { beingId: String(target._id), defaultRole: value };
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
    const validated = await assertCoordInBounds(target, value, moment?.actorAct?.branch || "0");
    return { beingId: String(target._id), coord: validated };
  }

  throw new Error(
    `set-being: unknown field "${field}". Supported: name, defaultRole, homeSpace, parentBeingId, password, position, coord, qualities.<namespace>[.<innerKey>]`,
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

async function addLlmConnectionHandler({ target, params, identity, moment }) {
  const { name, baseUrl, apiKey, model } = params || {};
  if (!name || !baseUrl || !model) {
    throw new Error(
      "add-llm-connection: `name`, `baseUrl`, and `model` are required",
    );
  }
  // Load the row to read the current main slot for the
  // auto-assign-on-first-connection branch.
  const beingRow = await loadTargetRow(target, "being", { moment });
  const { addLlmConnection, assignConnection } = await import(
    "../../present/cognition/llm/connect.js"
  );
  const beingId = String(beingRow._id);
  const connection = await addLlmConnection(
    beingId,
    { name, baseUrl, apiKey: apiKey || "none", model },
    { identity, moment },
  );
  try {
    const beingLlm =
      beingRow.qualities instanceof Map
        ? beingRow.qualities.get("beingLlm")
        : beingRow.qualities?.beingLlm;
    const currentMain = beingLlm?.slots?.main;
    if (!currentMain) {
      await assignConnection(beingId, "main", connection._id, {
        identity, moment,
      });
    }
  } catch {}
  return { connection };
}

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

registerOperation("end-being", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "end-being",
  args: {},
  handler: endBeingHandler,
});

// ────────────────────────────────────────────────────────────────────
// grant-role / revoke-role
// ────────────────────────────────────────────────────────────────────
//
// Roles are auth (seed/RolesAreAuth.md). A being holds a role by
// being granted it; authorize walks rolesGranted and matches the
// role's canX against the verb+action.
//
// Both ops emit one Fact each on the target being's reel. The being
// reducer (applyRoleGrants in reducerHelpers.js) folds them into
// qualities.rolesGranted:
//   grant-role  → append { role, anchorSpaceId|anchorBeingId, grantedBy, grantedAt }
//   revoke-role → remove the matching tuple (role, anchor*, grantedBy)
//
// Duplicate grants from different grantors live as separate entries,
// each separately revocable. The being holds the role until ALL
// grants of (role, anchor) are revoked.
//
// Auth: the caller's right to grant role X is encoded in their own
// granted roles' canDo: a role with canDo entry `grant-role:X` (or
// `grant-role:*` for super-grantors like angel) permits granting X.
// Same shape for revoke-role:X. This means anyone who has been
// authored as a grantor for X via the canDo declaration on their
// role can hand X out. The chain back to I-Am is structural.

async function grantRoleHandler({ target, params, identity, moment }) {
  // THE CONVERSION: grant-role's validation + record is grant-role.word (caller mode). The
  // .word returns the record; the cut enriches the op params with grantedBy/grantedAt so
  // the dispatcher's auto-emitted grant-role fact carries them (the being reducer reads
  // them from fact.params). JS body = clean-miss fallback.
  const viaWord = await _grantRoleViaWord({ caller: identity?.beingId, target, role: params?.role, anchorSpaceId: params?.anchorSpaceId, anchorBeingId: params?.anchorBeingId, moment });
  if (viaWord) {
    if (params) { params.grantedBy = viaWord.grantedBy; params.grantedAt = viaWord.grantedAt; }
    return viaWord;
  }

  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "grant-role: identity required (the grantor's beingId)",
    );
  }
  if (!params || typeof params !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "grant-role: params required");
  }
  const { role, anchorSpaceId = null, anchorBeingId = null } = params;
  if (typeof role !== "string" || !role.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "grant-role: `role` is required");
  }
  if (!anchorSpaceId && !anchorBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "grant-role: one of `anchorSpaceId` or `anchorBeingId` is required",
    );
  }
  if (anchorSpaceId && anchorBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "grant-role: only one of `anchorSpaceId` or `anchorBeingId` may be set",
    );
  }
  // Validate the role exists in the registry — can't grant a non-role.
  const { getRole } = await import("../../present/roles/registry.js");
  const roleSpec = getRole(role);
  if (!roleSpec) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, `grant-role: role "${role}" is not registered`);
  }
  // Enrich params in-place so the auto-emitted Fact carries the full
  // grant record (grantedBy + grantedAt). The being reducer reads
  // these from fact.params and appends to qualities.rolesGranted.
  // No expiry: wall-clock expiry is a human-time concept the reality
  // has no clock for; a grant lasts until revoked. Time-bound grants
  // arrive with reality-time (moments), not ISO timestamps — see
  // present/roles/acquisition.js.
  const grantedBy = String(identity.beingId);
  const grantedAt = new Date().toISOString();
  params.grantedBy = grantedBy;
  params.grantedAt = grantedAt;
  return {
    granted: true,
    role,
    granteeBeingId: String(targetIdOf(target)),
    anchorSpaceId,
    anchorBeingId,
    grantedBy,
    grantedAt,
  };
}

async function revokeRoleHandler({ target, params, identity, moment }) {
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "revoke-role: identity required (the revoker's beingId)",
    );
  }
  if (!params || typeof params !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "revoke-role: params required");
  }
  const { role, anchorSpaceId = null, anchorBeingId = null, grantedBy = null } = params;
  if (typeof role !== "string" || !role.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "revoke-role: `role` is required");
  }
  if (!anchorSpaceId && !anchorBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "revoke-role: one of `anchorSpaceId` or `anchorBeingId` is required",
    );
  }
  // Enrich grantedBy in-place. grantedBy identifies the SPECIFIC grant
  // to revoke (defaults to the caller's own beingId — revoking my own
  // grant). The being reducer matches on (role, anchor, grantedBy).
  const targetGrantedBy = grantedBy ? String(grantedBy) : String(identity.beingId);
  params.grantedBy = targetGrantedBy;
  return {
    revoked: true,
    role,
    granteeBeingId: String(targetIdOf(target)),
    anchorSpaceId,
    anchorBeingId,
    grantedBy: targetGrantedBy,
  };
}

// grant-role's world strand is grant-role.word (the gates + the role-registry check + the
// record). CALLER mode. Returns {granted, role, granteeBeingId, anchorSpaceId,
// anchorBeingId, grantedBy, grantedAt} or null on a clean miss so the JS body runs.
registerRoleWord("being", "grant-role", new URL("./grant-role.word", import.meta.url));
async function _grantRoleViaWord({ caller, target, role, anchorSpaceId, anchorBeingId, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("being", "grant-role", moment?.actorAct?.branch);
  if (!ir) return null;
  const { grantHostEnv } = await import("./grantHost.js");
  const branch = moment?.actorAct?.branch;
  try {
    const { result } = await runRoleWord(ir, {
      moment, branch,
      trigger: { caller: caller ? String(caller) : null, target: target ? String(targetIdOf(target)) : null, role: role ?? null, anchorSpaceId: anchorSpaceId ?? null, anchorBeingId: anchorBeingId ?? null, branch },
      env: { host: grantHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

registerOperation("grant-role", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "grant-role",
  args: {
    role:          { type: "text", label: "Role to grant",       required: true },
    anchorSpaceId: { type: "text", label: "Anchor space id",     required: false },
    anchorBeingId: { type: "text", label: "Anchor being id",     required: false },
  },
  // The role-walk authorizes the FULL action `grant-role:<role>` so
  // canDo entries can scope grantors per-role: `grant-role:human`
  // grants only human; `grant-role:*` (or bare `grant-role`, the
  // namespace match) is the super-grantor shape. Without this, the
  // per-role contract documented above was never enforced — the walk
  // only ever saw the bare op name, so any grantor could grant ANY
  // role and `grant-role:X` entries matched nothing.
  authAction: ({ params }) =>
    typeof params?.role === "string" && params.role.length
      ? `grant-role:${params.role}`
      : "grant-role",
  handler: grantRoleHandler,
});

registerOperation("revoke-role", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "revoke-role",
  args: {
    role:          { type: "text", label: "Role to revoke",       required: true },
    anchorSpaceId: { type: "text", label: "Anchor space id",      required: false },
    anchorBeingId: { type: "text", label: "Anchor being id",      required: false },
    grantedBy:     { type: "text", label: "Grantor whose grant to revoke (defaults to self)", required: false },
  },
  // Same per-role scoping as grant-role.
  authAction: ({ params }) =>
    typeof params?.role === "string" && params.role.length
      ? `revoke-role:${params.role}`
      : "revoke-role",
  handler: revokeRoleHandler,
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
