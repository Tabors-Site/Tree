// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Connection setup for LLM-flow moments. Everything about which
// voice this being's moment will be spoken in: the catalog of
// possible providers, the rules that decide which one applies at
// this position for this being, and the live client-cache the
// factory line consults before each inference.
//
// I am not part of any moment. I am the catalog and the rule book
// the line opens before it ever calls a provider.
//
// What I own:
//
//   SLOT RULES        Read assignment data off space and being
//                     qualities. Slot names like "main", "scout"
//                     map to connectionIds; flags like
//                     enforced/locked/preferOwn shape the
//                     resolution chain. Sanitized inputs against
//                     prototype pollution + path injection.
//
//   CONNECTIONS CRUD  Per-being LLM connections (entries under
//                     `Being.qualities.llmConnections`, NOT a separate
//                     schema): name + base URL + encrypted API key +
//                     model. Written through set-being facts and folded
//                     like any quality. Add, update, delete, assign-to-
//                     slot, assign-to-space-slot. AES-256-CBC at rest.
//
//   SSRF GATE         Every base URL validated against blocked
//                     hosts and private-IP patterns. Local-LLM
//                     hosts (Ollama, etc.) require explicit opt-
//                     in via `allowedLlmDomains` place config.
//
//   SLOT REGISTRY     Extensions register additional being/space
//                     slots (e.g. "reflect", "scout"). The seed
//                     ships only "main" (being) and "default"
//                     (space).
//
//   CLIENT CACHE      OpenAI-shape clients cached by (beingId,
//                     slot) with TTL eviction. Invalidated when
//                     assignments change.
//
//   RESOLUTION CHAIN  The four-layer chain that picks the
//                     connectionId for a (being, space, slot)
//                     triple at moment-time: lockout > enforcement
//                     > default-chain (position-first) > per-call
//                     override.
//
//   CAPABILITY CHECK  Cheap probe for "does this being have any
//                     LLM available."
//
// Used by:
//   - call.js — the provider-call surround calls into the
//     resolved client to make the actual inference.
//   - runTurn.js — the loop body asks `getClientForBeing` once at
//     the top of each moment.
//   - assemble.js — never reaches in here directly; the frame
//     it renders is voice-agnostic.

import OpenAI from "openai";
import { getInternalConfigValue } from "../../../internalConfig.js";
import crypto from "crypto";
import { randomUUID as uuidv4 } from "node:crypto";
import log from "../../../seedStory/log.js";
import Being from "../../../materials/being/being.js";
import Space from "../../../materials/space/space.js";
import { I } from "../../../materials/being/seedBeings.js";
import { getStoryConfigValue } from "../../../storyConfig.js";
import { getAncestorChain } from "../../../materials/space/ancestorCache.js";
import { actorHistoryFrom } from "../../../past/act/crossOrigin.js";
import {
  resolveAndValidateHost,
  hostInAllowedLlmDomains,
  validateBaseUrl,
} from "./ssrf.js";
// resolveAndValidateHost / hostInAllowedLlmDomains / validateBaseUrl
// are re-exported so external callers (extensions registering custom
// CRUD paths, etc.) still find them on the connect.js surface.
export { resolveAndValidateHost, hostInAllowedLlmDomains };

// Connections live in `Being.qualities.llmConnections` as a Map keyed by
// connection uuid. Each entry is { name, baseUrl, encryptedApiKey, model,
// createdAt, lastUsedAt }. Connections are owned by a being; lookup
// always requires beingId alongside connectionId (no global registry).

let _iAmBeingId = null;
async function getIAmBeingId() {
  if (_iAmBeingId) return _iAmBeingId;
  const { findByName } = await import("../../../materials/projections.js");
  const iAm = await findByName("being", I, "0");
  _iAmBeingId = iAm ? String(iAm.id) : null;
  return _iAmBeingId;
}

function readConnectionsFrom(state) {
  if (!state?.qualities) return {};
  const conns =
    state.qualities instanceof Map
      ? state.qualities.get("llmConnections")
      : state.qualities?.llmConnections;
  return conns || {};
}

// Both readers REQUIRE an explicit `history` argument. No silent
// main-bias — a missing history is a perimeter threading bug and
// must surface loud. loadOrFold walks lineage so sub-branches that
// diverged (e.g. deleted a connection on this history) see the
// history's effective view, not main's.
function _requireHistory(history, hint) {
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      `LLM connection read missing history (${hint}). ` +
        `Pass moment?.actorAct?.history or actorHistoryFrom(moment) — ` +
        `no main-bias default. Every read names its history.`,
    );
  }
  return history;
}

async function readConnection(beingId, connectionId, history) {
  if (!beingId || !connectionId) return null;
  _requireHistory(history, "readConnection");
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("being", beingId, history);
  return readConnectionsFrom(slot?.state)[connectionId] || null;
}

async function readAllConnections(beingId, history) {
  if (!beingId) return {};
  _requireHistory(history, "readAllConnections");
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("being", beingId, history);
  return readConnectionsFrom(slot?.state);
}

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";

let MAX_CONNECTIONS_PER_USER = 15;
export function setMaxConnectionsPerUser(n) {
  MAX_CONNECTIONS_PER_USER = Math.max(1, Math.min(Number(n) || 15, 100));
}
const MAX_NAME_LENGTH = 100;
const MAX_KEY_LENGTH = 500;
const MAX_MODEL_LENGTH = 200;
const MAX_SLOT_NAME_LENGTH = 50;
const SLOT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

let LLM_TIMEOUT_MS = 5 * 60 * 1000;
export function setLlmTimeout(ms) {
  LLM_TIMEOUT_MS = ms;
}
export function getLlmTimeout() {
  return LLM_TIMEOUT_MS;
}

let CLIENT_CACHE_TTL = 5 * 60 * 1000;
export function setClientCacheTtl(ms) {
  CLIENT_CACHE_TTL = ms;
}

const DANGEROUS_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "toString",
  "valueOf",
]);
const MAX_SLOTS = 50;

// ─────────────────────────────────────────────────────────────────────────
// SLOT RULES (assignments)
// ─────────────────────────────────────────────────────────────────────────
//
// Assignment data carries two kinds of fields:
//   Connection fields (which LLM):
//     `default` / `main`  — the primary connection
//     `[slotName]`        — able-specific overrides (e.g. "scout")
//
//   Authority flags (who decides):
//     `enforced`   lock IN this assignment for descendants. Space
//                  enforcement wins over being enforcement when both
//                  apply; both override being.preferOwn.
//     `locked`     lock OUT all LLM usage for descendants. Sovereign,
//                  stops the resolver entirely.
//     `preferOwn`  (being only) invert the chain so the being's own
//                  LLM ranks above the position's.

function sanitizeSlots(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
  const clean = {};
  let count = 0;
  for (const [key, value] of entries) {
    if (count >= MAX_SLOTS) break;
    if (typeof key !== "string" || DANGEROUS_KEYS.has(key)) continue;
    if (value === null || (typeof value === "string" && value.length <= 100)) {
      clean[key] = value;
      count++;
    }
  }
  return clean;
}

function asBool(v) {
  return v === true;
}

/**
 * LLM assignments for a space.
 * Reads `space.qualities.llm.slots` and `space.qualities.llm.enforced`.
 * Returns `{ default, [slot]: connId, enforced }`. `default` reads
 * from `qualities.llm.slots.main` (the slot the "main" assignment
 * writes to).
 */
export function getSpaceLlmAssignments(space) {
  if (!space) return { default: null, enforced: false };
  const meta =
    space.qualities instanceof Map
      ? space.qualities.get("llm")
      : space.qualities?.llm;
  const slots = sanitizeSlots(meta?.slots);
  const result = { ...slots };
  result.default = typeof slots.main === "string" ? slots.main : null;
  result.enforced = asBool(meta?.enforced);
  return result;
}

/**
 * LLM assignments for a being.
 * Reads `being.qualities.beingLlm.slots` and the authority flags.
 * Returns `{ main, [slot]: connId, enforced, locked, preferOwn }`.
 * `main` reads from `qualities.beingLlm.slots.main`.
 */
export function getBeingLlmAssignments(being) {
  if (!being)
    return { main: null, enforced: false, locked: false, preferOwn: false };
  const meta =
    being.qualities instanceof Map
      ? being.qualities.get("beingLlm")
      : being.qualities?.beingLlm;
  const slots = sanitizeSlots(meta?.slots);
  const result = { ...slots };
  result.main = typeof slots.main === "string" ? slots.main : null;
  result.enforced = asBool(meta?.enforced);
  result.locked = asBool(meta?.locked);
  result.preferOwn = asBool(meta?.preferOwn);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION
// ─────────────────────────────────────────────────────────────────────────

export function getEncryptionKey() {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("CUSTOM_LLM_API_SECRET_KEY must be at least 32 characters");
  }
  return Buffer.from(ENCRYPTION_KEY.slice(0, 32));
}

function encrypt(text) {
  if (!text || typeof text !== "string")
    throw new Error("Cannot encrypt: value must be a non-empty string");
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedText) {
  let key;
  try {
    key = getEncryptionKey();
  } catch (e) {
    throw new Error("Cannot decrypt LLM credentials: " + e.message);
  }
  const [ivHex, encrypted] = encryptedText.split(":");
  if (!ivHex || !encrypted)
    throw new Error(
      "Malformed encrypted LLM credential (expected iv:ciphertext)",
    );
  try {
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    throw new Error(
      "Failed to decrypt LLM credential. The encryption key may have changed or the stored credential is corrupted.",
    );
  }
}

// SSRF protection moved to ssrf.js. Imported above.

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────

function validateName(name) {
  if (!name || typeof name !== "string")
    throw new Error("Connection name is required");
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`Connection name must be 1-${MAX_NAME_LENGTH} characters`);
  }
  return trimmed;
}

function validateModel(model) {
  if (!model || typeof model !== "string" || model.length > MAX_MODEL_LENGTH) {
    throw new Error("Invalid model name");
  }
  const safe = model.replace(/[^a-zA-Z0-9\-_\.\/\:]/g, "");
  if (safe.length === 0) {
    throw new Error("Invalid model name after sanitization");
  }
  return safe;
}

function validateApiKey(apiKey, required) {
  if (required) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("API key is required");
    }
  }
  if (apiKey != null) {
    if (typeof apiKey !== "string") throw new Error("Invalid API key");
    if (apiKey.length > MAX_KEY_LENGTH) throw new Error("API key too long");
  }
  return apiKey;
}

function validateConnectionId(connectionId) {
  if (connectionId === null || connectionId === undefined) return null;
  if (typeof connectionId !== "string")
    throw new Error("Invalid connection ID");
  if (connectionId.length > 100) throw new Error("Invalid connection ID");
  return connectionId;
}

// ─────────────────────────────────────────────────────────────────────────
// SLOT REGISTRATION
// ─────────────────────────────────────────────────────────────────────────

// Core being slot. Extensions register additional via registerBeingLlmSlot().
const CORE_BEING_SLOTS = new Set(["main"]);
const _extBeingSlots = new Set();

export function registerBeingLlmSlot(slot) {
  if (
    typeof slot !== "string" ||
    !SLOT_NAME_PATTERN.test(slot) ||
    slot.length > MAX_SLOT_NAME_LENGTH
  ) {
    log.warn(
      "LLM",
      `Invalid being LLM slot name rejected: ${String(slot).slice(0, 50)}`,
    );
    return;
  }
  _extBeingSlots.add(slot);
}

function isValidUserSlot(slot) {
  return (
    typeof slot === "string" &&
    (CORE_BEING_SLOTS.has(slot) || _extBeingSlots.has(slot))
  );
}

export function getAllBeingLlmSlots() {
  return [...CORE_BEING_SLOTS, ..._extBeingSlots];
}

// Core space slot. Extensions register additional via registerRootSpaceLlmSlot().
const CORE_ROOT_SLOTS = new Set(["default"]);
const _extRootSlots = new Set();

export function registerRootSpaceLlmSlot(slot) {
  if (
    typeof slot !== "string" ||
    !SLOT_NAME_PATTERN.test(slot) ||
    slot.length > MAX_SLOT_NAME_LENGTH
  ) {
    log.warn(
      "LLM",
      `Invalid root LLM slot name rejected: ${String(slot).slice(0, 50)}`,
    );
    return;
  }
  _extRootSlots.add(slot);
}

export function isValidRootLlmSlot(slot) {
  return (
    typeof slot === "string" &&
    (CORE_ROOT_SLOTS.has(slot) || _extRootSlots.has(slot))
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CLIENT CACHE
// ─────────────────────────────────────────────────────────────────────────
//
// Cache key shapes:
//   `${beingId}:${slot}` — normal slot-based resolution
//   `conn:${connectionId}` — override path
//   `place:${slot}` — place-level default fallback

const beingClientCache = new Map();

setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of beingClientCache) {
      if (now - entry.fetchedAt > CLIENT_CACHE_TTL * 2)
        beingClientCache.delete(key);
    }
  },
  10 * 60 * 1000,
).unref();

/** Clear cached client(s) for a being. Call when their LLM config changes. */
export function clearBeingClientCache(beingId) {
  for (const key of beingClientCache.keys()) {
    if (key === beingId || key.startsWith(beingId + ":")) {
      beingClientCache.delete(key);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CONNECTIONS CRUD
// ─────────────────────────────────────────────────────────────────────────

// Helper signature pattern: (beingId, spec, { identity } = {})
//
// These CRUD helpers (resolveConnectionSpec / resolveConnectionUpdate / resolveConnectionRemoval)
// are now the host FLOOR the llm-connection `.word`s call (store/words/llm-connection/llmHost.js):
// validate the spec, mint the uuid (add), encrypt the key, bake the set-being params — laying NO
// fact. The `.word` lays the fact (the dispatcher's one stamp for update/delete; add's deeds via
// runWordToStore). NO skipAudit anymore. Identity threads through for attribution.

// resolveConnectionSpec — the NON-EMITTING floor of add-llm-connection: load the
// being, enforce the cap, validate name/model/key, SSRF-gate the base URL, encrypt
// the key, mint the id, and bake the set-being params. Lays NO fact. ONE kernel,
// TWO callers (the "no reimplementation" rule, E6): the legacy addLlmConnection
// below calls it then self-emits via doVerb; add-llm-connection.word's host `see`
// resolve-connection calls it and returns setBeingParams as factParams so the
// DISPATCHER lays the one do:set-being. The chain holds ciphertext only (encrypt()
// here); redact.js strips qualities.llmConnections from every wire surface.
export async function resolveConnectionSpec(
  beingId,
  { name, baseUrl, apiKey, model },
  { moment } = {},
) {
  // loadOrFold: a being inherited from main onto a sub-branch resolves via
  // lineage cold-fold. Bare loadProjection returned null and threw "Being not
  // found" for LLM-config writes against inherited beings.
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("being", beingId, actorHistoryFrom(moment));
  if (!slot) throw new Error("Being not found");
  const being = { _id: slot.id, ...slot.state };

  const existing = readConnectionsFrom(being);
  if (Object.keys(existing).length >= MAX_CONNECTIONS_PER_USER) {
    throw new Error(
      `Maximum of ${MAX_CONNECTIONS_PER_USER} connections reached`,
    );
  }

  const safeName = validateName(name);
  const safeModel = validateModel(model);
  // apiKey is optional — local LLMs (Ollama, llama.cpp, etc.) commonly
  // accept no auth. Validation still enforces length and string type.
  validateApiKey(apiKey, false);
  const safeBaseUrl = validateBaseUrl(baseUrl);

  // SSRF protection — every connection validated against the allowlist.
  const hostname = new URL(safeBaseUrl).hostname;
  if (!hostInAllowedLlmDomains(hostname)) {
    await resolveAndValidateHost(hostname);
  }

  const connectionId = uuidv4();
  const conn = {
    name: safeName,
    baseUrl: safeBaseUrl,
    encryptedApiKey: apiKey ? encrypt(apiKey) : null,
    model: safeModel,
    createdAt: new Date(),
    lastUsedAt: null,
  };

  // isFirst: the being has no LIVE `main` slot yet → add.word's conditional assign-to-main
  // fires (the auto-assign as its OWN word/moment, not a buried second verb). LIVE matters:
  // a main pointing at a DELETED connection counts as empty — which is exactly why delete
  // can drop its slot-clears run-on (the dangling slot ref FOLDS to absent right here).
  const beingLlmMeta =
    being.qualities instanceof Map
      ? being.qualities.get("beingLlm")
      : being.qualities?.beingLlm;
  const mainSlot = beingLlmMeta?.slots?.main;
  const isFirst = !mainSlot || !existing[mainSlot];

  return {
    connectionId,
    conn,
    beingId: String(being._id),
    isFirst,
    setBeingParams: {
      field: `qualities.llmConnections.${connectionId}`,
      value: conn,
    },
  };
}

export async function addLlmConnection(
  beingId,
  { name, baseUrl, apiKey, model },
  { identity, moment } = {},
) {
  const {
    connectionId,
    conn,
    beingId: bid,
    setBeingParams,
  } = await resolveConnectionSpec(
    beingId,
    { name, baseUrl, apiKey, model },
    { moment },
  );

  const { doVerb } = await import("../../../ibp/verbs/do.js");
  await doVerb(
    { kind: "being", id: bid },
    "set-being",
    setBeingParams,
    identity ? { identity, moment } : { identity: I, moment },
  );

  return {
    _id: connectionId,
    name: conn.name,
    baseUrl: conn.baseUrl,
    model: conn.model,
  };
}

// resolveConnectionUpdate — the NON-EMITTING floor of update-llm-connection: load the
// being, find the connection, validate + SSRF-gate + re-encrypt only the CHANGED fields,
// and bake the merged set-being params. Lays NO fact. ONE kernel, TWO callers (E6): the
// legacy updateLlmConnection below self-emits via doVerb; update-llm-connection.word's
// host see resolve-connection-update returns setBeingParams as factParams so the
// DISPATCHER lays the one do:set-being. `noChange` (no field given) is for non-op callers
// — the op path always sends baseUrl+model, so from the op it always changes. `wasAssigned`
// flags the post-fact client-cache bust.
export async function resolveConnectionUpdate(
  beingId,
  connectionId,
  { name, baseUrl, apiKey, model },
  { moment } = {},
) {
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("being", beingId, actorHistoryFrom(moment));
  if (!slot) throw new Error("Being not found");
  const being = { _id: slot.id, ...slot.state };

  const safeConnId = validateConnectionId(connectionId);
  const existing = readConnectionsFrom(being)[safeConnId];
  if (!existing) throw new Error("Connection not found");

  const update = {};
  if (baseUrl !== undefined) {
    const safeBaseUrl = validateBaseUrl(baseUrl);
    const hostname = new URL(safeBaseUrl).hostname;
    if (!hostInAllowedLlmDomains(hostname)) {
      await resolveAndValidateHost(hostname);
    }
    update.baseUrl = safeBaseUrl;
  }
  if (model !== undefined) update.model = validateModel(model);
  if (name !== undefined && name !== null) update.name = validateName(name);
  if (apiKey) {
    validateApiKey(apiKey, false);
    update.encryptedApiKey = encrypt(apiKey);
  }

  const merged = { ...existing, ...update };
  const beingLlmMeta =
    being.qualities instanceof Map
      ? being.qualities.get("beingLlm")
      : being.qualities?.beingLlm;
  const beingSlots = beingLlmMeta?.slots || {};
  return {
    connectionId: safeConnId,
    merged,
    beingId: String(being._id),
    noChange: Object.keys(update).length === 0,
    wasAssigned: Object.values(beingSlots).includes(connectionId),
    setBeingParams: {
      field: `qualities.llmConnections.${safeConnId}`,
      value: merged,
    },
  };
}

export async function updateLlmConnection(
  beingId,
  connectionId,
  { name, baseUrl, apiKey, model },
  { identity, moment } = {},
) {
  const r = await resolveConnectionUpdate(
    beingId,
    connectionId,
    { name, baseUrl, apiKey, model },
    { moment },
  );
  if (r.noChange) {
    return {
      _id: r.connectionId,
      name: r.merged.name,
      baseUrl: r.merged.baseUrl,
      model: r.merged.model,
    };
  }
  const { doVerb } = await import("../../../ibp/verbs/do.js");
  await doVerb(
    { kind: "being", id: r.beingId },
    "set-being",
    r.setBeingParams,
    identity ? { identity, moment } : { identity: I, moment },
  );
  if (r.wasAssigned) clearBeingClientCache(beingId);
  return {
    _id: r.connectionId,
    name: r.merged.name,
    baseUrl: r.merged.baseUrl,
    model: r.merged.model,
  };
}

// resolveConnectionRemoval — the NON-EMITTING floor of delete-llm-connection: load the
// being, confirm the connection exists, and bake the set-being params that UNSET it
// (value:null → setDeepPath delete). ONE fact (the spacebar lift). ONE kernel, TWO callers
// (E6): the legacy deleteLlmConnection below self-emits via doVerb; delete-llm-connection.word's
// host see returns setBeingParams as factParams so the DISPATCHER lays the one do:set-being.
export async function resolveConnectionRemoval(
  beingId,
  connectionId,
  { moment } = {},
) {
  const safeConnId = validateConnectionId(connectionId);
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("being", beingId, actorHistoryFrom(moment));
  if (!slot) throw new Error("Being not found");
  const being = { _id: slot.id, ...slot.state };

  const conn = readConnectionsFrom(being)[safeConnId];
  if (!conn) throw new Error("Connection not found");

  return {
    connectionId: safeConnId,
    beingId: String(being._id),
    setBeingParams: {
      field: `qualities.llmConnections.${safeConnId}`,
      value: null,
    },
  };
}

export async function deleteLlmConnection(
  beingId,
  connectionId,
  { identity, moment } = {},
) {
  const r = await resolveConnectionRemoval(beingId, connectionId, { moment });
  const { doVerb } = await import("../../../ibp/verbs/do.js");
  await doVerb(
    { kind: "being", id: r.beingId },
    "set-being",
    r.setBeingParams,
    identity ? { identity, moment } : { identity: I, moment },
  );
  clearBeingClientCache(beingId);

  // ONE fact — the slot-clears run-on is DROPPED (cleaned proper, the spacebar). A slot
  // (incl. "main") pointing at the deleted connection is a dangling ref: the LLM-resolution
  // chain (chain.js) falls through gracefully when a connectionId no longer resolves, and
  // resolveConnectionSpec's `isFirst` treats a dangling main as empty (so a re-add
  // auto-assigns). Facts are the truth, readers fold on demand — no eager cascade.
  return { removed: true };
}

export async function assignConnection(
  beingId,
  slot,
  connectionId,
  { identity, moment } = {},
) {
  if (!isValidUserSlot(slot)) {
    throw new Error("Invalid assignment slot: " + slot);
  }

  const safeConnId = validateConnectionId(connectionId);
  const history = actorHistoryFrom(moment);

  if (safeConnId) {
    const conn = await readConnection(beingId, safeConnId, history);
    if (!conn) throw new Error("Connection not found");
  }

  // loadOrFold: same inherited-being lineage-cold-fold rationale.
  const { loadOrFold } = await import("../../../materials/projections.js");
  const beingSlot = await loadOrFold("being", beingId, history);
  if (!beingSlot) throw new Error("Being not found");
  const being = { _id: beingSlot.id, ...beingSlot.state };

  const { doVerb } = await import("../../../ibp/verbs/do.js");
  const opts = identity ? { identity, moment } : { identity: I, moment };

  // All slots (including "main") route through
  // qualities.beingLlm.slots.<slot>. do.set carries the write; the
  // reducer's applySetQualities writes the projection.
  await doVerb(
    { kind: "being", id: String(being._id) },
    "set-being",
    { field: `qualities.beingLlm.slots.${slot}`, value: safeConnId },
    opts,
  );

  clearBeingClientCache(beingId);

  return { slot, connectionId: safeConnId };
}

/**
 * Space-scope counterpart to `assignConnection`. Writes the
 * tree-level step of the resolution chain. All slots (including
 * "main") write to `space.qualities.llm.slots.<slot>`. Pass
 * `connectionId: null` to clear.
 */
export async function assignSpaceConnection(
  spaceId,
  slot,
  connectionId,
  { ownerBeingId, identity, moment } = {},
) {
  if (!isValidUserSlot(slot)) {
    throw new Error("Invalid assignment slot: " + slot);
  }
  const safeConnId = validateConnectionId(connectionId);
  const history = actorHistoryFrom(moment, "assignSpaceConnection");

  if (safeConnId) {
    // With qualities-based storage, connections are scoped to a being —
    // ownership lookup requires the owner's beingId. Seed-internal
    // callers without ownerBeingId trust the caller (gate happens
    // upstream); operator callers supply ownerBeingId from their
    // identity so the check runs.
    if (ownerBeingId) {
      const conn = await readConnection(ownerBeingId, safeConnId, history);
      if (!conn) throw new Error("Connection not found");
    }
  }

  const { loadProjection: _lPspace } =
    await import("../../../materials/projections.js");
  const _sSlot = await _lPspace("space", spaceId, "0");
  if (!_sSlot) throw new Error("Space not found");
  const space = { _id: _sSlot.id, ...(_sSlot.state || {}) };

  const { doVerb } = await import("../../../ibp/verbs/do.js");
  const opts = identity ? { identity, moment } : { identity: I, moment };

  // All slots (including "main") write to qualities.llm.slots.<slot>.
  // do.set carries the write; null clears.
  const spaceTarget = { kind: "space", id: String(space._id) };
  await doVerb(
    spaceTarget,
    "set-space",
    { field: `qualities.llm.slots.${slot}`, value: safeConnId },
    opts,
  );

  return { spaceId: String(spaceId), slot, connectionId: safeConnId };
}

// resolveSlotAssignment — the NON-EMITTING floor of assign-llm-slot. Validates the slot and
// (for a real connectionId) that the connection exists, loads the target, and bakes the set
// params + the branch flags (being → qualities.beingLlm.slots.<slot>; space/stance →
// qualities.llm.slots.<slot>). Lays NO fact. assign-llm-slot.word's host see uses it and the
// `.word` issues the ONE deed the branch selects (do set-being / do set-space). connectionId:null
// clears the slot. ADDITIVE — the legacy assignConnection/assignSpaceConnection keep self-emitting
// for any direct callers; a dedup is a follow-up.
export async function resolveSlotAssignment(
  targetId,
  kind,
  slot,
  connectionId,
  { caller, moment } = {},
) {
  if (!isValidUserSlot(slot))
    throw new Error("Invalid assignment slot: " + slot);
  const safeConnId = validateConnectionId(connectionId);
  const history = actorHistoryFrom(moment, "resolveSlotAssignment");
  const id = String(targetId);

  if (kind === "being") {
    if (safeConnId) {
      const conn = await readConnection(id, safeConnId, history);
      if (!conn) throw new Error("Connection not found");
    }
    const { loadOrFold } = await import("../../../materials/projections.js");
    const beingSlot = await loadOrFold("being", id, history);
    if (!beingSlot) throw new Error("Being not found");
    return {
      isBeing: true,
      isSpace: false,
      id: String(beingSlot.id),
      slot,
      connectionId: safeConnId,
      field: `qualities.beingLlm.slots.${slot}`,
      value: safeConnId,
    };
  }

  // space / stance — the connection is owned by a being, so the caller supplies ownership.
  if (safeConnId && caller) {
    const conn = await readConnection(String(caller), safeConnId, history);
    if (!conn) throw new Error("Connection not found");
  }
  const { loadProjection } = await import("../../../materials/projections.js");
  const sSlot = await loadProjection("space", id, "0");
  if (!sSlot) throw new Error("Space not found");
  return {
    isBeing: false,
    isSpace: true,
    id: String(sSlot.id),
    slot,
    connectionId: safeConnId,
    field: `qualities.llm.slots.${slot}`,
    value: safeConnId,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CONNECTION → CLIENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a client entry from a specific connectionId on a specific
 * being. Returns the entry on success, null if the connection is
 * missing / invalid or its baseUrl fails the SSRF gate.
 *
 * History is REQUIRED — either via moment.actorAct.history (the
 * normal moment path) or an explicit opts.history (cache-warming
 * call sites). No silent main-bias.
 *
 * @param {string} beingId       owner of the connection
 * @param {string} connectionId  uuid key within being.qualities.llmConnections
 * @param {string} [cacheKey]    optional cache key to memoize the entry
 * @param {object} opts
 * @param {object} [opts.moment]  moment's ctx (history read off actorAct)
 * @param {string} [opts.history]    explicit override for non-moment callers
 */
export async function resolveConnection(
  beingId,
  connectionId,
  cacheKey,
  { moment, history } = {},
) {
  const resolvedHistory =
    history || actorHistoryFrom(moment, "resolveConnection");
  const conn = await readConnection(beingId, connectionId, resolvedHistory);
  // baseUrl is required; encryptedApiKey is optional (local LLMs like
  // Ollama / llama.cpp commonly need no auth).
  if (!conn || !conn.baseUrl) return null;

  try {
    const hostname = new URL(conn.baseUrl).hostname;
    if (!hostInAllowedLlmDomains(hostname)) {
      await resolveAndValidateHost(hostname);
    }
  } catch (err) {
    log.error(
      "LLM",
      `Blocked custom LLM connection ${connectionId}: ${err.message}`,
    );
    return null;
  }

  // Empty/missing key → empty string. The OpenAI SDK accepts this for
  // local LLMs that don't authenticate.
  const apiKey = conn.encryptedApiKey ? decrypt(conn.encryptedApiKey) : "";
  let baseURL = conn.baseUrl.replace(/\/+$/, "");
  if (baseURL.endsWith("/chat/completions")) {
    baseURL = baseURL.replace(/\/chat\/completions$/, "");
  }

  const entry = {
    client: new OpenAI({
      baseURL,
      apiKey,
      // SDK-side retry disabled. callWithFailover in call.js handles
      // retry decisions against our own RETRYABLE_CODES set so we can
      // fast-fail on deterministic backend parse failures (500 from
      // local inference stacks) instead of burning 15 minutes retrying.
      maxRetries: 0,
      timeout: LLM_TIMEOUT_MS,
      defaultHeaders: {
        "HTTP-Referer":
          getStoryConfigValue("storyUrl") ||
          `http://localhost:${process.env.PORT || 3000}`,
        "X-OpenRouter-Title": "TreeOS",
        "X-OpenRouter-Categories": "personal-agent,general-chat",
      },
    }),
    model: conn.model || null,
    isCustom: true,
    connectionId,
    fetchedAt: Date.now(),
  };

  if (cacheKey) beingClientCache.set(cacheKey, entry);

  // lastUsedAt — Fact on the being's reel. Joins the caller's moment's
  // ΔF so the touch commits atomically with whatever the moment is
  // doing. No fire-and-forget (that would have committed outside the
  // moment, which is no longer a legal path). The fact is observability
  // — the LLM call doesn't depend on it succeeding — so a missing
  // moment is silently skipped rather than erroring.
  if (moment?.actId) {
    try {
      // loadOrFold: same inherited-being lineage-cold-fold rationale.
      const { loadOrFold } = await import("../../../materials/projections.js");
      const slot = await loadOrFold("being", beingId, actorHistoryFrom(moment));
      if (slot) {
        const { doVerb } = await import("../../../ibp/verbs/do.js");
        await doVerb(
          { kind: "being", id: String(slot.id) },
          "set-being",
          {
            field: `qualities.llmConnections.${connectionId}.lastUsedAt`,
            value: new Date().toISOString(),
          },
          { identity: I, moment },
        );
      }
    } catch (err) {
      log.debug("LLM", `lastUsedAt write skipped: ${err.message}`);
    }
  }

  return entry;
}

/**
 * Resolve the LLM client for a being on a specific history. Chain:
 *   1. overrideConnectionId (from a tree's able-slot resolution)
 *   2. being slot assignment (qualities.beingLlm.slots[slot])
 *   3. being main slot (qualities.beingLlm.slots.main), if slot
 *      wasn't already "main"
 *   4. place-level default (storyLlmConnection)
 *   5. noLlm sentinel
 *
 * Branch is REQUIRED — every read walks the being's effective view
 * on that history via loadOrFold. No silent main-bias.
 *
 * Returns `{ client, model, isCustom, connectionId, noLlm?, fetchedAt }`.
 */
export async function getClientForBeing(
  beingId,
  slot,
  overrideConnectionId,
  history,
) {
  if (!beingId) {
    return {
      client: null,
      model: null,
      isCustom: false,
      connectionId: null,
      noLlm: true,
      fetchedAt: Date.now(),
    };
  }
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      "getClientForBeing: history is required. Pass actorHistoryFrom(moment) " +
        "or the explicit history the read is happening on — no main-bias default.",
    );
  }

  slot = slot || "main";

  // 1. Override (e.g. from a root's able-slot resolution). Highest priority.
  if (overrideConnectionId) {
    const overrideCacheKey = "conn:" + overrideConnectionId + ":" + history;
    const overrideCached = beingClientCache.get(overrideCacheKey);
    if (
      overrideCached &&
      Date.now() - overrideCached.fetchedAt < CLIENT_CACHE_TTL
    ) {
      return overrideCached;
    }
    try {
      const overrideEntry = await resolveConnection(
        beingId,
        overrideConnectionId,
        overrideCacheKey,
        { history },
      );
      if (overrideEntry) return overrideEntry;
    } catch (err) {
      log.error(
        "LLM",
        `Failed to resolve override connection ${overrideConnectionId}: ${err.message}`,
      );
    }
  }

  // 2 + 3. Slot-based resolution from qualities.beingLlm.slots.
  // Cache key includes history so divergent views don't share entries.
  const cacheKey = beingId + ":" + slot + ":" + history;
  const cached = beingClientCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CLIENT_CACHE_TTL) {
    return cached;
  }

  try {
    const { loadOrFold } = await import("../../../materials/projections.js");
    const slotProj = await loadOrFold("being", beingId, history);
    const being = slotProj ? { _id: slotProj.id, ...slotProj.state } : null;
    const quals = being?.qualities || {};
    const extSlots = quals?.beingLlm?.slots || {};
    let connectionId = extSlots[slot] || null;

    // Fall back to the "main" slot if the requested slot has no
    // assignment of its own.
    if (!connectionId && slot !== "main") {
      connectionId = extSlots.main || null;
    }

    if (connectionId) {
      const entry = await resolveConnection(beingId, connectionId, cacheKey, {
        history,
      });
      if (entry) return entry;
    }
  } catch (err) {
    log.error(
      "LLM",
      `Failed to load custom LLM for being ${beingId}: ${err.message}`,
    );
  }

  // 4. Story-level default. The `storyLlmConnection` config key
  // holds the connectionId; the connection record itself lives on
  // the root operator's qualities (that's where `add-llm` writes,
  // since the BE op runs as the caller). Earlier doctrine said the
  // connection lived on I — that's where this lookup used to
  // probe — but add-llm has always written to the caller's being.
  // Resolving from the operator matches what the install side
  // actually does and avoids the silent-noLlm trap.
  try {
    const storyLlmId = getStoryConfigValue("storyLlmConnection");
    if (storyLlmId) {
      const { findRootOperator } =
        await import("../../../materials/being/identity.js");
      const operator = await findRootOperator();
      if (operator?._id) {
        const storyCacheKey = "place:" + slot + ":" + history;
        const storyCached = beingClientCache.get(storyCacheKey);
        if (
          storyCached &&
          Date.now() - storyCached.fetchedAt < CLIENT_CACHE_TTL
        ) {
          return storyCached;
        }
        const storyEntry = await resolveConnection(
          String(operator._id),
          storyLlmId,
          storyCacheKey,
          { history },
        );
        if (storyEntry) return storyEntry;
      }
    }
  } catch (err) {
    log.error("LLM", `Failed to resolve story default LLM: ${err.message}`);
  }

  // 5. No LLM available. Cache the sentinel so we don't re-walk.
  const noLlmEntry = {
    client: null,
    model: null,
    isCustom: false,
    connectionId: null,
    noLlm: true,
    fetchedAt: Date.now(),
  };
  beingClientCache.set(cacheKey, noLlmEntry);
  return noLlmEntry;
}

// Resolution chain (the 7-step walk) lives in resolution.js. The
// slot-rule readers (getSpaceLlmAssignments / getBeingLlmAssignments)
// stay here because they're projections of the qualities shape;
// resolution.js imports them.
export { resolveLlmConnectionChain } from "./resolution.js";

// ─────────────────────────────────────────────────────────────────────────
// CAPABILITY CHECK
// ─────────────────────────────────────────────────────────────────────────

/**
 * Does this being have any LLM available? True if they have a default
 * assigned, any saved connections, or a place-level default exists.
 */
export async function beingHasLlm(beingId) {
  if (!beingId) return false;
  const { loadProjection } = await import("../../../materials/projections.js");
  const slot = await loadProjection("being", beingId, "0");
  const state = slot?.state || {};
  const beingQuals = state?.qualities || {};
  const beingLlm = beingQuals?.beingLlm?.slots || {};
  if (beingLlm.main) return true;
  const conns = readConnectionsFrom(state);
  if (Object.keys(conns).length > 0) return true;
  return !!getStoryConfigValue("storyLlmConnection");
}
