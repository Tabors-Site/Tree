// SubPlan: per-node list of direct branch children with statuses.
//
// Self-similar: a project root has subPlan.branches listing level-1
// branches. Each level-1 branch's own metadata.swarm.subPlan lists its
// level-2 children. Recursive — each level plans for itself.
//
// Branch status lifecycle:
//   pending  — seeded, not yet dispatched
//   running  — dispatched, LLM work in progress
//   paused   — was running when the session aborted (disconnect, timeout,
//              signal). The resume detector treats these as ready to retry;
//              partial work is preserved.
//   done     — completed successfully
//   failed   — LLM error, unrecoverable. One automatic retry; second
//              failure is sticky.
//
// detectResumableSwarm treats pending, paused, and failed as resumable;
// done is skipped.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { NS, readMeta, mutateMeta } from "./meta.js";

/**
 * Read the subPlan for a given node. Returns the subPlan object or null.
 * Null means the node has no decomposition (a leaf executor).
 */
export async function readSubPlan(nodeId) {
  if (!nodeId) return null;
  try {
    const n = await Node.findById(nodeId).select("metadata").lean();
    if (!n) return null;
    const meta = readMeta(n);
    return meta?.subPlan || null;
  } catch {
    return null;
  }
}

/**
 * Upsert a single child entry on a PARENT's subPlan. Matches by `name`.
 * Partial updates merge over the existing entry. Used by the swarm runner
 * to record when each child starts, finishes, fails, retries.
 */
export async function upsertSubPlanEntry({ parentNodeId, child, core }) {
  if (!parentNodeId || !child?.name) return null;
  return mutateMeta(parentNodeId, (draft) => {
    if (!draft.subPlan) draft.subPlan = { branches: [], createdAt: new Date().toISOString() };
    if (!Array.isArray(draft.subPlan.branches)) draft.subPlan.branches = [];
    const idx = draft.subPlan.branches.findIndex((b) => b.name === child.name);
    if (idx === -1) {
      draft.subPlan.branches.push({
        retries: 0,
        status: "pending",
        startedAt: null,
        finishedAt: null,
        summary: null,
        error: null,
        ...child,
      });
    } else {
      draft.subPlan.branches[idx] = { ...draft.subPlan.branches[idx], ...child };
    }
    draft.subPlan.updatedAt = new Date().toISOString();
    return draft;
  }, core);
}

/**
 * Initialize (or re-initialize) a node as a swarm project root with a
 * systemSpec. Called by the swarm runner when the architect produces the
 * top-level task. Sets role=project, creates empty subPlan / inbox /
 * events / aggregatedDetail structures if absent.
 */
export async function initProjectPlan({ projectNodeId, systemSpec, core }) {
  return mutateMeta(projectNodeId, (draft) => {
    draft.role = "project";
    draft.initialized = true;
    draft.systemSpec = systemSpec || draft.systemSpec || null;
    if (!draft.subPlan) draft.subPlan = { branches: [], createdAt: new Date().toISOString() };
    if (!draft.aggregatedDetail) {
      draft.aggregatedDetail = {
        filesWritten: 0,
        contracts: [],
        statusCounts: { done: 0, running: 0, pending: 0, failed: 0 },
        lastActivity: null,
      };
    }
    if (!Array.isArray(draft.inbox)) draft.inbox = [];
    if (!Array.isArray(draft.events)) draft.events = [];
    return draft;
  }, core);
}

/**
 * Stamp a node with role=branch and the branch spec. Called when the
 * swarm creates a child under a project to host the branch session.
 */
export async function initBranchNode({ branchNodeId, name, spec, path, core }) {
  return mutateMeta(branchNodeId, (draft) => {
    draft.role = "branch";
    draft.branchName = name || draft.branchName || null;
    if (spec != null) draft.spec = spec;
    if (path != null) draft.path = path;
    if (!draft.status) draft.status = "pending";
    return draft;
  }, core);
}

/**
 * Stamp a node's status/summary/finishedAt in one atomic write.
 */
export async function setBranchStatus({ branchNodeId, status, summary, error, core }) {
  if (!branchNodeId) return;
  return mutateMeta(branchNodeId, (draft) => {
    if (status != null) draft.status = status;
    if (summary !== undefined) draft.summary = summary;
    if (error !== undefined) draft.error = error;
    draft.finishedAt = new Date().toISOString();
    return draft;
  }, core);
}
