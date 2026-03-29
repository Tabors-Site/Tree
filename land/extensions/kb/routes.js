import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import { createNote } from "../../seed/tree/notes.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import {
  scaffold,
  isInitialized,
  getSetupPhase,
  findKbNodes,
  routeKbIntent,
  getStatus,
  getStaleNotes,
  getUnplaced,
  isMaintainer,
} from "./core.js";

const router = express.Router();

// ── HTML Dashboard (GET with ?html) ──
router.get("/root/:rootId/kb", async (req, res, next) => {
  if (!("html" in req.query)) return next();
  try {
    const { isHtmlEnabled } = await import("../html-rendering/config.js");
    if (!isHtmlEnabled()) return next();
    const urlAuth = (await import("../html-rendering/urlAuth.js")).default;
    urlAuth(req, res, async () => {
      const { rootId } = req.params;
      const root = await NodeModel.findById(rootId).select("name metadata").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Not found");

      let status = null, stale = null, unplaced = null;
      if (await isInitialized(rootId)) {
        [status, stale, unplaced] = await Promise.all([
          getStatus(rootId), getStaleNotes(rootId), getUnplaced(rootId),
        ]);
      }

      // Check search capabilities
      const { getExtension } = await import("../loader.js");
      const hasEmbed = !!getExtension("embed");
      const hasScout = !!getExtension("scout");

      const { renderKbDashboard } = await import("./pages/dashboard.js");
      res.send(renderKbDashboard({
        rootId,
        rootName: root.name,
        status,
        stale,
        unplaced,
        token: req.query.token || null,
        userId: req.userId,
        hasEmbed,
        hasScout,
      }));
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

/**
 * POST /root/:rootId/kb
 * Main entry. Routes tell vs ask based on intent.
 */
router.post("/root/:rootId/kb", authenticate, async (req, res) => {
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
    if (await isExtensionBlockedAtNode("kb", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "KB is blocked on this branch.");
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
          message: `Knowledge base just created. The user said: "${message}".\n\nFirst: infer what domain this knowledge base covers from the user's message. Rename the root node to a clear, short name for this domain (e.g. "Datacenter Ops", "Company Policies", "Product Knowledge") using the rename tool.\n\nThen: if they're telling you something, organize it into the Topics tree. If they're asking, explain the kb is empty and invite them to start adding knowledge.`,
          mode: "tree:kb-tell",
          rootId, res, slot: "kb",
        });
        if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:kb-tell", setup: true });
      } catch (llmErr) {
        if (!res.headersSent) sendOk(res, { answer: "Knowledge base created. Set up an LLM connection to start.", mode: "tree:kb-tell", setup: true });
      }
      return;
    }

    // ── PATH 1b: Setup incomplete ──
    const phase = await getSetupPhase(rootId);
    if (phase === "base") {
      try {
        const { answer, chatId } = await runChat({
          userId, username, message,
          mode: "tree:kb-tell",
          rootId, res, slot: "kb",
        });
        if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:kb-tell", setup: true });
      } catch (llmErr) {
        if (!res.headersSent) sendOk(res, { answer: "Set up an LLM connection to use the knowledge base.", mode: "tree:kb-tell", setup: true });
      }
      return;
    }

    // ── Review: start guided review mode ──
    if (message.trim().toLowerCase() === "review") {
      const maintainer = await isMaintainer(rootId, userId);
      if (!maintainer) {
        return sendError(res, 403, ERR.FORBIDDEN, "Only maintainers can review.");
      }
      try {
        const { answer, chatId } = await runChat({
          userId, username,
          message: "Start a guided review of stale notes in this knowledge base.",
          mode: "tree:kb-review",
          rootId, res, slot: "kb",
        });
        if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:kb-review" });
      } catch (llmErr) {
        if (!res.headersSent) sendOk(res, { answer: "Failed to start review. Check LLM connection.", mode: "tree:kb-review" });
      }
      return;
    }

    const intent = routeKbIntent(message);

    // ── Tell: only maintainers ──
    if (intent === "tell") {
      const maintainer = await isMaintainer(rootId, userId);
      if (!maintainer) {
        return sendError(res, 403, ERR.FORBIDDEN, "Only maintainers can add knowledge. You can ask questions.");
      }

      const nodes = await findKbNodes(rootId);
      if (nodes?.log) {
        try { await createNote({ nodeId: nodes.log.id, content: message, contentType: "text", userId }); } catch {}
      }

      try {
        const { answer, chatId } = await runChat({
          userId, username, message,
          mode: "tree:kb-tell",
          rootId, res, slot: "kb",
        });
        if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:kb-tell" });
      } catch (llmErr) {
        if (!res.headersSent) sendOk(res, { answer: "Failed to process. Check LLM connection.", mode: "tree:kb-tell" });
      }
      return;
    }

    // ── Ask: everyone ──
    try {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:kb-ask",
        rootId, res, slot: "kb",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:kb-ask" });
    } catch (llmErr) {
      if (!res.headersSent) sendOk(res, { answer: "Failed to search. Check LLM connection.", mode: "tree:kb-ask" });
    }
  } catch (err) {
    log.error("KB", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, "KB request failed");
  }
});

router.get("/root/:rootId/kb/status", authenticate, async (req, res) => {
  try {
    const status = await getStatus(req.params.rootId);
    if (!status) return sendError(res, 404, ERR.TREE_NOT_FOUND, "KB not found");
    sendOk(res, status);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Status failed");
  }
});

router.get("/root/:rootId/kb/stale", authenticate, async (req, res) => {
  try {
    const stale = await getStaleNotes(req.params.rootId);
    sendOk(res, { stale, count: stale.length });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Stale query failed");
  }
});

router.get("/root/:rootId/kb/unplaced", authenticate, async (req, res) => {
  try {
    const items = await getUnplaced(req.params.rootId);
    sendOk(res, { items, count: items.length });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Unplaced query failed");
  }
});

export default router;
