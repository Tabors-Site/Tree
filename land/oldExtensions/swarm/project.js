// Branch / Ruler tree-walk primitives. Swarm-native mechanism helpers.
// The "project role" is gone; swarm is mechanism only and governing
// owns coordination. findBranchContext walks for the nearest Ruler
// (metadata.governing.role === "ruler") instead of the legacy project
// marker. detectResumableSwarm and promoteDoneAncestors continue to do
// branch-mechanism work and accept a scope nodeId argument that may
// be any node where dispatch happened.

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { readMeta, mutateMeta } from "./state/meta.js";
import { plan } from "./state/planAccess.js";
import { dualWriteBranchStep } from "./state/dualWriteStatus.js";

/**
 * Read governing metadata directly without a getExtension hop. The
 * walks below need to recognize Ruler scopes; importing governing
 * here would create a circular dependency at module load. Reading the
 * raw metadata namespace gives us the role marker without coupling.
 */
function readGoverningRole(node) {
  const meta = node.metadata instanceof Map
    ? node.metadata.get("governing")
    : node.metadata?.["governing"];
  return meta?.role || null;
}

/**
 * Walk upward, return { projectNode, branchNode } where projectNode is
 * the nearest Ruler scope ancestor (or self) and branchNode is the
 * nearest ancestor with role=branch (may be null if the node lies
 * directly under the Ruler scope).
 *
 * Field name `projectNode` is kept for caller back-compat while the
 * code-workspace migration to "scope" vocabulary catches up.
 */
export async function findBranchContext(nodeId) {
  let cursor = String(nodeId || "");
  let guard = 0;
  let branch = null;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id name parent metadata").lean();
    if (!n) return null;
    const meta = readMeta(n);
    if (!branch && meta?.role === "branch") branch = n;
    if (readGoverningRole(n) === "ruler") {
      return { projectNode: n, branchNode: branch };
    }
    if (!n.parent) return null;
    cursor = String(n.parent);
    guard++;
  }
  return null;
}

/**
 * Return the sibling branches of a given branch node — direct children of
 * the parent that carry role=branch. Used for lateral signalling.
 */
export async function findBranchSiblings(branchNodeId) {
  if (!branchNodeId) return [];
  const me = await Node.findById(branchNodeId).select("_id parent name").lean();
  if (!me?.parent) return [];
  const parent = await Node.findById(me.parent).select("children").lean();
  if (!parent?.children?.length) return [];
  const siblings = await Node.find({
    _id: { $in: parent.children, $ne: me._id },
  }).select("_id name metadata").lean();
  return siblings.filter((n) => {
    const m = readMeta(n);
    return m?.role === "branch";
  });
}

/**
 * After a resume pass completes, walk a project's branch tree bottom up
 * and promote any parent whose children are all done to status=done.
 * Keeps ancestor status honest without per write sync. Reads branch
 * kind steps from the unified plan.
 */
export async function promoteDoneAncestors({ projectNodeId, core }) {
  if (!projectNodeId) return;
  try {
    const p = await plan();

    // SAME ANTI-PATTERN as the previous OOM in detectResumableSwarm.
    // readPlan(leafBranchId) walks UP via ancestor fallback when the
    // branch has no plan-type child of its own, returning the GOVERNING
    // plan — which IS the parent plan we're already iterating. The
    // recursion saw "branch X has children" (the same X we just visited)
    // and re-entered, exponentially. This function fires AFTER all
    // branches finish (only post-completion code path), which is exactly
    // when the user reports "server crashes after the plan is done."
    //
    // Fix: ownSubPlan probes for a node's OWN plan-type child without
    // ancestor fallback. A leaf branch with no sub-plan returns null,
    // and recursion stops. Visited-set guard catches any residual cycle.
    const visited = new Set();
    const ownSubPlan = async (nodeId) => {
      const planChild = await Node.findOne({
        parent: nodeId,
        type: "plan",
      }).select("_id").lean();
      if (!planChild) return null;
      return p.readPlan(planChild._id);
    };

    const visit = async (nodeId, depth = 0) => {
      const idStr = String(nodeId || "");
      if (!idStr || visited.has(idStr)) return { status: null, name: null };
      visited.add(idStr);
      // Paranoia depth cap (Pass 1 nesting is depth 1; 16 is well over).
      if (depth > 16) return { status: null, name: null };

      const node = await Node.findById(nodeId).select("_id name metadata").lean();
      if (!node) return { status: null, name: null };
      const meta = readMeta(node);
      // Top of the walk reads the governing plan via readPlan (case-2
      // resolves a node's own plan-type child). Nested calls use the
      // direct probe — never fall back to an ancestor's plan.
      const planObj = depth === 0
        ? await p.readPlan(nodeId)
        : await ownSubPlan(nodeId);
      const branches = (planObj?.steps || []).filter((s) => s.kind === "branch");

      if (branches.length === 0) {
        return { status: meta?.status || null, name: node.name };
      }

      const childStatuses = [];
      for (const entry of branches) {
        const childId = entry.childNodeId || null;
        if (!childId) {
          childStatuses.push(entry.status || "pending");
          continue;
        }
        const childResult = await visit(childId, depth + 1);
        childStatuses.push(childResult.status || entry.status || "pending");

        if (childResult.status && childResult.status !== (entry.status || "pending")) {
          await dualWriteBranchStep(
            nodeId,
            { name: entry.title, nodeId: childId, status: childResult.status },
            core,
          );
        }
      }

      const allDone = childStatuses.every((s) => s === "done");
      const currentStatus = meta?.status || "pending";

      if (allDone && currentStatus !== "done" && meta?.role === "branch") {
        await mutateMeta(nodeId, (draft) => {
          draft.status = "done";
          draft.summary = draft.summary || `All ${childStatuses.length} sub-branches completed.`;
          draft.finishedAt = new Date().toISOString();
          delete draft.error;
          return draft;
        }, core);
        return { status: "done", name: node.name };
      }

      return { status: currentStatus, name: node.name };
    };

    await visit(projectNodeId, 0);
  } catch (err) {
    log.warn("Swarm", `promoteDoneAncestors failed: ${err.message}`);
  }
}

/**
 * Walk the project's branch kind plan steps (and recursively nested
 * plans) for any branches NOT done. Returns a flat list of resumable
 * branch specs.
 *
 * Null when there's no plan yet (fresh project). { resumable: [],
 * total: N } when every branch is done.
 *
 * Decomposition aware: if a non done entry has done children, we
 * descend to resume only those non done children. Never re run a
 * parent whose decomposition already produced done work.
 */
export async function detectResumableSwarm(projectNodeId) {
  if (!projectNodeId) return null;
  try {
    const project = await Node.findById(projectNodeId).select("_id name metadata").lean();
    if (!project) return null;
    const meta = readMeta(project);

    // Resume detection reads from the active execution-record under
    // the Ruler scope's execution-node. Each Ruler holds its own
    // record; recursion descends into sub-Ruler scopes by following
    // the childNodeId on each branch entry. No legacy steps[] read,
    // no ancestor fallback.
    const { getExtension } = await import("../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.readActiveExecutionRecord) return null;

    const topRecord = await governing.readActiveExecutionRecord(projectNodeId);
    if (!topRecord) return null;
    const topBranchSteps = (topRecord.stepStatuses || []).filter((s) => s?.type === "branch");
    if (topBranchSteps.length === 0) return null;

    const resumable = [];
    const doneCount = { count: 0 };
    const totalCount = { count: 0 };
    const statusCounts = {
      pending: 0, running: 0, paused: 0,
      failed: 0, done: 0, advanced: 0, skipped: 0,
      cancelled: 0, superseded: 0,
    };
    // Statuses that are settled-with-progress: don't resume, but
    // descend into children to see if any of THEIR work is pending.
    // done = work completed; advanced = Foreman override (settled);
    // skipped = bypassed (settled).
    const SETTLED_WITH_PROGRESS = new Set(["done", "advanced", "skipped"]);
    // Terminal statuses that are NOT resumable AND have no children
    // worth descending into. "cancelled" is a deliberate stop —
    // resuming it would betray operator intent. "superseded" means a
    // newer emission replaced this one — the active emission's
    // resumable list is what matters, not this record's.
    const TERMINAL_NOT_RESUMABLE = new Set(["cancelled", "superseded"]);

    // Visited set guards against cycles in the descent. Each Ruler
    // scope has its own execution-record; we walk into a sub-Ruler
    // by reading its active record (not its parent's).
    const visitedNodes = new Set();

    const visit = async (rulerScopeId, parentBranchName, depth) => {
      const idStr = String(rulerScopeId);
      if (visitedNodes.has(idStr)) return;
      visitedNodes.add(idStr);
      if (depth > 16) return;

      const record = await governing.readActiveExecutionRecord(rulerScopeId);
      if (!record) return;
      const branchSteps = (record.stepStatuses || []).filter((s) => s?.type === "branch");
      if (branchSteps.length === 0) return;

      for (const step of branchSteps) {
        const entries = Array.isArray(step.branches) ? step.branches : [];
        for (const entry of entries) {
          totalCount.count++;
          const status = entry.status || "pending";
          statusCounts[status] = (statusCounts[status] || 0) + 1;
          const entryNodeId = entry.childNodeId || null;

          // Settled-with-progress: don't resume the branch itself
          // (its work is settled), but descend into its sub-Ruler
          // children to find any pending work below. doneCount is
          // success-only so reporting metrics stay honest; advanced
          // and skipped don't bump it.
          if (SETTLED_WITH_PROGRESS.has(status)) {
            if (status === "done") doneCount.count++;
            if (entryNodeId) await visit(entryNodeId, entry.name, depth + 1);
            continue;
          }

          // Terminal-not-resumable branches stay in place; we don't
          // descend into them and we don't add them to the resumable
          // list. Cancelled work is a deliberate stop; superseded
          // work belongs to a replaced emission.
          if (TERMINAL_NOT_RESUMABLE.has(status)) continue;

          // If the sub-Ruler has its own execution-record with done
          // children, descend so we resume only the non-done ones.
          let hasDoneChildren = false;
          if (entryNodeId) {
            const childRecord = await governing.readActiveExecutionRecord(entryNodeId);
            const childBranchSteps = (childRecord?.stepStatuses || []).filter((s) => s?.type === "branch");
            if (childBranchSteps.length > 0) {
              hasDoneChildren = childBranchSteps.some((cs) =>
                (cs.branches || []).some((b) => b.status === "done"),
              );
            }
          }

          if (hasDoneChildren) {
            if (entryNodeId) await visit(entryNodeId, entry.name, depth + 1);
            continue;
          }

          resumable.push({
            name: entry.name,
            nodeId: entryNodeId,
            spec: entry.spec,
            // path/files/slot/mode are swarm-era artifacts the
            // structured emission drops; default null/empty so
            // runBranchSwarm's defaults apply.
            path: null,
            files: [],
            slot: null,
            mode: null,
            parentBranch: parentBranchName,
            depth,
            priorStatus: status,
            priorError: entry.error || null,
            retries: entry.retries || 0,
          });
        }
      }
    };

    await visit(projectNodeId, null, 0);

    if (totalCount.count === 0) return null;
    return {
      projectNodeId: String(projectNodeId),
      projectName: project.name,
      systemSpec: meta?.systemSpec || null,
      resumable,
      total: totalCount.count,
      doneCount: doneCount.count,
      statusCounts,
      lastActivity: meta?.aggregatedDetail?.lastActivity || null,
    };
  } catch (err) {
    log.warn("Swarm", `detectResumableSwarm failed: ${err.message}`);
    return null;
  }
}

// ensureProject removed (legacy). The work it did splits cleanly:
//   - Role: governing.promoteToRuler (called from runRulerCycle entry).
//   - Mechanism bookkeeping: ensureScopeBookkeeping, called from
//     swarm.runBranchSwarm at dispatch time.
//   - Plan initialization: plan.ensurePlanAtScope, called by
//     governing.setContracts and other plan-touching paths.
// Callers should reach for governing primitives + plan extension API
// instead of asking swarm to "ensure a project."
