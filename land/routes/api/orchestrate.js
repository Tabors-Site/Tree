// routesURL/tree.js
// All LLM orchestration routes — tree chat/place, raw idea chat/place, understanding.

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
import RawIdea from "../../db/models/rawIdea.js";
import { createRawIdea } from "../../core/tree/rawIdea.js";
import { resolveTreeAccess } from "../../core/authenticate.js";
import { nullSocket } from "../../orchestrators/helpers.js";

const router = express.Router();

// Rate limit public queries: 10 per 15 min per IP
const publicQueryLimits = new Map();
const PQ_WINDOW_MS = 15 * 60 * 1000;
const PQ_MAX = 10;

function checkPublicQueryLimit(ip) {
  const now = Date.now();
  const entry = publicQueryLimits.get(ip);
  if (!entry || now - entry.start > PQ_WINDOW_MS) {
    publicQueryLimits.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= PQ_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of publicQueryLimits) {
    if (now - entry.start > PQ_WINDOW_MS * 2) publicQueryLimits.delete(ip);
  }
}, PQ_WINDOW_MS);

/**
 * POST /api/v1/tree/:rootId/chat
 * Send a message to a tree and get a natural language response.
 *
 * Body: { message: string }
 * Response: { success: boolean, answer: string }
 */
router.post("/root/:rootId/chat", authenticate, async (req, res) => {
  const { rootId } = req.params;
  const { message } = req.body;

  console.log(
    `🌳 Tree chat: rootId=${rootId} user=${req.username} message="${message?.slice(0, 80)}"`,
  );

  if (
    !message ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 5000
  ) {
    return res.status(400).json({
      success: false,
      answer: "Message is required and must be under 5000 characters.",
    });
  }

  // Check tree access
  const access = await resolveTreeAccess(rootId, req.userId);
  if (!access.isOwner && !access.isContributor) {
    return res
      .status(403)
      .json({ success: false, answer: "Not authorized to access this tree." });
  }

  // Check LLM access
  const rootCheck = await Node.findById(rootId)
    .select("rootOwner llmAssignments")
    .lean();
  const hasUserLlm = await userHasLlm(req.userId);
  const hasRootLlm = !!(rootCheck?.llmAssignments?.default && rootCheck.llmAssignments.default !== "none");
  if (!hasUserLlm && !hasRootLlm) {
    return res.status(403).json({
      success: false,
      answer: "No LLM connection. Visit /setup to set one up.",
    });
  }

  const visitorId = `tree-chat:${req.userId}:${Date.now()}`;
  const { sessionId } = createSession({
    userId: req.userId,
    type: SESSION_TYPES.API_TREE_CHAT,
    scopeKey: `${req.userId}:${rootId}`,
    description: `API tree chat on root ${rootId}`,
    meta: { rootId, visitorId },
  });
  const abort = new AbortController();
  setSessionAbort(sessionId, abort);

  // 19-minute timeout — return gracefully before nginx kills the connection
  const TIMEOUT_MS = 19 * 60 * 1000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(
      `⏱️ Tree chat timed out after ${TIMEOUT_MS / 1000}s: ${visitorId}`,
    );
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
      res.status(504).json({
        success: false,
        answer: "Request timed out. The tree took too long to respond.",
      });
    }
  }, TIMEOUT_MS);

  // ── AIChat tracking (same pattern as websocket.js) ──
  let aiChat = null;
  try {
    const clientInfo = await getClientForUser(req.userId);
    aiChat = await startAIChat({
      userId: req.userId,
      sessionId,
      message: message.slice(0, 5000),
      source: "api",
      modeKey: "tree:chat",
      llmProvider: {
        isCustom: clientInfo.isCustom,
        model: clientInfo.model,
        connectionId: clientInfo.connectionId || null,
      },
      treeContext: { targetNodeId: rootId },
    });
    if (aiChat) setAiContributionContext(visitorId, sessionId, aiChat._id);
  } catch (err) {
    console.error("⚠️ Failed to create AIChat:", err.message);
  }

  // Serialize requests per user+tree so concurrent messages don't race
  await enqueue(sessionId, async () => {
    try {
      console.log(`🔑 Tree chat: connecting MCP for ${visitorId}`);
      const internalJwt = jwt.sign(
        { userId: req.userId.toString(), username: req.username, visitorId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
      await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);
      console.log(`✅ Tree chat: MCP connected, starting orchestration`);

      setRootId(visitorId, rootId);

      const result = await orchestrateTreeRequest({
        visitorId,
        message: message.trim(),
        socket: nullSocket,
        username: req.username,
        userId: req.userId,
        signal: abort.signal,
        sessionId,
        rootId,
        rootChatId: aiChat?._id || null,
        sourceType: "tree-chat",
      });

      clearTimeout(timer);
      if (timedOut) return;

      console.log(
        `✅ Tree chat: orchestration complete, success=${result?.success}`,
      );

      // ── Finalize AIChat (success or no-fit) ──
      if (aiChat) {
        const answer = result?.answer || result?.reason || null;
        finalizeAIChat({
          chatId: aiChat._id,
          content: answer,
          stopped: false,
          modeKey: result?.modeKey || "tree:orchestrator",
        }).catch((err) =>
          console.error("⚠️ AIChat finalize failed:", err.message),
        );
      }

      if (!result || !result.success) {
        return res.json({
          success: false,
          answer: result?.answer || "Could not process your message.",
        });
      }

      return res.json({
        success: true,
        answer: result.answer,
      });
    } catch (err) {
      clearTimeout(timer);
      if (timedOut) return;
      console.error("❌ Tree chat error:", err.message);

      // ── Finalize AIChat (error) ──
      if (aiChat) {
        finalizeAIChat({
          chatId: aiChat._id,
          content: abort.signal.aborted ? null : `Error: ${err.message}`,
          stopped: abort.signal.aborted,
        }).catch((e) =>
          console.error("⚠️ AIChat error finalize failed:", e.message),
        );
      }

      if (!res.headersSent) {
        if (err.message?.includes("No LLM connection")) {
          return res.status(403).json({ success: false, error: err.message, answer: err.message });
        }
        return res
          .status(500)
          .json({ success: false, answer: "Something went wrong." });
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
});

/**
 * POST /api/v1/tree/:rootId/place
 * Place content onto a tree without generating a response.
 *
 * Body: { message: string }
 * Response: { success, stepSummaries, targetNodeId, targetPath }
 */
router.post("/root/:rootId/place", authenticate, async (req, res) => {
  const { rootId } = req.params;
  const { message } = req.body;

  console.log(
    `📌 Tree place: rootId=${rootId} user=${req.username} message="${message?.slice(0, 80)}"`,
  );

  if (
    !message ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 5000
  ) {
    return res.status(400).json({
      success: false,
      error: "Message is required and must be under 5000 characters.",
    });
  }

  // Check tree access
  const placeAccess = await resolveTreeAccess(rootId, req.userId);
  if (!placeAccess.isOwner && !placeAccess.isContributor) {
    return res
      .status(403)
      .json({ success: false, error: "Not authorized to access this tree." });
  }

  // Check LLM access
  const placeRootCheck = await Node.findById(rootId)
    .select("rootOwner llmAssignments")
    .lean();
  const placeHasUserLlm = await userHasLlm(req.userId);
  const placeHasRootLlm = !!(placeRootCheck?.llmAssignments?.default && placeRootCheck.llmAssignments.default !== "none");
  if (!placeHasUserLlm && !placeHasRootLlm) {
    return res.status(403).json({
      success: false,
      error: "No LLM connection. Visit /setup to set one up.",
    });
  }

  const visitorId = `tree-place:${req.userId}:${Date.now()}`;
  const { sessionId } = createSession({
    userId: req.userId,
    type: SESSION_TYPES.API_TREE_PLACE,
    scopeKey: `${req.userId}:${rootId}`,
    description: `API tree place on root ${rootId}`,
    meta: { rootId, visitorId },
  });
  const abort = new AbortController();
  setSessionAbort(sessionId, abort);

  const TIMEOUT_MS = 19 * 60 * 1000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(
      `⏱️ Tree place timed out after ${TIMEOUT_MS / 1000}s: ${visitorId}`,
    );
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
      res.status(504).json({ success: false, error: "Request timed out." });
    }
  }, TIMEOUT_MS);

  let aiChat = null;
  try {
    const clientInfo = await getClientForUser(req.userId);
    aiChat = await startAIChat({
      userId: req.userId,
      sessionId,
      message: message.slice(0, 5000),
      source: "api",
      modeKey: "tree:place",
      llmProvider: {
        isCustom: clientInfo.isCustom,
        model: clientInfo.model,
        connectionId: clientInfo.connectionId || null,
      },
      treeContext: { targetNodeId: rootId },
    });
    if (aiChat) setAiContributionContext(visitorId, sessionId, aiChat._id);
  } catch (err) {
    console.error("⚠️ Failed to create AIChat:", err.message);
  }

  // Serialize requests per user+tree so concurrent messages don't race
  await enqueue(sessionId, async () => {
    try {
      const internalJwt = jwt.sign(
        { userId: req.userId.toString(), username: req.username, visitorId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
      await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);
      setRootId(visitorId, rootId);

      const result = await orchestrateTreeRequest({
        visitorId,
        message: message.trim(),
        socket: nullSocket,
        username: req.username,
        userId: req.userId,
        signal: abort.signal,
        sessionId,
        rootId,
        skipRespond: true,
        rootChatId: aiChat?._id || null,
        sourceType: "tree-place",
      });

      clearTimeout(timer);
      if (timedOut) return;

      if (aiChat) {
        const summary = result?.stepSummaries?.length
          ? `Placed: ${result.stepSummaries.length} step(s)`
          : null;
        finalizeAIChat({
          chatId: aiChat._id,
          content: summary || result?.reason || null,
          stopped: false,
          modeKey: result?.modeKey || "tree:orchestrator",
        }).catch((err) =>
          console.error("⚠️ AIChat finalize failed:", err.message),
        );
      }

      if (!result || !result.success) {
        return res.json({
          success: false,
          error: result?.reason || "Could not place content.",
          stepSummaries: result?.stepSummaries || [],
        });
      }

      return res.json({
        success: true,
        stepSummaries: result.stepSummaries || [],
        targetNodeId: result.lastTargetNodeId || null,
        targetPath: result.lastTargetPath || null,
      });
    } catch (err) {
      clearTimeout(timer);
      if (timedOut) return;
      console.error("❌ Tree place error:", err.message);

      if (aiChat) {
        finalizeAIChat({
          chatId: aiChat._id,
          content: abort.signal.aborted ? null : `Error: ${err.message}`,
          stopped: abort.signal.aborted,
        }).catch((e) =>
          console.error("⚠️ AIChat error finalize failed:", e.message),
        );
      }

      if (!res.headersSent) {
        return res
          .status(500)
          .json({ success: false, error: "Something went wrong." });
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
});

/**
 * POST /api/v1/tree/:rootId/query
 * Query the tree (read-only). Responds with information but makes no edits.
 *
 * Body: { message: string }
 * Response: { success, answer }
 */
router.post("/root/:rootId/query", authenticateOrPublic, async (req, res) => {
  const { rootId } = req.params;
  const { message } = req.body;
  const isPublicAccess = !!req.isPublicAccess;

  console.log(
    `🔍 Tree query: rootId=${rootId} user=${isPublicAccess ? "public" : req.username} message="${message?.slice(0, 80)}"`,
  );

  if (
    !message ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 5000
  ) {
    return res.status(400).json({
      success: false,
      answer: "Message is required and must be under 5000 characters.",
    });
  }

  // Rate limit public queries
  if (isPublicAccess && !checkPublicQueryLimit(req.ip || "unknown")) {
    return res.status(429).json({
      success: false,
      answer: "Too many queries. Please try again later.",
    });
  }

  const rootCheck = await Node.findById(rootId)
    .select("rootOwner llmAssignments visibility")
    .lean();

  if (!rootCheck) {
    return res.status(404).json({ success: false, answer: "Tree not found." });
  }

  // Determine who pays for LLM and which user context to use
  let effectiveUserId = req.userId;
  let effectiveUsername = req.username;
  let isPublicQuery = false;
  let canopyProxyClient = null; // set if using visitor's home land LLM

  const treeHasLlm = rootCheck.llmAssignments?.default !== "none";

  if (isPublicAccess) {
    // Public access: tree must be public
    if (rootCheck.visibility !== "public") {
      return res.status(403).json({ success: false, answer: "This tree is not public." });
    }

    const hasCanopyVisitor = !!req.canopyVisitor;

    if (treeHasLlm) {
      // Owner's LLM, owner pays
      effectiveUserId = rootCheck.rootOwner;
      const owner = await User.findById(rootCheck.rootOwner).select("username").lean();
      effectiveUsername = owner?.username || "system";
    } else if (hasCanopyVisitor) {
      // Visitor authenticated on their home land. Route LLM through canopy proxy.
      canopyProxyClient = createCanopyLlmProxyClient({
        userId: req.canopyVisitor.userId,
        homeLand: req.canopyVisitor.homeLand,
        slot: "main",
      });
      effectiveUserId = rootCheck.rootOwner; // session runs under owner context locally
      const owner = await User.findById(rootCheck.rootOwner).select("username").lean();
      effectiveUsername = `visitor@${req.canopyVisitor.homeLand}`;
    } else {
      // Anonymous, no owner LLM
      return res.status(403).json({
        success: false,
        answer: "This tree has no AI configured for public queries.",
      });
    }
    isPublicQuery = true;
  } else {
    // Authenticated user: check tree access
    const queryAccess = await resolveTreeAccess(rootId, req.userId);
    if (!queryAccess.isOwner && !queryAccess.isContributor) {
      // Not owner/contributor, but tree might be public
      if (rootCheck.visibility === "public") {
        // Allow query. Use owner's LLM if available.
        if (treeHasLlm) {
          effectiveUserId = rootCheck.rootOwner;
          const owner = await User.findById(rootCheck.rootOwner).select("username").lean();
          effectiveUsername = owner?.username || "system";
        } else if (req.canopy?.sourceLandDomain) {
          // Remote canopy user, no tree LLM. Fall back to their home land's LLM.
          canopyProxyClient = createCanopyLlmProxyClient({
            userId: req.userId,
            homeLand: req.canopy.sourceLandDomain,
            slot: "main",
          });
          effectiveUserId = rootCheck.rootOwner;
          const owner = await User.findById(rootCheck.rootOwner).select("username").lean();
          effectiveUsername = `visitor@${req.canopy.sourceLandDomain}`;
        }
        isPublicQuery = true;
      } else {
        return res
          .status(403)
          .json({ success: false, answer: "Not authorized to access this tree." });
      }
    }
  }

  // Verify LLM access (skip for canopy proxy, they handle their own)
  if (!canopyProxyClient) {
    const hasUserLlm = await userHasLlm(effectiveUserId);
    if (!hasUserLlm && !treeHasLlm) {
      return res.status(403).json({
        success: false,
        answer: isPublicAccess
          ? "This tree has no AI configured for public queries."
          : "No LLM connection configured. Set one up at /setup or assign one to this tree.",
      });
    }
  }

  const visitorId = `tree-query:${effectiveUserId}:${Date.now()}`;
  const { sessionId } = createSession({
    userId: effectiveUserId,
    type: SESSION_TYPES.API_TREE_QUERY,
    scopeKey: `${effectiveUserId}:${rootId}`,
    description: `API tree query on root ${rootId}${isPublicQuery ? " (public)" : ""}`,
    meta: { rootId, visitorId, isPublicQuery },
  });
  const abort = new AbortController();
  setSessionAbort(sessionId, abort);

  const TIMEOUT_MS = 19 * 60 * 1000;
  let timedOut = false;
  let aiChat = null;

  const timer = setTimeout(() => {
    timedOut = true;
    console.error(
      `⏱️ Tree query timed out after ${TIMEOUT_MS / 1000}s: ${visitorId}`,
    );
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
      res.status(504).json({
        success: false,
        answer: "Request timed out. The tree took too long to respond.",
      });
    }
  }, TIMEOUT_MS);

  try {
    const clientInfo = canopyProxyClient
      ? { client: canopyProxyClient, isCustom: true, model: "proxy", connectionId: null }
      : await getClientForUser(effectiveUserId);
    aiChat = await startAIChat({
      userId: effectiveUserId,
      sessionId,
      message: message.slice(0, 5000),
      source: isPublicQuery ? "public-query" : "api",
      modeKey: "tree:query",
      llmProvider: {
        isCustom: clientInfo.isCustom,
        model: clientInfo.model,
        connectionId: clientInfo.connectionId || null,
      },
      treeContext: { targetNodeId: rootId },
    });
    if (aiChat) setAiContributionContext(visitorId, sessionId, aiChat._id);
  } catch (err) {
    console.error("⚠️ Failed to create AIChat:", err.message);
  }

  await enqueue(sessionId, async () => {
    try {
      const internalJwt = jwt.sign(
        { userId: effectiveUserId.toString(), username: effectiveUsername, visitorId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
      await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);

      setRootId(visitorId, rootId);

      const result = await orchestrateTreeRequest({
        visitorId,
        message: message.trim(),
        socket: nullSocket,
        username: effectiveUsername,
        userId: effectiveUserId,
        signal: abort.signal,
        sessionId,
        rootId,
        forceQueryOnly: true,
        rootChatId: aiChat?._id || null,
        sourceType: "tree-query",
      });

      clearTimeout(timer);
      if (timedOut) return;

      if (aiChat) {
        const answer = result?.answer || result?.reason || null;
        finalizeAIChat({
          chatId: aiChat._id,
          content: answer,
          stopped: false,
          modeKey: result?.modeKey || "tree:orchestrator",
        }).catch((err) =>
          console.error("⚠️ AIChat finalize failed:", err.message),
        );
      }

      if (!result || !result.success) {
        return res.json({
          success: false,
          answer: result?.answer || "Could not process your message.",
        });
      }

      return res.json({
        success: true,
        answer: result.answer,
      });
    } catch (err) {
      clearTimeout(timer);
      if (timedOut) return;
      console.error("❌ Tree query error:", err.message);

      if (aiChat) {
        finalizeAIChat({
          chatId: aiChat._id,
          content: abort.signal.aborted ? null : `Error: ${err.message}`,
          stopped: abort.signal.aborted,
        }).catch((e) =>
          console.error("⚠️ AIChat error finalize failed:", e.message),
        );
      }

      if (!res.headersSent) {
        // Surface LLM config errors cleanly instead of generic 500
        if (err.message?.includes("No LLM connection")) {
          const msg = isPublicQuery
            ? "This tree has no AI configured for public queries."
            : err.message;
          return res.status(403).json({
            success: false,
            error: msg,
            answer: msg,
          });
        }
        return res
          .status(500)
          .json({ success: false, answer: "Something went wrong." });
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
});

// ── Raw Idea: combined create + place (fire-and-forget) ─────────────────────
router.post("/user/:userId/raw-ideas/place", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const content = req.body?.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      return res
        .status(400)
        .json({ error: "content (text string) is required" });
    }

    if (!(await userHasLlm(req.userId))) {
      return res
        .status(403)
        .json({ error: "No LLM connection. Visit /setup to set one up." });
    }

    const alreadyProcessing = await RawIdea.findOne({
      userId: req.userId.toString(),
      status: "processing",
    });
    if (alreadyProcessing) {
      return res.status(409).json({
        error:
          "Another idea is already being placed -- please wait for it to finish.",
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

// ── Raw Idea: combined create + chat (synchronous, returns response) ────────
router.post("/user/:userId/raw-ideas/chat", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const content = req.body?.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      return res
        .status(400)
        .json({ error: "content (text string) is required" });
    }

    if (!(await userHasLlm(req.userId))) {
      return res
        .status(403)
        .json({ error: "No LLM connection. Visit /setup to set one up." });
    }

    const alreadyProcessing = await RawIdea.findOne({
      userId: req.userId.toString(),
      status: "processing",
    });
    if (alreadyProcessing) {
      return res.status(409).json({
        error:
          "Another idea is already being placed -- please wait for it to finish.",
      });
    }

    const result = await createRawIdea({
      contentType: "text",
      content: content.trim(),
      userId: req.userId,
    });

    const user = await User.findById(req.userId).select("username").lean();

    const TIMEOUT_MS = 19 * 60 * 1000;
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

// ── Raw Idea: auto-place (fire-and-forget) ──────────────────────────────────
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
        return res
          .status(422)
          .json({ error: "File ideas cannot be auto-placed" });
      }
      if (rawIdea.status && rawIdea.status !== "pending") {
        return res.status(409).json({ error: `Already ${rawIdea.status}` });
      }

      // Check user has LLM for raw idea placement
      if (!(await userHasLlm(req.userId))) {
        return res
          .status(403)
          .json({ error: "No LLM connection. Visit /setup to set one up." });
      }

      // Block concurrent placements — only one at a time per user
      const alreadyProcessing = await RawIdea.findOne({
        userId: req.userId.toString(),
        status: "processing",
      });
      if (alreadyProcessing) {
        return res.status(409).json({
          error:
            "Another idea is already being placed — please wait for it to finish.",
        });
      }

      const user = await User.findById(req.userId).select("username").lean();

      // Fire and forget — orchestrator runs in background
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

// ── Raw Idea: auto-chat (synchronous, returns response) ─────────────────────
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
        return res
          .status(422)
          .json({ error: "File ideas cannot be auto-placed" });
      }
      if (rawIdea.status && rawIdea.status !== "pending") {
        return res.status(409).json({ error: `Already ${rawIdea.status}` });
      }

      // Check user has LLM for raw idea chat
      if (!(await userHasLlm(req.userId))) {
        return res
          .status(403)
          .json({ error: "No LLM connection. Visit /setup to set one up." });
      }

      // Block concurrent placements — only one at a time per user
      const alreadyProcessing = await RawIdea.findOne({
        userId: req.userId.toString(),
        status: "processing",
      });
      if (alreadyProcessing) {
        return res.status(409).json({
          error:
            "Another idea is already being placed — please wait for it to finish.",
        });
      }

      const user = await User.findById(req.userId).select("username").lean();

      // 19-minute timeout — return gracefully before nginx kills the connection
      const TIMEOUT_MS = 19 * 60 * 1000;
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

// ── Understanding: orchestrate ──────────────────────────────────────────────
router.post(
  "/root/:nodeId/understandings/run/:runId/orchestrate",
  authenticate,
  async (req, res) => {
    const { nodeId, runId } = req.params;
    const userId = req.userId;
    const username = req.username;
    const fromSite = req.body?.source === "user";
    const source = fromSite ? "user" : "api";

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
        source,
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

// ── Understanding: stop active run ──────────────────────────────────────────
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
