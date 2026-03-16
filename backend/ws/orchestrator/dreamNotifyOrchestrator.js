// ws/orchestrator/dreamNotifyOrchestrator.js
// Phase 4 of tree dream: generates summary + thought notifications from dream AI chats.
// No tools needed — two tool-less LLM calls, then saves Notification documents.

import dotenv from "dotenv";

dotenv.config();

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

import { switchMode, processMessage, setRootId, getClientForUser, resolveRootLlmForMode, clearSession } from "../conversation.js";
import { trackChainStep, startAIChat, finalizeAIChat, clearAiContributionContext } from "../aiChatTracker.js";
import { connectToMCP, MCP_SERVER_URL, closeMCPClient } from "../mcp.js";
import { createSession, endSession, setSessionAbort, clearSessionAbort, SESSION_TYPES } from "../sessionRegistry.js";
import AIChat from "../../db/models/aiChat.js";
import Node from "../../db/models/node.js";
import Notification from "../../db/models/notification.js";

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

function parseJsonSafe(text) {
  try {
    if (typeof text === "object" && text !== null) return text;
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

const MSG_CAP = 1500;

function capText(text) {
  if (!text || text.length <= MSG_CAP) return text || "";
  return text.slice(0, MSG_CAP) + "...";
}

/**
 * Build a condensed dream log from AIChat records.
 * Includes the actual start/end messages (capped at 1500 chars each)
 * plus metadata like mode, target, and result.
 */
function buildDreamLog(chats) {
  const entries = [];
  for (const chat of chats) {
    const mode = chat.aiContext?.path || "unknown";
    const result = chat.treeContext?.stepResult || "";
    const target = chat.treeContext?.targetPath || chat.treeContext?.targetNodeName || "";

    let header = `[${mode}]`;
    if (target) header += ` on "${target}"`;
    if (result) header += ` (${result})`;

    const startMsg = capText(chat.startMessage?.content);
    const endMsg = capText(chat.endMessage?.content);

    let entry = header;
    if (startMsg) entry += `\nInput: ${startMsg}`;
    if (endMsg) entry += `\nOutput: ${endMsg}`;

    entries.push(entry);
  }
  // Cap at 60 entries to stay within token limits
  return entries.slice(0, 60).join("\n---\n");
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

export async function orchestrateDreamNotify({
  rootId,
  userId,
  username,
  treeName,
  dreamSessionIds,
  source = "background",
}) {
  const visitorId = `dream-notify:${rootId}:${Date.now()}`;
  const { sessionId } = createSession({
    userId,
    type: SESSION_TYPES.DREAM_NOTIFY,
    description: `Dream notifications: ${treeName}`,
    meta: { rootId, visitorId },
  });
  const abort = new AbortController();
  setSessionAbort(sessionId, abort);

  let chainIndex = 1;
  let mainChatId = null;
  let finalizeArgs = { content: null, stopped: true, modeKey: "dream-notify:complete" };

  // ── LLM provider ────────────────────────────────────────────────────
  let llmProvider;
  try {
    const modeConnectionId = await resolveRootLlmForMode(rootId, "tree:dream-summary");
    const clientInfo = await getClientForUser(userId, "main", modeConnectionId);
    llmProvider = {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    llmProvider = undefined;
  }

  // ── AI chat tracking ─────────────────────────────────────────────────
  const mainChat = await startAIChat({
    userId,
    sessionId,
    message: `Dream notifications for "${treeName}"`,
    source,
    modeKey: "dream-notify:start",
    llmProvider,
  });
  mainChatId = mainChat._id;

  // ── MCP connection ───────────────────────────────────────────────────
  const internalJwt = jwt.sign({ userId, username, visitorId }, JWT_SECRET, { expiresIn: "1h" });
  await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);

  console.log(`📬 Dream notifications starting for "${treeName}"`);

  try {
    setRootId(visitorId, rootId);

    // ── Fetch dream AI chats ──────────────────────────────────────────
    const dreamChats = await AIChat.find({
      sessionId: { $in: dreamSessionIds },
    })
      .sort({ sessionId: 1, chainIndex: 1 })
      .select("aiContext treeContext startMessage endMessage")
      .lean();

    if (dreamChats.length === 0) {
      console.log(`📬 No AI chats found for dream sessions, skipping notifications`);
      finalizeArgs = { content: "No dream activity to summarize", stopped: false, modeKey: "dream-notify:complete" };
      return;
    }

    const dreamLog = buildDreamLog(dreamChats);

    // ════════════════════════════════════════════════════════════════
    // STEP 1: DREAM SUMMARY
    // ════════════════════════════════════════════════════════════════

    switchMode(visitorId, "tree:dream-summary", {
      username,
      userId,
      rootId,
      treeName,
      dreamLog,
      clearHistory: true,
    });

    const summaryStart = new Date();
    const summaryResult = await processMessage(
      visitorId,
      "Summarize this dream.",
      { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
    );
    const summaryEnd = new Date();

    const summaryLlm = summaryResult?._llmProvider || llmProvider;
    const summary = parseJsonSafe(summaryResult?.answer || summaryResult);

    trackChainStep({
      userId,
      sessionId,
      rootChatId: mainChatId,
      chainIndex: chainIndex++,
      modeKey: "tree:dream-summary",
      source,
      input: "dream summary",
      output: summary,
      startTime: summaryStart,
      endTime: summaryEnd,
      llmProvider: summaryLlm,
    });

    // ════════════════════════════════════════════════════════════════
    // STEP 2: DREAM THOUGHT
    // ════════════════════════════════════════════════════════════════

    switchMode(visitorId, "tree:dream-thought", {
      username,
      userId,
      rootId,
      treeName,
      dreamLog,
      clearHistory: true,
    });

    const thoughtStart = new Date();
    const thoughtResult = await processMessage(
      visitorId,
      "Generate a thought for today.",
      { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
    );
    const thoughtEnd = new Date();

    const thoughtLlm = thoughtResult?._llmProvider || llmProvider;
    const thought = parseJsonSafe(thoughtResult?.answer || thoughtResult);

    trackChainStep({
      userId,
      sessionId,
      rootChatId: mainChatId,
      chainIndex: chainIndex++,
      modeKey: "tree:dream-thought",
      source,
      input: "dream thought",
      output: thought,
      startTime: thoughtStart,
      endTime: thoughtEnd,
      llmProvider: thoughtLlm,
    });

    // ════════════════════════════════════════════════════════════════
    // SAVE NOTIFICATIONS
    // ════════════════════════════════════════════════════════════════

    const rootNode = await Node.findById(rootId).select("rootOwner contributors").lean();
    const recipients = new Set();
    if (rootNode?.rootOwner) recipients.add(rootNode.rootOwner);
    if (rootNode?.contributors) {
      for (const c of rootNode.contributors) recipients.add(c);
    }

    const notifications = [];

    for (const recipientId of recipients) {
      if (summary?.title && summary?.content) {
        notifications.push({
          userId: recipientId,
          rootId,
          type: "dream-summary",
          title: summary.title,
          content: summary.content,
          dreamSessionIds,
        });
      }

      if (thought?.title && thought?.content) {
        notifications.push({
          userId: recipientId,
          rootId,
          type: "dream-thought",
          title: thought.title,
          content: thought.content,
          dreamSessionIds,
        });
      }
    }

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
      console.log(`📬 Created ${notifications.length} notification(s) for ${recipients.size} user(s)`);
    }

    finalizeArgs = {
      content: `Summary: ${summary?.title || "failed"} | Thought: ${thought?.title || "failed"}`,
      stopped: false,
      modeKey: "dream-notify:complete",
    };
  } catch (err) {
    console.error(`❌ Dream notification error for "${treeName}":`, err.message);
    finalizeArgs = { content: err.message, stopped: abort.signal.aborted, modeKey: "dream-notify:complete" };
  } finally {
    if (mainChatId) {
      finalizeAIChat({ chatId: mainChatId, ...finalizeArgs }).catch((e) =>
        console.error(`❌ Failed to finalize dream-notify chat:`, e.message),
      );
    }
    clearAiContributionContext(visitorId);
    clearSessionAbort(sessionId);
    endSession(sessionId);
    closeMCPClient(visitorId);
    clearSession(visitorId);
  }
}
