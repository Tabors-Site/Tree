// routesURL/tree.js
// Direct tree chat endpoint — send a message to a tree, get a response back.

import express from "express";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

import authenticate from "../middleware/authenticate.js";
import { orchestrateTreeRequest } from "../ws/orchestrator/treeOrchestrator.js";
import { setRootId, getClientForUser } from "../ws/conversation.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../ws/mcp.js";
import { startAIChat, finalizeAIChat } from "../ws/aiChatTracker.js";

const router = express.Router();

const nullSocket = {
  emit: () => {},
  to: () => nullSocket,
  broadcast: { emit: () => {} },
};

// ── API session management (15-min idle TTL, keyed by userId:rootId) ──
const SESSION_TTL = 15 * 60 * 1000;
const apiSessions = new Map();

function getOrCreateSession(userId, rootId) {
  const key = `${userId}:${rootId}`;
  const now = Date.now();
  const existing = apiSessions.get(key);

  if (existing && now - existing.lastActivity < SESSION_TTL) {
    existing.lastActivity = now;
    return existing.sessionId;
  }

  const sessionId = uuidv4();
  apiSessions.set(key, { sessionId, lastActivity: now });
  return sessionId;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of apiSessions) {
    if (now - val.lastActivity > SESSION_TTL) apiSessions.delete(key);
  }
}, 5 * 60 * 1000);

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

  console.log(`🌳 Tree chat: rootId=${rootId} user=${req.username} message="${message?.slice(0, 80)}"`);

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ success: false, answer: "Message is required." });
  }

  const visitorId = `tree-chat:${req.userId}:${Date.now()}`;
  const sessionId = getOrCreateSession(req.userId, rootId);

  // 19-minute timeout — return gracefully before nginx kills the connection
  const TIMEOUT_MS = 19 * 60 * 1000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`⏱️ Tree chat timed out after ${TIMEOUT_MS / 1000}s: ${visitorId}`);
    closeMCPClient(visitorId);
    if (aiChat) {
      finalizeAIChat({
        chatId: aiChat._id,
        content: "Error: Request timed out",
        stopped: false,
      }).catch(() => {});
    }
    if (!res.headersSent) {
      res.status(504).json({ success: false, answer: "Request timed out. The tree took too long to respond." });
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
        baseUrl: clientInfo.isCustom ? clientInfo.client.baseURL : null,
      },
      treeContext: { targetNodeId: rootId },
    });
  } catch (err) {
    console.error("⚠️ Failed to create AIChat:", err.message);
  }

  try {
    console.log(`🔑 Tree chat: connecting MCP for ${visitorId}`);
    const internalJwt = jwt.sign(
      { userId: req.userId.toString(), username: req.username },
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
      signal: null,
      sessionId,
      rootId,
    });

    clearTimeout(timer);
    if (timedOut) return;

    console.log(`✅ Tree chat: orchestration complete, success=${result?.success}`);

    // ── Finalize AIChat (success or no-fit) ──
    if (aiChat) {
      const answer = result?.answer || result?.reason || null;
      finalizeAIChat({
        chatId: aiChat._id,
        content: answer,
        stopped: false,
        modeKey: result?.modeKey || "tree:orchestrator",
      }).catch((err) => console.error("⚠️ AIChat finalize failed:", err.message));
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
        content: `Error: ${err.message}`,
        stopped: false,
      }).catch((e) => console.error("⚠️ AIChat error finalize failed:", e.message));
    }

    return res.status(500).json({ success: false, answer: "Something went wrong." });
  } finally {
    clearTimeout(timer);
    if (!timedOut) closeMCPClient(visitorId);
  }
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

  console.log(`📌 Tree place: rootId=${rootId} user=${req.username} message="${message?.slice(0, 80)}"`);

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ success: false, error: "Message is required." });
  }

  const visitorId = `tree-place:${req.userId}:${Date.now()}`;
  const sessionId = getOrCreateSession(req.userId, rootId);

  const TIMEOUT_MS = 19 * 60 * 1000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`⏱️ Tree place timed out after ${TIMEOUT_MS / 1000}s: ${visitorId}`);
    closeMCPClient(visitorId);
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
        baseUrl: clientInfo.isCustom ? clientInfo.client.baseURL : null,
      },
      treeContext: { targetNodeId: rootId },
    });
  } catch (err) {
    console.error("⚠️ Failed to create AIChat:", err.message);
  }

  try {
    const internalJwt = jwt.sign(
      { userId: req.userId.toString(), username: req.username },
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
      signal: null,
      sessionId,
      rootId,
      skipRespond: true,
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
      }).catch((err) => console.error("⚠️ AIChat finalize failed:", err.message));
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
        content: `Error: ${err.message}`,
        stopped: false,
      }).catch((e) => console.error("⚠️ AIChat error finalize failed:", e.message));
    }

    return res.status(500).json({ success: false, error: "Something went wrong." });
  } finally {
    clearTimeout(timer);
    if (!timedOut) closeMCPClient(visitorId);
  }
});

export default router;
