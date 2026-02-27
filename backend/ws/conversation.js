// ws/conversation.js
// Mode-aware conversation state management and chat processing

import OpenAI from "openai";
import dotenv from "dotenv";
import crypto from "crypto";
import User from "../db/models/user.js";
import {
  getMode,
  getDefaultMode,
  getToolsForMode,
  buildPromptForMode,
  CARRY_MESSAGES,
} from "./modes/registry.js";
import { mcpClients, connectToMCP, MCP_SERVER_URL } from "./mcp.js";

import { resolveAndValidateHost } from "../core/customLLM.js";


dotenv.config();

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT LLM CLIENT (your server)
// ─────────────────────────────────────────────────────────────────────────

const defaultClient = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || "http://10.0.0.23:11434/v1",
  apiKey: process.env.OPENAI_API_KEY || "ollama",
});
//"gpt-oss:20b";
const DEFAULT_MODEL = process.env.AI_MODEL || "qwen3.5:27b";

const MAX_MESSAGES = 30;
const MAX_TOOL_ITERATIONS = 15;

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION HELPERS (must match whatever you use when saving)
// ─────────────────────────────────────────────────────────────────────────

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

/**
 * Returns { client, model, isCustom } for a user.
 * Uses their custom LLM if configured, otherwise falls back to default.
 */

export async function getClientForUser(userId) {
  if (!userId) return { client: defaultClient, model: DEFAULT_MODEL, isCustom: false };

  var cached = userClientCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < CLIENT_CACHE_TTL) {
    return cached;
  }

  try {
    var user = await User.findById(userId)
      .select("customLlmConnection")
      .lean();

    var conn = user && user.customLlmConnection;

    if (conn && conn.baseUrl && conn.encryptedApiKey && !conn.revoked) {
      // Re-validate DNS at request time to prevent DNS rebinding
      try {
        var hostname = new URL(conn.baseUrl).hostname;
        await resolveAndValidateHost(hostname);
      } catch (err) {
        console.error("Blocked custom LLM for " + userId + ": " + err.message);
        var fallback = {
          client: defaultClient,
          model: DEFAULT_MODEL,
          isCustom: false,
          fetchedAt: Date.now(),
        };
        userClientCache.set(userId, fallback);
        return fallback;
      }

      var apiKey = decrypt(conn.encryptedApiKey);

      var baseURL = conn.baseUrl.replace(/\/+$/, "");
      if (baseURL.endsWith("/chat/completions")) {
        baseURL = baseURL.replace(/\/chat\/completions$/, "");
      }

      var entry = {
        client: new OpenAI({ baseURL: baseURL, apiKey: apiKey }),
        model: conn.model || DEFAULT_MODEL,
        isCustom: true,
        fetchedAt: Date.now(),
      };

      userClientCache.set(userId, entry);

      User.updateOne(
        { _id: userId },
        { $set: { "customLlmConnection.lastUsedAt": new Date() } }
      ).catch(function () {});

      return entry;
    }
  } catch (err) {
    console.error("Failed to load custom LLM for user " + userId + ": " + err.message);
  }

  var defaultEntry = {
    client: defaultClient,
    model: DEFAULT_MODEL,
    isCustom: false,
    fetchedAt: Date.now(),
  };
  userClientCache.set(userId, defaultEntry);
  return defaultEntry;
}

/**
 * Clear cached client for a user (call when they update/revoke their LLM config).
 */
export function clearUserClientCache(userId) {
  userClientCache.delete(userId);
}

// ─────────────────────────────────────────────────────────────────────────
// SESSION STATE (keyed by visitorId)
// ─────────────────────────────────────────────────────────────────────────

// Each session holds: { modeKey, bigMode, messages[], rootId }
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
    });
  }
  return sessions.get(visitorId);
}

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

  // Resolve LLM client for this user (custom or default)
  const { client: openai, model: MODEL, isCustom } = await getClientForUser(ctx.userId);

 

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

    // If tools are requested, continue the loop
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // tool execution happens below
    } else {
      // ✅ No tools left → now safe to return for internal mode
        if (isInternal) {
        const raw = assistantMessage.content;
        try {
          return JSON.parse(raw);
        } catch (err) {
          // Try stripping markdown fences
          try {
            const stripped = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
            return JSON.parse(stripped);
          } catch (_) {}

          // If it looks like truncated JSON, return it as raw context
          // rather than failing — the orchestrator can still use it
          if (raw && (raw.startsWith("{") || raw.startsWith("["))) {
            return { _raw: true, content: raw };
          }

          return {
            action: "error",
            reason: "Internal mode returned invalid JSON",
            raw,
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
  console.log(`🧹 Cleared session for ${visitorId}`);
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