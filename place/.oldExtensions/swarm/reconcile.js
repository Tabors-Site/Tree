// Tree-authoritative reconciliation against the active execution-record.
//
// The structured plan emission is immutable; the execution-record's
// stepStatuses are the mutable runtime ledger. Reconciliation walks
// the active execution-record under each Ruler scope (and recursively
// into sub-Ruler scopes) and detects drift between branch entries'
// childNodeId references and the actual tree state:
//
//   - childNodeId points at a node that no longer exists → mark the
//     entry status "blocked" with reason "child node missing in tree".
//     Caller (dispatch / resume) can surface this and re-create the
//     child via a fresh sub-Ruler dispatch under the current emission.
//
//   - childNodeId points at a renamed node → currently no fix; the
//     structured emission's name is canonical, the tree's mismatch is
//     a manual edit the user owns. Logged as info.
//
// Architectural shift from the pre-Phase-E version: legacy reconcile
// rewrote metadata.plan.steps[] from tree state every dispatch. With
// structured emission as the source of truth, reconcile only patches
// status on the runtime ledger; it never rewrites the plan.

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";

/**
 * Reconcile the active execution-record(s) at and below a scope.
 *
 * Accepts a Ruler scope id (or a node that walks up to one). Walks
 * the active execution-record's branch entries, checks each
 * childNodeId against the tree, and patches stepStatus when nodes
 * are missing. Recurses into sub-Ruler scopes.
 *
 * Idempotent: only writes when something changed. Returns
 * { blocked, scanned } for caller diagnostics.
 */
export async function reconcileProject({ projectNodeId, core: _core }) {
  if (!projectNodeId) return { blocked: 0, scanned: 0 };

  let governing = null;
  try {
    const { getExtension } = await import("../loader.js");
    governing = getExtension("governing")?.exports;
  } catch {}
  if (!governing?.findRulerScope || !governing?.readActiveExecutionRecord || !governing?.updateStepStatus) {
    return { blocked: 0, scanned: 0 };
  }

  const totals = { blocked: 0, scanned: 0 };
  const visited = new Set();

  const reconcileRuler = async (scopeId, depth) => {
    if (depth > 16) return;
    const idStr = String(scopeId);
    if (visited.has(idStr)) return;
    visited.add(idStr);

    const ruler = await governing.findRulerScope(scopeId);
    if (!ruler) return;
    const record = await governing.readActiveExecutionRecord(ruler._id);
    if (!record?._recordNodeId) return;

    const recurseScopes = [];
    for (const step of (record.stepStatuses || [])) {
      if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
      for (const entry of step.branches) {
        totals.scanned++;
        if (!entry?.childNodeId) continue;
        // Already terminal? Don't bother checking the tree.
        // "cancelled" is terminal — operator deliberately stopped this
        // work; reconcile must NOT reap it as stale or treat it as
        // recoverable. Same family as failed/blocked/done from the
        // reconciler's perspective: a settled state.
        if (entry.status === "blocked"
          || entry.status === "failed"
          || entry.status === "done"
          || entry.status === "cancelled") {
          recurseScopes.push(entry.childNodeId);
          continue;
        }
        const child = await Node.findById(entry.childNodeId).select("_id name").lean();
        if (!child) {
          // Tree node gone — entry references a dangling id.
          await governing.updateStepStatus({
            recordNodeId: record._recordNodeId,
            stepIndex: step.stepIndex,
            branchName: entry.name,
            updates: {
              status: "blocked",
              blockedReason: "child node missing in tree",
              completedAt: new Date().toISOString(),
            },
          });
          totals.blocked++;
          log.info("Swarm",
            `🪦 reconcile: branch "${entry.name}" at ruler ${String(ruler._id).slice(0, 8)} — ` +
            `childNodeId ${String(entry.childNodeId).slice(0, 8)} missing in tree; status → blocked`);
          continue;
        }
        if (child.name && entry.name && String(child.name).toLowerCase() !== String(entry.name).toLowerCase()) {
          log.info("Swarm",
            `reconcile: branch "${entry.name}" at ruler ${String(ruler._id).slice(0, 8)} — ` +
            `tree node renamed to "${child.name}" (manual edit; structured emission keeps original name)`);
        }
        recurseScopes.push(entry.childNodeId);
      }
    }

    // Recurse into each child Ruler's own execution-record.
    for (const childScopeId of recurseScopes) {
      await reconcileRuler(childScopeId, depth + 1);
    }
  };

  try {
    await reconcileRuler(projectNodeId, 0);
  } catch (err) {
    log.warn("Swarm", `reconcileProject ${String(projectNodeId).slice(0, 8)} failed: ${err.message}`);
  }
  return totals;
}
