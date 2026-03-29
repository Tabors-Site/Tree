import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import { createNote } from "../../seed/tree/notes.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";
import {
  scaffold,
  isInitialized,
  findRecoveryNodes,
  parseCheckIn,
  recordDoses,
  recordCraving,
  recordMood,
  recordEnergy,
  getStatus,
  getPatterns,
  getMilestones,
  getHistory,
  addSubstance,
} from "./core.js";

const router = express.Router();

// ── HTML Dashboard (GET with ?html) ──
router.get("/root/:rootId/recovery", async (req, res, next) => {
  if (!("html" in req.query)) return next();
  try {
    const { isHtmlEnabled } = await import("../html-rendering/config.js");
    if (!isHtmlEnabled()) return next();
    const urlAuth = (await import("../html-rendering/urlAuth.js")).default;
    urlAuth(req, res, async () => {
      const { rootId } = req.params;
      const root = await NodeModel.findById(rootId).select("name metadata").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Not found");
      let status = null, milestones = null;
      if (await isInitialized(rootId)) {
        [status, milestones] = await Promise.all([getStatus(rootId), getMilestones(rootId)]);
      }
      const { renderRecoveryDashboard } = await import("./pages/dashboard.js");
      res.send(renderRecoveryDashboard({ rootId, rootName: root.name, status, milestones, token: req.query.token || null, userId: req.userId }));
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

/**
 * POST /root/:rootId/recovery
 * Main entry point. Three paths: setup, check-in, questions.
 */
router.post("/root/:rootId/recovery", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawMessage = req.body.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(" ") : rawMessage;
    if (!message) return sendError(res, 400, ERR.INVALID_INPUT, "message required");

    const root = await NodeModel.findById(rootId).select("rootOwner contributors").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

    const userId = req.userId;
    const isOwner = root.rootOwner?.toString() === userId;
    const isContributor = root.contributors?.some(c => c.toString() === userId);
    if (!isOwner && !isContributor) return sendError(res, 403, ERR.FORBIDDEN, "No access");

    const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
    if (await isExtensionBlockedAtNode("recovery", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "Recovery is blocked on this branch.");
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
          message: `First time setup. The user said: "${message}". Ask them what substances they want to track, their current usage, and their goals. Be warm. This is the beginning.`,
          mode: "tree:recovery-log",
          rootId, res,
          slot: "recovery",
        });
        if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:recovery-log", setup: true });
      } catch (llmErr) {
        if (!res.headersSent) sendOk(res, { answer: "Tree created. Set up an LLM connection to start the conversation.", mode: "tree:recovery-log", setup: true });
      }
      return;
    }

    // ── PATH 1b: Setup incomplete (scaffold done, no substances configured yet) ──
    const { getSetupPhase } = await import("./core.js");
    const phase = await getSetupPhase(rootId);
    if (phase === "base") {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:recovery-log",
        rootId, res, slot: "recovery",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:recovery-log", setup: true });
      return;
    }

    const nodes = await findRecoveryNodes(rootId);

    // ── PATH 3: Questions/reflection/planning ──
    const isReflect = /\b(how am i|how's my|pattern|trend|week|month|progress|review|doing)\b/i.test(message);
    const isPlan = /\b(taper|plan|schedule|adjust|slow down|speed up|change.*target|set.*target)\b/i.test(message);
    const isJournal = /\b(journal|just writing|need to write|vent)\b/i.test(message);

    if (isJournal && nodes?.journal) {
      // Write to journal, minimal response
      try {
        await createNote({ nodeId: nodes.journal.id, content: message, contentType: "text", userId });
      } catch {}
      sendOk(res, { answer: "Written.", mode: "tree:recovery-journal" });
      return;
    }

    if (isPlan) {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:recovery-plan",
        rootId, res, slot: "recovery",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:recovery-plan" });
      return;
    }

    if (isReflect) {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:recovery-reflect",
        rootId, res, slot: "recovery",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:recovery-reflect" });
      return;
    }

    // ── PATH 2: Check-in (default) ──
    const parsed = await parseCheckIn(message, userId, username, rootId);

    if (parsed) {
      // Record substances
      if (parsed.substances) {
        for (const sub of parsed.substances) {
          if (sub.name && sub.doses != null) {
            try { await recordDoses(nodes, sub.name, sub.doses); } catch {}
          }
        }
      }

      // Record cravings
      if (parsed.cravings) {
        for (const cr of parsed.cravings) {
          try { await recordCraving(nodes, cr.intensity || 0, !!cr.resisted, cr.trigger || null); } catch {}
        }
      }

      // Record mood
      if (parsed.mood?.score != null) {
        try { await recordMood(nodes, parsed.mood.score); } catch {}
      }

      // Record energy
      if (parsed.energy != null) {
        try { await recordEnergy(nodes, parsed.energy); } catch {}
      }

      // Write note to Log
      if (nodes?.log) {
        try {
          const noteContent = parsed.context || message;
          await createNote({ nodeId: nodes.log.id, content: noteContent, contentType: "text", userId });
        } catch {}
      }
    }

    // Get fresh status for response
    const status = await getStatus(rootId);

    // Build response via LLM (the AI has context from enrichContext)
    const { answer, chatId } = await runChat({
      userId, username,
      message: parsed
        ? `Check-in logged. Data: ${JSON.stringify(parsed)}. Respond naturally. Acknowledge what's hard. Point out patterns if visible. Short.`
        : message,
      mode: "tree:recovery-log",
      rootId, res, slot: "recovery",
    });

    if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:recovery-log", parsed, status });
  } catch (err) {
    log.error("Recovery", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/recovery/check
 */
router.get("/root/:rootId/recovery/check", authenticate, async (req, res) => {
  try {
    const status = await getStatus(req.params.rootId);
    if (!status) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Recovery tree not found");
    sendOk(res, status);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/recovery/patterns
 */
router.get("/root/:rootId/recovery/patterns", authenticate, async (req, res) => {
  try {
    const patterns = await getPatterns(req.params.rootId);
    sendOk(res, { patterns });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/recovery/milestones
 */
router.get("/root/:rootId/recovery/milestones", authenticate, async (req, res) => {
  try {
    const milestones = await getMilestones(req.params.rootId);
    sendOk(res, { milestones });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/recovery/taper
 */
router.get("/root/:rootId/recovery/taper", authenticate, async (req, res) => {
  try {
    const nodes = await findRecoveryNodes(req.params.rootId);
    if (!nodes) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Recovery tree not found");

    const Note = (await import("../../seed/models/note.js")).default;
    const taperData = {};

    for (const [name, sub] of Object.entries(nodes.substances || {})) {
      if (!sub.schedule) continue;
      const notes = await Note.find({ nodeId: sub.schedule })
        .sort({ createdAt: 1 })
        .select("content createdAt")
        .lean();
      taperData[name] = notes.map(n => n.content);

      // Current dose values
      if (sub.doses) {
        const doseNode = await NodeModel.findById(sub.doses).select("metadata").lean();
        const values = doseNode?.metadata instanceof Map ? doseNode.metadata.get("values") : doseNode?.metadata?.values;
        if (values) {
          taperData[name + "_status"] = {
            today: values.today || 0,
            target: values.target || 0,
            finalTarget: values.finalTarget || 0,
            streak: values.streak || 0,
          };
        }
      }
    }

    sendOk(res, { taper: taperData });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /root/:rootId/recovery/substance
 * Add a new substance to track.
 */
router.post("/root/:rootId/recovery/substance", authenticate, async (req, res) => {
  try {
    const { name, startingTarget, finalTarget } = req.body;
    if (!name) return sendError(res, 400, ERR.INVALID_INPUT, "Substance name required");

    const result = await addSubstance(req.params.rootId, name, req.userId, { startingTarget, finalTarget });
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
