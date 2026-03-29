import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import { createNote } from "../../seed/tree/notes.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import {
  isInitialized,
  getSetupPhase,
  findStudyNodes,
  getStudyProgress,
  getGaps,
  addToQueue,
} from "./core.js";
import { scaffold } from "./setup.js";

let Node = NodeModel;
export function setServices({ Node: N }) { if (N) Node = N; }

const router = express.Router();

// ── Intent detection ──

function detectIntent(message) {
  const lower = message.toLowerCase();
  if (/\b(needlearn|need to learn|want to learn|add to queue|queue)\b/.test(lower)) return "queue";
  if (/\b(study session|continue studying|let's study|teach me|study$)\b/.test(lower)) return "session";
  if (/\b(progress|mastery|how am i|gaps?|review|status|streak)\b/.test(lower)) return "review";
  if (/\b(curriculum|break.*down|plan|organize|structure|build.*curriculum)\b/.test(lower)) return "plan";
  // URL detection
  if (/^https?:\/\//.test(lower.trim())) return "queue";
  return "log";
}

/**
 * POST /root/:rootId/study
 */
router.post("/root/:rootId/study", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawMessage = req.body.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(" ") : rawMessage;
    if (!message) return sendError(res, 400, ERR.INVALID_INPUT, "message required");

    const root = await Node.findById(rootId).select("rootOwner contributors").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

    const userId = req.userId;
    const isOwner = root.rootOwner?.toString() === userId;
    const isContributor = root.contributors?.some(c => c.toString() === userId);
    if (!isOwner && !isContributor) return sendError(res, 403, ERR.FORBIDDEN, "No access");

    const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
    if (await isExtensionBlockedAtNode("study", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "Study is blocked on this branch.");
    }

    const user = await UserModel.findById(userId).select("username").lean();
    const username = user?.username || "user";
    const { runChat } = await import("../../seed/llm/conversation.js");

    // ── PATH 1: First use ──
    if (!(await isInitialized(rootId))) {
      await scaffold(rootId, userId);

      try {
        const { answer, chatId } = await runChat({
          userId, username,
          message: `New study tree. The user said: "${message}". Help them set up. Ask what they want to learn, their learning style, and daily study goal.`,
          mode: "tree:study-plan",
          rootId, res, slot: "study",
        });
        if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:study-plan", setup: true });
      } catch (llmErr) {
        if (!res.headersSent) sendOk(res, { answer: "Tree created. Set up an LLM connection to start the conversation.", mode: "tree:study-plan", setup: true });
      }
      return;
    }

    // ── PATH 1b: Setup incomplete ──
    const phase = await getSetupPhase(rootId);
    if (phase === "base") {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:study-plan",
        rootId, res, slot: "study",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:study-plan", setup: true });
      return;
    }

    const intent = detectIntent(message);

    // ── PATH 2: Queue add ──
    if (intent === "queue") {
      // Extract topic from "needlearn X" pattern
      const topic = message.replace(/^(needlearn|need to learn|want to learn|add to queue)\s*/i, "").trim();
      if (topic) {
        const isUrl = /^https?:\/\//.test(topic);
        const result = await addToQueue(rootId, topic, userId, { url: isUrl ? topic : null });

        // Write to Log
        const nodes = await findStudyNodes(rootId);
        if (nodes?.log) {
          try { await createNote({ nodeId: nodes.log.id, content: `Queued: ${topic}`, contentType: "text", userId }); } catch {}
        }

        sendOk(res, { answer: `Queued: "${result.name}".${isUrl ? " Content will be fetched by learn extension." : ""}`, mode: "tree:study-log" });
        return;
      }
      // Fall through to log mode if no topic extracted
    }

    // ── PATH 3: Study session ──
    if (intent === "session") {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:study-session",
        rootId, res, slot: "study",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:study-session" });
      return;
    }

    // ── PATH 4: Review ──
    if (intent === "review") {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:study-review",
        rootId, res, slot: "study",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:study-review" });
      return;
    }

    // ── PATH 5: Plan/curriculum ──
    if (intent === "plan") {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:study-plan",
        rootId, res, slot: "study",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:study-plan" });
      return;
    }

    // ── PATH 6: Default log ──
    const { answer, chatId } = await runChat({
      userId, username, message,
      mode: "tree:study-log",
      rootId, res, slot: "study",
    });
    if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:study-log" });

  } catch (err) {
    log.error("Study", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, "Study request failed");
  }
});

/**
 * POST /root/:rootId/study/queue - needlearn shortcut
 */
router.post("/root/:rootId/study/queue", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawTopic = req.body.topic;
    const topic = Array.isArray(rawTopic) ? rawTopic.join(" ") : rawTopic;
    if (!topic) return sendError(res, 400, ERR.INVALID_INPUT, "topic required");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Study tree not initialized. Use 'study' first.");
    }

    const isUrl = /^https?:\/\//.test(topic);
    const result = await addToQueue(rootId, topic, req.userId, { url: isUrl ? topic : null });
    sendOk(res, { queued: result.name, url: isUrl || undefined });
  } catch (err) {
    log.error("Study", "Queue error:", err.message);
    sendError(res, 500, ERR.INTERNAL, "Queue add failed");
  }
});

/**
 * GET /root/:rootId/study/status
 */
router.get("/root/:rootId/study/status", authenticate, async (req, res) => {
  try {
    const progress = await getStudyProgress(req.params.rootId);
    if (!progress) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Study tree not found");
    sendOk(res, progress);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Status failed");
  }
});

/**
 * GET /root/:rootId/study/gaps
 */
router.get("/root/:rootId/study/gaps", authenticate, async (req, res) => {
  try {
    const gaps = await getGaps(req.params.rootId);
    sendOk(res, { gaps });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Gaps failed");
  }
});

export default router;
