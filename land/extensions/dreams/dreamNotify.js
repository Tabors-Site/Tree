// orchestrators/pipelines/dreamNotify.js
// Phase 4 of tree dream: generates summary + thought notifications from dream AI chats.
// Two tool-less LLM calls, then saves Notification documents.

import log from "../../seed/log.js";
import { OrchestratorRuntime, LLM_PRIORITY } from "../../seed/orchestrators/runtime.js";
import { SESSION_TYPES } from "../../seed/ws/sessionRegistry.js";
import { getExtension } from "../loader.js";
import Chat from "../../seed/models/chat.js";
import Node from "../../seed/models/node.js";

function getNotificationModel() {
  const ext = getExtension("notifications");
  return ext?.exports?.Notification || null;
}

const MSG_CAP = 1500;

function capText(text) {
  if (!text || text.length <= MSG_CAP) return text || "";
  return text.slice(0, MSG_CAP) + "...";
}

/**
 * Build a condensed dream log from Chat records.
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
  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username,
    // Tree-scoped dream-notify lane — chains nightly so the AI can compare
    // today's dream to prior dreams on the same tree.
    scope: "tree",
    purpose: "dream-notify",
    sessionType: SESSION_TYPES.DREAM_NOTIFY,
    description: `Dream notifications: ${treeName}`,
    modeKeyForLlm: "tree:dream-summary",
    source,
    llmPriority: LLM_PRIORITY.BACKGROUND,
  });

  const initialized = await rt.init(`Dream notifications for "${treeName}"`);
  if (!initialized) return;

 log.verbose("Dreams", `Dream notifications starting for "${treeName}"`);

  try {
    // Fetch dream AI chats
    const dreamChats = await Chat.find({
      sessionId: { $in: dreamSessionIds },
    })
      .sort({ sessionId: 1, chainIndex: 1 })
      .select("aiContext treeContext startMessage endMessage")
      .lean();

    if (dreamChats.length === 0) {
 log.debug("Dreams", `No AI chats found for dream sessions, skipping notifications`);
      rt.setResult("No dream activity to summarize", "dream-notify:complete");
      return;
    }

    const dreamLog = buildDreamLog(dreamChats);

    // STEP 1: DREAM SUMMARY
    const { parsed: summary } = await rt.runStep("tree:dream-summary", {
      prompt: "Summarize this dream.",
      modeCtx: { treeName, dreamLog },
      input: "dream summary",
    });

    // STEP 2: DREAM THOUGHT
    const { parsed: thought } = await rt.runStep("tree:dream-thought", {
      prompt: "Generate a thought for today.",
      modeCtx: { treeName, dreamLog },
      input: "dream thought",
    });

    // SAVE NOTIFICATIONS
    const rootNode = await Node.findById(rootId).select("rootOwner contributors").lean();
    const recipients = new Set();
    if (rootNode?.rootOwner) recipients.add(rootNode.rootOwner);
    if (rootNode?.contributors) {
      for (const c of rootNode.contributors) recipients.add(c);
    }

    // Strip HTML tags from LLM output. The prompt asks for plain text
    // but models sometimes return HTML/markdown. Notifications render
    // as escaped text, so tags would show as literal <h1>, <strong>, etc.
    function stripTags(str) {
      if (typeof str !== "string") return str;
      return str.replace(/<[^>]*>/g, "").trim();
    }

    const notifications = [];

    for (const recipientId of recipients) {
      if (summary?.title && summary?.content) {
        notifications.push({
          userId: recipientId,
          rootId,
          type: "dream-summary",
          title: stripTags(summary.title),
          content: stripTags(summary.content),
          dreamSessionIds,
        });
      }

      if (thought?.title && thought?.content) {
        notifications.push({
          userId: recipientId,
          rootId,
          type: "dream-thought",
          title: stripTags(thought.title),
          content: stripTags(thought.content),
          dreamSessionIds,
        });
      }
    }

    if (notifications.length > 0) {
      const Notification = getNotificationModel();
      if (!Notification) {
        log.warn("Dreams", "Notifications extension not installed, skipping notification save");
      } else {
        await Notification.insertMany(notifications);
        log.verbose("Dreams", `Created ${notifications.length} notification(s) for ${recipients.size} user(s)`);
      }

      // Dispatch to gateway channels (fire-and-forget)
      const uniqueNotifs = [];
      if (summary?.title && summary?.content) {
        uniqueNotifs.push({ type: "dream-summary", title: summary.title, content: summary.content });
      }
      if (thought?.title && thought?.content) {
        uniqueNotifs.push({ type: "dream-thought", title: thought.title, content: thought.content });
      }
      if (uniqueNotifs.length > 0) {
        const gateway = getExtension("gateway");
        if (gateway?.exports?.dispatchNotifications) {
          gateway.exports.dispatchNotifications(rootId, uniqueNotifs)
            .catch((err) => log.error("Dreams", `Gateway dispatch error for root ${rootId}:`, err.message));
        }
      }
    }

    rt.setResult(
      `Summary: ${summary?.title || "failed"} | Thought: ${thought?.title || "failed"}`,
      "dream-notify:complete",
    );
  } catch (err) {
 log.error("Dreams", `Dream notification error for "${treeName}":`, err.message);
    rt.setError(err.message, "dream-notify:complete");
  } finally {
    await rt.cleanup();
  }
}
