// Low-level metadata helpers for the swarm namespace.
//
// All swarm state lives under metadata.swarm on the owning node. Domain
// extensions (code-workspace, research-workspace, etc.) write to their
// own namespaces for domain-specific concerns (filesystem paths,
// validators, plan drift). Swarm never touches those namespaces and they
// never touch swarm.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { setExtMeta as kernelSetExtMeta, readNs } from "../../../seed/tree/extensionMetadata.js";

export const NS = "swarm";

// Namespace-bound read helper. Thin wrapper over the kernel's readNs
// so callers still write readMeta(node) without carrying the NS
// everywhere. Removes the pattern of every extension duplicating the
// same Map-vs-object check locally.
export function readMeta(node) {
  return readNs(node, NS);
}

/**
 * Read current swarm metadata on a node, apply a mutator to a draft,
 * write back via setExtMeta (unscoped kernel import). The `core` arg is
 * ignored for the write: swarm state is swarm-owned no matter who
 * triggered the call, and the loader's per-extension scoping wrapper
 * would reject the write when a caller from another extension (e.g.
 * code-workspace firing afterNote) passes its own scoped core. Using
 * the kernel's unscoped setExtMeta bypasses the callerExtName check,
 * keeps the afterMetadataWrite hook, keeps the cache invalidation, and
 * remains atomic.
 */
export async function mutateMeta(nodeId, mutator, _core) {
  if (!nodeId || typeof mutator !== "function") return null;
  try {
    const node = await Node.findById(nodeId);
    if (!node) return null;
    const current = readMeta(node) || {};
    const draft = { ...current };
    const out = mutator(draft) || draft;
    await kernelSetExtMeta(node, NS, out);
    return out;
  } catch (err) {
    log.warn("Swarm", `mutateMeta ${nodeId} failed: ${err.message}`);
    return null;
  }
}

/**
 * Write a branch's `childSummary` onto its swarm metadata. Called by
 * the code-workspace summary-refresh helper whenever a material
 * change happens in the branch's subtree (file writes, signal
 * appends, contract updates, completion). The summary is the parent-
 * view representation of this child — what Pass 2 courts and Pass 3
 * reputation read when evaluating the subtree.
 *
 * Idempotent. Replaces the previous summary wholesale. Callers don't
 * need to merge — summary generation is deterministic over current
 * state.
 */
export async function setSummary({ nodeId, summary, core }) {
  if (!nodeId || !summary || typeof summary !== "object") return null;
  return mutateMeta(nodeId, (draft) => {
    draft.summary = summary;
    // Loop guard. The afterMetadataWrite hook in code-workspace
    // refreshes child summaries on swarm-namespace writes, which
    // INCLUDES summary writes themselves. Without this flag the
    // hook would fire a summary write → afterMetadataWrite →
    // refresh → summary write → ... loop. The debounce in
    // refreshChildSummary catches it after one hop, but each hop
    // costs two findById queries; setting this flag short-circuits
    // the hook before any work happens. Same pattern as plan's
    // _propagated for recomputeRollup.
    draft._summaryRefresh = true;
    return draft;
  }, core);
}

/**
 * Mark a node as a swarm PROJECT. Sets role=project, initialized=true,
 * stamps systemSpec (if provided), ensures execution bookkeeping
 * fields exist (aggregatedDetail, inbox, events). Plan state — steps,
 * archivedPlans, contracts, ledger, budget — lives in metadata.plan,
 * owned by the plan extension; this function does NOT touch any of it.
 */
export async function initProjectRole({ nodeId, systemSpec, core }) {
  return mutateMeta(nodeId, (draft) => {
    draft.role = "project";
    draft.initialized = true;
    if (systemSpec != null) draft.systemSpec = systemSpec || draft.systemSpec || null;
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
    if (!draft.createdAt) draft.createdAt = new Date().toISOString();
    return draft;
  }, core);
}

/**
 * Mark a node as a swarm BRANCH. Sets role=branch, stamps the branch's
 * execution fields (parentProjectId, parentBranch, spec, path, files,
 * slot, mode), initializes aggregatedDetail and inbox. Does NOT touch
 * plan data.
 */
export async function initBranchRole({ nodeId, name, spec, path, files, slot, mode, parentProjectId, parentBranch, core }) {
  return mutateMeta(nodeId, (draft) => {
    draft.role = "branch";
    draft.branchName = name || draft.branchName || null;
    if (spec != null) draft.spec = spec;
    if (path != null) draft.path = path;
    if (files != null) draft.files = files;
    if (slot != null) draft.slot = slot;
    if (mode != null) draft.mode = mode;
    if (parentProjectId) draft.parentProjectId = String(parentProjectId);
    if (parentBranch !== undefined) draft.parentBranch = parentBranch;
    if (!draft.status) draft.status = "pending";
    if (!draft.aggregatedDetail) {
      draft.aggregatedDetail = {
        filesWritten: 0,
        contracts: [],
        statusCounts: { done: 0, running: 0, pending: 0, failed: 0 },
        lastActivity: null,
      };
    }
    if (!Array.isArray(draft.inbox)) draft.inbox = [];
    if (!draft.createdAt) draft.createdAt = new Date().toISOString();
    return draft;
  }, core);
}

/**
 * Stamp a node's execution status / summary / error / finishedAt.
 * Used after a branch session ends to update the node's own swarm
 * metadata. The PARENT's plan is updated separately via the plan
 * extension's setBranchStepStatus.
 */
export async function setNodeStatus({ nodeId, status, summary, error, core }) {
  if (!nodeId) return;
  return mutateMeta(nodeId, (draft) => {
    if (status != null) draft.status = status;
    if (summary !== undefined) draft.summary = summary;
    if (error !== undefined) draft.error = error;
    draft.finishedAt = new Date().toISOString();
    return draft;
  }, core);
}
