// ws/orchestrator/cleanupReorganizeOrchestrator.js
// Analyzes tree structure and moves misplaced nodes / removes empty misplaced nodes.
// Pipeline: analyze (tool-less) → execute moves via tree:structure → execute deletes via tree:structure.

import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

import { switchMode, processMessage, setRootId, getClientForUser, clearSession } from "../conversation.js";
import { trackChainStep, startAIChat, finalizeAIChat, setAiContributionContext, clearAiContributionContext } from "../aiChatTracker.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../mcp.js";
import { buildDeepTreeSummary } from "../../core/treeFetch.js";
import { createSession, endSession, setSessionAbort, clearSessionAbort, SESSION_TYPES } from "../sessionRegistry.js";
import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const MAX_MOVES = 5;
const MAX_DELETES = 3;

// In-memory lock
const activeRuns = new Set();

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

function parseJsonSafe(text) {
  try {
    if (typeof text === "object" && text !== null) return text;
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

export async function orchestrateReorganize({ rootId, userId, username, source = "orchestrator" }) {
  if (activeRuns.has(rootId)) {
    console.log(`⏭️ Cleanup reorganize already running for tree ${rootId}, skipping`);
    return { success: false, error: "already running", sessionId: null };
  }

  activeRuns.add(rootId);

  const visitorId = `cleanup-reorg:${rootId}:${Date.now()}`;
  const { sessionId } = createSession({
    userId,
    type: SESSION_TYPES.CLEANUP_REORGANIZE,
    description: `Cleanup reorganize: ${rootId}`,
    meta: { rootId, visitorId },
  });
  const abort = new AbortController();
  setSessionAbort(sessionId, abort);

  let chainIndex = 1;
  let mainChatId = null;
  let finalizeArgs = { content: null, stopped: true, modeKey: "cleanup-reorg:complete" };

  // ── LLM provider ────────────────────────────────────────────────────
  let llmProvider;
  try {
    const clientInfo = await getClientForUser(userId, "main");
    llmProvider = {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    llmProvider = undefined;
  }

  // ── AI chat tracking ─────────────────────────────────────────────────
  const mainChat = await startAIChat({
    userId,
    sessionId,
    message: `Cleanup reorganize for tree ${rootId}`,
    source,
    modeKey: "cleanup-reorg:start",
    llmProvider,
  });
  mainChatId = mainChat._id;
  setAiContributionContext(visitorId, sessionId, mainChatId);

  // ── MCP connection ───────────────────────────────────────────────────
  const internalJwt = jwt.sign({ userId, username, visitorId }, JWT_SECRET, { expiresIn: "1h" });
  await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);

  console.log(`🧹 Cleanup reorganize started for tree ${rootId}`);

  try {
    setRootId(visitorId, rootId);

    // ════════════════════════════════════════════════════════════════
    // STEP 1: ANALYZE TREE STRUCTURE
    // ════════════════════════════════════════════════════════════════

    const treeSummary = await buildDeepTreeSummary(rootId, { includeEncodings: true, includeIds: true });

    switchMode(visitorId, "tree:cleanup-analyze", {
      username,
      userId,
      rootId,
      treeSummary,
      clearHistory: true,
    });

    const analyzeStart = new Date();
    const analyzeResult = await processMessage(
      visitorId,
      "Analyze this tree for misplaced or empty nodes that should be moved or removed.",
      { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
    );
    const analyzeEnd = new Date();

    const plan = parseJsonSafe(analyzeResult?.answer || analyzeResult);
    if (!plan) {
      console.error("❌ Cleanup reorganize: analysis returned invalid JSON");
      finalizeArgs = { content: "Analysis failed — invalid JSON", stopped: false, modeKey: "cleanup-reorg:complete" };
      return { success: false, error: "analysis failed", sessionId };
    }

    trackChainStep({
      userId,
      sessionId,
      rootChatId: mainChatId,
      chainIndex: chainIndex++,
      modeKey: "tree:cleanup-analyze",
      source,
      input: "tree analysis",
      output: plan,
      startTime: analyzeStart,
      endTime: analyzeEnd,
      llmProvider,
    });

    const moves = (plan.moves || []).slice(0, MAX_MOVES);
    const deletes = (plan.deletes || []).slice(0, MAX_DELETES);

    if (moves.length === 0 && deletes.length === 0) {
      console.log("🧹 Tree is well-organized — no changes needed");
      finalizeArgs = { content: "Tree is well-organized", stopped: false, modeKey: "cleanup-reorg:complete" };
      return { success: true, moves: 0, deletes: 0, sessionId };
    }

    console.log(`🧹 Plan: ${moves.length} move(s), ${deletes.length} delete(s)`);

    // ════════════════════════════════════════════════════════════════
    // STEP 2: EXECUTE MOVES via tree:structure
    // ════════════════════════════════════════════════════════════════

    let moveCount = 0;
    for (const move of moves) {
      if (abort.signal.aborted) break;

      // Verify node still exists
      const node = await Node.findById(move.nodeId).select("_id name").lean();
      if (!node) {
        console.warn(`⚠️ Skipping move — node ${move.nodeId} no longer exists`);
        continue;
      }

      switchMode(visitorId, "tree:structure", {
        username,
        userId,
        rootId,
        targetNodeId: move.newParentId,
        clearHistory: true,
      });

      const moveStart = new Date();
      const moveResult = await processMessage(
        visitorId,
        `Move node ${move.nodeId} ("${move.nodeName}") to this parent node. Reason: ${move.reason}`,
        { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
      );
      const moveEnd = new Date();

      const moveData = parseJsonSafe(moveResult?.answer || moveResult);

      trackChainStep({
        userId,
        sessionId,
        rootChatId: mainChatId,
        chainIndex: chainIndex++,
        modeKey: "tree:structure",
        source,
        input: `Move "${move.nodeName}" to ${move.newParentId}`,
        output: moveData,
        startTime: moveStart,
        endTime: moveEnd,
        llmProvider,
        treeContext: { targetNodeId: move.newParentId, stepResult: moveData ? "success" : "failed" },
      });

      if (moveData) moveCount++;
      console.log(`  ↪ Moved "${move.nodeName}": ${moveData ? "success" : "failed"}`);
    }

    // ════════════════════════════════════════════════════════════════
    // STEP 3: EXECUTE DELETES via tree:structure
    // ════════════════════════════════════════════════════════════════

    let deleteCount = 0;
    for (const del of deletes) {
      if (abort.signal.aborted) break;

      // Verify node still exists
      const node = await Node.findById(del.nodeId).select("_id name children").lean();
      if (!node) {
        console.warn(`⚠️ Skipping delete — node ${del.nodeId} no longer exists`);
        continue;
      }

      switchMode(visitorId, "tree:structure", {
        username,
        userId,
        rootId,
        targetNodeId: del.nodeId,
        clearHistory: true,
      });

      const delStart = new Date();
      const delResult = await processMessage(
        visitorId,
        `Delete node ${del.nodeId} ("${del.nodeName}"). It is empty and misplaced. Reason: ${del.reason}`,
        { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
      );
      const delEnd = new Date();

      const delData = parseJsonSafe(delResult?.answer || delResult);

      trackChainStep({
        userId,
        sessionId,
        rootChatId: mainChatId,
        chainIndex: chainIndex++,
        modeKey: "tree:structure",
        source,
        input: `Delete "${del.nodeName}"`,
        output: delData,
        startTime: delStart,
        endTime: delEnd,
        llmProvider,
        treeContext: { targetNodeId: del.nodeId, stepResult: delData ? "success" : "failed" },
      });

      if (delData) deleteCount++;
      console.log(`  🗑️ Deleted "${del.nodeName}": ${delData ? "success" : "failed"}`);
    }

    finalizeArgs = {
      content: `Reorganized: ${moveCount} moved, ${deleteCount} deleted`,
      stopped: false,
      modeKey: "cleanup-reorg:complete",
    };

    console.log(`🧹 Cleanup reorganize complete: ${moveCount} moved, ${deleteCount} deleted`);
    return { success: true, moves: moveCount, deletes: deleteCount, sessionId };
  } catch (err) {
    console.error(`❌ Cleanup reorganize error for tree ${rootId}:`, err.message);
    finalizeArgs = { content: err.message, stopped: abort.signal.aborted, modeKey: "cleanup-reorg:complete" };
    return { success: false, error: err.message, sessionId };
  } finally {
    if (mainChatId) {
      finalizeAIChat({ chatId: mainChatId, ...finalizeArgs }).catch((e) =>
        console.error(`❌ Failed to finalize cleanup-reorg chat:`, e.message),
      );
    }
    clearAiContributionContext(visitorId);
    clearSessionAbort(sessionId);
    endSession(sessionId);
    closeMCPClient(visitorId);
    clearSession(visitorId);
    activeRuns.delete(rootId);
  }
}
