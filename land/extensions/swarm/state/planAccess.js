// Cached lookup for the plan extension's api. Swarm code calls
// `await plan()` and uses the returned object's functions (setSteps,
// addStep, updateStep, archivePlan, upsertBranchStep, etc.).
//
// Centralizing the lookup keeps the cross-extension boundary visible
// and gives us one place to switch implementations later if needed.
// Throws when the plan extension isn't installed since swarm declares
// it as a hard dependency in the manifest.

let _cache = null;

export async function plan() {
  if (_cache) return _cache;
  try {
    const { getExtension } = await import("../../loader.js");
    const ext = getExtension("plan");
    if (!ext?.exports) {
      throw new Error("plan extension not loaded; swarm requires plan");
    }
    _cache = ext.exports;
    return _cache;
  } catch (err) {
    throw new Error(`plan extension lookup failed: ${err.message}`);
  }
}

/**
 * Backwards-compatible wrapper around plan.upsertBranchStep. Earlier
 * swarm code called this local helper before the upsert semantics
 * got promoted into the plan extension itself. Kept thin so any
 * older caller still works, but new call sites should go through
 * `(await plan()).upsertBranchStep(...)` directly.
 */
export async function upsertBranchStep({ parentNodeId, branch, core }) {
  const p = await plan();
  return p.upsertBranchStep(parentNodeId, branch, core);
}

/**
 * Single helper that writes BOTH sides of a branch status transition:
 *   1. The branch node's own swarm execution bookkeeping (status,
 *      summary, error, finishedAt at metadata.swarm on the branch).
 *   2. The parent project's plan step that tracks this branch (via
 *      plan.setBranchStepStatus).
 *
 * This is the only call site that needs to reach into two namespaces
 * on two different nodes at once; keeping it in swarm is correct
 * (the plan extension owns plan.setBranchStepStatus, swarm owns its
 * own role bookkeeping, this helper coordinates them).
 */
export async function setBranchStatus({ branchNodeId, status, summary, error, core }) {
  if (!branchNodeId) return;
  // Resolve the parent project from the branch's swarm metadata.
  const Node = (await import("../../../seed/models/node.js")).default;
  const branch = await Node.findById(branchNodeId).select("metadata").lean();
  const swMeta = branch?.metadata instanceof Map
    ? branch.metadata.get("swarm")
    : branch?.metadata?.swarm;
  const parentNodeId = swMeta?.parentProjectId
    || (await Node.findById(branchNodeId).select("parent").lean())?.parent;

  // Update the branch node's own swarm fields.
  const { setNodeStatus } = await import("./meta.js");
  await setNodeStatus({ nodeId: branchNodeId, status, summary, error, core });

  // Update the parent's plan step that points at this branch.
  if (parentNodeId) {
    const p = await plan();
    await p.setBranchStepStatus({
      parentNodeId: String(parentNodeId),
      childNodeId: branchNodeId,
      status,
      summary,
      error,
      core,
    });
  }
}
