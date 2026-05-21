// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// LLM connection resolution + per-being client cache.
//
// Given a being and (optionally) a role + tree, returns the OpenAI-shape
// client configured for the right model + API key + base URL. The
// resolution chain walks: override → being slot → being default →
// land default → no-LLM. A fifth step ("summoner's home being") is
// reserved for cross-land fallback — see [[project_llm_on_being_retires_proxy]].
//
// The cache is keyed by (beingId, slot) for normal resolution and by
// ("conn:" + connectionId) for override paths, with TTL-based expiry.
// `clearBeingClientCache(beingId)` invalidates after an LLM-config
// change.
//
// API-key decryption uses the unified encryption key from connections.js.
// Every custom-connection baseUrl is validated against the SSRF host
// allowlist before the client is built; bad hosts surface as a "Blocked
// custom LLM connection" log entry and fall through to the next step in
// the chain. Local-LLM-style usage (Ollama, etc.) requires whitelisting
// the host via `allowedLlmDomains` in land config.

import OpenAI from "openai";
import log from "../system/log.js";
import crypto from "crypto";
import Being from "../models/being.js";
import Space from "../models/space.js";
import LlmConnection from "../models/llmConnection.js";
import { getLandConfigValue } from "../landConfig.js";
import { getAncestorChain } from "../space/ancestorCache.js";
import { getSpaceLlmAssignments, getBeingLlmAssignments } from "./assignments.js";
import { resolveAndValidateHost, hostInAllowedLlmDomains, getEncryptionKey } from "./connections.js";

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-cbc";

let LLM_TIMEOUT_MS = 5 * 60 * 1000; // 5 min default
export function setLlmTimeout(ms) { LLM_TIMEOUT_MS = ms; }
export function getLlmTimeout() { return LLM_TIMEOUT_MS; }

let CLIENT_CACHE_TTL = 5 * 60 * 1000; // 5 min
export function setClientCacheTtl(ms) { CLIENT_CACHE_TTL = ms; }

// ─────────────────────────────────────────────────────────────────────────
// API KEY DECRYPTION
// ─────────────────────────────────────────────────────────────────────────

function decrypt(encryptedText) {
  let key;
  try {
    key = getEncryptionKey();
  } catch (e) {
    throw new Error("Cannot decrypt LLM credentials: " + e.message);
  }
  const [ivHex, encrypted] = encryptedText.split(":");
  if (!ivHex || !encrypted) throw new Error("Malformed encrypted LLM credential (expected iv:ciphertext)");
  try {
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    throw new Error("Failed to decrypt LLM credential. The encryption key may have changed or the stored credential is corrupted.");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CLIENT CACHE
// ─────────────────────────────────────────────────────────────────────────

// Cache key shapes:
//   `${beingId}:${slot}` — normal slot-based resolution
//   `conn:${connectionId}` — override path
//   `land:${slot}` — land-level default fallback
const beingClientCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of beingClientCache) {
    if (now - entry.fetchedAt > CLIENT_CACHE_TTL * 2) beingClientCache.delete(key);
  }
}, 10 * 60 * 1000).unref();

/** Clear cached client(s) for a being. Call when their LLM config changes. */
export function clearBeingClientCache(beingId) {
  for (const key of beingClientCache.keys()) {
    if (key === beingId || key.startsWith(beingId + ":")) {
      beingClientCache.delete(key);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CONNECTION → CLIENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a client entry from a specific connectionId. Returns the entry
 * on success, null if the connection is missing/invalid or its baseUrl
 * fails the SSRF gate.
 */
async function resolveConnection(connectionId, cacheKey) {
  const conn = await LlmConnection.findById(connectionId).lean();
  // baseUrl is required; encryptedApiKey is optional (local LLMs like
  // Ollama / llama.cpp commonly need no auth).
  if (!conn || !conn.baseUrl) return null;

  try {
    const hostname = new URL(conn.baseUrl).hostname;
    if (!hostInAllowedLlmDomains(hostname)) {
      await resolveAndValidateHost(hostname);
    }
  } catch (err) {
    log.error("LLM", `Blocked custom LLM connection ${connectionId}: ${err.message}`);
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
      // SDK-side retry disabled. callWithFailover in runChat.js handles
      // retry decisions against our own RETRYABLE_CODES set so we can
      // fast-fail on deterministic backend parse failures (500 from
      // local inference stacks) instead of burning 15 minutes retrying.
      maxRetries: 0,
      timeout: LLM_TIMEOUT_MS,
      defaultHeaders: {
        "HTTP-Referer": getLandConfigValue("landUrl") || `http://localhost:${process.env.PORT || 3000}`,
        "X-OpenRouter-Title": "TreeOS",
        "X-OpenRouter-Categories": "personal-agent,general-chat",
      },
    }),
    model:        conn.model || null,
    isCustom:     true,
    connectionId: conn._id,
    fetchedAt:    Date.now(),
  };

  if (cacheKey) beingClientCache.set(cacheKey, entry);

  LlmConnection.updateOne(
    { _id: conn._id },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => {});

  return entry;
}

// ─────────────────────────────────────────────────────────────────────────
// RESOLUTION CHAIN
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve the LLM client for a being. Chain:
 *   1. overrideConnectionId (from a tree's role-slot resolution)
 *   2. being slot assignment (metadata.userLlm.slots[slot])
 *   3. being default (Being.llmDefault), if slot wasn't "main"
 *   4. land-level default (landLlmConnection)
 *   5. noLlm sentinel
 *
 * A future cross-land step ("summoner's home being") slots between 4
 * and 5; see [[project_llm_on_being_retires_proxy]].
 *
 * Returns `{ client, model, isCustom, connectionId, noLlm?, fetchedAt }`.
 */
export async function getClientForBeing(beingId, slot, overrideConnectionId) {
  if (!beingId) {
    return {
      client:       null,
      model:        null,
      isCustom:     false,
      connectionId: null,
      noLlm:        true,
      fetchedAt:    Date.now(),
    };
  }

  slot = slot || "main";

  // 1. Override (e.g. from a root's role-slot resolution). Highest priority.
  if (overrideConnectionId) {
    const overrideCacheKey = "conn:" + overrideConnectionId;
    const overrideCached = beingClientCache.get(overrideCacheKey);
    if (overrideCached && Date.now() - overrideCached.fetchedAt < CLIENT_CACHE_TTL) {
      return overrideCached;
    }
    try {
      const overrideEntry = await resolveConnection(overrideConnectionId, overrideCacheKey);
      if (overrideEntry) return overrideEntry;
    } catch (err) {
      log.error("LLM", `Failed to resolve override connection ${overrideConnectionId}: ${err.message}`);
    }
    // Fall through to normal slot-based resolution
  }

  // 2 + 3. Slot-based resolution from being's llmDefault + metadata.userLlm.
  const cacheKey = beingId + ":" + slot;
  const cached = beingClientCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CLIENT_CACHE_TTL) {
    return cached;
  }

  try {
    const being = await Being.findById(beingId).select("llmDefault metadata").lean();
    const meta = being?.metadata || {};
    const extSlots = meta?.userLlm?.slots || {};
    let connectionId = slot === "main" ? being?.llmDefault : (extSlots[slot] || null);

    // Fall back to "main" (llmDefault) if the specific slot has no assignment
    if (!connectionId && slot !== "main" && being?.llmDefault) {
      connectionId = being.llmDefault;
    }

    if (connectionId) {
      const entry = await resolveConnection(connectionId, cacheKey);
      if (entry) return entry;
    }
  } catch (err) {
    log.error("LLM", `Failed to load custom LLM for being ${beingId}: ${err.message}`);
  }

  // 4. Land-level default (operator-configured fallback).
  try {
    const landLlmId = getLandConfigValue("landLlmConnection");
    if (landLlmId) {
      const landCacheKey = "land:" + slot;
      const landCached = beingClientCache.get(landCacheKey);
      if (landCached && Date.now() - landCached.fetchedAt < CLIENT_CACHE_TTL) {
        return landCached;
      }
      const landEntry = await resolveConnection(landLlmId, landCacheKey);
      if (landEntry) return landEntry;
    }
  } catch (err) {
    log.error("LLM", `Failed to resolve land default LLM: ${err.message}`);
  }

  // 5. No LLM available. Cache the sentinel so we don't re-walk.
  const noLlmEntry = {
    client:       null,
    model:        null,
    isCustom:     false,
    connectionId: null,
    noLlm:        true,
    fetchedAt:    Date.now(),
  };
  beingClientCache.set(cacheKey, noLlmEntry);
  return noLlmEntry;
}

// ─────────────────────────────────────────────────────────────────────────
// LLM CONNECTION RESOLVER (the single authoritative chain)
// ─────────────────────────────────────────────────────────────────────────
//
// Resolution philosophy: position-first, identity-last. *Where* you are
// shapes your tools more than *who* you are — until you say otherwise.
//
// Four layers of authority, evaluated top-down:
//
//   Layer 1 — Lockout (sovereign over everything):
//     ANY ancestor in the space walk has `llmDefault === "none"`, OR
//     ANY ancestor in the being walk has `userLlm.locked === true`
//     → returns null. "No LLM under this scope, period."
//
//   Layer 2 — Enforcement (sovereign over preferOwn):
//     ANY ancestor in the space walk has `metadata.llm.enforced === true`
//     → use that space's connection. Position locks the LLM in.
//
//     ANY ancestor in the being walk has `userLlm.enforced === true`
//     → use that being's connection. Parent being locks descendants in.
//
//     When both apply, space enforcement wins (position > identity).
//
//   Layer 3 — Default chain (substrate model; the common case):
//     1. space.metadata.llm.slots[slot]  ← role-LLM at this exact position
//     2. space.llmDefault                 ← default LLM at this position
//     3. walk to parent, repeat 1+2
//     4. ... up to land root ...
//     5. land config: landLlmConnection  ← operator fallback for the land
//     6. being.metadata.userLlm.slots[slot] ← being's role-specific LLM
//     7. being.llmDefault                 ← being's "personal" default
//
//   Layer 3′ — Being-preferred chain (user opts in):
//     When `being.metadata.userLlm.preferOwn === true` AND no
//     enforcement was found, the order inverts: being's LLM ranks
//     above position. Lockout still applies; enforcement still wins
//     over preferOwn.
//
//   Layer 4 — Per-call override (programmatic):
//     Caller passes a connectionId directly into `getClientForBeing`
//     instead of letting it resolve. Tests, special-case dispatch.
//
// Every level is data: set/unset any field to participate. Setting
// overrides; unsetting falls through. The space ancestor walk uses the
// per-request ancestor cache; the being walk follows parentBeingId.
//
// See [[project_seed_four_verbs_only]] (single named function, all
// callers route through it) and [[project_ibp_universal_grammar]].

const BEING_CHAIN_MAX_DEPTH = 20;
const LOCKDOWN = Symbol("LOCKDOWN");

// Walk `being.parentBeingId` up to root, collecting beings as we go.
// Cycle-guarded + depth-capped. Returns an array starting with the
// passed-in being and ending at the chain root.
async function walkBeingChain(rootBeing) {
  if (!rootBeing) return [];
  const chain = [rootBeing];
  const seen = new Set([String(rootBeing._id)]);
  let curId = rootBeing.parentBeingId || null;
  let depth = 0;
  while (curId && depth < BEING_CHAIN_MAX_DEPTH) {
    const id = String(curId);
    if (seen.has(id)) break;
    seen.add(id);
    const parent = await Being.findById(id)
      .select("llmDefault metadata parentBeingId")
      .lean()
      .catch(() => null);
    if (!parent) break;
    chain.push(parent);
    curId = parent.parentBeingId || null;
    depth++;
  }
  return chain;
}

// Walk the space ancestor chain looking for: a lockout, an enforced
// connection, or a normal hit. Returns:
//   - LOCKDOWN sentinel if any ancestor locks out
//   - { connectionId, enforced } at the first hit
//   - null if no space in the chain assigns anything
async function spaceChainResolve(spaceId, slot) {
  if (!spaceId) return null;
  let chain;
  try {
    chain = await getAncestorChain(spaceId);
  } catch {
    const single = await Space.findById(spaceId).select("llmDefault metadata").lean();
    chain = single ? [single] : [];
  }
  let firstHit = null;
  for (const space of chain) {
    const a = getSpaceLlmAssignments(space);
    if (a.default === "none") return LOCKDOWN;
    if (a.enforced) {
      const hit = a[slot] || a.default;
      if (hit) return { connectionId: hit, enforced: true };
    }
    if (!firstHit) {
      const hit = a[slot] || a.default;
      if (hit) firstHit = { connectionId: hit, enforced: false };
    }
  }
  return firstHit;
}

// Walk the being ancestor chain (pre-loaded) looking for lockout,
// enforcement, or a normal hit. Same return contract as spaceChainResolve.
function beingChainResolve(beingChain, slot) {
  if (!beingChain.length) return null;
  let firstHit = null;
  for (const being of beingChain) {
    const a = getBeingLlmAssignments(being);
    if (a.locked) return LOCKDOWN;
    if (a.enforced) {
      const hit = a[slot] || a.main;
      if (hit) return { connectionId: hit, enforced: true };
    }
    if (!firstHit) {
      const hit = a[slot] || a.main;
      if (hit) firstHit = { connectionId: hit, enforced: false };
    }
  }
  return firstHit;
}

/**
 * Resolve the LLM connectionId for a call at a specific position by a
 * specific being. Walks the four-layer chain above.
 *
 * @param {object} opts
 * @param {string} [opts.beingId]  the being making the call
 * @param {string} [opts.spaceId]  the position (current space)
 * @param {string} [opts.slot]     role-slot name (defaults to "main")
 * @returns {Promise<string|null>} connectionId, or null for noLlm
 */
export async function resolveLlmConnection({ beingId = null, spaceId = null, slot = "main" } = {}) {
  // Load the being and its ancestor chain together.
  const being = beingId
    ? await Being.findById(beingId)
        .select("llmDefault metadata parentBeingId")
        .lean()
        .catch(() => null)
    : null;
  const beingChain = await walkBeingChain(being);

  // Walk both trees collecting lockout / enforcement / first-hit.
  const spaceHit  = await spaceChainResolve(spaceId, slot);
  const beingHit = beingChainResolve(beingChain, slot);

  // Layer 1: Lockout wins over everything.
  if (spaceHit === LOCKDOWN || beingHit === LOCKDOWN) return null;

  // Layer 2: Enforcement wins over preferOwn. Space enforcement beats
  // being enforcement when both apply (position-first philosophy).
  if (spaceHit?.enforced)  return spaceHit.connectionId;
  if (beingHit?.enforced) return beingHit.connectionId;

  // Layer 3 / 3′: normal chain. preferOwn (set on the calling being's
  // own metadata) inverts the order.
  const preferOwn = being?.metadata?.userLlm?.preferOwn === true;
  const landConnId = getLandConfigValue("landLlmConnection") || null;
  const candidates = preferOwn
    ? [beingHit?.connectionId, spaceHit?.connectionId, landConnId]
    : [spaceHit?.connectionId, landConnId, beingHit?.connectionId];

  for (const c of candidates) if (c) return c;
  return null;
}

/**
 * @deprecated Use `resolveLlmConnection({ beingId, spaceId, slot })` instead.
 * Kept as a thin shim for legacy callers that pass a `role` spec and only
 * have the tree root. Routes through `resolveLlmConnection` without a
 * beingId so the being-step is skipped — preserves the original
 * "position-only" intent of the old function.
 */
export async function resolveRootLlmForRole(rootId, role) {
  if (!rootId) return null;
  return resolveLlmConnection({
    spaceId: rootId,
    slot:   role?.llmSlot || "main",
  });
}

// ─────────────────────────────────────────────────────────────────────────
// CAPABILITY CHECK
// ─────────────────────────────────────────────────────────────────────────

/**
 * Does this being have any LLM available? True if they have a default
 * assigned, any saved connections, or a land-level default exists.
 */
export async function beingHasLlm(beingId) {
  if (!beingId) return false;
  const being = await Being.findById(beingId).select("metadata").lean();
  const beingMeta = being?.metadata || {};
  const beingLlm = beingMeta?.userLlm?.slots || {};
  if (beingLlm.main) return true;
  const count = await LlmConnection.countDocuments({ beingId });
  if (count > 0) return true;
  return !!getLandConfigValue("landLlmConnection");
}
