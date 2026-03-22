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
import { orchestrateTreeRequest } from "../../orchestrators/tree.js";
import { orchestrateRawIdeaPlacement } from "../../orchestrators/pipelines/rawIdea.js";
import { orchestrateUnderstanding } from "../../orchestrators/pipelines/understand.js";
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
import RawIdea from "../../extensions/raw-ideas/model.js";
import { createRawIdea } from "../../core/tree/rawIdea.js";
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

  let timedOut = false;
  let aiChat = null;

  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`Tree ${mode} timed out after ${TIMEOUT_MS / 1000}s: ${visitorId}`);
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
    console.error("Failed to create AIChat:", err.message);
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

      const result = await orchestrateTreeRequest({
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
      });

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
        }).catch((err) => console.error("AIChat finalize failed:", err.message));
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
      console.error(`Tree ${mode} error:`, err.message);

      if (aiChat) {
        finalizeAIChat({
          chatId: aiChat._id,
          content: abort.signal.aborted ? null : `Error: ${err.message}`,
          stopped: abort.signal.aborted,
        }).catch((e) => console.error("AIChat error finalize failed:", e.message));
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
        const body = mode === "place"
          ? { success: false, error: "Something went wrong." }
          : { success: false, answer: "Something went wrong." };
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
    .select("rootOwner llmAssignments")
    .lean();
  const hasUserLlm = await userHasLlm(userId);
  const hasRootLlm = !!(rootCheck?.llmAssignments?.default && rootCheck.llmAssignments.default !== "none");
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
    .select("rootOwner llmAssignments visibility")
    .lean();

  if (!rootCheck) {
    return res.status(404).json({ success: false, answer: "Tree not found." });
  }

  // Resolve who pays for LLM and access
  let effectiveUserId = req.userId;
  let effectiveUsername = req.username;
  let isPublicQuery = false;
  let clientOverride = null;

  const treeHasLlm = rootCheck.llmAssignments?.default !== "none";

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

// ─────────────────────────────────────────────────────────────────────────
// Raw Idea: combined create + place (fire-and-forget)
// ─────────────────────────────────────────────────────────────────────────

router.post("/user/:userId/raw-ideas/place", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const content = req.body?.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content (text string) is required" });
    }

    if (!(await userHasLlm(req.userId))) {
      return res.status(403).json({ error: "No LLM connection. Visit /setup to set one up." });
    }

    const alreadyProcessing = await RawIdea.findOne({
      userId: req.userId.toString(),
      status: "processing",
    });
    if (alreadyProcessing) {
      return res.status(409).json({
        error: "Another idea is already being placed. Please wait for it to finish.",
      });
    }

    const result = await createRawIdea({
      contentType: "text",
      content: content.trim(),
      userId: req.userId,
    });

    const user = await User.findById(req.userId).select("username").lean();
    const source = req.body?.source === "user" ? "user" : "api";

    orchestrateRawIdeaPlacement({
      rawIdeaId: result.rawIdea._id,
      userId: req.userId,
      username: user?.username || "unknown",
      source,
    }).catch((err) =>
      console.error("Raw-idea orchestration failed:", err.message),
    );

    return res.status(202).json({
      message: "Orchestration started",
      rawIdeaId: result.rawIdea._id,
    });
  } catch (err) {
    console.error("raw-idea create+place error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Raw Idea: combined create + chat (synchronous, returns response)
// ─────────────────────────────────────────────────────────────────────────

router.post("/user/:userId/raw-ideas/chat", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const content = req.body?.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content (text string) is required" });
    }

    if (!(await userHasLlm(req.userId))) {
      return res.status(403).json({ error: "No LLM connection. Visit /setup to set one up." });
    }

    const alreadyProcessing = await RawIdea.findOne({
      userId: req.userId.toString(),
      status: "processing",
    });
    if (alreadyProcessing) {
      return res.status(409).json({
        error: "Another idea is already being placed. Please wait for it to finish.",
      });
    }

    const result = await createRawIdea({
      contentType: "text",
      content: content.trim(),
      userId: req.userId,
    });

    const user = await User.findById(req.userId).select("username").lean();

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: "Request timed out. The idea took too long to process.",
        });
      }
    }, TIMEOUT_MS);

    const source = req.body?.source === "user" ? "user" : "api";
    const orchResult = await orchestrateRawIdeaPlacement({
      rawIdeaId: result.rawIdea._id,
      userId: req.userId,
      username: user?.username || "unknown",
      withResponse: true,
      source,
    });

    clearTimeout(timer);
    if (timedOut) return;

    if (!orchResult || !orchResult.success) {
      return res.json({
        success: false,
        error: orchResult?.reason || "Could not process the idea.",
      });
    }

    return res.json({
      success: true,
      answer: orchResult.answer,
      rootId: orchResult.rootId,
      rootName: orchResult.rootName,
      targetNodeId: orchResult.targetNodeId,
      rawIdeaId: result.rawIdea._id,
    });
  } catch (err) {
    console.error("raw-idea create+chat error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Raw Idea: auto-place existing (fire-and-forget)
// ─────────────────────────────────────────────────────────────────────────

router.post(
  "/user/:userId/raw-ideas/:rawIdeaId/place",
  authenticate,
  async (req, res) => {
    try {
      const { rawIdeaId } = req.params;

      if (req.userId.toString() !== req.params.userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const rawIdea = await RawIdea.findById(rawIdeaId);
      if (!rawIdea || rawIdea.userId === "deleted") {
        return res.status(404).json({ error: "Raw idea not found" });
      }
      if (rawIdea.userId.toString() !== req.userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }
      if (rawIdea.contentType === "file") {
        return res.status(422).json({ error: "File ideas cannot be auto-placed" });
      }
      if (rawIdea.status && rawIdea.status !== "pending") {
        return res.status(409).json({ error: `Already ${rawIdea.status}` });
      }

      if (!(await userHasLlm(req.userId))) {
        return res.status(403).json({ error: "No LLM connection. Visit /setup to set one up." });
      }

      const alreadyProcessing = await RawIdea.findOne({
        userId: req.userId.toString(),
        status: "processing",
      });
      if (alreadyProcessing) {
        return res.status(409).json({
          error: "Another idea is already being placed. Please wait for it to finish.",
        });
      }

      const user = await User.findById(req.userId).select("username").lean();
      const source = req.body?.source === "user" ? "user" : "api";

      orchestrateRawIdeaPlacement({
        rawIdeaId,
        userId: req.userId,
        username: user?.username || "unknown",
        source,
      }).catch((err) =>
        console.error("Raw-idea orchestration failed:", err.message),
      );

      return res.status(202).json({ message: "Orchestration started" });
    } catch (err) {
      console.error("raw-idea orchestrate error:", err);
      return res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Raw Idea: auto-chat existing (synchronous, returns response)
// ─────────────────────────────────────────────────────────────────────────

router.post(
  "/user/:userId/raw-ideas/:rawIdeaId/chat",
  authenticate,
  async (req, res) => {
    try {
      const { rawIdeaId } = req.params;

      if (req.userId.toString() !== req.params.userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const rawIdea = await RawIdea.findById(rawIdeaId);
      if (!rawIdea || rawIdea.userId === "deleted") {
        return res.status(404).json({ error: "Raw idea not found" });
      }
      if (rawIdea.userId.toString() !== req.userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }
      if (rawIdea.contentType === "file") {
        return res.status(422).json({ error: "File ideas cannot be auto-placed" });
      }
      if (rawIdea.status && rawIdea.status !== "pending") {
        return res.status(409).json({ error: `Already ${rawIdea.status}` });
      }

      if (!(await userHasLlm(req.userId))) {
        return res.status(403).json({ error: "No LLM connection. Visit /setup to set one up." });
      }

      const alreadyProcessing = await RawIdea.findOne({
        userId: req.userId.toString(),
        status: "processing",
      });
      if (alreadyProcessing) {
        return res.status(409).json({
          error: "Another idea is already being placed. Please wait for it to finish.",
        });
      }

      const user = await User.findById(req.userId).select("username").lean();

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: "Request timed out. The idea took too long to process.",
          });
        }
      }, TIMEOUT_MS);

      const source = req.body?.source === "user" ? "user" : "api";
      const result = await orchestrateRawIdeaPlacement({
        rawIdeaId,
        userId: req.userId,
        username: user?.username || "unknown",
        withResponse: true,
        source,
      });

      clearTimeout(timer);
      if (timedOut) return;

      if (!result || !result.success) {
        return res.json({
          success: false,
          error: result?.reason || "Could not process the idea.",
        });
      }

      return res.json({
        success: true,
        answer: result.answer,
        rootId: result.rootId,
        rootName: result.rootName,
        targetNodeId: result.targetNodeId,
      });
    } catch (err) {
      console.error("raw-idea chat error:", err);
      return res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Understanding: orchestrate
// ─────────────────────────────────────────────────────────────────────────

router.post(
  "/root/:nodeId/understandings/run/:runId/orchestrate",
  authenticate,
  async (req, res) => {
    const { nodeId, runId } = req.params;
    const userId = req.userId;
    const username = req.username;
    const fromSite = req.body?.source === "user";

    const rootNode = await Node.findById(nodeId)
      .select("llmAssignments")
      .lean();
    const hasRootLlm = !!(rootNode?.llmAssignments?.default && rootNode.llmAssignments.default !== "none");
    if (!hasRootLlm && !(await userHasLlm(userId))) {
      return res.status(403).json({
        success: false,
        error: "No LLM connection. Visit /setup to set one up.",
      });
    }

    try {
      const result = await orchestrateUnderstanding({
        rootId: nodeId,
        userId,
        username,
        runId,
        fromSite,
      });

      if ("html" in req.query && result.success) {
        return res.redirect(
          `/api/v1/root/${nodeId}/understandings/run/${runId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return res.json(result);
    } catch (err) {
      console.error("Understanding orchestration error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Understanding: stop active run
// ─────────────────────────────────────────────────────────────────────────

router.post(
  "/root/:nodeId/understandings/run/:runId/stop",
  authenticate,
  async (req, res) => {
    const { runId } = req.params;
    const userId = req.userId;

    const sessions = getSessionsForUser(userId);
    const match = sessions.find(
      (s) =>
        s.type === SESSION_TYPES.UNDERSTANDING_ORCHESTRATE &&
        s.meta?.runId === runId,
    );

    if (!match) {
      return res.json({
        success: false,
        error: "No active session found for this run",
      });
    }

    endSession(match.sessionId);
    return res.json({ success: true });
  },
);

export default router;
