// LLM orchestration routes: tree chat/place/query/be, home chat.
// All routes are thin wrappers around runOrchestration() in seed/llm/conversation.js.
// They handle validation, auth, and translating the result into HTTP responses.

import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import express from "express";

import authenticate, { authenticateOptional } from "../../seed/middleware/authenticate.js";
import { createCanopyLlmProxyClient } from "../../canopy/llmProxy.js";
import { userHasLlm } from "../../seed/llm/conversation.js";
import { registerSessionType } from "../../seed/ws/sessionRegistry.js";
import User from "../../seed/models/user.js";
import Node from "../../seed/models/node.js";
import { resolveTreeAccess } from "../../seed/tree/treeAccess.js";

// Register API transport session types
registerSessionType("API_TREE_CHAT", "api-tree-chat");
registerSessionType("API_TREE_PLACE", "api-tree-place");
registerSessionType("API_TREE_QUERY", "api-tree-query");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// Shared validation helpers
// ─────────────────────────────────────────────────────────────────────────

function validateMessage(message, res) {
  if (
    !message ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 5000
  ) {
    sendError(res, 400, ERR.INVALID_INPUT, "Message is required and must be under 5000 characters.");
    return false;
  }
  return true;
}

async function checkTreeAccess(rootId, userId, res) {
  const access = await resolveTreeAccess(rootId, userId);
  if (!access.isOwner && !access.isContributor) {
    sendError(res, 403, ERR.FORBIDDEN, "Not authorized to access this tree.");
    return null;
  }
  return access;
}

async function checkLlmAccess(rootId, userId, res) {
  const rootCheck = await Node.findById(rootId)
    .select("rootOwner visibility llmDefault metadata")
    .lean();
  const hasUserLlm = await userHasLlm(userId);
  const hasRootLlm = !!(rootCheck?.llmDefault && rootCheck.llmDefault !== "none");
  if (!hasUserLlm && !hasRootLlm) {
    sendError(res, 503, ERR.LLM_NOT_CONFIGURED, "No LLM connection. Visit /setup to set one up.");
    return null;
  }
  return rootCheck;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /home/chat
// Home zone chat. Any authenticated user. No tree context. Uses home:default mode.
// ─────────────────────────────────────────────────────────────────────────

router.post("/home/chat", authenticate, async (req, res) => {
  const { message } = req.body;
  if (!validateMessage(message, res)) return;

  try {
    const { runOrchestration } = await import("../../seed/llm/conversation.js");
    const result = await runOrchestration({
      zone: "home",
      userId: req.userId,
      username: req.username,
      message: message.trim(),
      device: req.body.device || "http",
      handle: req.body.handle || req.body.sessionHandle || null,
      res,
      sourceType: "api-home",
    });
    sendOk(res, { answer: result.answer, chatId: result.chatId });
  } catch (err) {
    if (!res.headersSent) {
      if (err.errCode) return sendError(res, err.httpStatus, err.errCode, err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /root/:rootId/chat
// ─────────────────────────────────────────────────────────────────────────

router.post("/root/:rootId/chat", authenticate, async (req, res) => {
  const { rootId } = req.params;
  const { message, sessionHandle, currentNodeId } = req.body;

  if (!validateMessage(message, res)) return;
  if (!(await checkTreeAccess(rootId, req.userId, res))) return;
  if (!(await checkLlmAccess(rootId, req.userId, res))) return;

  try {
    const { runOrchestration } = await import("../../seed/llm/conversation.js");
    const result = await runOrchestration({
      zone: "tree",
      userId: req.userId,
      username: req.username,
      message: message.trim(),
      rootId,
      currentNodeId: currentNodeId || null,
      device: req.body.device || "http",
      handle: sessionHandle || req.body.handle || null,
      res,
      sourceType: "tree-chat",
    });

    if (!result.success) {
      return sendError(res, 503, ERR.LLM_FAILED, result.answer || result.reason || "Could not process your message.");
    }
    sendOk(res, { answer: result.answer, targetNodeId: result.targetNodeId });
  } catch (err) {
    if (res.headersSent) return;
    if (err.errCode) return sendError(res, err.httpStatus, err.errCode, err.message);
    if (err.message?.includes("No LLM connection")) {
      return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, err.message);
    }
    if (err.message?.includes("timed out") || err.message?.includes("All LLM connections failed")) {
      return sendError(res, 503, ERR.LLM_TIMEOUT, err.message);
    }
    sendError(res, 500, ERR.INTERNAL, err.message || "Something went wrong.");
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /root/:rootId/place
// ─────────────────────────────────────────────────────────────────────────

router.post("/root/:rootId/place", authenticate, async (req, res) => {
  const { rootId } = req.params;
  const { message, currentNodeId } = req.body;

  if (!validateMessage(message, res)) return;
  if (!(await checkTreeAccess(rootId, req.userId, res))) return;
  if (!(await checkLlmAccess(rootId, req.userId, res))) return;

  try {
    const { runOrchestration } = await import("../../seed/llm/conversation.js");
    const result = await runOrchestration({
      zone: "tree",
      userId: req.userId,
      username: req.username,
      message: message.trim(),
      rootId,
      currentNodeId: currentNodeId || null,
      device: req.body.device || "http",
      handle: req.body.handle || req.body.sessionHandle || null,
      res,
      sourceType: "tree-place",
      orchestrateFlags: { skipRespond: true },
    });

    if (!result.success) {
      return sendError(res, 503, ERR.LLM_FAILED, result.reason || "Could not place content.", { stepSummaries: result.stepSummaries || [] });
    }
    sendOk(res, {
      stepSummaries: result.stepSummaries,
      targetNodeId: result.lastTargetNodeId,
      targetPath: result.lastTargetPath,
    });
  } catch (err) {
    if (res.headersSent) return;
    if (err.errCode) return sendError(res, err.httpStatus, err.errCode, err.message);
    sendError(res, 500, ERR.INTERNAL, err.message || "Something went wrong.");
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /root/:rootId/query (authenticated or public)
// GET  /root/:rootId/query (public, same handler)
// ─────────────────────────────────────────────────────────────────────────

async function handleQuery(req, res) {
  const { rootId } = req.params;
  const message = req.body?.message || req.query?.message || req.query?.q;
  const currentNodeId = req.body?.currentNodeId || req.query?.currentNodeId || null;
  const isPublicAccess = !!req.isPublicAccess;

  if (!validateMessage(message, res)) return;

  const rootCheck = await Node.findById(rootId)
    .select("rootOwner visibility llmDefault metadata")
    .lean();

  if (!rootCheck) {
    return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found.");
  }

  // Resolve who pays for LLM and access
  let effectiveUserId = req.userId;
  let effectiveUsername = req.username;
  let isPublicQuery = false;
  let clientOverride = null;

  const treeHasLlm = rootCheck.llmDefault !== "none";

  if (isPublicAccess) {
    if (rootCheck.visibility !== "public") {
      return sendError(res, 403, ERR.FORBIDDEN, "This tree is not public.");
    }
    if (!treeHasLlm) {
      return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, "This tree has no AI configured for public queries.");
    }
    effectiveUserId = rootCheck.rootOwner;
    const owner = await User.findById(rootCheck.rootOwner).select("username").lean();
    effectiveUsername = owner?.username || "system";
    isPublicQuery = true;
  } else {
    const queryAccess = await resolveTreeAccess(rootId, req.userId);
    if (!queryAccess.isOwner && !queryAccess.isContributor) {
      if (rootCheck.visibility === "public") {
        if (treeHasLlm) {
          effectiveUserId = rootCheck.rootOwner;
          const owner = await User.findById(rootCheck.rootOwner).select("username").lean();
          effectiveUsername = owner?.username || "system";
        } else if (req.canopy?.sourceLandDomain) {
          clientOverride = {
            client: createCanopyLlmProxyClient({
              userId: req.userId,
              homeLand: req.canopy.sourceLandDomain,
              slot: "main",
            }),
            isCustom: true,
            model: "proxy",
            connectionId: null,
          };
          effectiveUserId = rootCheck.rootOwner;
          effectiveUsername = `visitor@${req.canopy.sourceLandDomain}`;
        }
        isPublicQuery = true;
      } else {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized to access this tree.");
      }
    }
  }

  // Rate limit public queries
  if (isPublicQuery) {
    const rateLimitKey = req.userId ? `user:${req.userId}` : (req.ip || "unknown");
    if (!checkPublicQueryLimit(rateLimitKey)) {
      return sendError(res, 429, ERR.RATE_LIMITED, "Too many queries. Please try again later.");
    }
  }

  // Verify LLM access (skip for canopy proxy)
  if (!clientOverride) {
    const hasUserLlm = await userHasLlm(effectiveUserId);
    if (!hasUserLlm && !treeHasLlm) {
      const msg = isPublicAccess
        ? "This tree has no AI configured for public queries."
        : "No LLM connection configured. Set one up at /setup or assign one to this tree.";
      return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, msg);
    }
  }

  // Public / remote queries don't belong in the owner's normal device
  // sessions. Compose a dedicated device string that identifies the
  // external visitor — canopy-proxied requests carry sourceLandDomain,
  // anonymous public visits fall back to IP. Each external visitor gets
  // their own session; the owner's `web`/`cli` sessions stay untouched.
  let deviceForQuery;
  if (isPublicQuery) {
    if (req.canopy?.sourceLandDomain) {
      const remoteUserTag = req.userId || req.canopy.remoteUserId || "anon";
      deviceForQuery = `canopy:${req.canopy.sourceLandDomain}:${remoteUserTag}`;
    } else if (req.userId) {
      // Authenticated local visitor on a public tree they don't own.
      deviceForQuery = `public:${req.userId}`;
    } else {
      // Anonymous public visitor.
      deviceForQuery = `public:anon:${req.ip || "unknown"}`;
    }
  } else {
    deviceForQuery = req.body?.device || "http";
  }

  try {
    const { runOrchestration } = await import("../../seed/llm/conversation.js");
    const result = await runOrchestration({
      zone: "tree",
      userId: effectiveUserId,
      username: effectiveUsername,
      message: (message || "").trim(),
      rootId,
      currentNodeId,
      device: deviceForQuery,
      handle: req.body?.handle || req.body?.sessionHandle || null,
      res,
      sourceType: "tree-query",
      orchestrateFlags: { forceQueryOnly: true },
      clientOverride,
      isPublicQuery,
    });

    if (!result.success) {
      return sendError(res, 503, ERR.LLM_FAILED, result.answer || result.reason || "Could not process your message.");
    }
    sendOk(res, { answer: result.answer, targetNodeId: result.targetNodeId });
  } catch (err) {
    if (res.headersSent) return;
    if (err.errCode) return sendError(res, err.httpStatus, err.errCode, err.message);
    if (err.message?.includes("No LLM connection")) {
      const msg = isPublicAccess
        ? "This tree has no AI configured for public queries."
        : err.message;
      return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, msg);
    }
    if (err.message?.includes("timed out")) {
      return sendError(res, 503, ERR.LLM_TIMEOUT, err.message);
    }
    sendError(res, 500, ERR.INTERNAL, err.message || "Something went wrong.");
  }
}

// Rate limit public queries: 10 per 15 min per IP
const publicQueryLimits = new Map();
const PQ_WINDOW_MS = 15 * 60 * 1000;
const PQ_MAX = 10;

function checkPublicQueryLimit(key) {
  const now = Date.now();
  const entry = publicQueryLimits.get(key);
  if (!entry || now - entry.start > PQ_WINDOW_MS) {
    publicQueryLimits.set(key, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= PQ_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of publicQueryLimits) {
    if (now - entry.start > PQ_WINDOW_MS * 2) publicQueryLimits.delete(key);
  }
}, PQ_WINDOW_MS);

router.post("/root/:rootId/query", authenticateOptional, handleQuery);
router.get("/root/:rootId/query", authenticateOptional, handleQuery);

// ─────────────────────────────────────────────────────────────────────────
// POST /root/:rootId/be
// Guided walkthrough. The tree leads. The user follows.
// ─────────────────────────────────────────────────────────────────────────

router.post("/root/:rootId/be", authenticate, async (req, res) => {
  const { rootId } = req.params;
  const { message, currentNodeId } = req.body;

  if (!validateMessage(message, res)) return;
  if (!(await checkTreeAccess(rootId, req.userId, res))) return;
  if (!(await checkLlmAccess(rootId, req.userId, res))) return;

  try {
    const { runOrchestration } = await import("../../seed/llm/conversation.js");
    const result = await runOrchestration({
      zone: "tree",
      userId: req.userId,
      username: req.username,
      message: message.trim(),
      rootId,
      currentNodeId: currentNodeId || null,
      device: req.body.device || "http",
      handle: req.body.handle || req.body.sessionHandle || null,
      res,
      sourceType: "tree-be",
      orchestrateFlags: { behavioral: true },
    });

    if (!result.success) {
      return sendError(res, 503, ERR.LLM_FAILED, result.answer || result.reason || "Could not process your message.");
    }
    sendOk(res, { answer: result.answer, targetNodeId: result.targetNodeId });
  } catch (err) {
    if (res.headersSent) return;
    if (err.errCode) return sendError(res, err.httpStatus, err.errCode, err.message);
    sendError(res, 500, ERR.INTERNAL, err.message || "Something went wrong.");
  }
});

// Raw idea and understanding orchestration endpoints moved to their extensions.

export default router;

