// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
// llm/runChat.js
// Conversation state, LLM resolution, tool loop, session management
import log from "../core/log.js";
import { hooks } from "../core/hooks.js";

import crypto from "crypto";
import Being from "../models/being.js";
import Node from "../models/node.js";
import { snapshotAncestors, resolveExtensionScopeFromChain, getAncestorChain } from "../tree/ancestorCache.js";
import { isDbHealthy } from "../core/dbConfig.js";
import { resolveTools } from "../core/tools.js";
import { getNodeName } from "../tree/treeFetch.js";
import { mcpClients, connectToMCP, MCP_SERVER_URL } from "./mcpClient.js";

// How many recent messages to carry across role switches when the new
// role doesn't request a full reset. Used to give continuity to the
// next role's context window.
let CARRY_MESSAGES = 4;
export function setCarryMessages(n) { CARRY_MESSAGES = Math.max(0, Number(n) || 4); }
import { getLandConfigValue } from "../landConfig.js";
import { SYSTEM_OWNER } from "../core/protocol.js";
import { appendToolCall } from "./summonTracker.js";
import { signInternalToken } from "../core/identity.js";

// ─────────────────────────────────────────────────────────────────────────
// ROLE-DRIVEN PROMPT + TOOL RESOLUTION
//
// Roles are the unit of LLM behavior. A role spec carries:
//   - buildSystemPrompt(ctx)  → async function returning the domain prompt
//   - toolNames              → string[] of tool names the LLM may call
//   - permissions            → ("see"|"do"|"summon"|"be")[] verb filter
//   - timeoutMs / maxRetries → optional LLM call budget
//   - llmSlot                → optional slot name for tree LLM resolution
//   - maxMessagesBeforeLoop / maxToolCallsPerStep → optional loop config
//
// These helpers wrap the role's prompt + tools with the kernel's
// universal scaffolding (position context, time block, extension/tree
// tool overlays). No mode lookup, no registry indirection — the role
// IS the spec. See [[project_ibp_universal_grammar]].
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the system prompt for a role at a position. Three layers:
 *   1. [Position] block (always present)
 *   2. role.buildSystemPrompt(ctx) — the domain prompt
 *   3. [Time] block (land timezone)
 */
async function buildSystemPromptForRole(role, ctx) {
  if (!role || typeof role.buildSystemPrompt !== "function") {
    throw new Error(`buildSystemPromptForRole: role "${role?.name || "(unnamed)"}" has no buildSystemPrompt`);
  }

  // ── Layer 1: position block ──
  const positionLines = [];
  if (ctx.name) positionLines.push(`User: ${ctx.name}`);
  const rootId = ctx.rootId || null;
  const currentNodeId = ctx.currentNodeId || ctx.targetNodeId || null;
  const targetNodeId = ctx.targetNodeId || null;

  const idsToResolve = {};
  if (rootId) idsToResolve.root = rootId;
  if (currentNodeId && currentNodeId !== rootId) idsToResolve.current = currentNodeId;
  if (targetNodeId && targetNodeId !== rootId && targetNodeId !== currentNodeId) {
    idsToResolve.target = targetNodeId;
  }

  const names = {};
  try {
    const entries = Object.entries(idsToResolve);
    if (entries.length > 0) {
      const resolved = await Promise.all(entries.map(([, id]) => getNodeName(id)));
      entries.forEach(([key], i) => { names[key] = resolved[i]; });
    }
  } catch (nameErr) {
    log.debug("Role", `Node name resolution failed: ${nameErr.message}`);
  }
  if (rootId) {
    positionLines.push(names.root ? `Tree: ${names.root} (${rootId})` : `Tree: ${rootId}`);
  }
  if (currentNodeId && currentNodeId !== rootId) {
    positionLines.push(names.current
      ? `Current node: ${names.current} (${currentNodeId})`
      : `Current node: ${currentNodeId}`);
  }
  if (targetNodeId && targetNodeId !== rootId && targetNodeId !== currentNodeId) {
    positionLines.push(names.target
      ? `Target node: ${names.target} (${targetNodeId})`
      : `Target node: ${targetNodeId}`);
  }
  const positionBlock = positionLines.length > 0
    ? `[Position]\n${positionLines.join("\n")}\n\n`
    : "";

  // ── Layer 2: role prompt ──
  let rolePrompt;
  try {
    rolePrompt = await Promise.resolve(role.buildSystemPrompt(ctx));
  } catch (promptErr) {
    log.error("Role", `role "${role.name}" buildSystemPrompt failed: ${promptErr.message}`);
    rolePrompt = `[Role prompt error: ${promptErr.message}]`;
  }

  // ── Layer 3: time block ──
  const timeBlock = `\n\n[Time] ${new Date().toISOString()}`;

  return `${positionBlock}${rolePrompt}${timeBlock}`;
}

/**
 * Resolve the OpenAI-compatible tools array for a role.
 *   1. role.toolNames (base)
 *   2. extension-injected tools (via _getExtToolsFn, keyed by role name)
 *   3. tree-specific overlays (metadata.tools.allowed / blocked)
 *   4. permission filter (drop tools whose verb isn't in role.permissions)
 */
function resolveToolsForRole(role, treeToolConfig = null, rolePermissions = null) {
  if (!role) return [];

  // Layer 1: role base tools
  let toolNames = Array.isArray(role.toolNames) ? [...role.toolNames] : [];

  // Layer 2: extension-injected tools keyed by role name
  const extTools = _getExtToolsFn(role.name);
  if (extTools.length > 0) {
    toolNames = [...new Set([...toolNames, ...extTools])];
  }

  // Layer 3: tree overlays
  if (treeToolConfig) {
    if (Array.isArray(treeToolConfig.allowed)) {
      toolNames = [...new Set([...toolNames, ...treeToolConfig.allowed])];
    }
    if (Array.isArray(treeToolConfig.blocked)) {
      const blockedSet = new Set(treeToolConfig.blocked);
      toolNames = toolNames.filter((t) => !blockedSet.has(t));
    }
  }

  // Layer 4: role-permissions filter (verb tag ∩ role.permissions).
  // Permissions are role identity ([[project_role_permissions_not_envelope]]);
  // envelopes never widen them.
  const permsForFilter = Array.isArray(rolePermissions) ? rolePermissions
                       : (Array.isArray(role.permissions) ? role.permissions : null);
  return resolveTools(toolNames, permsForFilter);
}

// Extension tool injection hook. Set by the loader after init via
// setExtensionToolResolver. Keyed by role name (the role IS the unit).
let _getExtToolsFn = () => [];
export function setExtensionToolResolver(fn) {
  _getExtToolsFn = typeof fn === "function" ? fn : () => [];
}

// ─────────────────────────────────────────────────────────────────────────
// LLM DEFAULTS
// ─────────────────────────────────────────────────────────────────────────

let MAX_MESSAGES = 30;
let MAX_TOOL_ITERATIONS = 15;
let LLM_MAX_RETRIES = 3;
function MAX_MESSAGE_CONTENT_BYTES() { return Math.max(4096, Math.min(Number(getLandConfigValue("maxMessageContentBytes")) || 32768, 131072)); }

// ── Kernel config setters (called from startup.js after land config loads) ──
export function setKernelConfig(key, value) {
  const num = Number(value);
  // Clamp all numeric values to sane bounds. Zero or negative values for
  // timeouts/limits would brick the conversation loop. Government-level:
  // every config path produces a functional system, never a broken one.
  switch (key) {
    case "llmTimeout": setLlmTimeout(Math.max(5000, Math.min(num * 1000, 30 * 60 * 1000))); break;
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
export { setLlmTimeout } from "./llmClient.js";
import { setLlmTimeout, getLlmTimeout } from "./llmClient.js";

// ── LLM Concurrency Semaphore ─────────────────────────────────────────
// Prevents thundering herd: caps in-flight LLM calls across all users.
// Excess callers queue with abort signal support.
let LLM_MAX_CONCURRENT = 20;
let FAILOVER_TIMEOUT_MS = 15000;
// Default tool-call timeout. Most tools complete in well under a
// minute; a small handful (extensions running another LLM call
// inside their handler — single Planner/Contractor/Foreman turns)
// can legitimately take a few minutes. 10 minutes is generous
// enough to cover those cases without making the kernel aware of
// which tools they are. Operators can tighten or extend per-node
// via the toolCallTimeout config key.
//
// As of the fire-and-forget refactor in governing, the long-running
// recursive spawn tools (hire-planner, hire-contractor, revise-plan,
// dispatch-execution, route-to-foreman, foreman-retry-branch) return
// in milliseconds — the spawned chainstep runs in the background and
// completion hooks wake the Ruler in a fresh turn. The 10-minute
// budget is now well above what any honest tool call needs.
//
// Cancellation runs through the caller's abort signal, not this
// timeout — the timeout exists to prevent stuck-forever tool calls
// from blocking the conversation loop, not as the cancellation path.
let TOOL_CALL_TIMEOUT_MS = 600000;
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
// that returns fallback connection IDs for a given beingId/rootId context.
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
 * @param {Function} resolver - async (beingId, rootId) => string[] of connectionIds
 */
export function registerFailoverResolver(resolver) {
  _failoverResolver = resolver;
}

/**
 * Try an LLM call with the primary client. On retryable failure, ask the
 * registered failover resolver for fallback connections and try each one.
 * @param {Function} callFn - async (openaiClient, model) => response
 * @param {object} primaryClient - { client, model, connectionId, ... }
 * @param {string} beingId
 * @param {string|null} rootId
 * @returns {object} { response, usedClient }
 */
async function callWithFailover(callFn, primaryClient, beingId, rootId) {
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
  const stack = await _failoverResolver(beingId, rootId);
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

// Retries / timeout resolution for a role-driven LLM call.
//   - Role spec may declare `timeoutMs` and `maxRetries`. Per-role values
//     win because the role knows its own budget (a Planner with a giant
//     prompt expects longer than a one-shot Worker).
//   - Per-node override via metadata.timeouts.<roleName> still wins
//     (operator escape hatch for slow specific scopes).
//   - Land default is the floor.
function getRetriesForRole(role) {
  return role?.maxRetries ?? LLM_MAX_RETRIES;
}
function getTimeoutForRole(role, nodeMetadata = null) {
  const meta = nodeMetadata instanceof Map ? Object.fromEntries(nodeMetadata) : (nodeMetadata || {});
  const nodeTimeout = role?.name ? meta.timeouts?.[role.name] : null;
  if (nodeTimeout && Number.isFinite(nodeTimeout)) return nodeTimeout;
  if (role?.timeoutMs && Number.isFinite(role.timeoutMs)) return role.timeoutMs;
  return getLlmTimeout();
}

// LLM connection resolution lives in seed/llm/llmClient.js. Imported
// here for use by the turn engine.
import {
  getClientForBeing,
  resolveRootLlmForRole,
} from "./llmClient.js";

// ─────────────────────────────────────────────────────────────────────────
// SESSION STATE (keyed by ai-chat session key)
// ─────────────────────────────────────────────────────────────────────────
//
// `clientSessionId` is the transport-session identifier built by
// seed/llm/sessionKeys.js. It identifies a reach — which being, from
// which device — so the per-tab `sessions` Map below can hold a
// distinct LLM-conversation buffer for each open window.
//
// What `clientSessionId` does for THIS Map: keys the per-tab LLM buffer
// (messages[], modeKey, bigMode). Two tabs on the same being get two
// entries so their working state doesn't clobber. Position, threading,
// MCP cache, and async event broadcast all live elsewhere now under
// first-class identifiers (Being.currentPositionId, ibpAddress,
// rootSummonId, being-room) — see sessionKeys.js header for the full
// after-refactor map.

// Each session holds: { messages[], role, _lastActive }.
//
// Position state (rootId, currentNodeId) lives separately in
// seed/beingPosition.js, keyed by beingId, because under the
// single-context being model a being has one position regardless of
// which reach (web + CLI) they connect through. Background AI pipelines
// run AS a specific being and write to THAT being's position.
const sessions = new Map();
let MAX_CONVERSATION_SESSIONS = 50000; // hard cap to prevent OOM from leaked sessions

// Position state lives in seed/beingPosition.js. Used internally
// by the runChat tool loop and prepareConversation/enrichContext.
// rootId is derived from currentNodeId on every setCurrentNodeId,
// so callers only ever set the current node; rootId follows.
import {
  getRootId,
  setCurrentNodeId,
  getCurrentNodeId,
} from "../beingPosition.js";

/**
 * Get or create the conversation session.
 *
 * Keyed by `conversationKey` — the canonical conversation identifier.
 * For being-to-being chats this is the IBP Address; for stanceless
 * background pipelines it's the pipeline key. Two tabs of the same
 * being at the same IBP Address see the same entry, so the LLM
 * conversation buffer (messages[], modeKey) is genuinely shared
 * across the being's open windows. Switching tabs no longer produces
 * divergent conversation state.
 *
 * Callers in pre-conversation code paths (mode probes from the
 * websocket layer, etc.) may pass the per-tab transport identifier as
 * a fallback. Those lookups return a fresh entry on miss; the
 * authoritative state still belongs to whoever opens the session
 * under the real conversationKey first.
 */
function getSession(conversationKey) {
  if (!sessions.has(conversationKey)) {
    // Hard cap: if sessions exceed limit, evict oldest before creating new
    if (sessions.size >= MAX_CONVERSATION_SESSIONS) {
      let oldestKey = null, oldestTime = Infinity;
      for (const [id, s] of sessions) {
        if ((s._lastActive || 0) < oldestTime) { oldestTime = s._lastActive || 0; oldestKey = id; }
      }
      if (oldestKey) sessions.delete(oldestKey);
    }
    sessions.set(conversationKey, {
      // The role spec the LLM is currently driving. Null until first
      // switchRole. Replaces the old modeKey/bigMode pair; the role IS
      // the unit of behavior.
      role: null,
      messages: [],
      _lastActive: Date.now(),
    });
  }
  const s = sessions.get(conversationKey);
  s._lastActive = Date.now();
  return s;
}

// Helper: derive the conversation key from ctx + fallback. Used at
// every internal getSession call site so the per-Portal-Address /
// per-pipelineKey shared buffer model holds end-to-end.
function _convKey(ctx, clientSessionId) {
  return ctx?.mcpCacheKey || clientSessionId;
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
// ROLE SWITCHING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Switch the session to a new role. Resets the conversation but carries
 * recent messages (unless ctx.clearHistory is set). Returns
 * { role, carriedMessages } for the caller.
 */
export async function switchRole(clientSessionId, newRole, ctx) {
  if (!newRole || typeof newRole !== "object" || !newRole.name) {
    throw new Error("switchRole requires a role spec with at least a `name` field");
  }
  ctx = ctx || {};
  const beingId = ctx.beingId || null;
  const session = getSession(_convKey(ctx, clientSessionId));
  const oldRole = session.role;
  const oldMessages = session.messages;

  let recentMessages = [];
  let carriedContext = [];

  if (!ctx.clearHistory) {
    let carryCount = CARRY_MESSAGES;
    if (oldRole?.preserveContextOnSwitch) {
      carryCount = Math.min(oldMessages.length, 8);
    }
    recentMessages = oldMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-carryCount);

    carriedContext = recentMessages.length > 0
      ? [
          {
            role: "system",
            content: `[Role Switch] Switched from ${oldRole?.name || "none"} to ${newRole.name}. Recent conversation context preserved.`,
          },
          ...recentMessages,
        ]
      : [];
  }

  const systemPrompt = await buildSystemPromptForRole(newRole, {
    ...ctx,
    clientSessionId,
    rootId: getRootId(beingId) || ctx.rootId,
    currentNodeId: ctx.currentNodeId || getCurrentNodeId(beingId),
  });

  session.messages = [
    { role: "system", content: systemPrompt },
    ...carriedContext,
  ];
  session.role = newRole;
  if (ctx.currentNodeId) await setCurrentNodeId(beingId, ctx.currentNodeId);

  log.debug("LLM",
    `🔄 Role switch for ${clientSessionId}: ${oldRole?.name || "none"} → ${newRole.name} (carried ${recentMessages.length} messages)`,
  );

  return {
    role: newRole.name,
    emoji: newRole.emoji,
    label: newRole.label,
    carriedMessages: recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CHAT PROCESSING HELPERS (private, called by processMessage)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get session, ensure a role is set, snapshot ancestor chain.
 * Returns { session, role }. Throws if no role is set on the session
 * AND no role spec was threaded through ctx — every LLM call must be
 * driven by a role.
 */
async function ensureSession(clientSessionId, ctx) {
  const beingId = ctx?.beingId || null;
  const session = getSession(_convKey(ctx, clientSessionId));

  // Self-healing: detect rootId mismatch. If the caller says we're in a
  // different tree than the being thinks, clear messages and re-init.
  // The position update below (setCurrentNodeId) re-derives rootId from
  // the incoming node, so rootId catches up automatically.
  const incomingRootId = ctx.rootId || null;
  const knownRootId = getRootId(beingId);
  if (knownRootId && incomingRootId && knownRootId !== incomingRootId) {
    log.debug("LLM", `Root mismatch for ${clientSessionId}: being=${knownRootId}, ctx=${incomingRootId}. Clearing.`);
    session.messages = [];
    session.role = null;
  }

  // Position update. setCurrentNodeId derives rootId from the chain
  // and updates both fields atomically. When the caller has only
  // rootId (no specific currentNodeId), the tree-root itself is the
  // position — the being "is at the tree root."
  const targetNodeId = ctx.currentNodeId || incomingRootId;
  if (targetNodeId) {
    await setCurrentNodeId(beingId, targetNodeId);
  }

  // Role MUST be present. runChat thread it through ctx.role (set
  // before calling processMessage). No default-role fallback — the
  // caller decides which role this being is acting in.
  if (!session.role && ctx.role) {
    await switchRole(clientSessionId, ctx.role, ctx);
  }
  if (!session.role) {
    throw new Error("ensureSession: no role on session and no ctx.role; every LLM call needs a role");
  }

  // Snapshot ancestor chain for consistent resolution within this message.
  // All resolution chains (scope, tools, LLM, config) read from this snapshot.
  const snapshotNodeId = getCurrentNodeId(beingId) || getRootId(beingId) || ctx.rootId;
  if (snapshotNodeId) {
    session._ancestorSnapshot = await snapshotAncestors(snapshotNodeId);
  }

  return { session, role: session.role };
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
        role: session.role?.name || null,
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
async function resolveLLMClient(ctx, session, clientSessionId) {
  // Resolve LLM client for this user. Role-driven slot override: when
  // role.llmSlot is set and the tree has llmAssignments for it, use that.
  const rootId = getRootId(ctx?.beingId) || ctx.rootId;
  const roleConnectionId =
    ctx.rootLlmConnectionId ||
    (rootId ? await resolveRootLlmForRole(rootId, session.role) : null);

  const clientEntry = await getClientForBeing(
    ctx.beingId,
    ctx.slot,
    roleConnectionId,
  );
  if (clientEntry.noLlm) {
    return {
      noLlmResponse: {
        content:
          "No LLM connection configured. Set one up at /setup to use AI features.",
        role: session.role?.name || null,
      },
    };
  }
  const {
    client: openai,
    model: MODEL,
    isCustom,
    connectionId: resolvedConnectionId,
  } = clientEntry;

  // Ensure MCP client. Cache key is per-conversation:
  //   - Being-to-being: ctx.mcpCacheKey is the IBP Address.
  //   - Stanceless background: ctx.mcpCacheKey is the internal session
  //     key (`pipeline:ephemeral:<uuid>` / `pipeline:tree:<rootId>:<purpose>`).
  //   - Legacy: clientSessionId fallback for callers that haven't been
  //     migrated to set ctx.mcpCacheKey.
  const mcpCacheKey = ctx?.mcpCacheKey || clientSessionId;
  let client = mcpClients.get(mcpCacheKey);
  if (!client) {
    const mcpJwt = signInternalToken({ beingId: ctx.beingId, name: ctx.name });
    client = await connectToMCP(MCP_SERVER_URL, mcpCacheKey, mcpJwt);
  }

  return { openai, MODEL, isCustom, resolvedConnectionId, client, clientEntry };
}

/**
 * Handle conversation loop trimming, fresh role init, max message trim, add user message.
 * @param {object} session - Conversation session state (carries session.role)
 * @param {object} ctx - Request context (username, beingId, rootId, etc.)
 * @param {string} message - The user's message to add
 * @param {string} clientSessionId - Session visitor identifier (for logging)
 */
async function prepareConversation(session, ctx, message, clientSessionId) {
  const role = session.role;
  // Check for conversation length - loop if needed (long-running roles)
  if (
    role.maxMessagesBeforeLoop &&
    session.messages.length > role.maxMessagesBeforeLoop
  ) {
    log.debug("LLM", `🔁 Conversation loop for ${clientSessionId} in role ${role.name}`);
    const recentMessages = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-(CARRY_MESSAGES * 2)); // carry more on loop

    const systemPrompt = await buildSystemPromptForRole(role, {
      name: ctx.name,
      beingId: ctx.beingId,
      clientSessionId,
      rootId: getRootId(ctx.beingId),
      currentNodeId: getCurrentNodeId(ctx.beingId),
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
      const posNodeId = getCurrentNodeId(ctx.beingId) || getRootId(ctx.beingId) || ctx.rootId || null;
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
            beingId: ctx.beingId,
            sessionId: clientSessionId,
            // Pass the current turn's user message so handlers that want
            // to gate their injection on vocabulary (e.g. channels' peer-
            // peek) can do so. Handlers that don't care just ignore it.
            message: message || null,
            dumpMode: true,
          });
        }
      }
    } catch (err) {
      log.debug("LLM", `enrichContext gather skipped: ${err.message}`);
    }

    const systemPrompt = await buildSystemPromptForRole(role, {
      name: ctx.name,
      beingId: ctx.beingId,
      clientSessionId,
      rootId: getRootId(ctx.beingId),
      currentNodeId: getCurrentNodeId(ctx.beingId),
      enrichedContext: enrichedContext || null,
    });
    if (session.messages.length === 0) {
      session.messages = [{ role: "system", content: systemPrompt }];
    } else if (session.messages[0]?.role === "system") {
      session.messages[0].content = systemPrompt;
    }

    // Persist the rendered system prompt + enrichContext output onto the
    // active chat record so the /chats viewer can replay exactly what
    // the AI saw. Fire-and-forget; we only write on the first turn per
    // systemPrompt / enrichedContext were copied onto the Summon row pre-
    // slim schema. The slim shape doesn't carry them — they're heavy
    // per-Summon copies that reference the role version instead. Stays
    // in session memory for the prompt builder; not persisted.
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

function resolveLlmConfig(ancestors, role) {
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

  // Layer 2: role config (fills gaps not set by node). Roles can declare
  // LLM-loop knobs directly (maxToolIterations, compressionThreshold, ...).
  if (role) {
    for (const [key, maxVal] of Object.entries(LLM_CONFIG_KEYS)) {
      if (config[key] !== undefined) continue;
      const val = role[key];
      if (typeof val === "number" && isFinite(val) && val > 0) {
        if (val > maxVal) log.verbose("LLM", `Role LLM config ${key}=${val} clamped to max ${maxVal}`);
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
async function resolveToolsForPosition(session, beingId, rolePermissions = null) {
  let treeToolConfig = null;
  let blockedExtensions = null;
  let restrictedExtensions = null;
  const currentNodeId = getCurrentNodeId(beingId) || getRootId(beingId);
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
  // Role-based tool resolution: each role declares its own tools.
  // rolePermissions (when present) filters tools to those whose verb tag is in
  // the role's declared permission set. See [[project_role_permissions_not_envelope]].
  let tools = resolveToolsForRole(session.role, treeToolConfig, rolePermissions);
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
async function callLLM(openai, MODEL, session, tools, ctx, clientEntry, clientSessionId) {
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
  // summonId/sessionId let extension hook handlers correlate back to the
  // originating chat step (needed by the AI forensics capture path in
  // treeos-base/ai-forensics.js).
  // parentSummonId is resolved from the Chat record so forensics captures
  // can point back to the dispatching call (summarizer → builder,
  // branch → architect, continuation → root). One lookup per LLM call;
  // skipped silently if the chat doc is unavailable.
  const _llmChatId = ctx?.summonId || null;
  const _llmSessionId = ctx?.sessionId || null;
  let _llmParentChatId = null;
  if (_llmChatId) {
    try {
      const { default: _Summon } = await import("../models/summon.js");
      const _chatDoc = await _Summon.findById(_llmChatId).select("inReplyTo").lean();
      if (_chatDoc?.inReplyTo) _llmParentChatId = String(_chatDoc.inReplyTo);
    } catch {}
  }
  const llmHookData = {
    beingId: ctx.beingId, rootId: ctx.rootId, role: session.role?.name,
    model: MODEL, messageCount: session.messages.length, hasTools: tools.length > 0,
    messages: session.messages, nodeId: getCurrentNodeId(ctx.beingId) || ctx.rootId || null,
    summonId: _llmChatId,
    sessionId: _llmSessionId,
    parentSummonId: _llmParentChatId,
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
      log.verbose("Grammar", `[role:${session.role?.name}] modifiers: ${blocks.join(" ")}`);
    }
  }

  let response;

  // Acquire semaphore slot before LLM call. Prevents thundering herd.
  await acquireLlmSlot(ctx.signal, ctx.llmPriority || LLM_PRIORITY.HUMAN);
  try {
    const failoverResult = await callWithFailover(
      (client, model) => client.chat.completions.create({ ...requestParams, model }, requestOpts),
      clientEntry,
      ctx.beingId,
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
      beingId: ctx.beingId, rootId: ctx.rootId, role: session.role?.name,
      model: failoverResult.usedClient?.model || MODEL,
      usage: response?.usage || null,
      hasToolCalls: !!response?.choices?.[0]?.message?.tool_calls?.length,
      summonId: _llmChatId,
      sessionId: _llmSessionId,
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
          beingId: ctx.beingId, rootId: ctx.rootId, role: session.role?.name,
          model: clientEntry?.model || MODEL,
          usage: null, // No usage data available from the error
          hasToolCalls: false,
          _failedGeneration: true,
          summonId: _llmChatId,
          sessionId: _llmSessionId,
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
    return await callLLM(openai, MODEL, session, tools, ctx, clientEntry, clientSessionId);
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
async function executeTool(toolCall, session, ctx, client, clientSessionId) {
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

  // Auto-inject standard tool-context args. Mirrors what mcp/server.js
  // sees from HTTP-path tool calls, so in-process and HTTP paths
  // present the same args shape to handlers.
  //   beingId          — the calling being (asker)
  //   summonId         — the current chainstep's chat record id
  //   rootSummonId     — the user-message-level chat for this turn;
  //                      per-turn state Maps (rulerDecisions,
  //                      foremanDecisions) key on this
  //   ibpAddress       — canonical conversation identifier (stance::stance);
  //                      per-conversation state Maps (abortRegistry,
  //                      pendingPlan, pendingSwarmPlan) key on this
  //   sessionId      — chat-record-level session group for UI nesting
  //   rootId         — tree root the call originates from
  //   nodeId         — current node position (per-being)
  args.beingId = ctx.beingId;
  // summonId / sessionId travel from the call site through ctx so mcp/server.js
  // can stop doing Map lookups. The sender is the authority — we always know
  // which chat the tool call belongs to before we make it.
  if (ctx?.summonId && !args.summonId) args.summonId = ctx.summonId;
  if (ctx?.sessionId && !args.sessionId) args.sessionId = ctx.sessionId;
  // rootSummonId is the user-message-level chat for this Ruler/Foreman turn.
  // Per-turn state Maps (rulerDecisions, foremanDecisions) key on it so
  // the orchestrator's reader can find what a tool wrote without having
  // to know which chainstep within the turn did the writing. Falls back
  // to summonId for paths that don't yet plumb rootSummonId.
  if (ctx?.rootSummonId && !args.rootSummonId) args.rootSummonId = ctx.rootSummonId;
  else if (ctx?.summonId && !args.rootSummonId) args.rootSummonId = ctx.summonId;
  // ibpAddress is the conversation-level identifier (canonical
  // stance::stance). Per-conversation state Maps (abortRegistry,
  // pendingPlan, pendingSwarmPlan) key on it so all chainsteps of one
  // IBP Address see the same in-flight state. mcpCacheKey already
  // carries this value through ctx; fall back to clientSessionId for
  // stanceless background pipelines.
  if (ctx?.mcpCacheKey && !args.ibpAddress) args.ibpAddress = ctx.mcpCacheKey;
  else if (clientSessionId && !args.ibpAddress) args.ibpAddress = clientSessionId;
  if (ctx.rootId && !args.rootId) args.rootId = ctx.rootId;
  // Pinned position wins. When a turn is dispatched with an explicit
  // ctx.currentNodeId (Worker-at-Ruler-scope, sub-Ruler turn, branch
  // dispatch, etc.) tool calls land at THAT node — even if the user
  // navigates somewhere else mid-turn and the being's position state
  // shifts. Without this pin, a sub-Ruler's Worker writes into the
  // project root the moment the user clicks elsewhere in the dashboard,
  // because position is per-being and shared between user-driven turns
  // and dispatch-driven turns.
  // Falls back to being-position state for unpinned turns (regular chat).
  const _curNode = ctx.currentNodeId || getCurrentNodeId(ctx.beingId) || ctx.rootId || null;
  if (_curNode && !args.nodeId) args.nodeId = _curNode;

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

  // beforeToolCall: extensions can modify args or cancel. summonId +
  // sessionId + nodeId let forensics correlate the tool call to its
  // originating chat step and the tree node whose signalInbox
  // should be snapshotted for signal diffing.
  const _toolChatId = ctx?.summonId || null;
  const _toolSessionId = ctx?.sessionId || null;
  const hookData = {
    toolName, args,
    beingId: ctx.beingId, rootId: ctx.rootId, role: session.role?.name,
    summonId: _toolChatId,
    sessionId: _toolSessionId,
    nodeId: getCurrentNodeId(ctx.beingId) || ctx.rootId || null,
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

  log.debug("LLM", `🔧 [role:${session.role?.name}] ${resolvedToolName}`, args);

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
    // Tool call timeout: individual tools should not hang longer
    // than the LLM timeout. Default 10 minutes covers both
    // fast-finishing tools (most) and the small handful that run
    // another LLM call inside their handler (extension-defined,
    // kernel-agnostic). Operators can tighten or extend per-node.
    //
    // CRITICAL: the MCP SDK has its own internal request timeout
    // (DEFAULT_REQUEST_TIMEOUT_MSEC = 60s) that fires error -32001
    // independently of any wrapper. Passing { timeout } to callTool
    // overrides the SDK's default; without it, the wrapper Promise
    // .race below never fires because MCP throws first. We pass the
    // configured value to BOTH the SDK's option and the race ceiling
    // so a hung MCP layer can still be unstuck by the wrapper.
    const nodeToolTimeout = session._nodeLlmConfig?.toolCallTimeout ?? TOOL_CALL_TIMEOUT_MS;
    const toolPromise = client.callTool(
      { name: resolvedToolName, arguments: args },
      undefined,
      { timeout: nodeToolTimeout },
    );
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
      beingId: ctx.beingId, rootId: ctx.rootId, role: session.role?.name,
      summonId: _toolChatId,
      sessionId: _toolSessionId,
      nodeId: getCurrentNodeId(ctx.beingId) || ctx.rootId || null,
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
      beingId: ctx.beingId, rootId: ctx.rootId, role: session.role?.name,
      summonId: _toolChatId,
      sessionId: _toolSessionId,
      nodeId: getCurrentNodeId(ctx.beingId) || ctx.rootId || null,
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
    role: session.role?.name,
    rootId: getRootId(ctx.beingId),
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
 * Process a chat message under the session's current role.
 */
export async function processMessage(clientSessionId, message, ctx) {
  const isInternal = ctx?.meta?.internal === true;

  // Phase 1: Session + ancestor snapshot. Role MUST already be on session
  // (set by ensureSession from ctx.role, which runChat threads through).
  const { session, role } = await ensureSession(clientSessionId, ctx);

  // Phase 2: Circuit breaker check
  const tripped = checkTreeCircuit(session);
  if (tripped) return tripped;

  // Phase 3: Resolve LLM client + MCP connection
  const llmResult = await resolveLLMClient(ctx, session, clientSessionId);
  if (llmResult.noLlmResponse) return llmResult.noLlmResponse;
  const { openai, MODEL, isCustom, resolvedConnectionId, client, clientEntry } = llmResult;

  // Phase 4: Prepare conversation (trim, init, add user message)
  await prepareConversation(session, ctx, message, clientSessionId);

  // Phase 5: Resolve tools for current position
  let { tools } = await resolveToolsForPosition(session, ctx.beingId, ctx.rolePermissions);

  // Query constraint: when readOnly is set, only tools registered with readOnlyHint
  // are available. Write tools are filtered before the role's LLM fires.
  if (ctx.readOnly) {
    const { isToolReadOnly } = await import("../tree/extensionScope.js");
    tools = tools.filter(t => {
      const name = t.function?.name || t.name;
      return name && isToolReadOnly(name);
    });
  }

  // Phase 5b: Resolve LLM config. Three layers: node > role > land globals.
  // Node config walks metadata.llm.config on ancestors. Role declares its own needs.
  // Stored on session so callLLM and executeTool can read overrides.
  session._nodeLlmConfig = resolveLlmConfig(session._ancestorSnapshot, role);

  // Phase 6: Tool calling loop
  let response;
  let iterations = 0;
  const maxIterations = session._nodeLlmConfig.maxToolIterations ?? MAX_TOOL_ITERATIONS;

  // Bounded per-step tool-call budget. When a role declares maxToolCallsPerStep
  // (or ctx forces one), break out after that many tool calls and signal the
  // caller with _continue: true so an orchestrator can open a new chainIndex
  // step and re-enter this loop on the same session.
  const maxToolCallsPerStep =
    ctx?.maxToolCallsPerStep ??
    role.maxToolCallsPerStep ??
    null;
  let toolCallsThisStep = 0;
  let continueReason = null;

  while (iterations < maxIterations) {
    if (ctx.signal?.aborted) throw new Error("Request cancelled");
    iterations++;

    // LLM call with semaphore, failover, hooks
    response = await callLLM(openai, MODEL, session, tools, ctx, clientEntry, clientSessionId);

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
      try { ctx.onThinking({ text: assistantMessage.content, role: session.role?.name }); }
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
      const toolResult = await executeTool(toolCall, session, ctx, client, clientSessionId);
      const _toolMs = Date.now() - _toolStart;
      toolResults.push(toolResult);
      toolCallsThisStep++;

      // Persist the tool call on the active Chat record so the step
      // trace is visible in chat history (CLI `chats` and dashboard).
      // Fire-and-forget: the user already got the tool result via the
      // tool_result message, this is just audit/history logging.
      try {
        const _appendChatId = ctx?.summonId || null;
        if (_appendChatId) {
          appendToolCall(_appendChatId, {
            tool: toolResult.tool,
            args: toolResult.args,
            result: toolResult.result,
            success: toolResult.success,
            error: toolResult.error,
            ms: _toolMs,
          });
        }
      } catch {}

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
      role: session.role?.name,
      rootId: getRootId(ctx.beingId),
      isCustom,
      model: MODEL,
      connectionId: resolvedConnectionId || null,
    };
    return {
      success: true,
      content: "",
      answer: "",
      _internal,
      _continue: continueReason === "tool-cap",
      _continueReason: continueReason,
    };
  }

  return finalizeResponse(session, openai, MODEL, response, isInternal, isCustom, resolvedConnectionId, ctx);
}

// injectContext retired 2026-05-18. The "frontend pushes a buffer-text
// summary of what the user did" pattern is dead under SUMMON — the AI
// sees substrate via SEE, and substrate writes emit DO events that
// interested beings subscribe to. No buffer to inject into.

// Read the role currently bound to a session. Internal-only — used by
// runChat to skip a redundant switchRole when the role hasn't changed.
export function getCurrentRole(sessionKey) {
  return getSession(sessionKey).role;
}

// clearSession / resetConversation / resetVisitorSession / sessionCount
// retired 2026-05-18. The per-tab LLM conversation buffer they operated
// on is a relic of the orchestrator era; under SUMMON each call rebuilds
// context fresh from substrate (Summon records + IBP Address history +
// enrichContext hooks). There's no buffer to clear, no conversation to
// reset, no count worth surfacing as a top-level metric.

/**
 * High-level chat utility for extensions and routes.
 * Handles all boilerplate: MCP connection, mode switch, Chat tracking,
 * processMessage, cleanup. One call.
 *
 * Session routing — three paths in:
 *   1. `clientSessionId`: caller provides the key directly (pass-through from
 *      an upstream runOrchestration that wants this sub-call to join the
 *      user's session, or an extension joining a named internal lane).
 *   2. `scope` + `purpose`: declare a named internal lane. Kernel assembles
 *      `pipeline:tree:${rootId}:${purpose}[:${extra}]` /
 *      `pipeline:home:${beingId}:${purpose}[:${extra}]` /
 *      `pipeline:land:${purpose}[:${extra}]`. Persists across runs.
 *   3. Neither: ephemeral. Fresh `pipeline:ephemeral:${uuid}` per call, one-shot.
 *
 * Default is ephemeral. Extensions that want cross-run memory declare it
 * explicitly via scope/purpose. User keys are built by runOrchestration
 * (not here) from entry-point ingredients.
 *
 * Usage:
 *   // Fire-and-forget (default)
 *   await runChat({ beingId, message, mode });
 *
 *   // Named internal lane with cross-run memory
 *   await runChat({ beingId, message, mode, scope: "tree", purpose: "reflect", rootId });
 *
 *   // Parallel chains within a lane
 *   await runChat({ ..., scope: "tree", purpose: "analyze", extra: "security", rootId });
 *
 *   // Join an upstream user session
 *   await runChat({ ..., clientSessionId: userKeyFromCaller });
 */
/**
 * runChat — canonical entry for one LLM call on behalf of a summoned
 * being. Four structured inputs cover everything:
 *
 *   being    — the Being doc of the responder. Carries _id, username,
 *              currentPositionId, homePositionId, llmDefault.
 *   envelope — the SUMMON envelope that woke this summon. Carries
 *              from (asker stance), content, ibpAddress, correlation,
 *              inReplyTo, rootCorrelation, priority, intent.
 *   role     — the active role spec from ibp/roles/registry.js
 *              (buildSystemPrompt, toolNames, permissions, name).
 *   signal   — AbortController.signal from the scheduler.
 *
 * Derives beingId/beingOut/username/message/nodeId/llmPriority/
 * parentSummonId from the structured inputs and runs one LLM call.
 *
 * See [[project_ibp_universal_grammar]] for the architectural lock.
 */
export async function runChat({ being, envelope, role, signal = null } = {}) {
  // Validate structured inputs
  if (!being?._id) {
    throw new Error("runChat requires being with _id");
  }
  if (!envelope || (envelope.content === undefined && envelope.content !== "")) {
    throw new Error("runChat requires envelope with content");
  }
  if (!role || typeof role !== "object" || !role.name) {
    throw new Error("runChat requires a role spec from ibp/roles/registry.js");
  }

  // Derive locals from the structured inputs.
  const beingOut = String(being._id);
  let askerName = null;
  if (typeof envelope.from === "string") {
    const m = envelope.from.match(/@([a-z][a-z0-9-]*)$/i);
    if (m) askerName = m[1];
  }
  const beingIn  = envelope.fromBeingId || String(being._id);
  const beingId  = beingIn;
  const username = askerName || being.name || null;
  const message  = typeof envelope.content === "string"
    ? envelope.content
    : JSON.stringify(envelope.content);
  const nodeId   = being.currentPositionId || being.homePositionId || null;
  const rootId   = null;
  const llmPriority    = envelope.priority || null;
  const parentSummonId = envelope.inReplyTo || null;

  const { connectToMCP, getMCPClient, MCP_SERVER_URL } = await import("./mcpClient.js");
  const { startSummon, finalizeSummon } = await import("./summonTracker.js");
  const { setSessionAbort, clearSessionAbort } = await import("../session/registry.js");
  const { resolvePipelineKey } = await import("./sessionKeys.js");
  const { computeIbpAddressForSummon } = await import("./ibpAddress.js");

  // Eagerly compute the IBP Address for being-to-being conversations
  // so it can serve as the MCP client cache key. When beingOut is set
  // and both stances resolve, the same IBP Address keys the MCP client
  // across every Summon in this conversation. When it can't be
  // resolved, fall back to a fresh ephemeral pipeline key.
  const _eagerIbpAddress = beingOut
    ? await computeIbpAddressForSummon({
        askerBeingId:    beingId,
        askerPosition:   getCurrentNodeId(beingId) || null,
        addresseeBeingId: beingOut,
      })
    : null;
  const { key: resolvedKey } = resolvePipelineKey({ beingId, rootId });
  const mcpCacheKey = _eagerIbpAddress || resolvedKey;

  // The session-buffer key for the in-memory `sessions` Map. Held as
  // its own local for clarity in the function body; resolves to the
  // same string as mcpCacheKey under the new architecture.
  const sessionKey = mcpCacheKey;
  const sessionId  = crypto.randomUUID();

  // Abort controller for cancellation (Ctrl+C, timeout, etc.)
  const abort = signal ? null : new AbortController();
  const abortSignal = signal || abort.signal;

  // Register abort so external callers can cancel via sessionRegistry.
  // Skip if caller provided a signal (the caller already registered theirs).
  if (abort) setSessionAbort(sessionKey, abort);

  // 1. Connect MCP (reuse if already connected). Cache keyed by
  // mcpCacheKey — IBP Address for being-to-being, internal session
  // key otherwise. Skip if a client already exists under this key.
  if (!getMCPClient(mcpCacheKey)) {
    const internalJwt = signInternalToken({ beingId, name: username });
    try {
      await connectToMCP(MCP_SERVER_URL, mcpCacheKey, internalJwt);
    } catch (err) {
      log.warn("RunChat", `MCP connect failed: ${err.message}`);
    }
  }

  // 2. Set position. rootId is derived from the current node, so
  // callers only set the node; the tree-root follows. When only
  // rootId is known, treat it as the position itself.
  const targetNodeId = nodeId || rootId;
  if (targetNodeId) await setCurrentNodeId(beingId, targetNodeId);

  // 3. Switch role only if different. Role state lives on the
  // conversation entry (keyed by mcpCacheKey: IBP Address or
  // pipelineKey), so two tabs at the same conversation see the same
  // current role and don't re-switch redundantly.
  const currentRole = getCurrentRole(mcpCacheKey);
  if (currentRole?.name !== role.name) {
    try {
      await switchRole(sessionKey, role, { username, beingId, mcpCacheKey, currentNodeId: getCurrentNodeId(beingId) });
    } catch (err) {
      log.warn("RunChat", `Role switch to ${role.name} failed: ${err.message}`);
    }
  }

  // 4. Create Summon record
  let chat;
  try {
    const clientInfo = await getClientForBeing(beingId, sessionKey) || {};
    chat = await startSummon({
      beingIn:       beingId,                                       // asker
      beingOut,                                                     // responder
      // Asker stance position: the asker's CURRENT navigated position
      // (per Being.currentPositionId / seed/beingPosition.js cache),
      // with rootId as fallback. The Summon's IBP Address is computed
      // from this stance plus the addressee's stance.
      askerPosition: getCurrentNodeId(beingId) || rootId || null,
      message,
      activeRole:    role.name,
      llmProvider: {
        isCustom:     clientInfo.isCustom || false,
        model:        clientInfo.model || "unknown",
        connectionId: clientInfo.connectionId || null,
      },
      // When the caller links to a parent Summon, the new record
      // joins that reply chain (rootCorrelation propagates).
      ...(parentSummonId ? { inReplyTo: parentSummonId } : {}),
    });
  } catch (err) {
    log.warn("RunChat", `Summon create failed: ${err.message}`);
  }

  // 5. Run processMessage. summonId / sessionId / mcpCacheKey ride
  // through ctx so the tool loop knows which Summon owns the tool
  // calls and which MCP client to use, without per-sessionKey side
  // channels.
  let result;
  try {
    result = await processMessage(sessionKey, message, {
      username,
      beingId,
      rootId,
      currentNodeId: getCurrentNodeId(beingId),
      summonId:     chat?._id || null,
      rootSummonId: chat?._id || null,   // runChat creates one root Summon; summonId === rootSummonId
      sessionId,
      mcpCacheKey,
      signal:       abortSignal,
      llmPriority,
      // Role permissions ∩ tool verbs — narrows the LLM's tool surface
      // to what the role declares. Permissions are role identity; no
      // envelope or caller may widen them. Untagged tools are rejected
      // at registration (see seed/tools.js).
      rolePermissions: Array.isArray(role.permissions) ? role.permissions : null,
      // Role spec flows through ctx so ensureSession can apply it
      // when the session has none yet (first message on a fresh key).
      role,
    });
  } catch (err) {
    if (chat) {
      const stopped = abortSignal.aborted;
      try { await finalizeSummon({ summonId: chat._id, content: stopped ? null : `Error: ${err.message}`, stopped }); } catch {}
    }
    if (abort) clearSessionAbort(sessionKey);
    throw err;
  }

  const stopped = abortSignal.aborted;
  let answer = stopped ? null : (result?.content || result?.answer || "No response.");

  // 6. beforeResponse hook: extensions clean/modify the response before delivery.
  if (answer && !stopped) {
    try {
      const hookData = { content: answer, beingId, rootId, role: role.name };
      await hooks.run("beforeResponse", hookData);
      answer = hookData.content;
    } catch {}
  }

  // 7. Finalize Chat
  if (chat) {
    try {
      const internal = result?._internal || {};
      await finalizeSummon({ summonId: chat._id, content: stopped ? null : answer, stopped, role: internal.role || role.name });
    } catch {}
  }

  // 8. Clear abort (keep session + MCP alive for next message in same role)
  if (abort) clearSessionAbort(sessionKey);

  return {
    answer,
    summonId: chat?._id || null,
    role:     role.name,
    sessionKey,
  };
}
