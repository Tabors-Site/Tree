// TreeOS Seed . AGPL-3.0 . https://treeos.ai
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
import log from "../core/log.js";
import crypto from "crypto";
import Being from "../models/being.js";
import Node from "../models/node.js";
import LlmConnection from "../models/llmConnection.js";
import { getLandConfigValue } from "../landConfig.js";
import { resolveAndValidateHost, getEncryptionKey } from "./connections.js";

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
  if (!conn || !conn.baseUrl || !conn.encryptedApiKey) return null;

  try {
    const hostname = new URL(conn.baseUrl).hostname;
    await resolveAndValidateHost(hostname);
  } catch (err) {
    log.error("LLM", `Blocked custom LLM connection ${connectionId}: ${err.message}`);
    return null;
  }

  const apiKey = decrypt(conn.encryptedApiKey);
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
// ROLE → TREE LLM SLOT
// ─────────────────────────────────────────────────────────────────────────
//
// Roles declare which LLM slot they want via `role.llmSlot` on the role
// spec. The runtime walks: role.llmSlot → tree default → null. The role
// IS the source of truth for what tools, prompt, AND llm slot it uses.
// See [[project_ibp_universal_grammar]].

/**
 * Resolve the LLM connectionId for a role's call on a tree.
 *   1. role.llmSlot (when set) → llmAssignments[that slot]
 *   2. tree default (llmAssignments.default)
 *   3. null
 * If the tree's default is "none", LLM is explicitly disabled here.
 */
export async function resolveRootLlmForRole(rootId, role) {
  if (!rootId) return null;
  try {
    const rootNode = await Node.findById(rootId)
      .select("llmDefault metadata")
      .lean();
    if (!rootNode) return null;

    const { getLlmAssignments } = await import("./assignments.js");
    const assignments = getLlmAssignments(rootNode);

    // "none" means LLM is explicitly off for this tree
    if (assignments.default === "none") return null;

    if (role?.llmSlot) {
      const slotOverride = assignments[role.llmSlot];
      if (slotOverride) return slotOverride;
    }

    return assignments.default || null;
  } catch {
    return null;
  }
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
