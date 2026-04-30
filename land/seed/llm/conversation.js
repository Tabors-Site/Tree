// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// llm/conversation.js
// Conversation state, LLM resolution, tool loop, session management
import log from "../log.js";
import { hooks } from "../hooks.js";

import OpenAI from "openai";
import crypto from "crypto";
import User from "../models/user.js";
import Node from "../models/node.js";
import { snapshotAncestors, resolveExtensionScopeFromChain, getAncestorChain } from "../tree/ancestorCache.js";
import { isDbHealthy } from "../dbConfig.js";
import LlmConnection from "../models/llmConnection.js";
import {
  getMode,
  getDefaultMode,
  getToolsForMode,
  buildPromptForMode,
  CARRY_MESSAGES,
} from "../modes/registry.js";
import { mcpClients, connectToMCP, MCP_SERVER_URL } from "../ws/mcp.js";
import { getLandConfigValue } from "../landConfig.js";
import { SYSTEM_OWNER } from "../protocol.js";
import { appendToolCall, getChatContext } from "./chatTracker.js";

import { resolveAndValidateHost, getEncryptionKey } from "./connections.js";

// ─────────────────────────────────────────────────────────────────────────
// LLM DEFAULTS
// ─────────────────────────────────────────────────────────────────────────

let MAX_MESSAGES = 30;
let MAX_TOOL_ITERATIONS = 15;
let LLM_TIMEOUT_MS = 15 * 60 * 1000;
let LLM_MAX_RETRIES = 3;
const MODE_TIMEOUTS = {};
function MAX_MESSAGE_CONTENT_BYTES() { return Math.max(4096, Math.min(Number(getLandConfigValue("maxMessageContentBytes")) || 32768, 131072)); }

// ── Kernel config setters (called from startup.js after land config loads) ──
export function setKernelConfig(key, value) {
  const num = Number(value);
  // Clamp all numeric values to sane bounds. Zero or negative values for
  // timeouts/limits would brick the conversation loop. Government-level:
  // every config path produces a functional system, never a broken one.
  switch (key) {
    case "llmTimeout": LLM_TIMEOUT_MS = Math.max(5000, Math.min(num * 1000, 30 * 60 * 1000)); break;
    case "llmMaxRetries": LLM_MAX_RETRIES = Math.max(0, Math.min(num, 10)); break;
    case "maxToolIterations": MAX_TOOL_ITERATIONS = Math.max(1, Math.min(num, 100)); break;
    case "maxConversationMessages": MAX_MESSAGES = Math.max(4, Math.min(num, 200)); break;
    // "defaultModel" removed: model comes from the connection record, not a global default
    case "llmMaxConcurrent": LLM_MAX_CONCURRENT = Math.max(1, Math.min(num, 500)); break;
    case "failoverTimeout": FAILOVER_TIMEOUT_MS = Math.max(1000, Math.min(num * 1000, 120000)); break;
    case "toolCallTimeout": TOOL_CALL_TIMEOUT_MS = Math.max(5000, Math.min(num * 1000, 600000)); break;
    case "toolResultMaxBytes": TOOL_RESULT_MAX_BYTES = Math.max(1000, Math.min(num, 1000000)); break;
    case "llmWaiterTimeout": LLM_WAITER_TIMEOUT_MS = Math.max(5000, Math.min(num * 1000, 120000)); break;
    case "maxConversationSessions": MAX_CONVERSATION_SESSIONS = Math.max(100, Math.min(num, 500000)); break;
    case "staleConversationTimeout": STALE_SESSION_MS = Math.max(60000, Math.min(num * 1000, 86400000)); break;
  }
}
export function setLlmTimeout(ms) { LLM_TIMEOUT_MS = ms; }

// ── LLM Concurrency Semaphore ─────────────────────────────────────────
// Prevents thundering herd: caps in-flight LLM calls across all users.
// Excess callers queue with abort signal support.
let LLM_MAX_CONCURRENT = 20;
let FAILOVER_TIMEOUT_MS = 15000;
let TOOL_CALL_TIMEOUT_MS = 60000;
// Cap each tool result that lands in session.messages. The AI still
// sees the full result for its immediate reasoning; only what we
// remember in the context window is truncated. Previously 50KB per
// tool result, which stacked dangerously: 4 full-file reads in one
// branch session = 200KB of message history before the branch even
// starts writing. Shell-style branches (which read every sibling
// before composing an entry point) routinely hit 413 on remote
// providers with 32K / 16K / 8K context ceilings. 15KB per tool
// result still shows ~450 lines of code comfortably and truncates
// cleanly for huge files.
let TOOL_RESULT_MAX_BYTES = 15000;
let LLM_WAITER_TIMEOUT_MS = 30000;
let _activeLlmCalls = 0;
const _llmWaiters = [];

/**
 * LLM priority tiers. Human interactions always get slots first.
 * Lower number = higher priority.
 */
export const LLM_PRIORITY = {
  HUMAN: 1,        // CLI and WebSocket sessions (direct human interaction)
  GATEWAY: 2,      // External channel responses (Telegram, Discord, email, etc.)
  INTERACTIVE: 3,  // Human-initiated async (scout, explore, reroot analysis)
  BACKGROUND: 4,   // Autonomous jobs (intent, dreams, codebook, cascade, compression)
};

/**
 * Acquire an LLM semaphore slot with priority.
 * If slots available, acquires immediately. If not, waits in a priority queue.
 * Higher priority waiters (lower number) are dequeued first.
 *
 * @param {AbortSignal} [signal] - abort signal to cancel the wait
 * @param {number} [priority=4] - LLM_PRIORITY tier (default BACKGROUND)
 */
async function acquireLlmSlot(signal, priority = LLM_PRIORITY.BACKGROUND) {
  if (_activeLlmCalls < LLM_MAX_CONCURRENT) {
    _activeLlmCalls++;
    return;
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, priority, arrivedAt: Date.now() };

    // Insert in priority order (ascending priority number, then arrival time)
    let inserted = false;
    for (let i = 0; i < _llmWaiters.length; i++) {
      if (priority < _llmWaiters[i].priority) {
        _llmWaiters.splice(i, 0, waiter);
        inserted = true;
        break;
      }
    }
    if (!inserted) _llmWaiters.push(waiter);

    // Waiter timeout: reject and remove if slot not acquired in time.
    // Prevents zombie waiters from crashed/disconnected clients filling the queue.
    const timeoutId = setTimeout(() => {
      const idx = _llmWaiters.indexOf(waiter);
      if (idx >= 0) _llmWaiters.splice(idx, 1);
      reject(new Error(`LLM slot not acquired within ${LLM_WAITER_TIMEOUT_MS}ms`));
    }, LLM_WAITER_TIMEOUT_MS);
    waiter.cleanupTimeout = () => clearTimeout(timeoutId);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timeoutId);
        const idx = _llmWaiters.indexOf(waiter);
        if (idx >= 0) _llmWaiters.splice(idx, 1);
        reject(new Error("Queued LLM call cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      waiter.cleanup = () => signal.removeEventListener("abort", onAbort);
    }
  });
}

function releaseLlmSlot() {
  if (_llmWaiters.length > 0) {
    const next = _llmWaiters.shift(); // highest priority (lowest number) is first
    if (next.cleanupTimeout) next.cleanupTimeout();
    if (next.cleanup) next.cleanup();
    next.resolve();
    // Slot transfers to the next waiter, _activeLlmCalls stays the same
  } else {
    _activeLlmCalls = Math.max(0, _activeLlmCalls - 1);
  }
}

// ── LLM Failover ────────────────────────────────────────────────────────
// The kernel provides the retry mechanism. Extensions register a resolver
// that returns fallback connection IDs for a given userId/rootId context.
//
// 500 is deliberately NOT in the retryable set. Local inference backends
// (ollama/qwen3/etc) return 500 for deterministic failures like tool-call
// JSON parse errors in their own template engines, not for transient
// overload. Retrying burns 5+ minutes per attempt on a request that was
// never going to succeed. 502/503/504 remain retryable because those ARE
// usually transient network / upstream issues. 429 stays for rate limits.
const RETRYABLE_CODES = new Set([429, 502, 503, 504]);

/**
 * Detect the class of 500 that IS worth retrying once — provider
 * rejects the model's tool-call JSON because it contained invalid
 * escape sequences (raw backslash, backslash-space, unescaped control
 * char). A blind retry fails identically, but a retry with corrective
 * feedback ("your last turn had invalid escapes, avoid backslashes")
 * usually succeeds because the model actually rewrites the content.
 *
 * Targets the specific small-model failure mode the kernel comment
 * above warns about — NOT transient-overload 500s, which remain
 * non-retryable. Different signal, different recovery.
 */
function isJsonEscapeError(err) {
  if (!err) return false;
  const status = err.status || err.code;
  if (status !== 500 && status !== 400) return false;
  const msg = String(err.message || err.error?.message || "");
  // ESCAPE-class only: the parser is complaining about an escape
  // sequence specifically. Match unambiguous escape-error wording from
  // the major providers / runtimes:
  //   Go:  "invalid character 'X' in string escape code"
  //   Go:  "unescaped control character"
  //   Go:  "invalid \\u escape"
  //   V8:  "Bad escaped character in JSON"
  //   V8:  "invalid escape sequence \\g"
  // Do NOT match the generic "failed to parse JSON" wording — that
  // catches structural failures too and routes them to the wrong
  // retry hint. See isJsonStructuralError for that path.
  return /string escape code|invalid escape sequence|unescaped control|bad escaped character|invalid \\u escape/i.test(msg);
}

/**
 * Detect a STRUCTURAL JSON parse failure from the provider — unmatched
 * brackets, unexpected token at a structural position, truncated
 * payload, etc. Distinct from isJsonEscapeError: the model's content
 * was probably fine but the JSON envelope around it broke (often
 * because the model emitted overly long tool args and got truncated,
 * or quoting around code blocks went sideways).
 *
 * The retry hint for this class is different ("shorten args, split
 * into multiple tool calls"), so we classify separately to avoid
 * giving misleading advice about backslashes when the real problem
 * is a stray bracket.
 */
function isJsonStructuralError(err) {
  if (!err) return false;
  const status = err.status || err.code;
  if (status !== 500 && status !== 400) return false;
  const msg = String(err.message || err.error?.message || "");
  // Common structural-error signatures across providers:
  //   "invalid character ')' after object key:value pair"
  //   "unexpected end of JSON input"
  //   "unterminated string"
  //   "expected ',' or '}' after"
  //   "expected ':' after object key"
  //   generic "failed to parse JSON" without escape-specific wording
  if (/invalid character .*(after|in) (object|array)/i.test(msg)) return true;
  if (/unexpected end of JSON input|unterminated string|unexpected token/i.test(msg)) return true;
  if (/expected (',' or '}'|':' after|',' or ']')/i.test(msg)) return true;
  // Generic "failed to parse JSON" / "json parse error" without any
  // escape keyword is structural by elimination.
  if (/failed to parse JSON|json.*parse.*error/i.test(msg) && !/escape|control/i.test(msg)) return true;
  return false;
}

let _failoverResolver = null;

/**
 * Register a failover resolver. Extensions call this to supply fallback
 * connection IDs when the primary LLM connection fails.
 * @param {Function} resolver - async (userId, rootId) => string[] of connectionIds
 */
export function registerFailoverResolver(resolver) {
  _failoverResolver = resolver;
}

/**
 * Try an LLM call with the primary client. On retryable failure, ask the
 * registered failover resolver for fallback connections and try each one.
 * @param {Function} callFn - async (openaiClient, model) => response
 * @param {object} primaryClient - { client, model, connectionId, ... }
 * @param {string} userId
 * @param {string|null} rootId
 * @returns {object} { response, usedClient }
 */
async function callWithFailover(callFn, primaryClient, userId, rootId) {
  // Try primary
  try {
    const response = await callFn(primaryClient.client, primaryClient.model);
    return { response, usedClient: primaryClient };
  } catch (err) {
    const status = err.status || err.code;
    if (!RETRYABLE_CODES.has(status) && !err.message?.includes("timed out")) {
      throw err; // not retryable
    }
    // Jittered backoff on rate limit before trying failover
    if (status === 429) {
      const retryAfter = Number(err.headers?.["retry-after"]) || 0;
      const baseMs = retryAfter > 0 ? retryAfter * 1000 : 1000;
      const jitter = Math.random() * baseMs;
      await new Promise(r => setTimeout(r, baseMs + jitter));
    }

    // No failover resolver registered, nothing to try
    if (!_failoverResolver) throw err;

    log.warn("LLM", `Primary failed (${status}): ${primaryClient.model}. Trying failover.`);
  }

  // Ask the extension for fallback connection IDs
  const stack = await _failoverResolver(userId, rootId);
  if (!stack || stack.length === 0) {
    throw new Error("Primary LLM connection failed and no failover connections configured.");
  }

  // Walk the stack with cumulative timeout
  const failoverStart = Date.now();
  for (const connId of stack) {
    if (Date.now() - failoverStart > FAILOVER_TIMEOUT_MS) {
      log.warn("LLM", `Failover walk timed out after ${FAILOVER_TIMEOUT_MS}ms. Giving up.`);
      break;
    }
    if (connId === primaryClient.connectionId) continue; // skip primary
    try {
      const fallbackClient = await resolveConnection(connId, "failover:" + connId);
      if (!fallbackClient) continue;
      log.verbose("LLM", `Trying failover: ${fallbackClient.model} (${connId})`);
      const response = await callFn(fallbackClient.client, fallbackClient.model);
      log.verbose("LLM", `Failover succeeded: ${fallbackClient.model}`);
      return { response, usedClient: fallbackClient };
    } catch (err) {
      const failStatus = err.status || err.code;
      if (failStatus === 429) {
        const idx = stack.indexOf(connId);
        const baseMs = 1000 * Math.pow(2, idx);
        const jitter = Math.random() * baseMs;
        await new Promise(r => setTimeout(r, baseMs + jitter));
      }
      log.warn("LLM", `Failover ${connId} failed: ${err.message?.slice(0, 100)}`);
      continue;
    }
  }

  // All failed
  throw new Error(`All LLM connections failed (primary + ${stack.length} failover). Check your connections.`);
}
export function setLlmMaxRetries(n) { LLM_MAX_RETRIES = n; }
const MODE_RETRIES = {};
export function registerModeTimeout(modeKey, ms) { MODE_TIMEOUTS[modeKey] = ms; }
export function registerModeRetries(modeKey, n) { MODE_RETRIES[modeKey] = n; }
function getRetriesForMode(modeKey) { return MODE_RETRIES[modeKey] ?? LLM_MAX_RETRIES; }
function getTimeoutForMode(modeKey, nodeMetadata = null) {
  // Per-node override
  const meta = nodeMetadata instanceof Map ? Object.fromEntries(nodeMetadata) : (nodeMetadata || {});
  const nodeTimeout = meta.timeouts?.[modeKey];
  if (nodeTimeout && Number.isFinite(nodeTimeout)) return nodeTimeout;
  // Per-mode (extension registered)
  if (MODE_TIMEOUTS[modeKey]) return MODE_TIMEOUTS[modeKey];
  // Land default
  return LLM_TIMEOUT_MS;
}

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION HELPERS (must match whatever you use when saving)
// ─────────────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-cbc";

function decrypt(encryptedText) {
  // Use the unified key derivation from connections.js to avoid mismatch
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
  } catch (e) {
    throw new Error("Failed to decrypt LLM credential. The encryption key may have changed or the stored credential is corrupted.");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PER-USER LLM CLIENT CACHE
// ─────────────────────────────────────────────────────────────────────────

// Cache: userId → { client, model, fetchedAt }
const userClientCache = new Map();
let CLIENT_CACHE_TTL = 5 * 60 * 1000; // 5 min
let PROXY_CACHE_TTL = 60 * 1000; // 1 min for canopy proxy clients

export function setClientCacheTtl(ms) { CLIENT_CACHE_TTL = ms; }
export function setProxyCacheTtl(ms) { PROXY_CACHE_TTL = ms; }

// Periodic cache cleanup (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of userClientCache) {
    const ttl = entry.isCanopyProxy ? PROXY_CACHE_TTL : CLIENT_CACHE_TTL;
    if (now - entry.fetchedAt > ttl * 2) userClientCache.delete(key);
  }
}, 10 * 60 * 1000).unref();

/**
 * Returns { client, model, isCustom } for a user.
 * Uses their custom LLM if configured, otherwise falls back to default.
 */

/**
 * Try to build a client entry from a specific connectionId.
 * Returns the entry on success, or null if the connection is missing/invalid.
 */
async function resolveConnection(connectionId, cacheKey) {
  const conn = await LlmConnection.findById(connectionId).lean();
  if (!conn || !conn.baseUrl || !conn.encryptedApiKey) return null;

  // Admin users can use private/internal IPs (e.g. local Ollama)
  const owner = await User.findById(conn.userId).select("isAdmin").lean();

  if (!owner?.isAdmin) {
    try {
      const hostname = new URL(conn.baseUrl).hostname;
      await resolveAndValidateHost(hostname);
    } catch (err) {
      log.error("LLM", `Blocked custom LLM connection ${connectionId}: ${err.message}`);
      return null;
    }
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
      // SDK-side retry is disabled. We handle retry decisions in
      // callWithFailover based on our own RETRYABLE_CODES set so we can
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
    model: conn.model || null,
    isCustom: true,
    connectionId: conn._id,
    fetchedAt: Date.now(),
  };

  if (cacheKey) userClientCache.set(cacheKey, entry);

  LlmConnection.updateOne(
    { _id: conn._id },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => {});

  return entry;
}

export async function getClientForUser(userId, slot, overrideConnectionId) {
  if (!userId)
    return {
      client: null,
      model: null,
      isCustom: false,
      connectionId: null,
      noLlm: true,
      fetchedAt: Date.now(),
    };

  slot = slot || "main";

  // 1. If an override connectionId is provided (e.g. from a root's llmAssignments),
  //    try that first. It takes highest priority.
  if (overrideConnectionId) {
    const overrideCacheKey = "conn:" + overrideConnectionId;
    const overrideCached = userClientCache.get(overrideCacheKey);
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

  // 2. Normal slot-based resolution from user.llmAssignments
  const cacheKey = userId + ":" + slot;
  const cached = userClientCache.get(cacheKey);
  const ttl = cached?.isCanopyProxy ? PROXY_CACHE_TTL : CLIENT_CACHE_TTL;
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached;
  }

  try {
    const user = await User.findById(userId).select("llmDefault metadata").lean();
    const meta = user?.metadata || {};
    const extSlots = meta?.userLlm?.slots || {};
    let connectionId = slot === "main" ? user?.llmDefault : (extSlots[slot] || null);

    // Fall back to "main" (llmDefault) if the specific slot has no assignment
    if (!connectionId && slot !== "main" && user?.llmDefault) {
      connectionId = user.llmDefault;
    }

    if (connectionId) {
      const entry = await resolveConnection(connectionId, cacheKey);
      if (entry) return entry;
    }
  } catch (err) {
    log.error("LLM", `Failed to load custom LLM for user ${userId}: ${err.message}`);
  }

  // Check if this is a remote user whose LLM lives on their home land
  try {
    const remoteCheck = await User.findById(userId).select("isRemote homeLand").lean();
    if (remoteCheck?.isRemote && remoteCheck.homeLand) {
      const { createCanopyLlmProxyClient } = await import("../../canopy/llmProxy.js");
      const proxyClient = createCanopyLlmProxyClient({ userId, homeLand: remoteCheck.homeLand, slot });
      const proxyEntry = {
        client: proxyClient,
        model: null,
        isCustom: true,
        connectionId: null,
        isCanopyProxy: true,
        fetchedAt: Date.now(),
      };
      userClientCache.set(cacheKey, proxyEntry);
      return proxyEntry;
    }
  } catch (err) {
    log.error("LLM", `Failed to create canopy LLM proxy for user ${userId}: ${err.message}`);
  }

  // Land-level default LLM (operator-configured fallback for all users)
  try {
    const landLlmId = getLandConfigValue("landLlmConnection");
    if (landLlmId) {
      const landCacheKey = "land:" + slot;
      const landCached = userClientCache.get(landCacheKey);
      if (landCached && Date.now() - landCached.fetchedAt < CLIENT_CACHE_TTL) {
        return landCached;
      }
      const landEntry = await resolveConnection(landLlmId, landCacheKey);
      if (landEntry) return landEntry;
    }
  } catch (err) {
    log.error("LLM", `Failed to resolve land default LLM: ${err.message}`);
  }

  const noLlmEntry = {
    client: null,
    model: null,
    isCustom: false,
    connectionId: null,
    noLlm: true,
    fetchedAt: Date.now(),
  };
  userClientCache.set(cacheKey, noLlmEntry);
  return noLlmEntry;
}

// ── Mode → llmAssignments key mapping ────────────────────────────────────
// Groups related modes under a single assignment key.
// Resolution: mode-specific → placement fallback → user default
// Extensions can register additional mappings via registerModeAssignment().
// Mode → LLM slot mapping. Starts empty. Extensions register their mappings
// during init via registerModeAssignment(). The kernel provides the registry.
// The kernel does not know what modes exist. That's extension territory.
const MODE_TO_ASSIGNMENT = {};

/**
 * Register a mode-to-LLM-slot mapping. Extensions call this during init
 * to assign their custom modes to LLM slots.
 * @param {string} modeKey - e.g. "custom:formal"
 * @param {string} slotName - e.g. "respond" or a custom slot name
 */
export function registerModeAssignment(modeKey, slotName) {
  MODE_TO_ASSIGNMENT[modeKey] = slotName;
}

/**
 * Resolve the LLM connectionId for a given mode on a tree.
 * Priority: llmAssignments[modeGroup] → llmAssignments.default → null
 * If default is "none", LLM is explicitly disabled for this tree.
 * Returns the connectionId string, or null.
 */
export async function resolveRootLlmForMode(rootId, modeKey) {
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

    const assignmentKey = MODE_TO_ASSIGNMENT[modeKey];
    if (assignmentKey) {
      const modeOverride = assignments[assignmentKey];
      if (modeOverride) return modeOverride;
    }

    // Fallback to tree default
    return assignments.default || null;
  } catch {
    return null;
  }
}

/**
 * Clear cached client for a user (call when they update/revoke their LLM config).
 */
export function clearUserClientCache(userId) {
  // Clear all slot entries for this user
  for (const key of userClientCache.keys()) {
    if (key === userId || key.startsWith(userId + ":")) {
      userClientCache.delete(key);
    }
  }
}

/**
 * Quick check: does this user have any custom LLM connection available?
 * Returns true if user.llmAssignments.main is set OR they have at least one connection.
 */
export async function userHasLlm(userId) {
  if (!userId) return false;
  const user = await User.findById(userId).select("metadata").lean();
  const userMeta = user?.metadata || {};
  const userLlm = userMeta?.userLlm?.slots || {};
  if (userLlm.main) return true;
  const count = await LlmConnection.countDocuments({ userId });
  if (count > 0) return true;
  // Land default available?
  return !!getLandConfigValue("landLlmConnection");
}

// ─────────────────────────────────────────────────────────────────────────
// SESSION STATE (keyed by ai-chat session key)
// ─────────────────────────────────────────────────────────────────────────
//
// The parameter/local variable name `visitorId` throughout this file is
// the ai-chat session key built by seed/llm/sessionKeys.js. We keep the
// historical `visitorId` name because it's the JWT claim name (wire
// contract with the MCP server), a field in the runChat/runOrchestration
// return value (API contract with callers), and a field name in
// sessionRegistry meta (consumed by hooks). Rename-in-place would break
// all three. For new code, treat `visitorId` as synonymous with
// `aiSessionKey` — same string, same meaning.
//
// The `socket.visitorId` field (set in ws/websocket.js register handler)
// is related but distinct: it's the transport-level fallback key used
// when a chat arrives before payload context is established. It's a
// real socket field, not a local variable.

// Each session holds: { modeKey, bigMode, messages[], rootId, _lastActive }
const sessions = new Map();
let MAX_CONVERSATION_SESSIONS = 50000; // hard cap to prevent OOM from leaked sessions

// Persistent sessionId map for runChat (zone+rootId+userId -> sessionId).
// Chains Chat documents together. Capped at 10K entries.
const _runChatSessions = new Map();


/**
 * Get or create session for a visitor.
 */
function getSession(visitorId) {
  if (!sessions.has(visitorId)) {
    // Hard cap: if sessions exceed limit, evict oldest before creating new
    if (sessions.size >= MAX_CONVERSATION_SESSIONS) {
      let oldestKey = null, oldestTime = Infinity;
      for (const [id, s] of sessions) {
        if ((s._lastActive || 0) < oldestTime) { oldestTime = s._lastActive || 0; oldestKey = id; }
      }
      if (oldestKey) sessions.delete(oldestKey);
    }
    sessions.set(visitorId, {
      modeKey: null,
      bigMode: null,
      messages: [],
      rootId: null,
      _lastActive: Date.now(),
    });
  }
  const s = sessions.get(visitorId);
  s._lastActive = Date.now();
  return s;
}

// Sweep stale conversation sessions every 10 minutes (safety net)
let STALE_SESSION_MS = 30 * 60 * 1000; // 30 min
setInterval(
  () => {
    const now = Date.now();
    let swept = 0;
    for (const [id, s] of sessions) {
      if (now - (s._lastActive || 0) > STALE_SESSION_MS) {
        sessions.delete(id);
        _runChatSessions.delete(id);
        swept++;
      }
    }
    if (swept > 0)
      log.debug("LLM", 
        `🧹 Swept ${swept} stale conversation session(s) (${sessions.size} remaining)`,
      );
  },
  10 * 60 * 1000,
).unref();

// ─────────────────────────────────────────────────────────────────────────
// MODE SWITCHING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Switch to a new mode. Resets conversation but carries recent messages.
 * Returns { modeKey, alert } for the frontend.
 */
export async function switchMode(visitorId, newModeKey, ctx) {
  ctx = ctx || {};
  const session = getSession(visitorId);
  const mode = getMode(newModeKey);
  if (!mode) throw new Error(`Unknown mode: ${newModeKey}`);

  const oldModeKey = session.modeKey;
  const oldMessages = session.messages;

  let recentMessages = [];
  let carriedContext = [];

  // Skip carry when doing a full reset (big mode switch)
  if (!ctx.clearHistory) {
    // Determine how many messages to carry over
    let carryCount = CARRY_MESSAGES;

    // Reflect modes get extra context carry for plan formation
    const oldMode = oldModeKey ? getMode(oldModeKey) : null;
    if (oldMode?.preserveContextOnSwitch) {
      carryCount = Math.min(oldMessages.length, 8);
    }

    recentMessages = oldMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-carryCount);

    carriedContext =
      recentMessages.length > 0
        ? [
            {
              role: "system",
              content: `[Mode Switch] Switched from ${oldModeKey || "none"} to ${newModeKey}. Here is recent conversation context for continuity:`,
            },
            ...recentMessages,
          ]
        : [];
  }

  // Build new system prompt
  const systemPrompt = await buildPromptForMode(newModeKey, {
    ...ctx,
    rootId: session.rootId || ctx.rootId,
    currentNodeId: ctx.currentNodeId || session.currentNodeId,
    enrichedContext: session._lastEnrichedContext || null,
    isFirstTurn: !session._hasHadFirstTurn,
    editsByFile: session._editsByFile || {},
  });

  // Reset conversation with new system prompt + carried context
  session.messages = [
    { role: "system", content: systemPrompt },
    ...carriedContext,
  ];
  session.modeKey = newModeKey;
  session.bigMode = mode.bigMode;
  // Persist currentNodeId so position hold works on the next request
  if (ctx.currentNodeId) session.currentNodeId = ctx.currentNodeId;

  log.debug("LLM",
    `🔄 Mode switch for ${visitorId}: ${oldModeKey || "none"} → ${newModeKey} (carried ${recentMessages.length} messages)`,
  );

  return {
    modeKey: newModeKey,
    emoji: mode.emoji,
    label: mode.label,
    alert: `${mode.emoji} ${mode.label}`,
    carriedMessages: recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };
}

/**
 * Switch to a big mode's default sub-mode.
 */
export async function switchBigMode(visitorId, bigMode, ctx) {
  const defaultModeKey = getDefaultMode(bigMode);
  if (!defaultModeKey) throw new Error(`No default mode for: ${bigMode}`);
  return await switchMode(visitorId, defaultModeKey, { ...ctx, clearHistory: true });
}

// ─────────────────────────────────────────────────────────────────────────
// CHAT PROCESSING HELPERS (private, called by processMessage)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get session, ensure a mode exists, snapshot ancestor chain.
 * Returns { session, mode }.
 */
async function ensureSession(visitorId, ctx) {
  const session = getSession(visitorId);

  // Self-healing: detect rootId mismatch. If the caller says we're in a different
  // tree than the session thinks, clear messages and re-init. This catches race
  // conditions where setRootId and switchMode happen out of order, and protects
  // against stale context when callers forget to clear on tree transitions.
  const incomingRootId = ctx.rootId || null;
  if (session.rootId && incomingRootId && session.rootId !== incomingRootId) {
    log.debug("LLM", `Root mismatch for ${visitorId}: session=${session.rootId}, ctx=${incomingRootId}. Clearing.`);
    session.messages = [];
    session.modeKey = null;
    session.rootId = incomingRootId;
  }

  // Sync rootId from context if session doesn't have one yet
  if (!session.rootId && incomingRootId) {
    session.rootId = incomingRootId;
  }

  // Sync currentNodeId from context
  if (ctx.currentNodeId) {
    session.currentNodeId = ctx.currentNodeId;
  }

  // Ensure we have a mode - default to home:default
  if (!session.modeKey) {
    await switchMode(visitorId, "home:default", ctx);
  }

  const mode = getMode(session.modeKey);

  // Snapshot ancestor chain for consistent resolution within this message.
  // All resolution chains (scope, tools, mode, LLM, config) read from this snapshot.
  const snapshotNodeId = session.currentNodeId || session.rootId || ctx.rootId;
  if (snapshotNodeId) {
    session._ancestorSnapshot = await snapshotAncestors(snapshotNodeId);
  }

  return { session, mode };
}

/**
 * Check if the tree's circuit breaker is tripped.
 * Returns a dormant response object, or null if healthy.
 */
function checkTreeCircuit(session) {
  if (session._ancestorSnapshot) {
    // The owner node (root) is the last non-system node in the chain
    const rootAncestor = session._ancestorSnapshot.find(a => a.rootOwner && a.rootOwner !== SYSTEM_OWNER);
    if (rootAncestor?.metadata?.circuit?.tripped) {
      return {
        content: "This tree is dormant. It exceeded health thresholds and its circuit breaker tripped. Contact the land operator or wait for an extension to revive it.",
        modeKey: session.modeKey,
        _internal: { tripped: true, rootId: rootAncestor._id },
      };
    }
  }
  return null;
}

/**
 * Resolve LLM client with failover, connect MCP client.
 * Returns { openai, MODEL, isCustom, resolvedConnectionId, client (MCP), clientEntry }
 * or returns a noLlm response object (has .noLlmResponse).
 */
async function resolveLLMClient(ctx, session, visitorId) {
  // Resolve LLM client for this user (custom or default, with root override)
  // Auto-resolve per-mode LLM override from the tree's llmAssignments
  const rootId = session.rootId || ctx.rootId;
  const modeConnectionId =
    ctx.rootLlmConnectionId ||
    (rootId ? await resolveRootLlmForMode(rootId, session.modeKey) : null);

  const clientEntry = await getClientForUser(
    ctx.userId,
    ctx.slot,
    modeConnectionId,
  );
  if (clientEntry.noLlm) {
    // Metering handled by extension hooks (beforeLLMCall/afterLLMCall) if installed
    return {
      noLlmResponse: {
        content:
          "No LLM connection configured. Set one up at /setup to use AI features.",
        modeKey: session.modeKey,
      },
    };
  }
  const {
    client: openai,
    model: MODEL,
    isCustom,
    connectionId: resolvedConnectionId,
  } = clientEntry;

  // Ensure MCP client
  let client = mcpClients.get(visitorId);
  if (!client) {
    const jwt = (await import("jsonwebtoken")).default;
    const mcpJwt = jwt.sign(
      { userId: String(ctx.userId), username: ctx.username, visitorId },
      process.env.JWT_SECRET,
      { expiresIn: "24h" },
    );
    client = await connectToMCP(MCP_SERVER_URL, visitorId, mcpJwt);
  }

  return { openai, MODEL, isCustom, resolvedConnectionId, client, clientEntry };
}

/**
 * Handle conversation loop trimming, fresh mode init, max message trim, add user message.
 * @param {object} session - Conversation session state
 * @param {object} ctx - Request context (username, userId, rootId, etc.)
 * @param {string} message - The user's message to add
 * @param {object} mode - The resolved mode object
 * @param {string} visitorId - Session visitor identifier (for logging)
 */
async function prepareConversation(session, ctx, message, mode, visitorId) {
  // Check for conversation length - loop if needed (BE mode)
  if (
    mode.maxMessagesBeforeLoop &&
    session.messages.length > mode.maxMessagesBeforeLoop
  ) {
    log.debug("LLM", `🔁 Conversation loop for ${visitorId} in ${session.modeKey}`);
    const recentMessages = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-(CARRY_MESSAGES * 2)); // carry more on loop

    const systemPrompt = await buildPromptForMode(session.modeKey, {
      username: ctx.username,
      userId: ctx.userId,
      rootId: session.rootId,
      currentNodeId: session.currentNodeId,
      enrichedContext: session._lastEnrichedContext || null,
      isFirstTurn: !session._hasHadFirstTurn,
      editsByFile: session._editsByFile || {},
    });

    session.messages = [
      { role: "system", content: systemPrompt },
      {
        role: "system",
        content: `[Conversation Loop] The conversation was getting long and has been trimmed. Recent context preserved. Re-fetch the tree to re-orient if needed.`,
      },
      ...recentMessages,
    ];
  }

  // Build/refresh system prompt every call so it reflects current tree state
  {
    // Run enrichContext for the session's current node so mode buildSystemPrompt
    // hooks (and facet shouldInject checks) get the same injected data the
    // tree-orchestrator sees. Cheap: the handlers already guard with data
    // checks and are designed to run per-turn.
    let enrichedContext = null;
    try {
      const posNodeId = session.currentNodeId || session.rootId || ctx.rootId || null;
      if (posNodeId) {
        const posNode = await Node.findById(posNodeId).lean();
        if (posNode) {
          const meta = posNode.metadata instanceof Map
            ? Object.fromEntries(posNode.metadata)
            : (posNode.metadata || {});
          enrichedContext = {};
          await hooks.run("enrichContext", {
            context: enrichedContext,
            node: posNode,
            meta,
            nodeId: posNodeId,
            userId: ctx.userId,
            sessionId: visitorId,
            // Pass the current turn's user message so handlers that want
            // to gate their injection on vocabulary (e.g. channels' peer-
            // peek) can do so. Handlers that don't care just ignore it.
            message: message || null,
            dumpMode: true,
          });
          session._lastEnrichedContext = enrichedContext;
        }
      }
    } catch (err) {
      log.debug("LLM", `enrichContext gather skipped: ${err.message}`);
    }

    const systemPrompt = await buildPromptForMode(session.modeKey, {
      username: ctx.username,
      userId: ctx.userId,
      rootId: session.rootId,
      currentNodeId: session.currentNodeId,
      enrichedContext: enrichedContext || session._lastEnrichedContext || null,
      isFirstTurn: !session._hasHadFirstTurn,
      editsByFile: session._editsByFile || {},
    });
    if (session.messages.length === 0) {
      session.messages = [{ role: "system", content: systemPrompt }];
    } else if (session.messages[0]?.role === "system") {
      session.messages[0].content = systemPrompt;
    }

    // Persist the rendered system prompt + enrichContext output onto the
    // active chat record so the /chats viewer can replay exactly what
    // the AI saw. Fire-and-forget; we only write on the first turn per
    // chat (chatId stays in context across iterations). Subsequent turns
    // of the same chat keep the first capture — that's the one the user
    // cares about auditing.
    try {
      const _chatCtx = getChatContext(visitorId);
      if (_chatCtx?.chatId && !session._chatContextPersisted?.[_chatCtx.chatId]) {
        session._chatContextPersisted ||= {};
        session._chatContextPersisted[_chatCtx.chatId] = true;
        const _setFields = { $set: { systemPrompt } };
        if (enrichedContext && Object.keys(enrichedContext).length > 0) {
          _setFields.$set.enrichedContext = enrichedContext;
        }
        (async () => {
          try {
            const Chat = (await import("../models/chat.js")).default;
            await Chat.updateOne({ _id: _chatCtx.chatId, systemPrompt: null }, _setFields);
          } catch (err) {
            log.debug("LLM", `systemPrompt persist skipped: ${err.message}`);
          }
        })();
      }
    } catch {}
  }


  // Trim if over max. Preserve conversation integrity: tool results must
  // follow their corresponding assistant tool_call message. Trim to a clean
  // boundary (user or assistant without tool_calls) to avoid orphaned tool results.
  const maxMsgs = session._nodeLlmConfig?.maxConversationMessages ?? MAX_MESSAGES;
  if (session.messages.length > maxMsgs) {
    const systemMsg = session.messages[0];
    let recent = session.messages.slice(-(maxMsgs - 1));
    // Walk forward from the trim point to find a clean boundary.
    // Drop orphaned tool results (their assistant message was trimmed away).
    while (recent.length > 0 && recent[0].role === "tool") {
      recent.shift();
    }
    // Drop orphaned assistant tool_calls (their tool results were trimmed away).
    // An assistant message with tool_calls but no subsequent tool results confuses the LLM.
    while (recent.length > 0 && recent[0].role === "assistant" && recent[0].tool_calls?.length > 0) {
      recent.shift();
      // Drop any trailing tool results that belonged to the dropped assistant
      while (recent.length > 0 && recent[0].role === "tool") {
        recent.shift();
      }
    }
    // Cap any oversized messages retained after trim. Tool results and
    // injected context are capped on insertion, but LLM responses can be
    // arbitrarily large. Truncating here bounds total session memory.
    const maxBytes = MAX_MESSAGE_CONTENT_BYTES();
    for (const msg of recent) {
      if (typeof msg.content === "string" && msg.content.length > maxBytes) {
        msg.content = msg.content.slice(0, maxBytes) + "\n... (truncated)";
      }
    }
    session.messages = [systemMsg, ...recent];
  }

  // Add user message (capped to prevent oversized entries in conversation history).
  // On continuation re-entries, the caller is just re-running the tool loop on the
  // existing messages; we skip pushing a new user message so the chat doesn't grow
  // with synthetic "continue" turns.
  if (!ctx?.continuation) {
    const maxMsgBytes = MAX_MESSAGE_CONTENT_BYTES();
    const safeUserMsg = message.length > maxMsgBytes
      ? message.slice(0, maxMsgBytes) + "\n... (message truncated)"
      : message;
    session.messages.push({ role: "user", content: safeUserMsg });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MID-CONVERSATION COMPRESSION
// When the message list gets long during tool loops, compress older messages
// into a summary. Keeps the system prompt and recent messages intact.
//
// Default: mechanical (concat assistant messages, no LLM call).
// Extensions can register a custom compressor via the onCompress hook
// for LLM-powered summaries.
// ─────────────────────────────────────────────────────────────────────────

// Compression is ON by default now. A branch session that reads 4+
// sibling files accumulates enough tool results to blow past a
// remote provider's context window on the next turn. The old default
// (off) meant compression never ran unless the operator explicitly
// enabled it, and the symptom was cryptic 413 / 402 errors from
// failover providers mid-swarm. Operators who actively want no
// compression can set conversationCompression=false in the land
// config. Threshold of 20 messages catches branch sessions that
// read more than a handful of files without interfering with normal
// short chats.
const COMPRESSION_ENABLED = () => {
  const v = getLandConfigValue("conversationCompression");
  return v !== false; // default true; only disables when explicitly false
};
const COMPRESSION_THRESHOLD = () => Number(getLandConfigValue("compressionThreshold")) || 20;
const COMPRESSION_KEEP = () => Number(getLandConfigValue("compressionKeep")) || 8;

/**
 * Compress mid-conversation messages into a summary.
 * Preserves: system prompt (index 0), last `keep` messages.
 * Compresses: everything in between into a single summary message.
 *
 * @param {object} session - conversation session with messages[]
 * @param {number} threshold - message count trigger
 * @param {number} keep - messages to preserve at end
 */
async function compressConversation(session, threshold, keep) {
  const msgs = session.messages;
  if (msgs.length < threshold) return;

  // Don't compress if we already compressed recently (check for marker)
  if (msgs[1]?.role === "system" && msgs[1]?._compressed) return;

  const systemPrompt = msgs[0]; // always preserve
  const preserveStart = Math.max(1, msgs.length - keep);
  const toCompress = msgs.slice(1, preserveStart);
  const toKeep = msgs.slice(preserveStart);

  if (toCompress.length < 4) return; // not worth compressing

  // Build mechanical summary: extract assistant content, skip tool call details
  const summaryParts = [];
  for (const msg of toCompress) {
    if (msg.role === "assistant" && msg.content && typeof msg.content === "string") {
      // Skip very short tool-call-only messages
      const text = msg.content.trim();
      if (text.length > 20) summaryParts.push(text);
    }
  }

  if (summaryParts.length === 0) return;

  // Cap summary at ~2000 chars to keep it useful but compact
  let summary = summaryParts.join("\n").slice(0, 2000);
  if (summaryParts.join("\n").length > 2000) summary += "\n... (earlier context compressed)";

  // Fire onCompress hook if registered. Extensions can replace the mechanical
  // summary with an LLM-powered one. The hook receives the raw messages and
  // the mechanical summary, and can return a better one.
  try {
    const hookData = {
      messages: toCompress,
      mechanicalSummary: summary,
      summary, // extensions write to this field to override
    };
    await hooks.run("onCompress", hookData);
    summary = hookData.summary; // use extension override if provided
  } catch {}

  // Replace messages: system prompt + compressed summary + kept messages
  const compressedMsg = {
    role: "system",
    content: `[Compressed context from ${toCompress.length} earlier messages]\n${summary}`,
    _compressed: true,
  };

  session.messages = [systemPrompt, compressedMsg, ...toKeep];

  log.verbose("LLM", `Compressed ${toCompress.length} messages into summary (${summary.length} chars), kept ${toKeep.length}`);
}

/**
 * Resolve per-position LLM config. Three-layer resolution:
 *   1. Node config (metadata.llm.config) - operator override at position
 *   2. Mode config (mode object fields) - mode knows its own needs
 *   3. Land globals (the defaults) - safety ceiling
 *
 * Node wins over mode. Mode wins over land. All clamped to safe maximums.
 */
const LLM_CONFIG_KEYS = {
  maxToolIterations: 100,
  toolCallTimeout: 600000,       // 10 minutes max
  toolResultMaxBytes: 1000000,   // 1MB max
  maxConversationMessages: 200,
  compressionThreshold: 200,     // message count before mid-loop compression
  compressionKeep: 20,           // messages to preserve at the end
};

function resolveLlmConfig(ancestors, mode) {
  const config = {};

  // Layer 1: node config (walk ancestor chain, closest wins)
  if (ancestors && ancestors.length > 0) {
    for (const node of ancestors) {
      if (node.systemRole) break;
      const llmConfig = node.metadata?.llm?.config;
      if (!llmConfig || typeof llmConfig !== "object") continue;
      for (const [key, maxVal] of Object.entries(LLM_CONFIG_KEYS)) {
        if (config[key] !== undefined) continue;
        const val = llmConfig[key];
        if (typeof val === "number" && isFinite(val) && val > 0) {
          if (val > maxVal) log.verbose("LLM", `Node LLM config ${key}=${val} clamped to max ${maxVal}`);
          config[key] = Math.min(val, maxVal);
        }
      }
    }
  }

  // Layer 2: mode config (fills gaps not set by node)
  if (mode) {
    for (const [key, maxVal] of Object.entries(LLM_CONFIG_KEYS)) {
      if (config[key] !== undefined) continue;
      const val = mode[key];
      if (typeof val === "number" && isFinite(val) && val > 0) {
        if (val > maxVal) log.verbose("LLM", `Mode LLM config ${key}=${val} clamped to max ${maxVal}`);
        config[key] = Math.min(val, maxVal);
      }
    }
  }

  // Layer 3: land globals (applied at usage site via ?? fallback)
  return config;
}

/**
 * Resolve tool config and spatial extension scoping from the ancestor snapshot.
 * Uses the per-message snapshot (zero DB queries). Falls back to ancestor cache on miss.
 * Returns { tools, blockedExtensions, restrictedExtensions }.
 */
async function resolveToolsForPosition(session) {
  let treeToolConfig = null;
  let blockedExtensions = null;
  let restrictedExtensions = null;
  const currentNodeId = session.currentNodeId || session.rootId;
  if (currentNodeId) {
    try {
      // Use the per-message snapshot. Every resolution chain reads from this.
      // Falls back to ancestor cache (still cached, not raw DB) if no snapshot.
      const ancestors = session._ancestorSnapshot
        || await getAncestorChain(currentNodeId);

      if (ancestors && ancestors.length > 0) {
        // Tool config: walk ancestor chain in memory
        const allowed = new Set();
        const blocked = new Set();
        for (const node of ancestors) {
          if (node.systemRole) break;
          const meta = node.metadata || {};
          if (meta.tools?.allowed) for (const t of meta.tools.allowed) allowed.add(t);
          if (meta.tools?.blocked) for (const t of meta.tools.blocked) blocked.add(t);
        }
        if (allowed.size || blocked.size) {
          treeToolConfig = {
            allowed: allowed.size ? [...allowed] : undefined,
            blocked: blocked.size ? [...blocked] : undefined,
          };
        }

        // Extension scoping: reuse the same resolution helper that extensionScope.js uses
        const { getConfinedExtensions } = await import("../tree/extensionScope.js");
        const scope = resolveExtensionScopeFromChain(ancestors, getConfinedExtensions());
        if (scope.blocked.size) blockedExtensions = scope.blocked;
        if (scope.restricted.size) restrictedExtensions = scope.restricted;
      }
    } catch (scopeErr) {
      log.warn("LLM", `Tool scope resolution failed for node ${currentNodeId}: ${scopeErr.message}`);
    }
  }
  // Mode-based tool resolution: each mode declares its own tools.
  // Extensions chain via the orchestrator when a message needs multiple extensions.
  let tools = getToolsForMode(session.modeKey, treeToolConfig);
  // Filter tools by spatial extension scope (blocked + restricted)
  if (blockedExtensions || restrictedExtensions) {
    const { filterToolsByScope } = await import("../tree/extensionScope.js");
    tools = filterToolsByScope(tools, blockedExtensions, restrictedExtensions);
  }
  return { tools, blockedExtensions, restrictedExtensions };
}

/**
 * The LLM API call with semaphore, failover, afterLLMCall hook, and failed_generation handling.
 * Returns the response object.
 */
async function callLLM(openai, MODEL, session, tools, ctx, clientEntry, visitorId) {
  const requestParams = {
    model: MODEL,
    messages: session.messages,
  };

  // Only include tools if the mode has any
  if (tools.length > 0) {
    requestParams.tools = tools;
    requestParams.tool_choice = "auto";
  }

  // Pass abort signal to OpenAI if available
  const requestOpts = ctx.signal ? { signal: ctx.signal } : {};

  // beforeLLMCall: extensions can cancel (quota exhausted) or modify params.
  // messages exposed so before-hooks can prepend/modify system prompts.
  // chatId/sessionId let extension hook handlers correlate back to the
  // originating chat step (needed by the AI forensics capture path in
  // treeos-base/ai-forensics.js).
  // parentChatId is resolved from the Chat record so forensics captures
  // can point back to the dispatching call (summarizer → builder,
  // branch → architect, continuation → root). One lookup per LLM call;
  // skipped silently if the chat doc is unavailable.
  const _llmChatCtx = getChatContext(visitorId) || {};
  let _llmParentChatId = null;
  if (_llmChatCtx.chatId) {
    try {
      const { default: _Chat } = await import("../models/chat.js");
      const _chatDoc = await _Chat.findById(_llmChatCtx.chatId).select("parentChatId").lean();
      if (_chatDoc?.parentChatId) _llmParentChatId = String(_chatDoc.parentChatId);
    } catch {}
  }
  const llmHookData = {
    userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
    model: MODEL, messageCount: session.messages.length, hasTools: tools.length > 0,
    messages: session.messages, nodeId: session.currentNodeId || ctx.rootId || null,
    chatId: _llmChatCtx.chatId || null,
    sessionId: _llmChatCtx.sessionId || null,
    parentChatId: _llmParentChatId,
  };
  const llmHookResult = await hooks.run("beforeLLMCall", llmHookData);
  if (llmHookResult.cancelled) {
    throw new Error(llmHookResult.reason || "LLM call rejected");
  }

  // Log the final system prompt preamble (everything hooks injected before the mode prompt).
  // Shows [User Instructions], [Instructions], [Sprout], [Memories], etc. all stacked.
  // Log grammar modifiers injected by beforeLLMCall hooks.
  // Each [Block] maps to a part of speech: adverbs, pronouns, articles, prepositions.
  if (session.messages[0]?.role === "system") {
    const sys = session.messages[0].content;
    const blocks = sys.split("\n").filter(l => l.startsWith("[")).map(l => l.split("]")[0] + "]").slice(0, 10);
    if (blocks.length > 0) {
      log.verbose("Grammar", `[${session.modeKey}] modifiers: ${blocks.join(" ")}`);
    }
  }

  let response;

  // Acquire semaphore slot before LLM call. Prevents thundering herd.
  await acquireLlmSlot(ctx.signal, ctx.llmPriority || LLM_PRIORITY.HUMAN);
  try {
    const failoverResult = await callWithFailover(
      (client, model) => client.chat.completions.create({ ...requestParams, model }, requestOpts),
      clientEntry,
      ctx.userId,
      ctx.rootId || null,
    );
    response = failoverResult.response;
    // If a failover client was used, update tracking
    if (failoverResult.usedClient !== clientEntry) {
      Object.assign(clientEntry, failoverResult.usedClient);
    }

    // afterLLMCall: token metering, billing, analytics, forensics.
    // Includes the full responseText so the AI forensics capture in
    // treeos-base gets "what the AI said" without a second hook.
    hooks.run("afterLLMCall", {
      userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
      model: failoverResult.usedClient?.model || MODEL,
      usage: response?.usage || null,
      hasToolCalls: !!response?.choices?.[0]?.message?.tool_calls?.length,
      chatId: _llmChatCtx.chatId || null,
      sessionId: _llmChatCtx.sessionId || null,
      responseText: response?.choices?.[0]?.message?.content || null,
    }).catch(() => {});
  } catch (apiErr) {
    // Handle models that invent tool names (e.g. "json") instead of using defined tools.
    // Common with cheap/free models on OpenRouter that attempt function calling syntax
    // but use hallucinated tool names. The error contains the model's actual output in
    // failed_generation. We extract the useful text from that output.
    if (apiErr.code === "tool_use_failed" && apiErr.error?.failed_generation) {
      const inventedTool = apiErr.error?.message?.match(/tool '(\w+)'/)?.[1] || "?";
      let extracted = null;

      // Phase 1: Try parsing as JSON and extract from known argument fields
      try {
        const gen = JSON.parse(apiErr.error.failed_generation);
        const args = gen.arguments || gen;
        // Walk common field names that models put their actual response into
        extracted = args.responseHint || args.response || args.content
          || args.summary || args.text || args.message || args.answer;
        // If none matched but arguments exists, serialize it (but not "undefined")
        if (!extracted && gen.arguments && typeof gen.arguments === "object") {
          extracted = JSON.stringify(gen.arguments);
        }
      } catch {
        // Phase 2: JSON parse failed. Try regex extraction from raw text.
        // Check multiple field names, not just responseHint.
        const raw = apiErr.error.failed_generation;
        for (const field of ["responseHint", "response", "content", "summary", "text", "message", "answer"]) {
          const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)(?:"\\s*[,}])`));
          if (match) {
            extracted = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
            break;
          }
        }
        // Phase 3: If still nothing, try to use the raw text itself if it looks like prose
        if (!extracted && raw && !raw.startsWith("{") && !raw.startsWith("<") && raw.length > 10) {
          extracted = raw;
        }
      }

      if (extracted && extracted !== "undefined" && extracted !== "null") {
        log.warn("LLM", `Model invented tool "${inventedTool}". Extracted response from failed_generation (${extracted.length} chars).`);
        response = { choices: [{ message: { role: "assistant", content: extracted }, finish_reason: "stop" }] };

        // Fire afterLLMCall so extension metering still tracks the call
        hooks.run("afterLLMCall", {
          userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
          model: clientEntry?.model || MODEL,
          usage: null, // No usage data available from the error
          hasToolCalls: false,
          _failedGeneration: true,
          chatId: _llmChatCtx.chatId || null,
          sessionId: _llmChatCtx.sessionId || null,
          responseText: extracted || null,
        }).catch(() => {});
      } else {
        log.error("LLM", `Model invented tool "${inventedTool}" but no usable text could be extracted from failed_generation.`);
        throw apiErr;
      }
    } else if ((isJsonEscapeError(apiErr) || isJsonStructuralError(apiErr)) && !session._jsonRetryDone) {
      // Provider rejected the model's tool-call JSON. Two distinct
      // failure modes, two different retry hints. Blind retry of the
      // identical request would fail identically; so we inject a
      // corrective system message tailored to the failure class and
      // signal the caller below to retry ONCE. The retry runs in the
      // same callLLM frame, releasing and re-acquiring its semaphore
      // slot cleanly.
      //
      // session._jsonRetryDone is the per-session guard preventing an
      // infinite retry loop if the model can't produce clean output.
      session._jsonRetryDone = true;
      const errMsg = String(apiErr.message || apiErr.error?.message || "").slice(0, 200);
      const isEscape = isJsonEscapeError(apiErr);
      const failureClass = isEscape ? "escape" : "structural";
      log.warn(
        "LLM",
        `JSON ${failureClass} failure on ${MODEL} (${errMsg}). Retrying once with corrective hint.`,
      );

      // Diagnostic: capture what we sent so we can identify whether
      // upstream truncation is at play. For structural failures the
      // most useful signals are (a) which model + connection was used,
      // (b) total chars in the request messages (input load), and
      // (c) any partial response the upstream returned in
      // failed_generation. If max_tokens is unset on requestParams,
      // print "unset" — provider falls back to its own default and
      // that default is the prime suspect for mid-stream truncation.
      try {
        const totalMessageChars = (session.messages || [])
          .reduce((sum, m) => sum + (typeof m?.content === "string" ? m.content.length : 0), 0);
        const failedGen = apiErr?.error?.failed_generation || apiErr?.error?.failed_response || null;
        const failedGenLen = failedGen ? String(failedGen).length : null;
        const failedGenTail = failedGen
          ? String(failedGen).slice(-200).replace(/\s+/g, " ")
          : null;
        log.warn(
          "LLM",
          `↳ diagnostic: model=${MODEL} ` +
          `connection=${clientEntry?.connectionId ? String(clientEntry.connectionId).slice(0, 8) : "default"} ` +
          `messages=${(session.messages || []).length} ` +
          `inputChars=${totalMessageChars} ` +
          `tools=${tools.length} ` +
          `max_tokens=${requestParams.max_tokens ?? "unset"} ` +
          (failedGenLen != null ? `partialOutputChars=${failedGenLen} ` : "") +
          (failedGenTail ? `tail="${failedGenTail}"` : ""),
        );
      } catch (diagErr) {
        log.debug("LLM", `structural-failure diagnostic skipped: ${diagErr.message}`);
      }

      const escapeHint =
        `The provider could not deserialize one of your tool-call arguments because it contained ` +
        `invalid escape sequences (raw backslashes, backslash followed by a space, or unescaped ` +
        `control characters). RETRY WITH SIMPLER CONTENT: avoid backslashes entirely in tool ` +
        `arguments, keep content ASCII where possible, and prefer prose over literal code / regex / ` +
        `file paths. If you must include code, keep it short and use only simple identifiers.`;

      const structuralHint =
        `The provider could not deserialize your tool-call payload because the JSON envelope itself ` +
        `was malformed at a structural position (unmatched bracket, unexpected token after a key/` +
        `value pair, or a truncated string). This is usually NOT about escape characters — your ` +
        `previous content may have been fine, but the JSON wrapping around it broke. RETRY by: ` +
        `(1) keeping tool-call arguments shorter — split a long file into multiple smaller writes ` +
        `if needed; (2) double-checking that every quote, bracket, and brace in your arguments ` +
        `is balanced; (3) avoiding embedding raw long strings of code that may have triggered a ` +
        `truncation. The fix is structural, not lexical — do not strip backslashes or rewrite as ` +
        `prose unless the content itself was the problem.`;

      session.messages.push({
        role: "system",
        content:
          `Your previous turn failed with a JSON parse error: "${errMsg}". ` +
          (isEscape ? escapeHint : structuralHint),
      });
      ctx._retryJsonEscape = true; // signal to the outer wrapper below
    } else {
      throw apiErr;
    }
  } finally {
    releaseLlmSlot();
  }

  // JSON-escape retry: the catch block above injected a corrective
  // message into session.messages and set ctx._retryJsonEscape. Re-enter
  // callLLM once from a clean slot-acquisition. The session guard
  // (_jsonRetryDone) prevents this branch from firing a second time.
  if (ctx._retryJsonEscape) {
    ctx._retryJsonEscape = false;
    return await callLLM(openai, MODEL, session, tools, ctx, clientEntry, visitorId);
  }

  // Validate response structure. Some LLM providers return malformed responses
  // (missing choices array, null choices, empty array). Normalize to prevent
  // downstream crashes.
  if (!response || !response.choices || !Array.isArray(response.choices)) {
    log.warn("LLM", `LLM returned malformed response (no choices array). Model: ${MODEL}`);
    response = { choices: [{ message: { role: "assistant", content: "I was unable to generate a response. Please try again." }, finish_reason: "stop" }] };
  } else if (response.choices.length === 0) {
    log.warn("LLM", `LLM returned empty choices array. Model: ${MODEL}`);
    response = { choices: [{ message: { role: "assistant", content: "I was unable to generate a response. Please try again." }, finish_reason: "stop" }] };
  } else if (!response.choices[0].message) {
    log.warn("LLM", `LLM returned choice without message. Model: ${MODEL}`);
    response.choices[0].message = { role: "assistant", content: "I was unable to generate a response. Please try again." };
  }

  return response;
}

/**
 * Detect tool-call-like text from bad models, retry without tools.
 * Returns { earlyReturn, breakLoop } or null if no quirk detected.
 * earlyReturn: a value to return directly from processMessage.
 * breakLoop: true if the tool loop should break.
 */
async function handleModelQuirks(assistantMessage, session, tools, openai, MODEL, ctx, isInternal, isCustom, resolvedConnectionId) {
  if (
    !assistantMessage.tool_calls?.length &&
    assistantMessage.content &&
    tools.length > 0
  ) {
    const _content = assistantMessage.content;
    const looksLikeToolCall =
      /<tool_call>/i.test(_content) ||
      /<function[=\s]/i.test(_content) ||
      /```tool_code/i.test(_content);

    if (looksLikeToolCall) {
      log.warn("LLM",
        `Model returned tool-call text instead of function calling (${MODEL}). Retrying without tools.`,
      );

      // Remove the bad assistant message before retrying
      session.messages.pop();

      // Retry through the semaphore to respect concurrency limits
      const requestOpts = ctx.signal ? { signal: ctx.signal } : {};
      let fallbackResponse;
      await acquireLlmSlot(ctx.signal, ctx.llmPriority || LLM_PRIORITY.HUMAN);
      try {
        fallbackResponse = await openai.chat.completions.create(
          {
            model: MODEL,
            messages: [
              ...session.messages,
              {
                role: "system",
                content:
                  "Answer the user's question directly in plain text. Do not use XML, function call, or tool_call syntax.",
              },
            ],
          },
          requestOpts,
        );
      } finally {
        releaseLlmSlot();
      }

      const fallbackChoice = fallbackResponse?.choices?.[0];
      if (fallbackChoice?.message?.content) {
        session.messages.push(fallbackChoice.message);

        if (isInternal) {
          const raw = fallbackChoice.message.content;
          const _llmProvider = {
            isCustom,
            model: MODEL,
            connectionId: resolvedConnectionId || null,
          };
          // Try JSON parse for orchestrator consumption
          try {
            const p = JSON.parse(raw);
            p._llmProvider = _llmProvider;
            return { earlyReturn: p };
          } catch {
            // Model can't produce structured output. Return the raw text
            // as content so the orchestrator can still surface it to the user
            // instead of silently dropping the response.
            return {
              earlyReturn: {
                action: "respond",
                content: raw,
                _noToolSupport: true,
                _llmProvider,
              },
            };
          }
        }
      } else {
        // Fallback produced nothing. Let the original tool-call text through
        // as the response rather than returning nothing.
        log.warn("LLM", `Fallback retry produced no content for ${MODEL}. Using original text.`);
        session.messages.push(assistantMessage);
      }
      return { breakLoop: true };
    }
  }
  return null;
}

/**
 * All the JSON parsing attempts for internal mode responses.
 * Returns the parsed result object.
 */
function parseInternalResponse(raw, isCustom, MODEL, resolvedConnectionId) {
  const _llmProvider = {
    isCustom,
    model: MODEL,
    connectionId: resolvedConnectionId || null,
  };
  try {
    const parsed = JSON.parse(raw);
    parsed._llmProvider = _llmProvider;
    return parsed;
  } catch (err) {
    // Try stripping markdown fences
    try {
      const stripped = raw
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/, "");
      const parsed = JSON.parse(stripped);
      parsed._llmProvider = _llmProvider;
      return parsed;
    } catch (_) {}

    // Try extracting JSON object from text (LLM added preamble before JSON)
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}$/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        parsed._llmProvider = _llmProvider;
        return parsed;
      }
    } catch (_) {}

    // If it looks like truncated JSON, return it as raw context
    // rather than failing — the orchestrator can still use it
    if (raw && (raw.startsWith("{") || raw.startsWith("["))) {
      return { _raw: true, content: raw, _llmProvider };
    }

    // The model produced text that isn't valid JSON. Rather than returning
    // action:"error" (which the orchestrator treats as a failure, giving the
    // user nothing), return action:"respond" with the raw text. The user sees
    // the model's actual answer. This is the common path for cheap/free models
    // that don't follow structured output instructions.
    return {
      action: "respond",
      content: raw,
      _unstructured: true,
      _llmProvider,
    };
  }
}

/**
 * Execute a single tool call: parse args, circuit breaker, beforeToolCall hook,
 * DB health check, callTool, afterToolCall hooks, error handling.
 * Returns { result: toolResultEntry } where toolResultEntry has { tool, args?, success, error? }.
 */
async function executeTool(toolCall, session, ctx, client, visitorId) {
  const toolName = toolCall.function.name;
  let args;

  if (!toolCall.function.arguments || typeof toolCall.function.arguments !== "string") {
    log.error("LLM", `Missing or non-string tool arguments for ${toolName}`);
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: "Missing tool arguments" }),
    });
    return { tool: toolName, success: false, error: "Missing tool arguments" };
  }

  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    log.error("LLM", `Invalid tool arguments for ${toolName}:`, e.message);
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: "Invalid arguments" }),
    });
    return {
      tool: toolName,
      success: false,
      error: "Invalid arguments",
    };
  }

  // Auto-inject userId
  args.userId = ctx.userId;

  // Tool circuit breaker: if this tool has failed too many times in this session, skip it.
  // The tool disappears from the AI's perspective. It adapts by using other tools.
  // One bad API key disables one tool, not the whole tree.
  if (!session._toolFailures) session._toolFailures = {};
  const toolCircuitThreshold = parseInt(getLandConfigValue("toolCircuitThreshold") || "5", 10);
  if ((session._toolFailures[toolName] || 0) >= toolCircuitThreshold) {
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Tool "${toolName}" has been temporarily disabled due to repeated failures. Use a different approach.` }),
    });
    return { tool: toolName, args, success: false, error: "tool_circuit_tripped" };
  }

  // beforeToolCall: extensions can modify args or cancel. chatId +
  // sessionId + nodeId let forensics correlate the tool call to its
  // originating chat step and the tree node whose signalInbox
  // should be snapshotted for signal diffing.
  const _toolChatCtx = getChatContext(visitorId) || {};
  const hookData = {
    toolName, args,
    userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
    chatId: _toolChatCtx.chatId || null,
    sessionId: _toolChatCtx.sessionId || null,
    nodeId: session.currentNodeId || ctx.rootId || null,
  };
  const hookResult = await hooks.run("beforeToolCall", hookData);
  if (hookResult.cancelled) {
    const errCode = hookResult.timedOut ? "HOOK_TIMEOUT" : "HOOK_CANCELLED";
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: hookResult.reason || "Tool call cancelled", code: errCode }),
    });
    return { tool: toolName, args, success: false, error: errCode };
  }
  args = hookData.args;
  const resolvedToolName = hookData.toolName || toolName;

  log.debug("LLM", `🔧 [${session.modeKey}] ${resolvedToolName}`, args);

  // Announce tool call BEFORE it runs. Gives live consumers (CLI, web) a
  // chance to show "running <tool>..." status before the result lands.
  if (ctx.onToolCalled) {
    try { ctx.onToolCalled({ tool: resolvedToolName, args }); }
    catch { /* never let a listener break the tool loop */ }
  }

  // DB health check: if the database is unreachable, tell the AI immediately
  // so it responds to the user instead of retrying blindly with broken hands.
  if (!isDbHealthy()) {
    const dbErr = "Database is currently unavailable. Tell the user the land is experiencing issues and to try again shortly.";
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: dbErr }),
    });
    return { tool: toolName, args, success: false, error: "db_unavailable" };
  }

  try {
    // Tool call timeout: individual tools should not hang longer than the LLM timeout.
    // Most tools complete in < 5s. A 60s ceiling prevents a single tool from blocking
    // the entire conversation loop.
    const toolPromise = client.callTool({
      name: resolvedToolName,
      arguments: args,
    });
    const nodeToolTimeout = session._nodeLlmConfig?.toolCallTimeout ?? TOOL_CALL_TIMEOUT_MS;
    const result = await Promise.race([
      toolPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Tool "${resolvedToolName}" timed out after ${nodeToolTimeout / 1000}s`)), nodeToolTimeout)
      ),
    ]);
    let resultText =
      result?.contents?.[0]?.text ||
      result?.content?.[0]?.text ||
      JSON.stringify(result);
    // Cap tool result size to prevent huge payloads from consuming context window
    const nodeResultMax = session._nodeLlmConfig?.toolResultMaxBytes ?? TOOL_RESULT_MAX_BYTES;
    if (resultText && Buffer.byteLength(resultText, "utf8") > nodeResultMax) {
      // Slice by characters (conservative, may be slightly under byte limit for multi-byte)
      const charEstimate = Math.floor(nodeResultMax * 0.9);
      resultText = resultText.slice(0, charEstimate) + `\n... (truncated, result exceeded ${Math.round(nodeResultMax / 1024)}KB)`;
    }

    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: resultText,
    });

    // Tool circuit breaker: success resets failure count
    delete session._toolFailures[resolvedToolName];

    // afterToolCall (success): fire-and-forget
    hooks.run("afterToolCall", {
      toolName: resolvedToolName, args, result: resultText, success: true,
      userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
      chatId: _toolChatCtx.chatId || null,
      sessionId: _toolChatCtx.sessionId || null,
      nodeId: session.currentNodeId || ctx.rootId || null,
    }).catch(() => {});

    // Return the full result text too so the chat record can store it
    // for audit replay. Consumers that only care about success still
    // work — the extra field is optional.
    return { tool: resolvedToolName, args, result: resultText, success: true };
  } catch (err) {
    log.error("LLM", `❌ Tool ${resolvedToolName} failed:`, err.message);

    // Tool circuit breaker: increment failure count
    session._toolFailures[resolvedToolName] = (session._toolFailures[resolvedToolName] || 0) + 1;
    if (session._toolFailures[resolvedToolName] >= toolCircuitThreshold) {
      log.warn("LLM", `Tool "${resolvedToolName}" tripped after ${toolCircuitThreshold} consecutive failures. Disabled for this session.`);
    }

    // If DB died during tool execution, tell the AI clearly
    const errorMsg = !isDbHealthy()
      ? "Database became unavailable during this operation. Tell the user the land is experiencing issues."
      : err.message;

    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: errorMsg }),
    });

    // afterToolCall (failure): fire-and-forget
    hooks.run("afterToolCall", {
      toolName: resolvedToolName, args, error: err.message, success: false,
      userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
      chatId: _toolChatCtx.chatId || null,
      sessionId: _toolChatCtx.sessionId || null,
      nodeId: session.currentNodeId || ctx.rootId || null,
    }).catch(() => {});

    return {
      tool: resolvedToolName,
      args,
      success: false,
      error: err.message,
    };
  }
}

/**
 * Ensure final text response, push to messages, return the result object.
 */
async function finalizeResponse(session, openai, MODEL, response, isInternal, isCustom, resolvedConnectionId, ctx) {
  // Ensure final text response. If the tool loop ended with no text content
  // (e.g., model returned only tool calls), make one more call to get a summary.
  if (!response?.choices?.[0]?.message?.content) {
    await acquireLlmSlot(ctx?.signal);
    try {
      const finalResponse = await openai.chat.completions.create({
        model: MODEL,
        messages: session.messages,
      });
      response = finalResponse;
    } finally {
      releaseLlmSlot();
    }
  }

  const finalAnswer = response?.choices?.[0]?.message?.content || "Done.";

  // Only push if not already the last message
  if (!isInternal) {
    const lastMsg = session.messages[session.messages.length - 1];
    if (lastMsg?.role !== "assistant" || lastMsg?.content !== finalAnswer) {
      session.messages.push({ role: "assistant", content: finalAnswer });
    }
  }

  // Internal tracking (for Chat finalization, never sent to client)
  const _internal = {
    modeKey: session.modeKey,
    rootId: session.rootId,
    isCustom,
    model: MODEL,
    connectionId: resolvedConnectionId || null,
  };

  return {
    success: true,
    content: finalAnswer,
    answer: finalAnswer,
    _internal,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CHAT PROCESSING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Process a chat message within the current mode.
 */
export async function processMessage(visitorId, message, ctx) {
  const isInternal = ctx?.meta?.internal === true;

  // Phase 1: Session + ancestor snapshot
  const { session, mode } = await ensureSession(visitorId, ctx);

  // Phase 2: Circuit breaker check
  const tripped = checkTreeCircuit(session);
  if (tripped) return tripped;

  // Phase 3: Resolve LLM client + MCP connection
  const llmResult = await resolveLLMClient(ctx, session, visitorId);
  if (llmResult.noLlmResponse) return llmResult.noLlmResponse;
  const { openai, MODEL, isCustom, resolvedConnectionId, client, clientEntry } = llmResult;

  // Phase 4: Prepare conversation (trim, init, add user message)
  await prepareConversation(session, ctx, message, mode, visitorId);

  // Phase 5: Resolve tools for current position
  let { tools } = await resolveToolsForPosition(session);

  // Query constraint: when readOnly is set, only tools registered with readOnlyHint
  // are available. Write tools are filtered before the mode fires. The AI cannot
  // mutate the tree during a query interaction.
  if (ctx.readOnly) {
    const { isToolReadOnly } = await import("../tree/extensionScope.js");
    tools = tools.filter(t => {
      const name = t.function?.name || t.name;
      return name && isToolReadOnly(name);
    });
  }

  // Phase 5b: Resolve LLM config. Three layers: node > mode > land globals.
  // Node config walks metadata.llm.config on ancestors. Mode declares its own needs.
  // Stored on session so callLLM and executeTool can read overrides.
  session._nodeLlmConfig = resolveLlmConfig(session._ancestorSnapshot, mode);

  // Phase 6: Tool calling loop
  let response;
  let iterations = 0;
  const maxIterations = session._nodeLlmConfig.maxToolIterations ?? MAX_TOOL_ITERATIONS;

  // Bounded per-step tool-call budget. When a mode declares maxToolCallsPerStep
  // (or ctx forces one), break out after that many tool calls and signal the
  // caller with _continue: true so an orchestrator can open a new chainIndex
  // step and re-enter this loop on the same session. This keeps each LLM
  // generation short, prevents 5-minute freezes on 27B local models, and turns
  // a fat single-shot tool loop into a readable chain of phases.
  const maxToolCallsPerStep =
    ctx?.maxToolCallsPerStep ??
    mode.maxToolCallsPerStep ??
    null;
  let toolCallsThisStep = 0;
  let continueReason = null;

  while (iterations < maxIterations) {
    if (ctx.signal?.aborted) throw new Error("Request cancelled");
    iterations++;

    // LLM call with semaphore, failover, hooks
    response = await callLLM(openai, MODEL, session, tools, ctx, clientEntry, visitorId);

    const choice = response.choices?.[0];
    if (!choice) break;

    const assistantMessage = choice.message;

    // Always append assistant message to maintain conversation integrity.
    // Tool results MUST follow their corresponding assistant tool_call message.
    session.messages.push(assistantMessage);

    // Surface intermediate assistant prose as "thinking". When the model
    // writes something like "ok let me check the plan before I act" before
    // emitting a tool_call, that text explains its next move in plain
    // English. Previously it was only preserved in session.messages; now
    // we push it to any live consumer (CLI, web) so the user sees the
    // train of thought in real time. Fires on every iteration that still
    // has tool_calls queued — the final prose-only turn becomes the
    // answer through the normal break path below.
    if (
      ctx.onThinking &&
      assistantMessage.tool_calls?.length &&
      typeof assistantMessage.content === "string" &&
      assistantMessage.content.trim().length > 0
    ) {
      try { ctx.onThinking({ text: assistantMessage.content, modeKey: session.modeKey }); }
      catch { /* never let a listener break the loop */ }
    }

    // Detect models returning tool-call text instead of proper function calling
    const quirk = await handleModelQuirks(assistantMessage, session, tools, openai, MODEL, ctx, isInternal, isCustom, resolvedConnectionId);
    if (quirk?.earlyReturn) return quirk.earlyReturn;
    if (quirk?.breakLoop) break;

    // No tool calls: parse internal response or break
    if (!assistantMessage.tool_calls?.length) {
      if (isInternal) return parseInternalResponse(assistantMessage.content, isCustom, MODEL, resolvedConnectionId);
      break;
    }

    // Execute tool calls
    const toolResults = [];
    for (const toolCall of assistantMessage.tool_calls) {
      if (ctx.signal?.aborted) throw new Error("Request cancelled");
      const _toolStart = Date.now();
      const toolResult = await executeTool(toolCall, session, ctx, client, visitorId);
      const _toolMs = Date.now() - _toolStart;
      toolResults.push(toolResult);
      toolCallsThisStep++;

      // Persist the tool call on the active Chat record so the step
      // trace is visible in chat history (CLI `chats` and dashboard).
      // Fire-and-forget: the user already got the tool result via the
      // tool_result message, this is just audit/history logging.
      try {
        const chatCtx = getChatContext(visitorId);
        if (chatCtx?.chatId) {
          appendToolCall(chatCtx.chatId, {
            tool: toolResult.tool,
            args: toolResult.args,
            result: toolResult.result,
            success: toolResult.success,
            error: toolResult.error,
            ms: _toolMs,
          });
        }
      } catch {}

      // Track edits-per-file so the rewriteOverEdits facet can inject
      // a whole-file-rewrite warning after the 2nd edit to the same file.
      if (toolResult.tool === "workspace-edit-file" && toolResult.success) {
        try {
          const filePath = toolResult.args?.filePath || toolResult.args?.path || null;
          if (filePath) {
            if (!session._editsByFile) session._editsByFile = {};
            session._editsByFile[filePath] = (session._editsByFile[filePath] || 0) + 1;
          }
        } catch {}
      }
    }

    // Bounded step: if the mode wants step-bounded tool calls, break the
    // loop after the budget is spent. The assistant message with tool_calls
    // and all corresponding tool results are already in session.messages,
    // so re-entering the loop on a fresh step picks up cleanly.
    if (maxToolCallsPerStep && toolCallsThisStep >= maxToolCallsPerStep) {
      continueReason = "tool-cap";
      break;
    }

    // Yield tool results for real-time frontend updates
    if (ctx.onToolResults) {
      ctx.onToolResults(toolResults);
    }

    // Place mode: tool calls are the whole point. Once at least one has
    // succeeded, stop — don't re-invoke the LLM just to generate prose
    // the user will never see (place mode hides the answer). Saves a
    // full LLM round-trip per placement turn and stops the AI from
    // echoing macros/summaries into a chat record nobody reads.
    if (ctx.skipRespond && toolResults.some((r) => r?.success !== false)) {
      continueReason = "place-done";
      break;
    }

    // Mid-flight checkpoint: let callers inject user updates between tool iterations.
    // Same pattern as onToolResults. Optional callback. Zero overhead if unused.
    if (ctx.onToolLoopCheckpoint) {
      const update = await ctx.onToolLoopCheckpoint();
      if (update?.inject) {
        session.messages.push({ role: "user", content: update.inject });
      }
      if (update?.abort) {
        break;
      }
    }

    // Mid-conversation compression: when messages pile up during long tool chains,
    // compress older messages into a summary. Keeps the AI focused.
    // Config: conversationCompression (bool), compressionThreshold (int), compressionKeep (int)
    // Per-node override: metadata.llm.config.compressionThreshold / compressionKeep
    const compEnabled = session._nodeLlmConfig?.compressionThreshold !== undefined
      ? true // node-level config implies enabled
      : COMPRESSION_ENABLED();
    if (compEnabled) {
      const compThreshold = session._nodeLlmConfig?.compressionThreshold ?? COMPRESSION_THRESHOLD();
      const compKeep = session._nodeLlmConfig?.compressionKeep ?? COMPRESSION_KEEP();
      await compressConversation(session, compThreshold, compKeep);
    }
  }

  // Phase 7: Finalize response.
  // If we broke out of the loop because the step-bounded tool budget was hit,
  // skip the "ensure final text" call in finalizeResponse — the model was
  // actively tool-calling, not wrapping up. The caller (orchestrator) will
  // re-enter on a new chainIndex step with continuation: true.
  // Place mode (continueReason === "place-done") also short-circuits here:
  // the tools ran, the user won't see prose, no reason to spin up another
  // LLM turn just to generate text we'll discard.
  if (continueReason === "tool-cap" || continueReason === "place-done") {
    const _internal = {
      modeKey: session.modeKey,
      rootId: session.rootId,
      isCustom,
      model: MODEL,
      connectionId: resolvedConnectionId || null,
    };
    session._hasHadFirstTurn = true;
    return {
      success: true,
      content: "",
      answer: "",
      _internal,
      _continue: continueReason === "tool-cap",
      _continueReason: continueReason,
    };
  }

  session._hasHadFirstTurn = true;
  return finalizeResponse(session, openai, MODEL, response, isInternal, isCustom, resolvedConnectionId, ctx);
}

// ─────────────────────────────────────────────────────────────────────────
// CONTEXT INJECTION (frontend sync events)
// ─────────────────────────────────────────────────────────────────────────

export function injectContext(visitorId, content) {
  const session = getSession(visitorId);
  if (session.messages.length > 0) {
    // Cap injected context to prevent an extension from consuming the entire context window
    const MAX_INJECT_SIZE = 32000;
    const safeContent = typeof content === "string"
      ? (content.length > MAX_INJECT_SIZE ? content.slice(0, MAX_INJECT_SIZE) + "\n... (context truncated)" : content)
      : String(content).slice(0, MAX_INJECT_SIZE);
    session.messages.push({ role: "system", content: safeContent });
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// SESSION ACCESSORS
// ─────────────────────────────────────────────────────────────────────────

export function setRootId(visitorId, rootId) {
  const session = getSession(visitorId);
  // Cross-tree leak protection. The session map is keyed by visitorId
  // only, so a single visitor switching between trees would otherwise
  // carry forward the previous tree's currentNodeId — pinBranchPosition
  // and other dispatch paths set currentNodeId during a swarm, and
  // those values reference nodes inside the previous tree. After a
  // tree switch, getCurrentNodeId would return the stale node id
  // (because it prefers currentNodeId over rootId), and enrichContext
  // would walk from there, loading the OLD tree's plan / files /
  // contracts into the new conversation. Symptom: a fresh project
  // chat sees another project's data and "rebuilds" against it.
  //
  // On a genuine rootId change, clear currentNodeId so the next
  // getCurrentNodeId falls back cleanly to the new rootId. Same-rootId
  // calls leave currentNodeId untouched (typical mid-conversation
  // re-stamp).
  if (session.rootId && rootId && String(session.rootId) !== String(rootId)) {
    session.currentNodeId = null;
  }
  session.rootId = rootId;
}

export function getRootId(visitorId) {
  return getSession(visitorId).rootId;
}

export function setCurrentNodeId(visitorId, nodeId) {
  const session = getSession(visitorId);
  session.currentNodeId = nodeId;
}

export function getCurrentNodeId(visitorId) {
  const session = getSession(visitorId);
  return session.currentNodeId || session.rootId || null;
}

export function getCurrentMode(visitorId) {
  return getSession(visitorId).modeKey;
}


export function clearSession(visitorId) {
  sessions.delete(visitorId);
}

/**
 * Reset a visitor's in-memory session state after an abort so the next
 * message starts clean. Keeps mode / rootId / currentNodeId intact, but
 * throws away the message history (which may contain a half-finished
 * tool loop or a cancelled LLM call). The system prompt is rebuilt on
 * the next processMessage call via prepareConversation.
 *
 * Also clears the AI chat context so appendToolCall/finalizeChat don't
 * write to a stale chatId from the previous run.
 *
 * Called from the abort path in runOrchestration (CLI disconnect,
 * timeout, explicit signal). The tree state (masterPlan, files on disk,
 * metadata) is left alone — that's the authoritative state and persists
 * across reruns.
 */
export function resetVisitorSession(visitorId, reason = "aborted") {
  const session = sessions.get(visitorId);
  if (session) {
    // Drop the accumulated messages entirely. The system prompt gets
    // rebuilt fresh on the next prepareConversation call using the
    // current mode + tree position.
    session.messages = [];
    // Reset any in-loop state markers
    session._toolFailures = {};
    delete session._nodeLlmConfig;
  }
  // Fire-and-forget: clear chat context so next message starts from a
  // clean slate. clearChatContext is in chatTracker but we already have
  // it imported via other call sites.
  import("./chatTracker.js").then(({ clearChatContext }) => {
    try { clearChatContext(visitorId); } catch {}
  }).catch(() => {});

  log.info("LLM", `🧹 Reset session for ${visitorId} (reason: ${reason})`);
}

/**
 * Reset conversation messages but keep mode and rootId intact.
 * Rebuilds system prompt for the current mode.
 */
export async function resetConversation(visitorId, ctx) {
  const session = getSession(visitorId);
  if (!session.modeKey) return;

  const systemPrompt = await buildPromptForMode(session.modeKey, {
    username: ctx.username,
    userId: ctx.userId,
    rootId: session.rootId,
    currentNodeId: session.currentNodeId,
    enrichedContext: session._lastEnrichedContext || null,
    isFirstTurn: !session._hasHadFirstTurn,
    editsByFile: session._editsByFile || {},
  });

  session.messages = [{ role: "system", content: systemPrompt }];
  log.debug("LLM",
    `🔄 Reset conversation for ${visitorId} (mode: ${session.modeKey}, root: ${session.rootId})`,
  );
}

export function sessionCount() {
  return sessions.size;
}

/**
 * High-level chat utility for extensions and routes.
 * Handles all boilerplate: MCP connection, mode switch, Chat tracking,
 * processMessage, cleanup. One call.
 *
 * Session routing — three paths in:
 *   1. `aiSessionKey`: caller provides the key directly (pass-through from
 *      an upstream runOrchestration that wants this sub-call to join the
 *      user's session, or an extension joining a named internal lane).
 *   2. `scope` + `purpose`: declare a named internal lane. Kernel assembles
 *      `tree-internal:${rootId}:${purpose}[:${extra}]` /
 *      `home-internal:${userId}:${purpose}[:${extra}]` /
 *      `land-internal:${purpose}[:${extra}]`. Persists across runs.
 *   3. Neither: ephemeral. Fresh `ephemeral:${uuid}` per call, one-shot.
 *
 * Default is ephemeral. Extensions that want cross-run memory declare it
 * explicitly via scope/purpose. User keys are built by runOrchestration
 * (not here) from entry-point ingredients.
 *
 * Usage:
 *   // Fire-and-forget (default)
 *   await runChat({ userId, message, mode });
 *
 *   // Named internal lane with cross-run memory
 *   await runChat({ userId, message, mode, scope: "tree", purpose: "reflect", rootId });
 *
 *   // Parallel chains within a lane
 *   await runChat({ ..., scope: "tree", purpose: "analyze", extra: "security", rootId });
 *
 *   // Join an upstream user session
 *   await runChat({ ..., aiSessionKey: userKeyFromCaller });
 */
export async function runChat({
  userId, username, message, mode,
  rootId = null, nodeId = null,
  signal = null, res = null, llmPriority = null,
  onToolResults = null, onToolCalled = null, onThinking = null,
  treeContext = null,

  // AI-chat session routing — three paths:
  //   aiSessionKey    explicit pass-through (extension joining upstream session)
  //   scope+purpose   declared internal lane (tree/home/land + optional extra)
  //   neither         fresh ephemeral key (default)
  aiSessionKey = null,
  scope = null,
  purpose = null,
  extra = null,
  source = null,
}) {
  if (!userId || !message || !mode) {
    throw new Error("runChat requires userId, message, and mode");
  }

  // Auto-abort on client disconnect if Express res object is provided
  let _autoAbort = null;
  if (res && !signal) {
    _autoAbort = new AbortController();
    signal = _autoAbort.signal;
    res.on("close", () => { if (!res.writableEnded) _autoAbort.abort(); });
  }

  const jwt = (await import("jsonwebtoken")).default;
  const { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL } = await import("../ws/mcp.js");
  const { startChat, finalizeChat, setChatContext } = await import("./chatTracker.js");
  const { setSessionAbort, clearSessionAbort } = await import("../ws/sessionRegistry.js");
  const { resolveInternalAiSessionKey } = await import("./sessionKeys.js");

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) throw new Error("JWT_SECRET not configured");

  // Resolve the ai-chat session key (shared with OrchestratorRuntime).
  const { key: resolvedKey, persist: persistSession } = resolveInternalAiSessionKey({
    aiSessionKey, scope, purpose, extra, userId, rootId,
  });

  // Internal alias — the rest of this function keeps the historical name
  // `visitorId` for the ai-chat session key, since every downstream helper
  // (setRootId, setCurrentNodeId, MCP cache, abort registry, chatTracker)
  // already treats it as the session identifier.
  const visitorId = resolvedKey;

  let sessionId;
  if (persistSession) {
    if (!_runChatSessions.has(visitorId)) {
      if (_runChatSessions.size >= MAX_CONVERSATION_SESSIONS) {
        const first = _runChatSessions.keys().next().value;
        _runChatSessions.delete(first);
      }
      _runChatSessions.set(visitorId, crypto.randomUUID());
    }
    sessionId = _runChatSessions.get(visitorId);
  } else {
    sessionId = crypto.randomUUID();
  }

  // Abort controller for cancellation (Ctrl+C, timeout, etc.)
  const abort = signal ? null : new AbortController();
  const abortSignal = signal || abort.signal;

  // Register abort so external callers can cancel via sessionRegistry
  // Skip if caller provided a signal (the caller already registered their own abort)
  if (abort) setSessionAbort(visitorId, abort);

  // 1. Connect MCP (reuse if already connected)
  // Skip if caller provided an aiSessionKey (they already connected MCP for this session)
  if (!aiSessionKey && !getMCPClient(visitorId)) {
    const internalJwt = jwt.sign(
      { userId: userId.toString(), username: username || "unknown", visitorId },
      JWT_SECRET,
      { expiresIn: "24h" }
    );
    try {
      await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);
    } catch (err) {
      log.warn("RunChat", `MCP connect failed: ${err.message}`);
    }
  }

  // 2. Set root/node if provided
  if (rootId) setRootId(visitorId, rootId);
  if (nodeId) setCurrentNodeId(visitorId, nodeId);

  // 3. Switch mode only if different
  const currentMode = getCurrentMode(visitorId);
  if (currentMode !== mode) {
    try {
      await switchMode(visitorId, mode, { username, userId, currentNodeId: getCurrentNodeId(visitorId) });
    } catch (err) {
      log.warn("RunChat", `Mode switch to ${mode} failed: ${err.message}`);
    }
  }

  // 4. Create Chat record
  let chat;
  try {
    const clientInfo = await getClientForUser(userId, visitorId) || {};
    // runChat callers can provide a `treeContext` (room-agent delivery
    // passes { targetNodeId, roomNodeId, roomSubId } so the chat shows
    // up on the tree's chats page AND carries the room link). Default
    // falls back to rootId-only when caller didn't specify.
    const mergedTreeContext = treeContext || (rootId ? { targetNodeId: rootId } : undefined);
    chat = await startChat({
      userId,
      sessionId,
      message,
      modeKey: mode,
      ...(source ? { source } : {}),
      llmProvider: {
        isCustom: clientInfo.isCustom || false,
        model: clientInfo.model || "unknown",
        connectionId: clientInfo.connectionId || null,
      },
      treeContext: mergedTreeContext,
    });
    if (chat) setChatContext(visitorId, sessionId, chat._id);
  } catch (err) {
    log.warn("RunChat", `Chat create failed: ${err.message}`);
  }

  // 5. Run processMessage with abort signal
  let result;
  try {
    result = await processMessage(visitorId, message, {
      username,
      userId,
      rootId,
      currentNodeId: getCurrentNodeId(visitorId),
      signal: abortSignal,
      llmPriority,
      onToolResults,
      onToolCalled,
      onThinking,
    });
  } catch (err) {
    if (chat) {
      const stopped = abortSignal.aborted;
      try { await finalizeChat({ chatId: chat._id, content: stopped ? null : `Error: ${err.message}`, stopped }); } catch {}
    }
    if (abort) clearSessionAbort(visitorId);
    throw err;
  }

  const stopped = abortSignal.aborted;
  let answer = stopped ? null : (result?.content || result?.answer || "No response.");

  // 6. beforeResponse hook: extensions clean/modify the response before delivery.
  // Centralized here so every caller (CLI /home/chat, websocket, scheduled jobs)
  // gets the same treatment without each route having to remember to fire it.
  if (answer && !stopped) {
    try {
      const hookData = { content: answer, userId, rootId, mode };
      await hooks.run("beforeResponse", hookData);
      answer = hookData.content;
    } catch {}
  }

  // 7. Finalize Chat
  if (chat) {
    try {
      const internal = result?._internal || {};
      await finalizeChat({ chatId: chat._id, content: stopped ? null : answer, stopped, modeKey: internal.modeKey || mode });
    } catch {}
  }

  // 8. Clear abort (keep session + MCP alive for next message in same mode)
  // Only clear if we created our own abort controller
  if (abort) clearSessionAbort(visitorId);

  return {
    answer,
    chatId: chat?._id || null,
    modeKey: mode,
    visitorId,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// runOrchestration: universal entry point for user-facing chat flows.
//
// This is the canonical orchestration primitive. Every user-facing entry
// point (HTTP routes, websocket, gateway extensions) calls this. It handles:
//   - Transport session lifecycle (sessionRegistry create/end)
//   - Conversation visitorId building (zone+rootId+userId pattern)
//   - MCP connection
//   - Chat record create/finalize
//   - Request enqueue serialization
//   - Abort handling (caller signal, res.close, timeout)
//   - Orchestrator dispatch via registry, with fallback to processMessage
//   - beforeResponse hook firing (exactly once, except in place mode)
//   - Cleanup in all paths
//
// Use runChat() for background single-LLM-call work in extensions.
// Use runOrchestration() for anything where a real user is waiting.
// ─────────────────────────────────────────────────────────────────────────
export async function runOrchestration({
  zone,                                  // "tree" | "home" | "land" - required
  userId,                                // required
  username = null,
  message,                               // required
  rootId = null,                         // required for tree zone
  currentNodeId = null,
  device = null,                         // "dashboard" | "cli" | "http" | `${gateway}:${extId}` - per-reach decoupler
  handle = null,                         // overrides device when present (explicit merge or side-thread)
  sessionId: providedSessionId = null,   // Websocket passes its existing transport session
  aiSessionKey: providedAiSessionKey = null,  // explicit key pass-through (websocket's _pvId)
  socket = null,                         // Websocket passes the socket for tool emit
  signal = null,                         // Caller-provided abort signal
  res = null,                            // For HTTP auto-abort on disconnect
  llmPriority = null,
  orchestrateFlags = {},                 // { skipRespond, forceQueryOnly, behavioral }
  sourceType = null,                     // For Chat record source field (legacy alias)
  chatSource = "api",                    // Chat record source: "user" | "api" | "public-query" | "background"
  isPublicQuery = false,
  clientOverride = null,                 // For canopy proxy public queries
  onChatCreated = null,                  // Callback fired right after Chat record exists
  onToolResults = null,
  onToolCalled = null,                   // Announce tool calls BEFORE they run
  onThinking = null,                     // Mid-turn assistant prose (reasoning)
  onToolLoopCheckpoint = null,
}) {
  if (!userId || !message || !zone) {
    throw new Error("runOrchestration requires zone, userId, and message");
  }
  if (zone === "tree" && !rootId) {
    throw new Error("runOrchestration tree zone requires rootId");
  }

  // Lazy imports (avoid circular deps and keep boot light)
  const jwtMod = (await import("jsonwebtoken")).default;
  const { closeMCPClient, getMCPClient } = await import("../ws/mcp.js");
  const { startChat, finalizeChat, setChatContext, clearChatContext } = await import("./chatTracker.js");
  const {
    createSession,
    endSession,
    setSessionAbort,
    clearSessionAbort,
    SESSION_TYPES,
    registerSessionType,
  } = await import("../ws/sessionRegistry.js");
  const { enqueue } = await import("../ws/requestQueue.js");
  const { getOrchestrator } = await import("../orchestrators/registry.js");
  const { nullSocket } = await import("../orchestrators/helpers.js");
  const { ProtocolError, ERR } = await import("../protocol.js");
  const { buildUserAiSessionKey } = await import("./sessionKeys.js");

  // Phantom-rootId guard. Browser localStorage / session caches can
  // pin a rootId that points to a deleted (or never-completed) tree.
  // Subsequent chats then ship that ghost id, the orchestrator stores
  // it in memory via setRootId, and downstream code paths chew through
  // null lookups across walks, classifiers, and prompt builders —
  // observed to allocate without bound and crash a 4GB heap before any
  // routing log fires. Reject early with a clean error so the client
  // can clear its cached state instead of pinning the server in a
  // broken loop. Cheap: one indexed _id lookup per tree-zone request.
  if (zone === "tree" && rootId) {
    const rootDoc = await Node.findById(rootId).select("_id").lean();
    if (!rootDoc) {
      throw new ProtocolError(
        404,
        ERR.TREE_NOT_FOUND,
        `Tree root ${String(rootId).slice(0, 8)} does not exist. ` +
        `Your client likely has a stale rootId cached from a deleted ` +
        `tree — clear browser localStorage / session storage and reconnect.`,
      );
    }
  }

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) throw new Error("JWT_SECRET not configured");

  // Ensure session types are registered for fallback zones
  if (!SESSION_TYPES.API_HOME_CHAT) registerSessionType("API_HOME_CHAT", "api-home-chat");
  if (!SESSION_TYPES.API_LAND_CHAT) registerSessionType("API_LAND_CHAT", "api-land-chat");

  // ── Build ai-chat session key for conversation continuity ─────────────
  // Canonical shape: user:${userId}:${anchor}:${suffix}
  // where anchor is rootId (tree) or "home"/"land", and suffix is
  // `handle` (explicit override) or `device` (default, per-reach split).
  //
  // `visitorId` is the historical variable name for the ai-chat session
  // key throughout this file and its collaborators (MCP cache, session
  // state, chatTracker, sessionRegistry). See the block comment near
  // the `sessions` Map declaration for why the name is preserved.
  //
  // Priority: providedAiSessionKey (pass-through) > minted from pieces.
  let visitorId = providedAiSessionKey || null;
  if (!visitorId) {
    visitorId = buildUserAiSessionKey({ userId, zone, rootId, device, handle });
  }

  // ── Build sessionRegistry session for transport tracking ──────────────
  // If caller provided sessionId (websocket has its own), reuse it.
  // Otherwise create one via sessionRegistry. scopeKey enables idle reuse
  // so back-to-back HTTP calls from the same browser tab share a session.
  let sessionId = providedSessionId;
  let weCreatedSession = false;

  if (!sessionId) {
    // scopeKey drives idle transport-session reuse. visitorId already
    // encodes (user, zone, rootId, device/handle) so it's the natural
    // scope. Two different devices at the same tree get different
    // visitorIds → different scopeKeys → no crossover.
    const scopeKey = visitorId;

    const sessionType =
      zone === "tree"
        ? (orchestrateFlags.skipRespond
            ? SESSION_TYPES.API_TREE_PLACE
            : orchestrateFlags.forceQueryOnly
              ? SESSION_TYPES.API_TREE_QUERY
              : SESSION_TYPES.API_TREE_CHAT)
        : (zone === "home" ? SESSION_TYPES.API_HOME_CHAT : SESSION_TYPES.API_LAND_CHAT);

    const tag = handle || device || null;
    const description = zone === "tree"
      ? `${zone} ${orchestrateFlags.skipRespond ? "place" : orchestrateFlags.forceQueryOnly ? "query" : "chat"} on root ${rootId}${tag ? ` [${tag}]` : ""}${isPublicQuery ? " (public)" : ""}`
      : `${zone} chat${tag ? ` [${tag}]` : ""}`;

    const created = createSession({
      userId,
      type: sessionType,
      scopeKey,
      description,
      meta: { rootId, visitorId, isPublicQuery, handle, device, zone },
    });
    sessionId = created.sessionId;
    weCreatedSession = true;
  }

  // ── Setup abort controller ────────────────────────────────────────────
  const abort = new AbortController();
  if (signal) {
    if (signal.aborted) abort.abort();
    else signal.addEventListener("abort", () => abort.abort(), { once: true });
  }
  if (res) {
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
  }
  setSessionAbort(sessionId, abort);

  // ── Timeout ────────────────────────────────────────────────────────────
  const TIMEOUT_MS = Number(getLandConfigValue("apiOrchestrationTimeout")) || (45 * 60 * 1000);
  let timedOut = false;
  let chat = null;

  const timer = setTimeout(() => {
    timedOut = true;
    log.error("Orchestration", `Zone ${zone} timed out after ${TIMEOUT_MS / 1000}s: ${visitorId}`);
    abort.abort();
  }, TIMEOUT_MS);

  // ── Create Chat record ────────────────────────────────────────────────
  // Use the existing conversation mode if set (preserves websocket behavior
  // where the Chat is tagged with the actual current mode), otherwise fall
  // back to a zone+flags default.
  try {
    const clientInfo = clientOverride || (await getClientForUser(userId, visitorId)) || {};
    const existingMode = getCurrentMode(visitorId);
    const defaultModeKey = zone === "tree"
      ? `tree:${orchestrateFlags.skipRespond ? "place" : orchestrateFlags.forceQueryOnly ? "query" : "chat"}`
      : `${zone}:default`;
    const modeKeyForChat = existingMode || defaultModeKey;
    const resolvedSource = isPublicQuery ? "public-query" : (chatSource || "api");
    chat = await startChat({
      userId,
      sessionId,
      message: message.slice(0, 5000),
      source: resolvedSource,
      modeKey: modeKeyForChat,
      llmProvider: {
        isCustom: clientInfo.isCustom || false,
        model: clientInfo.model || "unknown",
        connectionId: clientInfo.connectionId || null,
      },
      ...(rootId ? { treeContext: { targetNodeId: rootId } } : {}),
    });
    if (chat) {
      setChatContext(visitorId, sessionId, chat._id);
      if (typeof onChatCreated === "function") {
        try { onChatCreated(chat); } catch (e) { log.warn("Orchestration", `onChatCreated failed: ${e.message}`); }
      }
    }
  } catch (err) {
    log.warn("Orchestration", `Failed to create Chat: ${err.message}`);
  }

  // ── Centralized cleanup, runs in all exit paths ───────────────────────
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(timer);
    clearChatContext(visitorId);
    clearSessionAbort(sessionId);
    if (weCreatedSession) {
      try { endSession(sessionId); } catch {}
    }
  };

  // ── Main orchestration body, serialized per session ───────────────────
  let result = null;
  let executionError = null;

  try {
    await enqueue(sessionId, async () => {
      try {
        // Connect MCP for this visitor (skip if already connected)
        if (!getMCPClient(visitorId)) {
          const internalJwt = jwtMod.sign(
            { userId: userId.toString(), username: username || "unknown", visitorId },
            JWT_SECRET,
            { expiresIn: "1h" },
          );
          try {
            // connectToMCP and MCP_SERVER_URL imported at top of file
            await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);
          } catch (err) {
            log.warn("Orchestration", `MCP connect failed: ${err.message}`);
          }
        }

        // Set rootId/currentNodeId in conversation session
        if (rootId) setRootId(visitorId, rootId);
        if (currentNodeId) {
          const previousNodeId = getCurrentNodeId(visitorId);
          const backToRoot = String(currentNodeId) === String(rootId)
            && previousNodeId && String(previousNodeId) !== String(rootId);
          if (backToRoot) {
            // User navigated back to tree root. Fresh conversation.
            clearSession(visitorId);
            if (rootId) setRootId(visitorId, rootId);
          }
          setCurrentNodeId(visitorId, currentNodeId);
        }

        // Dispatch: orchestrator if registered for the zone, else processMessage
        const orch = getOrchestrator(zone);

        if (orch) {
          result = await orch.handle({
            visitorId,
            message: message.trim(),
            socket: socket || nullSocket,
            username,
            userId,
            signal: abort.signal,
            sessionId,
            rootId,
            rootChatId: chat?._id || null,
            sourceType: sourceType || `${zone}-chat`,
            onToolLoopCheckpoint,
            onToolResults,
            onToolCalled,
            onThinking,
            ...orchestrateFlags,
          });
        } else {
          // No orchestrator: single-mode fallback (home, land currently)
          const defaultMode = `${zone}:default`;
          const currentMode = getCurrentMode(visitorId);
          if (currentMode !== defaultMode) {
            try {
              await switchMode(visitorId, defaultMode, {
                username, userId, currentNodeId: getCurrentNodeId(visitorId),
              });
            } catch (err) {
              log.warn("Orchestration", `Mode switch to ${defaultMode} failed: ${err.message}`);
            }
          }
          result = await processMessage(visitorId, message, {
            username,
            userId,
            rootId,
            currentNodeId: getCurrentNodeId(visitorId),
            signal: abort.signal,
            llmPriority,
            onToolResults,
            onToolCalled,
            onThinking,
            onToolLoopCheckpoint,
          });
        }
      } catch (err) {
        executionError = err;
      }
    });
  } catch (err) {
    executionError = executionError || err;
  }

  clearTimeout(timer);

  // ── Timeout takes precedence ──────────────────────────────────────────
  if (timedOut) {
    closeMCPClient(visitorId);
    if (chat) {
      finalizeChat({
        chatId: chat._id,
        content: "Error: Request timed out",
        stopped: false,
      }).catch(() => {});
    }
    // Reset in-memory session so the next message starts clean. Tree
    // state persists; only the LLM conversation history gets wiped.
    resetVisitorSession(visitorId, "timeout");
    cleanup();
    throw new ProtocolError(500, ERR.TIMEOUT, "Request timed out");
  }

  // ── Execution error from inside the enqueue body ──────────────────────
  if (executionError) {
    if (chat) {
      const stopped = abort.signal.aborted;
      finalizeChat({
        chatId: chat._id,
        content: stopped ? null : `Error: ${executionError.message}`,
        stopped,
      }).catch(() => {});
    }
    // Reset session state on any execution error (aborted or otherwise).
    // Tree state survives; conversation history does not.
    resetVisitorSession(visitorId, abort.signal.aborted ? "aborted" : "error");
    cleanup();
    throw executionError;
  }

  // ── Normalize result shape ────────────────────────────────────────────
  const stopped = abort.signal.aborted;
  let answer = null;
  let success = true;
  let stepSummaries = [];
  let lastTargetPath = null;
  let targetNodeId = null;
  let lastTargetNodeId = null;
  let modeKey = null;
  let reason = null;

  if (result) {
    answer = stopped ? null : (result.answer ?? result.content ?? null);
    success = result.success !== false;
    stepSummaries = result.stepSummaries || [];
    lastTargetPath = result.lastTargetPath || null;
    targetNodeId = result.targetNodeId || null;
    lastTargetNodeId = result.lastTargetNodeId || null;
    modeKey = result.modeKey || (result._internal && result._internal.modeKey) || null;
    reason = result.reason || null;
  }

  // ── beforeResponse hook (skip for place mode) ─────────────────────────
  if (answer && !stopped && !orchestrateFlags.skipRespond) {
    try {
      const hookData = {
        content: answer,
        userId,
        rootId,
        mode: modeKey || `${zone}:default`,
      };
      await hooks.run("beforeResponse", hookData);
      answer = hookData.content;
    } catch {}
  }

  // ── Finalize Chat ─────────────────────────────────────────────────────
  if (chat) {
    try {
      const summary = orchestrateFlags.skipRespond
        ? (stepSummaries.length ? `Placed: ${stepSummaries.length} step(s)` : null)
        : (answer || reason || null);
      finalizeChat({
        chatId: chat._id,
        content: stopped ? null : summary,
        stopped,
        modeKey: modeKey || (zone === "tree" ? "tree:orchestrator" : `${zone}:default`),
      }).catch((err) => log.error("Orchestration", `Chat finalize failed: ${err.message}`));
    } catch {}
  }

  // If the request was aborted mid-flight (CLI disconnect, explicit
  // signal), wipe the in-memory session so the next message starts
  // clean. Tree state survives; only conversation history is cleared.
  if (stopped) {
    resetVisitorSession(visitorId, "aborted");
  }

  cleanup();

  return {
    answer,
    success,
    stepSummaries,
    lastTargetPath,
    targetNodeId,
    lastTargetNodeId,
    modeKey,
    reason,
    chatId: chat?._id || null,
    visitorId,
    sessionId,
    stopped,
  };
}

// runPipeline moved to seed/orchestrators/pipeline.js
