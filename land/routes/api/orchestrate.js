import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
// LLM orchestration routes: tree chat/place/query, raw idea chat/place, understanding.

import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

import authenticate from "../../seed/middleware/authenticate.js";
import { getExtension } from "../../extensions/loader.js";

// readAuth: delegates to html-rendering's urlAuth if installed, otherwise requires hard auth
function readAuth(req, res, next) {
  const handler = getExtension("html-rendering")?.exports?.urlAuth;
  if (handler) return handler(req, res, next);
  return authenticate(req, res, next);
}
import { createCanopyLlmProxyClient } from "../../canopy/llmProxy.js";
// orchestrateTreeRequest loaded via registry (tree-orchestrator extension)
import { getOrchestrator } from "../../seed/orchestratorRegistry.js";
import {
  setRootId,
  getClientForUser,
  clearSession,
  userHasLlm,
} from "../../seed/ws/conversation.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../../seed/ws/mcp.js";
import {
  startChat,
  finalizeChat,
  setChatContext,
  clearChatContext,
} from "../../seed/ws/chatTracker.js";
import { enqueue } from "../../seed/ws/requestQueue.js";
import {
  createSession,
  endSession,
  getSessionsForUser,
  setSessionAbort,
  clearSessionAbort,
  SESSION_TYPES,
} from "../../seed/ws/sessionRegistry.js";
import User from "../../seed/models/user.js";
import Node from "../../seed/models/node.js";
import { resolveTreeAccess } from "../../seed/authenticate.js";
import { nullSocket } from "../../seed/orchestrators/helpers.js";

const router = express.Router();
const TIMEOUT_MS = 19 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Shared orchestration runner
// ─────────────────────────────────────────────────────────────────────────

/**
 * Handles all the plumbing for a tree orchestration request:
 * session lifecycle, MCP connect, JWT, timeout, Chat tracking,
 * request queuing, and cleanup.
 *
 * @param {object} opts
 * @param {string} opts.mode        - "chat" | "place" | "query"
 * @param {string} opts.rootId
 * @param {string} opts.message
 * @param {string} opts.userId
 * @param {string} opts.username
 * @param {string} opts.sessionType - SESSION_TYPES value
 * @param {object} opts.orchestrateFlags - { skipRespond, forceQueryOnly }
 * @param {object} [opts.clientOverride] - override LLM client (canopy proxy)
 * @param {boolean} [opts.isPublicQuery]
 * @param {Express.Response} res
 */
async function runTreeOrchestration(opts, res) {
  const {
    mode,
    rootId,
    message,
    userId,
    username,
    sessionType,
    orchestrateFlags = {},
    clientOverride = null,
    isPublicQuery = false,
  } = opts;

  const visitorId = `tree-${mode}:${userId}:${Date.now()}`;
  const { sessionId } = createSession({
    userId,
    type: sessionType,
    scopeKey: `${userId}:${rootId}`,
    description: `API tree ${mode} on root ${rootId}${isPublicQuery ? " (public)" : ""}`,
    meta: { rootId, visitorId, isPublicQuery },
  });
  const abort = new AbortController();
  setSessionAbort(sessionId, abort);

  // Abort when client disconnects (Ctrl+C in CLI, browser close)
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  let timedOut = false;
  let chat = null;

  const timer = setTimeout(() => {
    timedOut = true;
    log.error("API", `Tree ${mode} timed out after ${TIMEOUT_MS / 1000}s: ${visitorId}`);
    closeMCPClient(visitorId);
    clearChatContext(visitorId);
    if (chat) {
      finalizeChat({
        chatId: chat._id,
        content: "Error: Request timed out",
        stopped: false,
      }).catch(() => {});
    }
    if (!res.headersSent) {
      const msg = mode === "place"
        ? "Request timed out."
        : "Request timed out. The tree took too long to respond.";
      sendError(res, 504, ERR.TIMEOUT, msg);
    }
  }, TIMEOUT_MS);

  // Chat tracking
  try {
    const clientInfo = clientOverride || await getClientForUser(userId);
    chat = await startChat({
      userId,
      sessionId,
      message: message.slice(0, 5000),
      source: isPublicQuery ? "public-query" : "api",
      modeKey: `tree:${mode}`,
      llmProvider: {
        isCustom: clientInfo.isCustom,
        model: clientInfo.model,
        connectionId: clientInfo.connectionId || null,
      },
      treeContext: { targetNodeId: rootId },
    });
    if (chat) setChatContext(visitorId, sessionId, chat._id);
  } catch (err) {
    log.error("API", "Failed to create Chat:", err.message);
  }

  // Enqueue to serialize per user+tree
  await enqueue(sessionId, async () => {
    try {
      const internalJwt = jwt.sign(
        { userId: userId.toString(), username, visitorId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
      await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);
      setRootId(visitorId, rootId);

      const orchArgs = {
        visitorId,
        message: message.trim(),
        socket: nullSocket,
        username,
        userId,
        signal: abort.signal,
        sessionId,
        rootId,
        rootChatId: chat?._id || null,
        sourceType: `tree-${mode}`,
        ...orchestrateFlags,
      };

      const orch = getOrchestrator("tree");
      if (!orch) throw new Error("No tree orchestrator installed.");
      const result = await orch.handle(orchArgs);

      clearTimeout(timer);
      if (timedOut) return;

      // Finalize Chat
      if (chat) {
        const summary = mode === "place"
          ? (result?.stepSummaries?.length ? `Placed: ${result.stepSummaries.length} step(s)` : null)
          : (result?.answer || result?.reason || null);
        finalizeChat({
          chatId: chat._id,
          content: summary,
          stopped: false,
          modeKey: result?.modeKey || "tree:orchestrator",
        }).catch((err) => log.error("API", "Chat finalize failed:", err.message));
      }

      // Format response based on mode
      if (!result || !result.success) {
        const msg = mode === "place"
          ? (result?.reason || "Could not place content.")
          : (result?.answer || "Could not process your message.");
        const detail = mode === "place" ? { stepSummaries: result?.stepSummaries || [] } : undefined;
        return sendError(res, 200, ERR.ORCHESTRATOR_NOT_FOUND, msg, detail);
      }

      if (mode === "place") {
        return sendOk(res, {
          stepSummaries: result.stepSummaries || [],
          targetNodeId: result.lastTargetNodeId || null,
          targetPath: result.lastTargetPath || null,
        });
      }

      return sendOk(res, {
        answer: result.answer,
      });
    } catch (err) {
      clearTimeout(timer);
      if (timedOut) return;
      log.error("API", `Tree ${mode} error:`, err.message);

      if (chat) {
        finalizeChat({
          chatId: chat._id,
          content: abort.signal.aborted ? null : `Error: ${err.message}`,
          stopped: abort.signal.aborted,
        }).catch((e) => log.error("API", "Chat error finalize failed:", e.message));
      }

      if (!res.headersSent) {
        if (err.message?.includes("No LLM connection")) {
          const msg = isPublicQuery
            ? "This tree has no AI configured for public queries."
            : err.message;
          return sendError(res, 503, ERR.LLM_NOT_CONFIGURED, msg);
        }
        return sendError(res, 500, ERR.INTERNAL, err.message || "Something went wrong.");
      }
    } finally {
      clearTimeout(timer);
      clearChatContext(visitorId);
      clearSessionAbort(sessionId);
      endSession(sessionId);
      if (!timedOut) closeMCPClient(visitorId);
      clearSession(visitorId);
    }
  });
}

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
// POST /root/:rootId/chat
// ─────────────────────────────────────────────────────────────────────────

router.post("/root/:rootId/chat", authenticate, async (req, res) => {
  const { rootId } = req.params;
  const { message } = req.body;

  if (!validateMessage(message, res)) return;
  if (!(await checkTreeAccess(rootId, req.userId, res))) return;
  if (!(await checkLlmAccess(rootId, req.userId, res))) return;

  await runTreeOrchestration({
    mode: "chat",
    rootId,
    message: message.trim(),
    userId: req.userId,
    username: req.username,
    sessionType: SESSION_TYPES.API_TREE_CHAT,
  }, res);
});

// ─────────────────────────────────────────────────────────────────────────
// POST /root/:rootId/place
// ─────────────────────────────────────────────────────────────────────────

router.post("/root/:rootId/place", authenticate, async (req, res) => {
  const { rootId } = req.params;
  const { message } = req.body;

  if (!validateMessage(message, res)) return;
  if (!(await checkTreeAccess(rootId, req.userId, res))) return;
  if (!(await checkLlmAccess(rootId, req.userId, res))) return;

  await runTreeOrchestration({
    mode: "place",
    rootId,
    message: message.trim(),
    userId: req.userId,
    username: req.username,
    sessionType: SESSION_TYPES.API_TREE_PLACE,
    orchestrateFlags: { skipRespond: true },
  }, res);
});

// ─────────────────────────────────────────────────────────────────────────
// POST /root/:rootId/query (authenticated or public)
// GET  /root/:rootId/query (public, same handler)
// ─────────────────────────────────────────────────────────────────────────

async function handleQuery(req, res) {
  const { rootId } = req.params;
  const message = req.body?.message || req.query?.message || req.query?.q;
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

  await runTreeOrchestration({
    mode: "query",
    rootId,
    message: (message || "").trim(),
    userId: effectiveUserId,
    username: effectiveUsername,
    sessionType: SESSION_TYPES.API_TREE_QUERY,
    orchestrateFlags: { forceQueryOnly: true },
    clientOverride,
    isPublicQuery,
  }, res);
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

router.post("/root/:rootId/query", readAuth, handleQuery);
router.get("/root/:rootId/query", readAuth, handleQuery);

// Raw idea and understanding orchestration endpoints moved to their extensions.

export default router;

