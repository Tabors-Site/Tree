// Project/branch tree-walk primitives. Swarm-native. Finds the nearest
// swarm project by walking ancestors for metadata.swarm.role === "project",
// and enumerates resumable branches for pickup detection.

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { readMeta, mutateMeta } from "./state/meta.js";
import { upsertSubPlanEntry } from "./state/subPlan.js";

/**
 * Walk upward from any node, return the nearest swarm project (role=project
 * + initialized). Null if none found before hitting root.
 */
export async function findProjectForNode(nodeId) {
  let cursor = String(nodeId || "");
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id name parent metadata").lean();
    if (!n) return null;
    const meta = readMeta(n);
    if (meta?.role === "project" && meta?.initialized) return n;
    if (!n.parent) return null;
    cursor = String(n.parent);
    guard++;
  }
  return null;
}

/**
 * Walk upward, return { projectNode, branchNode } where branchNode is
 * the nearest ancestor with role=branch (may be null if the node lies
 * directly under the project root).
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
    if (meta?.role === "project" && meta?.initialized) {
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
 * After a resume pass completes, walk a project's subPlan bottom-up and
 * promote any parent whose children are all done to status=done. Keeps
 * ancestor status honest without per-write sync.
 */
export async function promoteDoneAncestors({ projectNodeId, core }) {
  if (!projectNodeId) return;
  try {
    const visit = async (nodeId) => {
      const node = await Node.findById(nodeId).select("_id name metadata").lean();
      if (!node) return { status: null, name: null };
      const meta = readMeta(node);
      const subPlan = meta?.subPlan;

      if (!subPlan || !Array.isArray(subPlan.branches) || subPlan.branches.length === 0) {
        return { status: meta?.status || null, name: node.name };
      }

      const childStatuses = [];
      for (const entry of subPlan.branches) {
        if (!entry.nodeId) {
          childStatuses.push(entry.status || "pending");
          continue;
        }
        const childResult = await visit(entry.nodeId);
        childStatuses.push(childResult.status || entry.status || "pending");

        if (childResult.status && childResult.status !== (entry.status || "pending")) {
          await upsertSubPlanEntry({
            parentNodeId: nodeId,
            core,
            child: { name: entry.name, status: childResult.status },
          });
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

    await visit(projectNodeId);
  } catch (err) {
    log.warn("Swarm", `promoteDoneAncestors failed: ${err.message}`);
  }
}

/**
 * Walk the project's subPlan (and recursively nested subPlans) for any
 * branches NOT done. Returns a flat list of resumable branch specs.
 *
 * Null when there's no masterPlan/subPlan (fresh project). { resumable: [],
 * total: N } when every branch is done.
 *
 * Decomposition-aware: if a non-done entry has done children, we descend
 * to resume only those non-done children — never re-run a parent whose
 * decomposition already produced done work (which would duplicate it).
 */
export async function detectResumableSwarm(projectNodeId) {
  if (!projectNodeId) return null;
  try {
    const project = await Node.findById(projectNodeId).select("_id name metadata").lean();
    if (!project) return null;
    const meta = readMeta(project);
    const topSubPlan = meta?.subPlan;
    if (!topSubPlan || !Array.isArray(topSubPlan.branches) || topSubPlan.branches.length === 0) {
      return null;
    }

    const resumable = [];
    const doneCount = { count: 0 };
    const totalCount = { count: 0 };
    const statusCounts = { pending: 0, running: 0, paused: 0, failed: 0, done: 0 };

    const visit = async (parentNodeId, parentBranchName, depth) => {
      const parentNode = await Node.findById(parentNodeId).select("_id metadata").lean();
      const parentMeta = readMeta(parentNode);
      const subPlan = parentMeta?.subPlan;
      if (!subPlan || !Array.isArray(subPlan.branches)) return;

      for (const entry of subPlan.branches) {
        totalCount.count++;
        const status = entry.status || "pending";
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        if (status === "done") {
          doneCount.count++;
          if (entry.nodeId) {
            await visit(entry.nodeId, entry.name, depth + 1);
          }
          continue;
        }

        // Peek at this entry's own subPlan. If its decomposition ran
        // and produced done children, descend to pick up the non-done
        // ones; don't add the parent (re-running duplicates done work).
        let hasDoneChildren = false;
        if (entry.nodeId) {
          const childNode = await Node.findById(entry.nodeId).select("metadata").lean();
          const childMeta = readMeta(childNode);
          const childBranches = childMeta?.subPlan?.branches;
          if (Array.isArray(childBranches) && childBranches.length > 0) {
            hasDoneChildren = childBranches.some((c) => c.status === "done");
          }
        }

        if (hasDoneChildren) {
          if (entry.nodeId) {
            await visit(entry.nodeId, entry.name, depth + 1);
          }
          continue;
        }

        resumable.push({
          name: entry.name,
          nodeId: entry.nodeId || null,
          spec: entry.spec,
          path: entry.path || null,
          files: entry.files || [],
          slot: entry.slot || null,
          mode: entry.mode || null,
          parentBranch: parentBranchName,
          depth,
          priorStatus: status,
          priorError: entry.error || null,
          retries: entry.retries || 0,
        });
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

/**
 * Ensure `rootId` is initialized as a swarm project. Sets
 * metadata.swarm.role = "project" + initialized = true, creates empty
 * subPlan/events/inbox if absent, fires `swarm:afterProjectInit` so
 * domain extensions can do their own init (e.g., code-workspace creates
 * the filesystem workspace directory). Idempotent — safe to call when
 * the project already exists.
 */
export async function ensureProject({ rootId, systemSpec, owner, core, fireHook }) {
  if (!rootId) return null;
  const existing = await Node.findById(rootId).select("_id name metadata").lean();
  if (!existing) return null;

  const { initProjectPlan } = await import("./state/subPlan.js");
  await initProjectPlan({ projectNodeId: rootId, systemSpec: systemSpec || null, core });

  const projectNode = await Node.findById(rootId).select("_id name metadata").lean();
  if (typeof fireHook === "function") {
    try {
      await fireHook("swarm:afterProjectInit", {
        projectNode,
        owner: owner || null,
        systemSpec: systemSpec || null,
      });
    } catch (err) {
      log.warn("Swarm", `afterProjectInit listener error: ${err.message}`);
    }
  }
  return projectNode;
}
