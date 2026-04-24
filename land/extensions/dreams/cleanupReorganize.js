// orchestrators/pipelines/cleanupReorganize.js
// Analyzes tree structure and moves misplaced nodes / removes empty misplaced nodes.
// Pipeline: analyze (tool-less) -> execute moves via tree:structure -> execute deletes via tree:structure.

import log from "../../seed/log.js";
import { OrchestratorRuntime, LLM_PRIORITY } from "../../seed/orchestrators/runtime.js";
import { SESSION_TYPES } from "../../seed/ws/sessionRegistry.js";
import { buildDeepTreeSummary } from "../../seed/tree/treeFetch.js";
import Node from "../../seed/models/node.js";

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
    // Tree-scoped reorg lane — chains across reorganization passes.
    scope: "tree",
    purpose: "cleanup-reorganize",
    sessionType: SESSION_TYPES.CLEANUP_REORGANIZE,
    description: `Cleanup reorganize: ${rootId}`,
    modeKeyForLlm: "tree:cleanup-analyze",
    source,
    lockNamespace: "cleanup-reorg",
    llmPriority: LLM_PRIORITY.BACKGROUND,
  });

  const initialized = await rt.init();
  if (!initialized) {
 log.verbose("Dreams", `Cleanup reorganize already running for tree ${rootId}, skipping`);
    return { success: false, error: "already running", sessionId: null };
  }

 log.verbose("Dreams", `Cleanup reorganize started for tree ${rootId}`);

  try {
    // STEP 1: ANALYZE TREE STRUCTURE
    let encodingMap = null;
    try {
      const { getExtension } = await import("../loader.js");
      const uExt = getExtension("understanding");
      if (uExt?.exports?.getEncodingMap) encodingMap = await uExt.exports.getEncodingMap(rootId);
    } catch {}
    const treeSummary = await buildDeepTreeSummary(rootId, {
      includeIds: true,
      encodingMap,
    });

    const { parsed: plan } = await rt.runStep("tree:cleanup-analyze", {
      prompt: "Analyze this tree for misplaced or empty nodes that should be moved or removed.",
      modeCtx: { treeSummary },
      input: "tree analysis",
    });

    if (!plan) {
 log.error("Dreams", "Cleanup reorganize: analysis returned invalid JSON");
      rt.setResult("Analysis failed, invalid JSON", "cleanup-reorg:complete");
      return { success: false, error: "analysis failed", sessionId: rt.sessionId };
    }

    const moves = (plan.moves || []).slice(0, MAX_MOVES);
    const deletes = (plan.deletes || []).slice(0, MAX_DELETES);

    if (moves.length === 0 && deletes.length === 0) {
 log.debug("Dreams", "Tree is well-organized, no changes needed");
      rt.setResult("Tree is well-organized", "cleanup-reorg:complete");
      return { success: true, moves: 0, deletes: 0, sessionId: rt.sessionId };
    }

 log.debug("Dreams", `Plan: ${moves.length} move(s), ${deletes.length} delete(s)`);

    // STEP 2: EXECUTE MOVES via tree:structure
    let moveCount = 0;
    for (const move of moves) {
      if (rt.aborted) break;

      const node = await Node.findById(move.nodeId).select("_id name").lean();
      if (!node) {
 log.warn("Dreams", `Skipping move, node ${move.nodeId} no longer exists`);
        continue;
      }

      const { parsed: moveData } = await rt.runStep("tree:structure", {
        prompt: `Move node ${move.nodeId} ("${move.nodeName}") to this parent node. Reason: ${move.reason}`,
        modeCtx: { targetNodeId: move.newParentId },
        input: `Move "${move.nodeName}" to ${move.newParentId}`,
        treeContext: (data) => ({ targetNodeId: move.newParentId, stepResult: data ? "success" : "failed" }),
      });

      if (moveData) moveCount++;
 log.debug("Dreams", `Moved "${move.nodeName}": ${moveData ? "success" : "failed"}`);
    }

    // STEP 3: EXECUTE DELETES via tree:structure
    let deleteCount = 0;
    for (const del of deletes) {
      if (rt.aborted) break;

      const node = await Node.findById(del.nodeId).select("_id name children").lean();
      if (!node) {
 log.warn("Dreams", `Skipping delete, node ${del.nodeId} no longer exists`);
        continue;
      }

      const { parsed: delData } = await rt.runStep("tree:structure", {
        prompt: `Delete node ${del.nodeId} ("${del.nodeName}"). It is empty and misplaced. Reason: ${del.reason}`,
        modeCtx: { targetNodeId: del.nodeId },
        input: `Delete "${del.nodeName}"`,
        treeContext: (data) => ({ targetNodeId: del.nodeId, stepResult: data ? "success" : "failed" }),
      });

      if (delData) deleteCount++;
 log.debug("Dreams", `Deleted "${del.nodeName}": ${delData ? "success" : "failed"}`);
    }

    rt.setResult(`Reorganized: ${moveCount} moved, ${deleteCount} deleted`, "cleanup-reorg:complete");
 log.verbose("Dreams", `Cleanup reorganize complete: ${moveCount} moved, ${deleteCount} deleted`);
    return { success: true, moves: moveCount, deletes: deleteCount, sessionId: rt.sessionId };
  } catch (err) {
 log.error("Dreams", `Cleanup reorganize error for tree ${rootId}:`, err.message);
    rt.setError(err.message, "cleanup-reorg:complete");
    return { success: false, error: err.message, sessionId: rt.sessionId };
  } finally {
    await rt.cleanup();
  }
}
