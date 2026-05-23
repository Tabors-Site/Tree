// Cached lookup for governing's plan primitives. Phase F absorbed the
// plan extension into governing; swarm uses readPlan, ensurePlanAtScope,
// findGoverningPlan, etc. via getExtension("governing").
//
// Throws when governing isn't loaded since swarm depends on it.

let _cache = null;

export async function plan() {
  if (_cache) return _cache;
  try {
    const { getExtension } = await import("../../loader.js");
    const ext = getExtension("governing");
    if (!ext?.exports) {
      throw new Error("governing extension not loaded; swarm requires governing");
    }
    _cache = ext.exports;
    return _cache;
  } catch (err) {
    throw new Error(`governing extension lookup failed: ${err.message}`);
  }
}

/**
 * Update a branch node's own swarm execution bookkeeping (status,
 * summary, error). Status tracking on the parent plan moved to the
 * active execution-record's stepStatuses (Phase E).
 */
export async function setBranchStatus({ branchNodeId, status, summary, error, core }) {
  if (!branchNodeId) return;
  const { setNodeStatus } = await import("./meta.js");
  await setNodeStatus({ nodeId: branchNodeId, status, summary, error, core });
}
