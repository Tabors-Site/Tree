import log from "../../core/log.js";
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

import authenticate, { authenticateOrPublic } from "../../middleware/authenticate.js";
import { createCanopyLlmProxyClient } from "../../canopy/llmProxy.js";
// orchestrateTreeRequest loaded via registry (tree-orchestrator extension)
import { getOrchestrator } from "../../core/orchestratorRegistry.js";
import {
  setRootId,
  getClientForUser,
  clearSession,
  userHasLlm,
} from "../../ws/conversation.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../../ws/mcp.js";
import {
  startAIChat,
  finalizeAIChat,
  setAiContributionContext,
  clearAiContributionContext,
} from "../../ws/aiChatTracker.js";
import { enqueue } from "../../ws/requestQueue.js";
import {
  createSession,
  endSession,
  getSessionsForUser,
  setSessionAbort,
  clearSessionAbort,
  SESSION_TYPES,
} from "../../ws/sessionRegistry.js";
import User from "../../db/models/user.js";
import Node from "../../db/models/node.js";
import { resolveTreeAccess } from "../../core/authenticate.js";
import { nullSocket } from "../../orchestrators/helpers.js";

const router = express.Router();
const TIMEOUT_MS = 19 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Shared orchestration runner
// ─────────────────────────────────────────────────────────────────────────

/**
 * Handles all the plumbing for a tree orchestration request:
 * session lifecycle, MCP connect, JWT, timeout, AIChat tracking,
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
  let aiChat = null;

  const timer = setTimeout(() => {
    timedOut = true;
    log.error("API", `Tree ${mode} timed out after ${TIMEOUT_MS / 1000}s: ${visitorId}`);
    closeMCPClient(visitorId);
    clearAiContributionContext(visitorId);
    if (aiChat) {
      finalizeAIChat({
        chatId: aiChat._id,
        content: "Error: Request timed out",
        stopped: false,
      }).catch(() => {});
    }
    if (!res.headersSent) {
      const status = 504;
      const body = mode === "place"
        ? { success: false, error: "Request timed out." }
        : { success: false, answer: "Request timed out. The tree took too long to respond." };
      res.status(status).json(body);
    }
  }, TIMEOUT_MS);

  // AIChat tracking
  try {
    const clientInfo = clientOverride || await getClientForUser(userId);
    aiChat = await startAIChat({
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
    if (aiChat) setAiContributionContext(visitorId, sessionId, aiChat._id);
  } catch (err) {
    log.error("API", "Failed to create AIChat:", err.message);
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
        rootChatId: aiChat?._id || null,
        sourceType: `tree-${mode}`,
        ...orchestrateFlags,
      };

      const orch = getOrchestrator("tree");
      if (!orch) throw new Error("No tree orchestrator installed.");
      const result = await orch.handle(orchArgs);

      clearTimeout(timer);
      if (timedOut) return;

      // Finalize AIChat
      if (aiChat) {
        const summary = mode === "place"
          ? (result?.stepSummaries?.length ? `Placed: ${result.stepSummaries.length} step(s)` : null)
          : (result?.answer || result?.reason || null);
        finalizeAIChat({
          chatId: aiChat._id,
          content: summary,
          stopped: false,
          modeKey: result?.modeKey || "tree:orchestrator",
        }).catch((err) => log.error("API", "AIChat finalize failed:", err.message));
      }

      // Format response based on mode
      if (!result || !result.success) {
        const body = mode === "place"
          ? { success: false, error: result?.reason || "Could not place content.", stepSummaries: result?.stepSummaries || [] }
          : { success: false, answer: result?.answer || "Could not process your message." };
        return res.json(body);
      }

      if (mode === "place") {
        return res.json({
          success: true,
          stepSummaries: result.stepSummaries || [],
          targetNodeId: result.lastTargetNodeId || null,
          targetPath: result.lastTargetPath || null,
        });
      }

      return res.json({
        success: true,
        answer: result.answer,
      });
    } catch (err) {
      clearTimeout(timer);
      if (timedOut) return;
      log.error("API", `Tree ${mode} error:`, err.message);

      if (aiChat) {
        finalizeAIChat({
          chatId: aiChat._id,
          content: abort.signal.aborted ? null : `Error: ${err.message}`,
          stopped: abort.signal.aborted,
        }).catch((e) => log.error("API", "AIChat error finalize failed:", e.message));
      }

      if (!res.headersSent) {
        if (err.message?.includes("No LLM connection")) {
          const msg = isPublicQuery
            ? "This tree has no AI configured for public queries."
            : err.message;
          const body = mode === "place"
            ? { success: false, error: msg }
            : { success: false, error: msg, answer: msg };
          return res.status(403).json(body);
        }
        const msg = err.message || "Something went wrong.";
        const body = mode === "place"
          ? { success: false, error: msg }
          : { success: false, answer: msg };
        return res.status(500).json(body);
      }
    } finally {
      clearTimeout(timer);
      clearAiContributionContext(visitorId);
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
    res.status(400).json({
      success: false,
      error: "Message is required and must be under 5000 characters.",
      answer: "Message is required and must be under 5000 characters.",
    });
    return false;
  }
  return true;
}

async function checkTreeAccess(rootId, userId, res) {
  const access = await resolveTreeAccess(rootId, userId);
  if (!access.isOwner && !access.isContributor) {
    res.status(403).json({ success: false, error: "Not authorized to access this tree.", answer: "Not authorized to access this tree." });
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
    res.status(403).json({
      success: false,
      error: "No LLM connection. Visit /setup to set one up.",
      answer: "No LLM connection. Visit /setup to set one up.",
    });
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
    return res.status(404).json({ success: false, answer: "Tree not found." });
  }

  // Resolve who pays for LLM and access
  let effectiveUserId = req.userId;
  let effectiveUsername = req.username;
  let isPublicQuery = false;
  let clientOverride = null;

  const treeHasLlm = rootCheck.llmDefault !== "none";

  if (isPublicAccess) {
    if (rootCheck.visibility !== "public") {
      return res.status(403).json({ success: false, answer: "This tree is not public." });
    }
    if (!treeHasLlm) {
      return res.status(403).json({ success: false, answer: "This tree has no AI configured for public queries." });
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
        return res.status(403).json({ success: false, answer: "Not authorized to access this tree." });
      }
    }
  }

  // Rate limit public queries
  if (isPublicQuery) {
    const rateLimitKey = req.userId ? `user:${req.userId}` : (req.ip || "unknown");
    if (!checkPublicQueryLimit(rateLimitKey)) {
      return res.status(429).json({ success: false, answer: "Too many queries. Please try again later." });
    }
  }

  // Verify LLM access (skip for canopy proxy)
  if (!clientOverride) {
    const hasUserLlm = await userHasLlm(effectiveUserId);
    if (!hasUserLlm && !treeHasLlm) {
      const msg = isPublicAccess
        ? "This tree has no AI configured for public queries."
        : "No LLM connection configured. Set one up at /setup or assign one to this tree.";
      return res.status(403).json({ success: false, answer: msg });
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

router.post("/root/:rootId/query", authenticateOrPublic, handleQuery);
router.get("/root/:rootId/query", authenticateOrPublic, handleQuery);

// Raw idea and understanding orchestration endpoints moved to their extensions.

export default router;

