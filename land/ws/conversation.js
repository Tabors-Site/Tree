// ws/conversation.js
// Mode-aware conversation state management and chat processing

import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import User from "../db/models/user.js";
import Node from "../db/models/node.js";
import CustomLlmConnection from "../db/models/customLlmConnection.js";
import {
  getMode,
  getDefaultMode,
  getToolsForMode,
  buildPromptForMode,
  CARRY_MESSAGES,
} from "./modes/registry.js";
import { mcpClients, connectToMCP, MCP_SERVER_URL } from "./mcp.js";
import { getLandUrl } from "../canopy/identity.js";

import { resolveAndValidateHost } from "../core/llms/customLLM.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT LLM CLIENT (your server)
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.AI_MODEL || "qwen3.5:27b";

const MAX_MESSAGES = 30;
const MAX_TOOL_ITERATIONS = 15;

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION HELPERS (must match whatever you use when saving)
// ─────────────────────────────────────────────────────────p────────────────

const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";

function decrypt(encryptedText) {
  const [ivHex, encrypted] = encryptedText.split(":");
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
const CLIENT_CACHE_TTL = 5 * 60 * 1000; // 5 min
const PROXY_CACHE_TTL = 60 * 1000; // 1 min for canopy proxy clients

/**
 * Returns { client, model, isCustom } for a user.
 * Uses their custom LLM if configured, otherwise falls back to default.
 */

/**
 * Try to build a client entry from a specific connectionId.
 * Returns the entry on success, or null if the connection is missing/invalid.
 */
async function resolveConnection(connectionId, cacheKey) {
  var conn = await CustomLlmConnection.findById(connectionId).lean();
  if (!conn || !conn.baseUrl || !conn.encryptedApiKey) return null;

  // God plan users can use private/internal IPs (e.g. local Ollama)
  var owner = await User.findById(conn.userId).select("profileType").lean();
  var isGod = owner && owner.profileType === "god";

  if (!isGod) {
    try {
      var hostname = new URL(conn.baseUrl).hostname;
      await resolveAndValidateHost(hostname);
    } catch (err) {
      console.error(
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
      maxRetries: 3,
      timeout: 60_000,
      defaultHeaders: {
        "HTTP-Referer": getLandUrl(),
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

  CustomLlmConnection.updateOne(
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
      console.error(
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
    var user = await User.findById(userId).select("llmAssignments").lean();
    var assignments = user && user.llmAssignments;
    var connectionId = (assignments && assignments[slot]) || null;

    // Fall back to "main" slot if the specific slot has no assignment
    if (!connectionId && slot !== "main" && assignments && assignments.main) {
      connectionId = assignments.main;
    }

    if (connectionId) {
      var entry = await resolveConnection(connectionId, cacheKey);
      if (entry) return entry;
    }
  } catch (err) {
    console.error(
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
    console.error("Failed to create canopy LLM proxy for user " + userId + ": " + err.message);
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
const MODE_TO_ASSIGNMENT = {
  // placement covers the core tree orchestration modes
  "tree:librarian": "placement",
  "tree:navigate": "placement",
  "tree:structure": "placement",
  "tree:edit": "placement",
  "tree:be": "placement",
  "tree:getContext": "placement",
  // respond gets its own key
  "tree:respond": "respond",
  // notes gets its own key
  "tree:notes": "notes",
  // understanding modes
  "tree:understand": "understanding",
  "tree:understand-summarize": "understanding",
  // cleanup modes
  "tree:cleanup-analyze": "cleanup",
  "tree:cleanup-expand-scan": "cleanup",
  // drain modes
  "tree:drain-cluster": "drain",
  "tree:drain-scout": "drain",
  "tree:drain-plan": "drain",
  // dream notification modes
  "tree:dream-summary": "notification",
  "tree:dream-thought": "notification",
};

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
      .select("llmAssignments")
      .lean();
    if (!rootNode?.llmAssignments) return null;

    // "none" means LLM is explicitly off for this tree
    if (rootNode.llmAssignments.default === "none") return null;

    const assignmentKey = MODE_TO_ASSIGNMENT[modeKey];
    if (assignmentKey) {
      const modeOverride = rootNode.llmAssignments[assignmentKey];
      if (modeOverride) return modeOverride;
    }

    // Fallback to tree default
    return rootNode.llmAssignments.default || null;
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
  var user = await User.findById(userId).select("llmAssignments").lean();
  if (user?.llmAssignments?.main) return true;
  var count = await CustomLlmConnection.countDocuments({ userId });
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
      console.log(
        `🧹 Swept ${swept} stale conversation session(s) (${sessions.size} remaining)`,
      );
  },
  10 * 60 * 1000,
);

// ─────────────────────────────────────────────────────────────────────────
// MODE SWITCHING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Switch to a new mode. Resets conversation but carries recent messages.
 * Returns { modeKey, alert } for the frontend.
 */
export function switchMode(visitorId, newModeKey, ctx) {
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
  const systemPrompt = buildPromptForMode(newModeKey, {
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

  console.log(
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
export function switchBigMode(visitorId, bigMode, ctx) {
  const defaultModeKey = getDefaultMode(bigMode);
  if (!defaultModeKey) throw new Error(`No default mode for: ${bigMode}`);
  return switchMode(visitorId, defaultModeKey, { ...ctx, clearHistory: true });
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
    switchMode(visitorId, "home:default", ctx);
  }

  const mode = getMode(session.modeKey);

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
    // Charge energy to discourage chatting without a connection
    try {
      const { useEnergy } = await import("../core/tree/energy.js");
      await useEnergy({ userId: ctx.userId, action: "chatError" });
    } catch (_) {}
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
    client = await connectToMCP(
      MCP_SERVER_URL,
      visitorId,
      ctx.username,
      ctx.userId,
    );
  }

  // Check for conversation length - loop if needed (BE mode)
  if (
    mode.maxMessagesBeforeLoop &&
    session.messages.length > mode.maxMessagesBeforeLoop
  ) {
    console.log(`🔁 Conversation loop for ${visitorId} in ${session.modeKey}`);
    const recentMessages = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-(CARRY_MESSAGES * 2)); // carry more on loop

    const systemPrompt = buildPromptForMode(session.modeKey, {
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
    const systemPrompt = buildPromptForMode(session.modeKey, {
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

  // Get tools for current mode
  const tools = getToolsForMode(session.modeKey);

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

    response = await openai.chat.completions.create(requestParams, requestOpts);

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
        console.warn(
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
        console.error(`❌ Invalid tool arguments for ${toolName}:`, e.message);
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

      console.log(`🔧 [${session.modeKey}] ${toolName}`, args);

      try {
        const result = await client.callTool({
          name: toolName,
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

        toolResults.push({ tool: toolName, args, success: true });
      } catch (err) {
        console.error(`❌ Tool ${toolName} failed:`, err.message);

        session.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message }),
        });

        toolResults.push({
          tool: toolName,
          args,
          success: false,
          error: err.message,
        });
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

  return {
    success: true,
    answer: finalAnswer,
    modeKey: session.modeKey,
    rootId: session.rootId,
    isCustomLLM: isCustom,
    llmProvider: {
      isCustom,
      model: MODEL,
      connectionId: resolvedConnectionId || null,
    },
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

export function conversationSessionCount() {
  return sessions.size;
}

/**
 * Reset conversation messages but keep mode and rootId intact.
 * Rebuilds system prompt for the current mode.
 */
export function resetConversation(visitorId, ctx) {
  const session = getSession(visitorId);
  if (!session.modeKey) return;

  const systemPrompt = buildPromptForMode(session.modeKey, {
    username: ctx.username,
    userId: ctx.userId,
    rootId: session.rootId,
  });

  session.messages = [{ role: "system", content: systemPrompt }];
  console.log(
    `🔄 Reset conversation for ${visitorId} (mode: ${session.modeKey}, root: ${session.rootId})`,
  );
}

export function getConversation(visitorId) {
  return getSession(visitorId).messages;
}

export function getSessionInfo(visitorId) {
  const s = getSession(visitorId);
  return {
    modeKey: s.modeKey,
    bigMode: s.bigMode,
    rootId: s.rootId,
    messageCount: s.messages.length,
  };
}

export function sessionCount() {
  return sessions.size;
}
