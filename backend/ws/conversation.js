// ws/conversation.js
// Mode-aware conversation state management and chat processing

import OpenAI from "openai";
import dotenv from "dotenv";
import {
  getMode,
  getDefaultMode,
  getToolsForMode,
  buildPromptForMode,
  CARRY_MESSAGES,
} from "./modes/registry.js";
import { mcpClients, connectToMCP, MCP_SERVER_URL } from "./mcp.js";

dotenv.config();

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || "http://localhost:11434/v1",
  apiKey: process.env.OPENAI_API_KEY || "ollama",
});

const MODEL = process.env.AI_MODEL || "gpt-oss:20b";
const MAX_MESSAGES = 30;
const MAX_TOOL_ITERATIONS = 15;

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

  // Determine how many messages to carry over
  let carryCount = CARRY_MESSAGES;

  // Reflect modes get extra context carry for plan formation
  const oldMode = oldModeKey ? getMode(oldModeKey) : null;
  if (oldMode?.preserveContextOnSwitch) {
    carryCount = Math.min(oldMessages.length, 8); // carry more from reflect
  }

  // Extract recent user/assistant messages (skip system & tool messages)
  const recentMessages = oldMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-carryCount);

  // Build new system prompt
  const systemPrompt = buildPromptForMode(newModeKey, {
    username: ctx.username,
    userId: ctx.userId,
    rootId: session.rootId || ctx.rootId,
  });

  // Build carried context summary if there are messages to carry
  const carriedContext =
    recentMessages.length > 0
      ? [
          {
            role: "system",
            content: `[Mode Switch] Switched from ${oldModeKey || "none"} to ${newModeKey}. Here is recent conversation context for continuity:`,
          },
          ...recentMessages,
        ]
      : [];

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
  return switchMode(visitorId, defaultModeKey, ctx);
}

// ─────────────────────────────────────────────────────────────────────────
// CHAT PROCESSING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Process a chat message within the current mode.
 */
export async function processMessage(visitorId, message, ctx) {
  const session = getSession(visitorId);

  // Ensure we have a mode - default to home:default
  if (!session.modeKey) {
    switchMode(visitorId, "home:default", ctx);
  }

  const mode = getMode(session.modeKey);

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
    session.messages.push(assistantMessage);

    // No tool calls = final response
    if (
      !assistantMessage.tool_calls ||
      assistantMessage.tool_calls.length === 0
    ) {
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
  const lastMsg = session.messages[session.messages.length - 1];
  if (lastMsg?.role !== "assistant" || lastMsg?.content !== finalAnswer) {
    session.messages.push({ role: "assistant", content: finalAnswer });
  }

  return {
    success: true,
    answer: finalAnswer,
    modeKey: session.modeKey,
    rootId: session.rootId,
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
