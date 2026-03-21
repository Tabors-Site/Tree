// orchestrators/pipelines/cleanupReorganize.js
// Analyzes tree structure and moves misplaced nodes / removes empty misplaced nodes.
// Pipeline: analyze (tool-less) -> execute moves via tree:structure -> execute deletes via tree:structure.

import { OrchestratorRuntime } from "../runtime.js";
import { SESSION_TYPES } from "../../ws/sessionRegistry.js";
import { buildDeepTreeSummary } from "../../core/tree/treeFetch.js";
import Node from "../../db/models/node.js";

const MAX_MOVES = 5;
const MAX_DELETES = 3;

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

export async function orchestrateReorganize({
  rootId,
  userId,
  username,
  source = "orchestrator",
}) {
  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username,
    visitorId: `cleanup-reorg:${rootId}:${Date.now()}`,
    sessionType: SESSION_TYPES.CLEANUP_REORGANIZE,
    description: `Cleanup reorganize: ${rootId}`,
    modeKeyForLlm: "tree:cleanup-analyze",
    source,
    lockNamespace: "cleanup-reorg",
  });

  const initialized = await rt.init();
  if (!initialized) {
    console.log(`Cleanup reorganize already running for tree ${rootId}, skipping`);
    return { success: false, error: "already running", sessionId: null };
  }

  console.log(`Cleanup reorganize started for tree ${rootId}`);

  try {
    // STEP 1: ANALYZE TREE STRUCTURE
    const treeSummary = await buildDeepTreeSummary(rootId, {
      includeEncodings: true,
      includeIds: true,
    });

    const { parsed: plan } = await rt.runStep("tree:cleanup-analyze", {
      prompt: "Analyze this tree for misplaced or empty nodes that should be moved or removed.",
      modeCtx: { treeSummary },
      input: "tree analysis",
    });

    if (!plan) {
      console.error("Cleanup reorganize: analysis returned invalid JSON");
      rt.setResult("Analysis failed, invalid JSON", "cleanup-reorg:complete");
      return { success: false, error: "analysis failed", sessionId: rt.sessionId };
    }

    const moves = (plan.moves || []).slice(0, MAX_MOVES);
    const deletes = (plan.deletes || []).slice(0, MAX_DELETES);

    if (moves.length === 0 && deletes.length === 0) {
      console.log("Tree is well-organized, no changes needed");
      rt.setResult("Tree is well-organized", "cleanup-reorg:complete");
      return { success: true, moves: 0, deletes: 0, sessionId: rt.sessionId };
    }

    console.log(`Plan: ${moves.length} move(s), ${deletes.length} delete(s)`);

    // STEP 2: EXECUTE MOVES via tree:structure
    let moveCount = 0;
    for (const move of moves) {
      if (rt.aborted) break;

      const node = await Node.findById(move.nodeId).select("_id name").lean();
      if (!node) {
        console.warn(`Skipping move, node ${move.nodeId} no longer exists`);
        continue;
      }

      const { parsed: moveData } = await rt.runStep("tree:structure", {
        prompt: `Move node ${move.nodeId} ("${move.nodeName}") to this parent node. Reason: ${move.reason}`,
        modeCtx: { targetNodeId: move.newParentId },
        input: `Move "${move.nodeName}" to ${move.newParentId}`,
        treeContext: (data) => ({ targetNodeId: move.newParentId, stepResult: data ? "success" : "failed" }),
      });

      if (moveData) moveCount++;
      console.log(`  Moved "${move.nodeName}": ${moveData ? "success" : "failed"}`);
    }

    // STEP 3: EXECUTE DELETES via tree:structure
    let deleteCount = 0;
    for (const del of deletes) {
      if (rt.aborted) break;

      const node = await Node.findById(del.nodeId).select("_id name children").lean();
      if (!node) {
        console.warn(`Skipping delete, node ${del.nodeId} no longer exists`);
        continue;
      }

      const { parsed: delData } = await rt.runStep("tree:structure", {
        prompt: `Delete node ${del.nodeId} ("${del.nodeName}"). It is empty and misplaced. Reason: ${del.reason}`,
        modeCtx: { targetNodeId: del.nodeId },
        input: `Delete "${del.nodeName}"`,
        treeContext: (data) => ({ targetNodeId: del.nodeId, stepResult: data ? "success" : "failed" }),
      });

      if (delData) deleteCount++;
      console.log(`  Deleted "${del.nodeName}": ${delData ? "success" : "failed"}`);
    }

    rt.setResult(`Reorganized: ${moveCount} moved, ${deleteCount} deleted`, "cleanup-reorg:complete");
    console.log(`Cleanup reorganize complete: ${moveCount} moved, ${deleteCount} deleted`);
    return { success: true, moves: moveCount, deletes: deleteCount, sessionId: rt.sessionId };
  } catch (err) {
    console.error(`Cleanup reorganize error for tree ${rootId}:`, err.message);
    rt.setError(err.message, "cleanup-reorg:complete");
    return { success: false, error: err.message, sessionId: rt.sessionId };
  } finally {
    await rt.cleanup();
  }
}
