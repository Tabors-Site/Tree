// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// ws/conversation.js
// Mode-aware conversation state management and chat processing
import log from "../log.js";
import { hooks } from "../hooks.js";

import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import User from "../models/user.js";
import Node from "../models/node.js";
import { snapshotAncestors } from "../tree/ancestorCache.js";
import { isDbHealthy } from "../dbConfig.js";
import LlmConnection from "../models/llmConnection.js";
import {
  getMode,
  getDefaultMode,
  getToolsForMode,
  buildPromptForMode,
  CARRY_MESSAGES,
} from "./modes/registry.js";
import { mcpClients, connectToMCP, MCP_SERVER_URL } from "./mcp.js";
import { getLandConfigValue } from "../landConfig.js";

import { resolveAndValidateHost } from "../llm/connections.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT LLM CLIENT (your server)
// ─────────────────────────────────────────────────────────────────────────

let DEFAULT_MODEL = process.env.AI_MODEL || "qwen3.5:27b";
let MAX_MESSAGES = 30;
let MAX_TOOL_ITERATIONS = 15;
let LLM_TIMEOUT_MS = 15 * 60 * 1000;
let LLM_MAX_RETRIES = 3;
const MODE_TIMEOUTS = {};

// ── Kernel config setters (called from startup.js after land config loads) ──
export function setKernelConfig(key, value) {
  const num = Number(value);
  switch (key) {
    case "llmTimeout": LLM_TIMEOUT_MS = num * 1000; break;
    case "llmMaxRetries": LLM_MAX_RETRIES = num; break;
    case "maxToolIterations": MAX_TOOL_ITERATIONS = num; break;
    case "maxConversationMessages": MAX_MESSAGES = num; break;
    case "defaultModel": DEFAULT_MODEL = String(value); break;
  }
}
export function setLlmTimeout(ms) { LLM_TIMEOUT_MS = ms; }

// ── LLM Failover Stack ──────────────────────────────────────────────────
// When the primary LLM connection fails (429, 500, timeout), try the next
// connection in the user's failover stack. Kernel-level reliability.

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

async function getFailoverStack(userId) {
  const user = await User.findById(userId).select("metadata").lean();
  const meta = user?.metadata instanceof Map ? Object.fromEntries(user.metadata) : (user?.metadata || {});
  return meta.llm?.failoverStack || [];
}

/**
 * Try an LLM call with the primary client. On retryable failure, walk the
 * failover stack and try each connection until one succeeds.
 * @param {Function} callFn - async (openaiClient, model) => response
 * @param {object} primaryClient - { client, model, connectionId, ... }
 * @param {string} userId - for failover stack lookup
 * @returns {object} { response, usedClient }
 */
async function callWithFailover(callFn, primaryClient, userId) {
  // Try primary
  try {
    const response = await callFn(primaryClient.client, primaryClient.model);
    return { response, usedClient: primaryClient };
  } catch (err) {
    const status = err.status || err.code;
    if (!RETRYABLE_CODES.has(status) && !err.message?.includes("timed out")) {
      throw err; // not retryable
    }
    log.warn("LLM", `Primary failed (${status}): ${primaryClient.model}. Trying failover stack.`);
  }

  // Walk failover stack
  const stack = await getFailoverStack(userId);
  for (const connId of stack) {
    if (connId === primaryClient.connectionId) continue; // skip primary
    try {
      const fallbackClient = await resolveConnection(connId, "failover:" + connId);
      if (!fallbackClient) continue;
      log.verbose("LLM", `Trying failover: ${fallbackClient.model} (${connId})`);
      const response = await callFn(fallbackClient.client, fallbackClient.model);
      log.verbose("LLM", `Failover succeeded: ${fallbackClient.model}`);
      return { response, usedClient: fallbackClient };
    } catch (err) {
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
// ─────────────────────────────────────────────────────────p────────────────

const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";

function decrypt(encryptedText) {
  if (!ENCRYPTION_KEY) throw new Error("CUSTOM_LLM_API_SECRET_KEY not set. Cannot decrypt LLM credentials.");
  const [ivHex, encrypted] = encryptedText.split(":");
  if (!ivHex || !encrypted) throw new Error("Malformed encrypted text");
  const iv = Buffer.from(ivHex, "hex");
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
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
  var conn = await LlmConnection.findById(connectionId).lean();
  if (!conn || !conn.baseUrl || !conn.encryptedApiKey) return null;

  // Admin users can use private/internal IPs (e.g. local Ollama)
  var owner = await User.findById(conn.userId).select("isAdmin").lean();

  if (!owner?.isAdmin) {
    try {
      var hostname = new URL(conn.baseUrl).hostname;
      await resolveAndValidateHost(hostname);
    } catch (err) {
      log.error("LLM", 
        "Blocked custom LLM connection " + connectionId + ": " + err.message,
      );
      return null;
    }
  }

  var apiKey = decrypt(conn.encryptedApiKey);
  var baseURL = conn.baseUrl.replace(/\/+$/, "");
  if (baseURL.endsWith("/chat/completions")) {
    baseURL = baseURL.replace(/\/chat\/completions$/, "");
  }

  var entry = {
    client: new OpenAI({
      baseURL: baseURL,
      apiKey: apiKey,
      maxRetries: LLM_MAX_RETRIES,
      timeout: LLM_TIMEOUT_MS,
      defaultHeaders: {
        "HTTP-Referer": getLandConfigValue("landUrl") || `http://localhost:${process.env.PORT || 3000}`,
        "X-OpenRouter-Title": "TreeOS",
        "X-OpenRouter-Categories": "personal-agent,general-chat",
      },
    }),
    model: conn.model || DEFAULT_MODEL,
    isCustom: true,
    connectionId: conn._id,
    fetchedAt: Date.now(),
  };

  if (cacheKey) userClientCache.set(cacheKey, entry);

  LlmConnection.updateOne(
    { _id: conn._id },
    { $set: { lastUsedAt: new Date() } },
  ).catch(function () {});

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
  //    try that first — it takes highest priority.
  if (overrideConnectionId) {
    var overrideCacheKey = "conn:" + overrideConnectionId;
    var overrideCached = userClientCache.get(overrideCacheKey);
    if (
      overrideCached &&
      Date.now() - overrideCached.fetchedAt < CLIENT_CACHE_TTL
    ) {
      return overrideCached;
    }
    try {
      var overrideEntry = await resolveConnection(
        overrideConnectionId,
        overrideCacheKey,
      );
      if (overrideEntry) return overrideEntry;
    } catch (err) {
      log.error("LLM", 
        "Failed to resolve override connection " +
          overrideConnectionId +
          ": " +
          err.message,
      );
    }
    // Fall through to normal slot-based resolution
  }

  // 2. Normal slot-based resolution from user.llmAssignments
  var cacheKey = userId + ":" + slot;
  var cached = userClientCache.get(cacheKey);
  var ttl = cached?.isCanopyProxy ? PROXY_CACHE_TTL : CLIENT_CACHE_TTL;
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached;
  }

  try {
    var user = await User.findById(userId).select("llmDefault metadata").lean();
    var meta = user?.metadata || {};
    var extSlots = meta?.userLlm?.slots || {};
    var connectionId = slot === "main" ? user?.llmDefault : (extSlots[slot] || null);

    // Fall back to "main" (llmDefault) if the specific slot has no assignment
    if (!connectionId && slot !== "main" && user?.llmDefault) {
      connectionId = user.llmDefault;
    }

    if (connectionId) {
      var entry = await resolveConnection(connectionId, cacheKey);
      if (entry) return entry;
    }
  } catch (err) {
    log.error("LLM", 
      "Failed to load custom LLM for user " + userId + ": " + err.message,
    );
  }

  // Check if this is a remote user whose LLM lives on their home land
  try {
    var remoteCheck = await User.findById(userId).select("isRemote homeLand").lean();
    if (remoteCheck?.isRemote && remoteCheck.homeLand) {
      var { createCanopyLlmProxyClient } = await import("../canopy/llmProxy.js");
      var proxyClient = createCanopyLlmProxyClient({
        userId,
        homeLand: remoteCheck.homeLand,
        slot,
      });
      var proxyEntry = {
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
    log.error("LLM", "Failed to create canopy LLM proxy for user " + userId + ": " + err.message);
  }

  var noLlmEntry = {
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
const MODE_TO_ASSIGNMENT = {
  // Core tree orchestration modes (kernel)
  "tree:librarian": "placement",
  "tree:navigate": "placement",
  "tree:structure": "placement",
  "tree:edit": "placement",
  "tree:be": "placement",
  "tree:getContext": "placement",
  "tree:respond": "respond",
  "tree:notes": "notes",
  // Extension modes are registered via registerModeAssignment() during init
};

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

    const { getLlmAssignments } = await import("../seed/llm/assignments.js");
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
  for (var key of userClientCache.keys()) {
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
  var user = await User.findById(userId).select("metadata").lean();
  var userMeta = user?.metadata || {};
  var userLlm = userMeta?.userLlm?.assignments || {};
  if (userLlm.main) return true;
  var count = await LlmConnection.countDocuments({ userId });
  return count > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// SESSION STATE (keyed by visitorId)
// ─────────────────────────────────────────────────────────────────────────

// Each session holds: { modeKey, bigMode, messages[], rootId, _lastActive }
const sessions = new Map();

/**
 * Get or create session for a visitor.
 */
function getSession(visitorId) {
  if (!sessions.has(visitorId)) {
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
const STALE_SESSION_MS = 30 * 60 * 1000; // 30 min
setInterval(
  () => {
    const now = Date.now();
    let swept = 0;
    for (const [id, s] of sessions) {
      if (now - (s._lastActive || 0) > STALE_SESSION_MS) {
        sessions.delete(id);
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
  });

  // Reset conversation with new system prompt + carried context
  session.messages = [
    { role: "system", content: systemPrompt },
    ...carriedContext,
  ];
  session.modeKey = newModeKey;
  session.bigMode = mode.bigMode;

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
// CHAT PROCESSING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Process a chat message within the current mode.
 */
export async function processMessage(visitorId, message, ctx) {
  const session = getSession(visitorId);
  const isInternal = ctx?.meta?.internal === true;

  // Ensure we have a mode - default to home:default
  if (!session.modeKey) {
    await switchMode(visitorId, "home:default", ctx);
  }

  const mode = getMode(session.modeKey);

  // Snapshot ancestor chain for consistent resolution within this message.
  // All resolution chains (scope, tools, mode, LLM, auth) read from this snapshot.
  const snapshotNodeId = session.currentNodeId || session.rootId || ctx.rootId;
  if (snapshotNodeId) {
    session._ancestorSnapshot = await snapshotAncestors(snapshotNodeId);
  }

  // Circuit breaker: if the tree is tripped, reject immediately. No LLM call.
  if (session._ancestorSnapshot) {
    // The owner node (root) is the last non-system node in the chain
    const rootAncestor = session._ancestorSnapshot.find(a => a.rootOwner && a.rootOwner !== "SYSTEM");
    if (rootAncestor?.metadata?.circuit?.tripped) {
      return {
        content: "This tree is dormant. It exceeded health thresholds and its circuit breaker tripped. Contact the land operator or wait for an extension to revive it.",
        modeKey: session.modeKey,
        _internal: { tripped: true, rootId: rootAncestor._id },
      };
    }
  }

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
    // Energy metering handled by energy extension hooks if installed
    return {
      content:
        "No LLM connection configured. Set one up at /setup to use AI features.",
      modeKey: session.modeKey,
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

  // If conversation is empty (fresh mode), initialize
  if (session.messages.length === 0) {
    const systemPrompt = await buildPromptForMode(session.modeKey, {
      username: ctx.username,
      userId: ctx.userId,
      rootId: session.rootId,
    });
    session.messages = [{ role: "system", content: systemPrompt }];
  }

  // Trim if over max
  if (session.messages.length > MAX_MESSAGES) {
    const systemMsg = session.messages[0];
    const recent = session.messages.slice(-(MAX_MESSAGES - 1));
    session.messages = [systemMsg, ...recent];
  }

  // Add user message

  session.messages.push({ role: "user", content: message });

  // Get tools for current mode (with per-node tool config + spatial extension scoping)
  let treeToolConfig = null;
  let blockedExtensions = null;
  let restrictedExtensions = null;
  const currentNodeId = session.currentNodeId || session.rootId;
  if (currentNodeId) {
    try {
      // Walk from current node up to root, merging tool configs + extension scoping
      const allowed = new Set();
      const blocked = new Set();
      const blockedExts = new Set();
      const restrictedExts = new Map(); // extName -> access mode ("read")
      let cursor = currentNodeId;
      const visited = new Set();
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const n = await Node.findById(cursor).select("metadata parent systemRole").lean();
        if (!n || n.systemRole) break;
        const meta = n.metadata instanceof Map ? Object.fromEntries(n.metadata) : (n.metadata || {});
        if (meta.tools?.allowed) for (const t of meta.tools.allowed) allowed.add(t);
        if (meta.tools?.blocked) for (const t of meta.tools.blocked) blocked.add(t);
        // Spatial extension scoping
        if (meta.extensions?.blocked) for (const e of meta.extensions.blocked) blockedExts.add(e);
        if (meta.extensions?.restricted) {
          for (const [e, access] of Object.entries(meta.extensions.restricted)) {
            if (!blockedExts.has(e) && !restrictedExts.has(e)) restrictedExts.set(e, access);
          }
        }
        cursor = n.parent;
      }
      if (allowed.size || blocked.size) {
        treeToolConfig = {
          allowed: allowed.size ? [...allowed] : undefined,
          blocked: blocked.size ? [...blocked] : undefined,
        };
      }
      if (blockedExts.size) blockedExtensions = blockedExts;
      if (restrictedExts.size) restrictedExtensions = restrictedExts;
    } catch {}
  }
  let tools = getToolsForMode(session.modeKey, treeToolConfig);
  // Filter tools by spatial extension scope (blocked + restricted)
  if (blockedExtensions || restrictedExtensions) {
    const { filterToolsByScope } = await import("../seed/tree/extensionScope.js");
    tools = filterToolsByScope(tools, blockedExtensions, restrictedExtensions);
  }

  // Tool calling loop
  let response;
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    // Check for cancellation
    if (ctx.signal?.aborted) {
      throw new Error("Request cancelled");
    }

    iterations++;

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

    // beforeLLMCall: extensions can cancel (quota exhausted) or modify params
    const llmHookData = {
      userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
      model: MODEL, messageCount: session.messages.length, hasTools: tools.length > 0,
    };
    const llmHookResult = await hooks.run("beforeLLMCall", llmHookData);
    if (llmHookResult.cancelled) {
      throw new Error(llmHookResult.reason || "LLM call rejected");
    }

    try {
      const failoverResult = await callWithFailover(
        (client, model) => client.chat.completions.create({ ...requestParams, model }, requestOpts),
        clientEntry,
        ctx.userId,
      );
      response = failoverResult.response;
      // If a failover client was used, update tracking
      if (failoverResult.usedClient !== clientEntry) {
        Object.assign(clientEntry, failoverResult.usedClient);
      }

      // afterLLMCall: token metering, billing, analytics
      hooks.run("afterLLMCall", {
        userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
        model: failoverResult.usedClient?.model || MODEL,
        usage: response?.usage || null,
        hasToolCalls: !!response?.choices?.[0]?.message?.tool_calls?.length,
      }).catch(() => {});
    } catch (apiErr) {
      // Handle models that invent tool names (e.g. "json") instead of using defined tools
      if (apiErr.code === "tool_use_failed" && apiErr.error?.failed_generation) {
        let extracted = null;
        try {
          const gen = JSON.parse(apiErr.error.failed_generation);
          extracted = gen.arguments?.responseHint || gen.arguments?.response || gen.arguments?.content || gen.arguments?.summary || JSON.stringify(gen.arguments);
        } catch {
          // Try extracting any readable text from the failed generation
          const raw = apiErr.error.failed_generation;
          const hintMatch = raw.match(/"responseHint"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
          if (hintMatch) extracted = hintMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }

        if (extracted) {
          log.warn("LLM", `⚠️ Model invented tool "${apiErr.error?.message?.match(/tool '(\w+)'/)?.[1] || "?"}". Extracted response from failed_generation.`);
          response = { choices: [{ message: { role: "assistant", content: extracted }, finish_reason: "stop" }] };
        } else {
          throw apiErr;
        }
      } else {
        throw apiErr;
      }
    }

    const choice = response.choices?.[0];
    if (!choice) break;

    const assistantMessage = choice.message;

    // Always append assistant message for tool reasoning
    // Always append assistant message to maintain conversation integrity.
    // Tool results MUST follow their corresponding assistant tool_call message.
    session.messages.push(assistantMessage);

    // Detect models that return tool-call-like text instead of proper function calling
    // (common with free/cheap models on OpenRouter that don't support tool_use)
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
          `⚠️ Model returned tool-call text instead of function calling (${MODEL}). Retrying without tools.`,
        );
        session.messages.pop();
        const fallbackResponse = await openai.chat.completions.create(
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
        const fallbackChoice = fallbackResponse.choices?.[0];
        if (fallbackChoice) {
          session.messages.push(fallbackChoice.message);
          if (isInternal) {
            const raw = fallbackChoice.message.content;
            const _llmProvider = {
              isCustom,
              model: MODEL,
              connectionId: resolvedConnectionId || null,
            };
            try {
              const p = JSON.parse(raw);
              p._llmProvider = _llmProvider;
              return p;
            } catch {
              return {
                action: "error",
                reason: "Model cannot use tools",
                raw,
                _llmProvider,
              };
            }
          }
          answer = fallbackChoice.message.content;
        }
        break;
      }
    }

    // If tools are requested, continue the loop
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // tool execution happens below
    } else {
      // ✅ No tools left → now safe to return for internal mode
      if (isInternal) {
        const raw = assistantMessage.content;
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

          return {
            action: "error",
            reason: "Internal mode returned invalid JSON",
            raw,
            _llmProvider,
          };
        }
      }
      break;
    }

    // Execute tool calls
    const toolResults = [];
    for (const toolCall of assistantMessage.tool_calls) {
      // Check for cancellation before each tool
      if (ctx.signal?.aborted) {
        throw new Error("Request cancelled");
      }

      const toolName = toolCall.function.name;
      let args;

      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        log.error("LLM", `❌ Invalid tool arguments for ${toolName}:`, e.message);
        session.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: "Invalid arguments" }),
        });
        toolResults.push({
          tool: toolName,
          success: false,
          error: "Invalid arguments",
        });
        continue;
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
        toolResults.push({ tool: toolName, args, success: false, error: "tool_circuit_tripped" });
        continue;
      }

      // beforeToolCall: extensions can modify args or cancel
      const hookData = { toolName, args, userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey };
      const hookResult = await hooks.run("beforeToolCall", hookData);
      if (hookResult.cancelled) {
        const errCode = hookResult.timedOut ? "HOOK_TIMEOUT" : "HOOK_CANCELLED";
        session.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: hookResult.reason || "Tool call cancelled", code: errCode }),
        });
        toolResults.push({ tool: toolName, args, success: false, error: errCode });
        continue;
      }
      args = hookData.args;
      const resolvedToolName = hookData.toolName || toolName;

      log.debug("LLM", `🔧 [${session.modeKey}] ${resolvedToolName}`, args);

      // DB health check: if the database is unreachable, tell the AI immediately
      // so it responds to the user instead of retrying blindly with broken hands.
      if (!isDbHealthy()) {
        const dbErr = "Database is currently unavailable. Tell the user the land is experiencing issues and to try again shortly.";
        session.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: dbErr }),
        });
        toolResults.push({ tool: toolName, args, success: false, error: "db_unavailable" });
        continue;
      }

      try {
        const result = await client.callTool({
          name: resolvedToolName,
          arguments: args,
        });
        const resultText =
          result?.contents?.[0]?.text ||
          result?.content?.[0]?.text ||
          JSON.stringify(result);

        session.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultText,
        });

        toolResults.push({ tool: resolvedToolName, args, success: true });

        // Tool circuit breaker: success resets failure count
        delete session._toolFailures[resolvedToolName];

        // afterToolCall (success): fire-and-forget
        hooks.run("afterToolCall", {
          toolName: resolvedToolName, args, result: resultText, success: true,
          userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
        }).catch(() => {});
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

        toolResults.push({
          tool: resolvedToolName,
          args,
          success: false,
          error: err.message,
        });

        // afterToolCall (failure): fire-and-forget
        hooks.run("afterToolCall", {
          toolName: resolvedToolName, args, error: err.message, success: false,
          userId: ctx.userId, rootId: ctx.rootId, mode: session.modeKey,
        }).catch(() => {});
      }
    }

    // Yield tool results for real-time frontend updates
    if (ctx.onToolResults) {
      ctx.onToolResults(toolResults);
    }
  }

  // Ensure final text response
  if (!response?.choices?.[0]?.message?.content) {
    const finalResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: session.messages,
    });
    response = finalResponse;
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
// CONTEXT INJECTION (frontend sync events)
// ─────────────────────────────────────────────────────────────────────────

export function injectContext(visitorId, content) {
  const session = getSession(visitorId);
  if (session.messages.length > 0) {
    session.messages.push({ role: "system", content });
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// SESSION ACCESSORS
// ─────────────────────────────────────────────────────────────────────────

export function setRootId(visitorId, rootId) {
  const session = getSession(visitorId);
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
 * Usage:
 *   const { answer, chatId } = await runChat({
 *     userId, username, message, mode: "land:manager",
 *     rootId: null,  // optional, for tree modes
 *     nodeId: null,  // optional, for per-node context
 *   });
 */
export async function runChat({ userId, username, message, mode, rootId = null, nodeId = null, signal = null, res = null }) {
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
  const { connectToMCP, closeMCPClient, getMCPClient, MCP_SERVER_URL } = await import("./mcp.js");
  const { startChat, finalizeChat, setChatContext } = await import("./chatTracker.js");
  const { setSessionAbort, clearSessionAbort } = await import("./sessionRegistry.js");

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) throw new Error("JWT_SECRET not configured");

  // Session identity: zone + context + user
  // land:{userId}          - land zone (persistent across land chats)
  // home:{userId}          - home zone (persistent across home chats)
  // tree:{rootId}:{userId} - tree zone (new session per tree, persistent within tree)
  const bigMode = mode.split(":")[0];
  const contextKey = bigMode === "tree" && rootId ? rootId : bigMode;
  const visitorId = `${contextKey}:${userId}`;

  // Persistent sessionId per zone (chains Chats together)
  // Uses crypto.randomUUID() (sync) to avoid race condition between check and set
  if (!runChat._sessions) runChat._sessions = new Map();
  if (!runChat._sessions.has(visitorId)) {
    runChat._sessions.set(visitorId, crypto.randomUUID());
  }
  const sessionId = runChat._sessions.get(visitorId);

  // Abort controller for cancellation (Ctrl+C, timeout, etc.)
  const abort = signal ? { signal } : new AbortController();
  const abortSignal = signal || abort.signal;

  // Register abort so external callers can cancel via sessionRegistry
  setSessionAbort(visitorId, abort);

  const internalJwt = jwt.sign(
    { userId: userId.toString(), username: username || "unknown", visitorId },
    JWT_SECRET,
    { expiresIn: "5m" }
  );

  // 1. Connect MCP (reuse if already connected)
  if (!getMCPClient(visitorId)) {
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
      await switchMode(visitorId, mode, { username, userId });
    } catch (err) {
      log.warn("RunChat", `Mode switch to ${mode} failed: ${err.message}`);
    }
  }

  // 4. Create Chat record
  let chat;
  try {
    const clientInfo = await getClientForUser(userId, visitorId) || {};
    chat = await startChat({
      userId,
      sessionId,
      message,
      modeKey: mode,
      llmProvider: {
        isCustom: clientInfo.isCustom || false,
        model: clientInfo.model || "unknown",
        connectionId: clientInfo.connectionId || null,
      },
      treeContext: rootId ? { targetNodeId: rootId } : undefined,
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
      signal: abortSignal,
    });
  } catch (err) {
    if (chat) {
      const stopped = abortSignal.aborted;
      try { await finalizeChat({ chatId: chat._id, content: stopped ? null : `Error: ${err.message}`, stopped }); } catch {}
    }
    clearSessionAbort(visitorId);
    throw err;
  }

  const stopped = abortSignal.aborted;
  const answer = stopped ? null : (result?.content || result?.answer || "No response.");

  // 6. Finalize Chat
  if (chat) {
    try {
      const internal = result?._internal || {};
      await finalizeChat({ chatId: chat._id, content: stopped ? null : answer, stopped, modeKey: internal.modeKey || mode });
    } catch {}
  }

  // 7. Clear abort (keep session + MCP alive for next message in same mode)
  clearSessionAbort(visitorId);

  return {
    answer,
    chatId: chat?._id || null,
    modeKey: mode,
    visitorId,
  };
}

/**
 * High-level multi-step pipeline for extensions.
 * Handles: lock, session, MCP, Chat chain, step execution, cleanup.
 *
 * Usage:
 *   const result = await runPipeline({
 *     userId, username, rootId,
 *     description: "Dream cycle for MyTree",
 *     sessionType: "dream-orchestrate",
 *     modeKeyForLlm: "tree:respond",
 *     lockNamespace: "dream",        // optional, prevents concurrent runs
 *     steps: async (pipeline) => {
 *       const { parsed } = await pipeline.step("tree:cleanup-analyze", {
 *         prompt: "Analyze this tree for cleanup opportunities",
 *       });
 *       await pipeline.step("tree:structure", {
 *         prompt: `Execute: ${JSON.stringify(parsed)}`,
 *       });
 *       return { summary: "Cleaned 3 branches" };
 *     },
 *   });
 */
export async function runPipeline({
  userId, username, rootId, description,
  sessionType = "orchestration",
  modeKeyForLlm = "tree:respond",
  source = "orchestrator",
  lockNamespace = null,
  lockKey = null,
  steps,
}) {
  if (!userId || !steps) throw new Error("runPipeline requires userId and steps function");

  const { OrchestratorRuntime } = await import("../orchestrators/runtime.js");
  const { parseJsonSafe } = await import("../orchestrators/helpers.js");

  const visitorId = `pipeline-${lockNamespace || "run"}-${rootId || userId}-${Date.now()}`;

  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username: username || "system",
    visitorId,
    sessionType,
    description: description || "Pipeline run",
    modeKeyForLlm,
    source,
    lockNamespace,
    lockKey: lockKey || rootId,
  });

  const initialized = await rt.init(description);
  if (!initialized) {
    return { success: false, reason: "Could not acquire lock", locked: true };
  }

  // Build a clean step interface for the caller
  const pipeline = {
    /** Run a single LLM step in a mode. Returns { parsed, raw }. */
    async step(modeKey, { prompt, modeCtx, input, treeContext } = {}) {
      if (rt.aborted) throw new Error("Pipeline aborted");
      return rt.runStep(modeKey, { prompt, modeCtx, input, treeContext });
    },

    /** Check if pipeline was aborted. */
    get aborted() { return rt.aborted; },

    /** The abort signal (pass to fetch, child processes, etc.) */
    get signal() { return rt.signal; },

    /** The session ID for this pipeline run. */
    get sessionId() { return rt.sessionId; },

    /** The root chat ID for chain tracking. */
    get chatId() { return rt.mainChatId; },

    /** The current chain index. */
    get chainIndex() { return rt.chainIndex; },

    /** The resolved LLM provider info. */
    get llmProvider() { return rt.llmProvider; },
  };

  try {
    const result = await steps(pipeline);
    rt.setResult(
      typeof result === "string" ? result : JSON.stringify(result),
      `${lockNamespace || "pipeline"}:complete`
    );
    return { success: true, ...result };
  } catch (err) {
    rt.setError(err.message, `${lockNamespace || "pipeline"}:error`);
    return { success: false, error: err.message };
  } finally {
    await rt.cleanup();
  }
}
