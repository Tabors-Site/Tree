// ws/orchestrator/rawIdeaOrchestrator.js
// Automates raw idea placement: chooseRoot → delegate to treeOrchestrator → record result.

import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

import { switchMode, processMessage, setRootId, getClientForUser } from "../conversation.js";
import { trackChainStep, startAIChat, finalizeAIChat, setAiContributionContext, clearAiContributionContext } from "../aiChatTracker.js";
import { orchestrateTreeRequest } from "./treeOrchestrator.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../mcp.js";
import { getRootNodesForUser, buildDeepTreeSummary } from "../../core/treeFetch.js";
import { logContribution } from "../../db/utils.js";
import { registerSession, endSession, SESSION_TYPES } from "../sessionRegistry.js";
import RawIdea from "../../db/models/rawIdea.js";
import Node from "../../db/models/node.js";

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
 *
 * @param {string}  rawIdeaId
 * @param {string}  userId
 * @param {string}  username
 * @param {boolean} [withResponse=false] — when true, waits for tree:respond and returns result
 */
export async function orchestrateRawIdeaPlacement({ rawIdeaId, userId, username, withResponse = false, source = "orchestrator" }) {
  const visitorId = `rawIdea:${rawIdeaId}`;
  const sessionId = uuidv4();
  registerSession({
    sessionId,
    userId,
    type: source === "background"
      ? SESSION_TYPES.SCHEDULED_RAW_IDEA
      : withResponse
        ? SESSION_TYPES.RAW_IDEA_CHAT
        : SESSION_TYPES.RAW_IDEA_ORCHESTRATE,
    description: `Raw idea placement: ${rawIdeaId}`,
    meta: { rawIdeaId, visitorId },
  });
  let chainIndex = 1;

  // Used to pass final status into the finally block for session finalization
  let finalizeArgs = { content: null, stopped: true, modeKey: "rawIdea:complete" };
  let mainChatId = null;

  // ── Load and validate raw idea ────────────────────────────────────────
  const rawIdea = await RawIdea.findById(rawIdeaId);
  if (!rawIdea || rawIdea.userId === "deleted") {
    console.warn(`⚠️ Raw idea ${rawIdeaId} not found or already placed`);
    return withResponse ? { success: false, reason: "Raw idea not found" } : undefined;
  }
  if (rawIdea.userId !== userId) {
    console.warn(`⚠️ Raw idea ${rawIdeaId} ownership mismatch`);
    return withResponse ? { success: false, reason: "Not authorized" } : undefined;
  }
  if (rawIdea.status && rawIdea.status !== "pending") {
    console.warn(`⚠️ Raw idea ${rawIdeaId} already ${rawIdea.status}`);
    return withResponse ? { success: false, reason: `Already ${rawIdea.status}` } : undefined;
  }

  // ── Mark as processing ────────────────────────────────────────────────
  rawIdea.status = "processing";
  rawIdea.aiSessionId = sessionId;
  await rawIdea.save();

  // ── Log contribution: AI started processing ───────────────────────────
  // Note: aiChatId not yet available (mainChat created below), but sessionId is
  await logContribution({
    userId,
    nodeId: "deleted",
    wasAi: true,
    sessionId,
    action: "rawIdea",
    nodeVersion: "0",
    rawIdeaAction: {
      action: "aiStarted",
      rawIdeaId: rawIdeaId.toString(),
    },
  });

  // ── Create the session root record (chainIndex 0) ────────────────────
  // This is what the AI chats page uses to show Done/Pending status.
  // finalizeAIChat() will set endMessage.time when we're done.
  let llmProvider;
  try {
    const clientInfo = await getClientForUser(userId, "rawIdea");
    llmProvider = {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    llmProvider = undefined;
  }
  const mainChat = await startAIChat({
    userId,
    sessionId,
    message: rawIdea.content,
    source,
    modeKey: "rawIdea:start",
    llmProvider,
  });
  mainChatId = mainChat._id;
  setAiContributionContext(userId, sessionId, mainChatId);

  console.log(`🤖 Raw-idea orchestrator started for ${rawIdeaId} (session: ${sessionId})`);

  const markStuck = async (reason) => {
    console.log(`🔶 Raw idea ${rawIdeaId} → stuck: ${reason}`);
    rawIdea.status = "stuck";
    await rawIdea.save();
    finalizeArgs = { content: reason, stopped: false, modeKey: "rawIdea:stuck" };
    trackChainStep({
      userId,
      sessionId,
      rootChatId: mainChatId,
      chainIndex: chainIndex++,
      modeKey: "rawIdea:complete",
      source: "orchestrator",
      input: reason,
      output: { status: "stuck", reason },
      llmProvider,
    });
    logContribution({
      userId,
      nodeId: "deleted",
      wasAi: true,
      aiChatId: mainChatId,
      sessionId,
      action: "rawIdea",
      nodeVersion: "0",
      rawIdeaAction: {
        action: "aiFailed",
        rawIdeaId: rawIdeaId.toString(),
      },
    }).catch((e) => console.error(`⚠️ Failed to log aiFailed contribution:`, e.message));
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
      return withResponse ? { success: false, reason: "No trees available for this user" } : undefined;
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
      slot: "rawIdea",
      meta: { internal: true },
    });
    const chooseEnd = new Date();

    const parsed = parseJsonSafe(
      typeof chooseResult === "string" ? chooseResult : JSON.stringify(chooseResult),
    );

    trackChainStep({
      userId,
      sessionId,
      rootChatId: mainChatId,
      chainIndex: chainIndex++,
      modeKey: "rawIdea:chooseRoot",
      source: "orchestrator",
      input: rawIdea.content,
      output: parsed,
      startTime: chooseStart,
      endTime: chooseEnd,
      llmProvider: chooseResult?.llmProvider || llmProvider,
    });

    const chosenRootId = parsed?.rootId;
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0;

    if (!chosenRootId || confidence < 0.35) {
      const stuckReason = parsed?.reasoning || `No tree fit (confidence: ${confidence.toFixed(2)})`;
      await markStuck(stuckReason);
      return withResponse ? { success: false, reason: stuckReason } : undefined;
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
      skipRespond: !withResponse,
      slot: "rawIdea",
      rootChatId: mainChatId,
    });

    if (!treeResult || treeResult.noFit || !treeResult.success) {
      const stuckReason = treeResult?.reason ||
        (treeResult?.noFit ? "Tree rejected the idea (no_fit)" : "Tree orchestration failed");
      await markStuck(stuckReason);
      return withResponse ? { success: false, reason: stuckReason } : undefined;
    }

    // ── PHASE 3: Record successful placement ──────────────────────────────
    const targetNodeId = extractTargetNodeId(treeResult) || chosenRootId;

    rawIdea.status = "succeeded";
    rawIdea.placedAt = new Date();
    await rawIdea.save();

    const targetNode = await Node.findById(targetNodeId).select("prestige").lean();
    const nodeVersion = targetNode?.prestige?.toString() ?? "0";

    await logContribution({
      userId,
      nodeId: targetNodeId,
      wasAi: true,
      aiChatId: mainChatId,
      sessionId,
      action: "rawIdea",
      nodeVersion,
      rawIdeaAction: {
        action: "placed",
        rawIdeaId: rawIdeaId.toString(),
        targetNodeId,
      },
    });

    trackChainStep({
      userId,
      sessionId,
      rootChatId: mainChatId,
      chainIndex: chainIndex++,
      modeKey: "rawIdea:complete",
      source: "orchestrator",
      input: rawIdea.content,
      output: { status: "succeeded", targetNodeId },
      llmProvider,
    });

    finalizeArgs = {
      content: withResponse
        ? (treeResult.answer || `Placed on node ${targetNodeId}`)
        : `Placed on node ${targetNodeId}`,
      stopped: false,
      modeKey: "rawIdea:complete",
    };

    console.log(`✅ Raw idea ${rawIdeaId} placed on node ${targetNodeId}`);

    if (withResponse) {
      return {
        success: true,
        answer: treeResult.answer || null,
        rootId: chosenRootId,
        rootName: parsed.rootName || null,
        targetNodeId,
      };
    }
  } catch (err) {
    console.error(`❌ Raw-idea orchestration error for ${rawIdeaId}:`, err.message);
    try {
      rawIdea.status = "stuck";
      await rawIdea.save();
      trackChainStep({
        userId,
        sessionId,
        rootChatId: mainChatId,
        chainIndex: chainIndex++,
        modeKey: "rawIdea:complete",
        source: "orchestrator",
        input: rawIdea.content,
        output: { status: "stuck", reason: err.message },
        llmProvider,
      });
      logContribution({
        userId,
        nodeId: "deleted",
        wasAi: true,
        aiChatId: mainChatId,
        sessionId,
        action: "rawIdea",
        nodeVersion: "0",
        rawIdeaAction: {
          action: "aiFailed",
          rawIdeaId: rawIdeaId.toString(),
        },
      }).catch((e) => console.error(`⚠️ Failed to log aiFailed contribution:`, e.message));
    } catch (saveErr) {
      console.error(`❌ Failed to mark raw idea as stuck:`, saveErr.message);
    }
    finalizeArgs = { content: err.message, stopped: false, modeKey: "rawIdea:complete" };
    if (withResponse) {
      return { success: false, reason: err.message };
    }
  } finally {
    if (mainChatId) {
      finalizeAIChat({ chatId: mainChatId, ...finalizeArgs }).catch((e) =>
        console.error(`❌ Failed to finalize raw-idea session chat:`, e.message),
      );
    }
    clearAiContributionContext(userId);
    endSession(sessionId);
    closeMCPClient(visitorId);
  }
}
