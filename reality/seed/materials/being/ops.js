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
import Being from "./being.js";
import { detectTargetKind, targetIdOf } from "../_targetShape.js";

const RESERVED_SET_META_NS = new Set([
  "inbox", // per-being inbox; written through SUMMON
]);

// ─────────────────────────────────────────────────────────────────────
// set-being
// ─────────────────────────────────────────────────────────────────────
//
// params: { field, value, merge=true }
// field paths:
//   "name" / "operatingMode" / "roles" / "defaultRole" / "homeSpace" /
//   "llmDefault" / "parentBeingId"                  → schema-field writes
//   "qualities.<namespace>"                          → set/merge that namespace
//   "qualities.<namespace>.<innerKey>"               → merge one inner key
//   value=null on a qualities path                   → unset

async function setOnBeingHandler({ target, params }) {
  const { field, value, merge = true } = params || {};
  if (!field || typeof field !== "string") {
    throw new Error("set-being: `field` is required");
  }
  const kind = detectTargetKind(target);
  if (kind !== "being") {
    throw new Error(
      `set-being: target must be a Being (got ${kind})`,
    );
  }

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
    const existing = await Being.findOne({ name: value }).select("_id");
    if (existing && String(existing._id) !== String(target._id)) {
      throw new Error(`set-being: name "${value}" already taken`);
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
    field === "operatingMode" ||
    field === "roles" ||
    field === "defaultRole" ||
    field === "homeSpace"
  ) {
    if (field === "roles" && value !== null && !Array.isArray(value)) {
      throw new Error("set-being: `roles` value must be an array or null");
    }
    if (
      field !== "roles" &&
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

  throw new Error(
    `set-being: unknown field "${field}". Supported: name, operatingMode, roles, defaultRole, homeSpace, llmDefault, parentBeingId, password, qualities.<namespace>[.<innerKey>]`,
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
// the seed/present/voices/llm/connect.js helpers behind the IBP
// grammar so operators / CLI clients have a single dispatch surface.
//
// `skipAudit: true` on every op because the helpers route their
// writes through `do.set-being`, and the inner set IS the canonical
// audit Fact. Without skipAudit the outer op would double-stamp.

async function addLlmConnectionHandler({ target, params, identity }) {
  const { name, baseUrl, apiKey, model } = params || {};
  if (!name || !baseUrl || !model) {
    throw new Error(
      "add-llm-connection: `name`, `baseUrl`, and `model` are required",
    );
  }
  const { addLlmConnection, assignConnection } = await import(
    "../../present/voices/llm/connect.js"
  );
  const beingId = String(target._id);
  const connection = await addLlmConnection(
    beingId,
    { name, baseUrl, apiKey: apiKey || "none", model },
    { identity },
  );
  // If this is the Being's first connection, auto-assign it to the
  // default `main` slot so subsequent runTurn calls find an LLM.
  try {
    if (!target.llmDefault) {
      await assignConnection(beingId, "main", connection._id);
    }
  } catch {}
  return { connection };
}

async function updateLlmConnectionHandler({ target, params, identity }) {
  const { connectionId, name, baseUrl, apiKey, model } = params || {};
  if (!connectionId)
    throw new Error("update-llm-connection: `connectionId` is required");
  if (!baseUrl || !model) {
    throw new Error(
      "update-llm-connection: `baseUrl` and `model` are required",
    );
  }
  const { updateLlmConnection } = await import(
    "../../present/voices/llm/connect.js"
  );
  const connection = await updateLlmConnection(
    String(target._id),
    connectionId,
    { name, baseUrl, apiKey, model },
    { identity },
  );
  return { connection };
}

async function deleteLlmConnectionHandler({ target, params, identity }) {
  const { connectionId } = params || {};
  if (!connectionId)
    throw new Error("delete-llm-connection: `connectionId` is required");
  const { deleteLlmConnection } = await import(
    "../../present/voices/llm/connect.js"
  );
  await deleteLlmConnection(String(target._id), connectionId, { identity });
  return { removed: true, connectionId };
}

// Bind an LLM slot to a connection (or unbind by passing null).
// Polymorphic across Being and Space targets — the resolution chain
// walks both, so slot assignment lives at both:
//
//   Being target → Being.llmDefault (slot="main") or
//                  Being.qualities.beingLlm.slots.<slot>
//   Space target → Space.llmDefault (slot="main") or
//                  Space.qualities.llm.slots.<slot>
async function assignLlmSlotHandler({ target, params, identity }) {
  const { slot, connectionId } = params || {};
  if (!slot) throw new Error("assign-llm-slot: `slot` is required");
  const kind = detectTargetKind(target);
  const { assignConnection, assignSpaceConnection } = await import(
    "../../present/voices/llm/connect.js"
  );
  if (kind === "being") {
    return assignConnection(String(target._id), slot, connectionId || null, {
      identity,
    });
  }
  const spaceId = targetIdOf(target);
  if (!spaceId)
    throw new Error("assign-llm-slot: target must resolve to a space id");
  return assignSpaceConnection(spaceId, slot, connectionId || null, {
    ownerBeingId: identity?.beingId || null,
    identity,
  });
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
