// Branch step status writer.
//
// Phase E reduced this to a governing-only writer. Earlier phases
// dual-wrote to the legacy metadata.plan.steps[] array on the
// plan-type node; that field is gone. Status changes now land
// exclusively on the active execution-record's stepStatuses[] under
// the Ruler's execution-node, via governing.updateStepStatusByBranchName.
//
// The function name is preserved (not "dualWrite" anymore, but
// rename ripples across 9 call sites in swarm.js + project.js;
// keeping the existing name avoids unnecessary churn). Phase F or a
// separate pass can rename to writeBranchStepStatus if desired.
//
// Signature mirrors the original plan.upsertBranchStep so call sites
// kept the same `(rootPlanNodeId, branchData, core)` shape.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

/**
 * Resolve the Ruler scope from a plan-type node id. The plan-type
 * node is a child of the Ruler scope by construction. Returns the
 * parent id or null.
 */
async function resolveRulerFromPlan(rootPlanNodeId) {
  if (!rootPlanNodeId) return null;
  const planNode = await Node.findById(rootPlanNodeId).select("_id parent type").lean();
  if (!planNode) return null;
  return planNode.parent ? String(planNode.parent) : null;
}

/**
 * Map the legacy upsertBranchStep payload onto the execution-record's
 * stepStatus update shape. startedAt auto-stamps the first time a
 * branch flips to "running"; updateStepStatus's partial-merge keeps
 * existing fields when the same call updates a different field.
 */
function buildRecordUpdates(branchData) {
  if (!branchData || typeof branchData !== "object") return null;
  const updates = {};
  if (typeof branchData.status === "string") updates.status = branchData.status;
  if (branchData.nodeId) updates.childNodeId = String(branchData.nodeId);
  if (typeof branchData.retries === "number") updates.retries = branchData.retries;
  if (branchData.error) updates.error = String(branchData.error).slice(0, 500);
  if (branchData.finishedAt) updates.completedAt = branchData.finishedAt;
  if (branchData.summary) updates.summary = String(branchData.summary).slice(0, 500);
  if (branchData.pausedAt) updates.pausedAt = branchData.pausedAt;
  if (branchData.abortReason) updates.abortReason = String(branchData.abortReason).slice(0, 500);
  if (branchData.blockedReason) updates.blockedReason = String(branchData.blockedReason).slice(0, 500);
  if (updates.status === "running") updates.startedAt = updates.startedAt || new Date().toISOString();
  return updates;
}

/**
 * Write a branch step status update to the active execution-record at
 * the Ruler scope hosting the plan-type node. Returns the updated
 * execution payload, or null if no record/branch matches.
 *
 * Failures are logged but do NOT throw — phase B's policy of "status
 * writes are best-effort, never block dispatch" is preserved. The
 * Foreman's reasoning surface (Pass 2) will plug into the same call
 * site if we later want strict-fail semantics.
 */
export async function dualWriteBranchStep(rootPlanNodeId, branchData, _core) {
  if (!branchData?.name) return null;
  try {
    const rulerNodeId = await resolveRulerFromPlan(rootPlanNodeId);
    if (!rulerNodeId) return null;

    const { getExtension } = await import("../../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.updateStepStatusByBranchName) return null;

    const updates = buildRecordUpdates(branchData);
    if (!updates) return null;

    return await governing.updateStepStatusByBranchName({
      rulerNodeId,
      branchName: branchData.name,
      updates,
    });
  } catch (err) {
    log.warn("Swarm/branchStepStatus", `execution-record write failed at ${String(rootPlanNodeId).slice(0, 8)}: ${err.message}`);
    return null;
  }
}
