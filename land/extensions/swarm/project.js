// Project/branch tree-walk primitives. Swarm-native. Finds the nearest
// swarm project by walking ancestors for metadata.swarm.role === "project",
// and enumerates resumable branches for pickup detection.

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { readMeta, mutateMeta, initProjectRole } from "./state/meta.js";
import { plan } from "./state/planAccess.js";

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
 * After a resume pass completes, walk a project's branch tree bottom up
 * and promote any parent whose children are all done to status=done.
 * Keeps ancestor status honest without per write sync. Reads branch
 * kind steps from the unified plan.
 */
export async function promoteDoneAncestors({ projectNodeId, core }) {
  if (!projectNodeId) return;
  try {
    const p = await plan();
    const visit = async (nodeId) => {
      const node = await Node.findById(nodeId).select("_id name metadata").lean();
      if (!node) return { status: null, name: null };
      const meta = readMeta(node);
      const planObj = await p.readPlan(nodeId);
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
        const childResult = await visit(childId);
        childStatuses.push(childResult.status || entry.status || "pending");

        if (childResult.status && childResult.status !== (entry.status || "pending")) {
          const p = await plan();
          await p.upsertBranchStep(
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

    await visit(projectNodeId);
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
    const p = await plan();
    const topPlan = await p.readPlan(projectNodeId);
    const topBranches = (topPlan?.steps || []).filter((s) => s.kind === "branch");
    if (topBranches.length === 0) return null;

    const resumable = [];
    const doneCount = { count: 0 };
    const totalCount = { count: 0 };
    const statusCounts = { pending: 0, running: 0, paused: 0, failed: 0, done: 0 };

    // Visited set + sub-plan resolver. The previous implementation used
    // p.readPlan(entryNodeId) for both the recursion target and the
    // sub-plan probe. readPlan walks UP the tree (ancestor-fallback)
    // when the node has no plan-type child of its own, returning the
    // GOVERNING plan — which for a leaf branch is the parent's plan,
    // containing the SAME branches we just iterated. That re-iterated
    // those branches as if they were sub-branches, recursed into each
    // one, and re-entered the same plan again. Exponential explosion;
    // 4GB in seconds; the OOM the user hit on every "continue" against
    // a project with done branches.
    //
    // Fix: track visited node ids so we don't revisit, AND use a
    // direct probe for OWN sub-plans (Node.findOne for a plan-type
    // child) instead of readPlan's ancestor-fallback. A branch only
    // has a sub-plan if it owns a plan-type direct child; readPlan
    // returning anything else means there is no sub-plan.
    const visitedNodes = new Set();

    const ownSubPlan = async (nodeId) => {
      if (!nodeId) return null;
      // Direct probe: a node's OWN sub-plan is a plan-type child of
      // that node. No ancestor fallback. If none exists, return null.
      const planChild = await Node.findOne({
        parent: nodeId,
        type: "plan",
      }).select("_id").lean();
      if (!planChild) return null;
      return p.readPlan(planChild._id);
    };

    const visit = async (parentNodeId, parentBranchName, depth) => {
      const idStr = String(parentNodeId);
      if (visitedNodes.has(idStr)) return;
      visitedNodes.add(idStr);
      // Paranoia depth cap (Pass 1 nesting is depth 1; 16 is well over).
      if (depth > 16) return;

      // The TOP of the walk uses readPlan because the project root
      // legitimately doesn't have a plan-type child of its own — its
      // plan IS the readPlan result via case-2 of findGoverningPlan
      // (project node has plan-type child). For nested calls, we use
      // ownSubPlan so we don't fall back to ancestor plans.
      const parentPlan = depth === 0
        ? await p.readPlan(parentNodeId)
        : await ownSubPlan(parentNodeId);
      const branches = (parentPlan?.steps || []).filter((s) => s.kind === "branch");
      if (branches.length === 0) return;

      for (const entry of branches) {
        totalCount.count++;
        const status = entry.status || "pending";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        const entryNodeId = entry.childNodeId || null;

        if (status === "done") {
          doneCount.count++;
          if (entryNodeId) {
            await visit(entryNodeId, entry.title, depth + 1);
          }
          continue;
        }

        // Peek at this entry's own plan (direct sub-plan only, not the
        // ancestor fallback). If its decomposition ran and produced
        // done children, descend to pick up the non-done ones.
        let hasDoneChildren = false;
        if (entryNodeId) {
          const childPlan = await ownSubPlan(entryNodeId);
          const childBranches = (childPlan?.steps || []).filter((s) => s.kind === "branch");
          if (childBranches.length > 0) {
            hasDoneChildren = childBranches.some((c) => c.status === "done");
          }
        }

        if (hasDoneChildren) {
          if (entryNodeId) await visit(entryNodeId, entry.title, depth + 1);
          continue;
        }

        resumable.push({
          name: entry.title,
          nodeId: entryNodeId,
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
 * metadata.swarm.role = "project" + initialized = true, stamps swarm
 * execution bookkeeping (aggregatedDetail, inbox, events), and
 * initializes the plan namespace via the plan extension. Fires
 * `swarm:afterProjectInit` so domain extensions can do their own init.
 * Idempotent — safe to call when the project already exists.
 */
export async function ensureProject({ rootId, systemSpec, owner, core, fireHook }) {
  if (!rootId) return null;
  const existing = await Node.findById(rootId).select("_id name metadata").lean();
  if (!existing) return null;

  await initProjectRole({ nodeId: rootId, systemSpec: systemSpec || null, core });
  const p = await plan();
  await p.initPlan(rootId, { systemSpec: systemSpec || null }, core);

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
