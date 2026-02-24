// ws/orchestrator/rawIdeaOrchestrator.js
// Automates raw idea placement: chooseRoot → delegate to treeOrchestrator → record result.

import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

import { switchMode, processMessage, setRootId } from "../conversation.js";
import { trackChainStep, startAIChat, finalizeAIChat } from "../aiChatTracker.js";
import { orchestrateTreeRequest } from "./treeOrchestrator.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../mcp.js";
import { getRootNodesForUser, buildDeepTreeSummary } from "../../core/treeFetch.js";
import { logContribution } from "../../db/utils.js";
import RawIdea from "../../db/models/rawIdea.js";

// ─────────────────────────────────────────────────────────────────────────
// NULL SOCKET
// Used when calling orchestrateTreeRequest without a WebSocket connection.
// All emit calls become no-ops so the tree orchestrator can run offline.
// ─────────────────────────────────────────────────────────────────────────

const nullSocket = {
  emit: () => {},
  to: () => nullSocket,
  broadcast: { emit: () => {} },
};

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

function parseJsonSafe(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Extract the best targetNodeId from a tree result's step summaries.
 * Falls back to the treeResult.rootId if no step target found.
 */
function extractTargetNodeId(treeResult) {
  if (!treeResult) return null;
  const summaries = treeResult.stepSummaries || [];
  for (let i = summaries.length - 1; i >= 0; i--) {
    const s = summaries[i];
    if (s.target && !s.skipped && !s.failed) {
      // target is "targetPath || targetNodeId || 'root'" — use rootId if just "root"
      const nodeId = s.targetNodeId || null;
      if (nodeId) return nodeId;
    }
  }
  return treeResult.rootId || null;
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

/**
 * Automatically places a raw idea into the best-fit tree.
 * Runs as a fire-and-forget async process — caller should not await.
 *
 * @param {string} rawIdeaId
 * @param {string} userId
 * @param {string} username
 */
export async function orchestrateRawIdeaPlacement({ rawIdeaId, userId, username }) {
  const visitorId = `rawIdea:${rawIdeaId}`;
  const sessionId = uuidv4();
  let chainIndex = 1;

  // Used to pass final status into the finally block for session finalization
  let finalizeArgs = { content: null, stopped: true, modeKey: "rawIdea:complete" };
  let mainChatId = null;

  // ── Load and validate raw idea ────────────────────────────────────────
  const rawIdea = await RawIdea.findById(rawIdeaId);
  if (!rawIdea || rawIdea.userId === "deleted") {
    console.warn(`⚠️ Raw idea ${rawIdeaId} not found or already placed`);
    return;
  }
  if (rawIdea.userId !== userId) {
    console.warn(`⚠️ Raw idea ${rawIdeaId} ownership mismatch`);
    return;
  }
  if (rawIdea.status && rawIdea.status !== "pending") {
    console.warn(`⚠️ Raw idea ${rawIdeaId} already ${rawIdea.status}`);
    return;
  }

  // ── Mark as processing ────────────────────────────────────────────────
  rawIdea.status = "processing";
  rawIdea.aiSessionId = sessionId;
  await rawIdea.save();

  // ── Create the session root record (chainIndex 0) ────────────────────
  // This is what the AI chats page uses to show Done/Pending status.
  // finalizeAIChat() will set endMessage.time when we're done.
  const mainChat = await startAIChat({
    userId,
    sessionId,
    message: rawIdea.content,
    source: "orchestrator",
    modeKey: "rawIdea:start",
  });
  mainChatId = mainChat._id;

  console.log(`🤖 Raw-idea orchestrator started for ${rawIdeaId} (session: ${sessionId})`);

  const markStuck = async (reason) => {
    console.log(`🔶 Raw idea ${rawIdeaId} → stuck: ${reason}`);
    rawIdea.status = "stuck";
    await rawIdea.save();
    finalizeArgs = { content: reason, stopped: false, modeKey: "rawIdea:stuck" };
    trackChainStep({
      userId,
      sessionId,
      chainIndex: chainIndex++,
      modeKey: "rawIdea:complete",
      source: "orchestrator",
      input: reason,
      output: { status: "stuck", reason },
    });
  };

  // ── Pre-connect MCP client with a valid internal JWT ─────────────────
  // processMessage() needs an MCP client keyed to visitorId. WebSocket sessions
  // pre-connect in websocket.js; for offline orchestration we do it here.
  const internalJwt = jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
  await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);

  try {
    // ── PHASE 1: Choose best-fit root ─────────────────────────────────────
    const roots = await getRootNodesForUser(userId);
    if (!roots || roots.length === 0) {
      await markStuck("No trees available for this user");
      return;
    }

    // Build a summary for each root tree
    const rootSummaries = await Promise.all(
      roots.map(async (r) => {
        const summary = await buildDeepTreeSummary(r._id).catch(() => "(summary unavailable)");
        return { rootId: r._id, name: r.name, summary };
      }),
    );

    // Run the chooseRoot mode
    switchMode(visitorId, "rawIdea:chooseRoot", {
      username,
      userId,
      content: rawIdea.content,
      rootSummaries,
      clearHistory: true,
    });

    const chooseStart = new Date();
    const chooseResult = await processMessage(visitorId, rawIdea.content, {
      username,
      userId,
      meta: { internal: true },
    });
    const chooseEnd = new Date();

    const parsed = parseJsonSafe(
      typeof chooseResult === "string" ? chooseResult : JSON.stringify(chooseResult),
    );

    trackChainStep({
      userId,
      sessionId,
      chainIndex: chainIndex++,
      modeKey: "rawIdea:chooseRoot",
      source: "orchestrator",
      input: rawIdea.content,
      output: parsed,
      startTime: chooseStart,
      endTime: chooseEnd,
    });

    const chosenRootId = parsed?.rootId;
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0;

    if (!chosenRootId || confidence < 0.35) {
      await markStuck(
        parsed?.reasoning || `No tree fit (confidence: ${confidence.toFixed(2)})`,
      );
      return;
    }

    console.log(
      `🌳 Chosen root: ${parsed.rootName} (${chosenRootId}) confidence=${confidence.toFixed(2)}`,
    );

    // ── PHASE 2: Delegate to tree orchestrator ────────────────────────────
    setRootId(visitorId, chosenRootId);

    const treeResult = await orchestrateTreeRequest({
      visitorId,
      message: rawIdea.content,
      socket: nullSocket,
      username,
      userId,
      signal: null,
      sessionId,
      rootId: chosenRootId,
    });

    if (!treeResult || treeResult.noFit || !treeResult.success) {
      await markStuck(
        treeResult?.reason ||
          (treeResult?.noFit ? "Tree rejected the idea (no_fit)" : "Tree orchestration failed"),
      );
      return;
    }

    // ── PHASE 3: Record successful placement ──────────────────────────────
    const targetNodeId = extractTargetNodeId(treeResult) || chosenRootId;

    rawIdea.userId = "deleted"; // soft-delete, consistent with manual placement
    rawIdea.status = "succeeded";
    rawIdea.placedAt = new Date();
    await rawIdea.save();

    await logContribution({
      userId,
      nodeId: targetNodeId,
      wasAi: true,
      action: "rawIdea",
      nodeVersion: "0",
      rawIdeaAction: {
        action: "placed",
        rawIdeaId: rawIdeaId.toString(),
        targetNodeId,
      },
    });

    trackChainStep({
      userId,
      sessionId,
      chainIndex: chainIndex++,
      modeKey: "rawIdea:complete",
      source: "orchestrator",
      input: rawIdea.content,
      output: { status: "succeeded", targetNodeId },
    });

    finalizeArgs = {
      content: `Placed on node ${targetNodeId}`,
      stopped: false,
      modeKey: "rawIdea:complete",
    };

    console.log(`✅ Raw idea ${rawIdeaId} placed on node ${targetNodeId}`);
  } catch (err) {
    console.error(`❌ Raw-idea orchestration error for ${rawIdeaId}:`, err.message);
    try {
      rawIdea.status = "stuck";
      await rawIdea.save();
      trackChainStep({
        userId,
        sessionId,
        chainIndex: chainIndex++,
        modeKey: "rawIdea:complete",
        source: "orchestrator",
        input: rawIdea.content,
        output: { status: "stuck", reason: err.message },
      });
    } catch (saveErr) {
      console.error(`❌ Failed to mark raw idea as stuck:`, saveErr.message);
    }
    finalizeArgs = { content: err.message, stopped: false, modeKey: "rawIdea:complete" };
  } finally {
    if (mainChatId) {
      finalizeAIChat({ chatId: mainChatId, ...finalizeArgs }).catch((e) =>
        console.error(`❌ Failed to finalize raw-idea session chat:`, e.message),
      );
    }
    closeMCPClient(visitorId);
  }
}
