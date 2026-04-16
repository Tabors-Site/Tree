/**
 * Distributed swarm state.
 *
 * Self-similar: every swarm-owned node (project root AND branch AND sub-branch)
 * carries the same shape in metadata["code-workspace"]:
 *
 *   {
 *     role: "project" | "branch",
 *     systemSpec: "what this level is expected to produce",
 *     subPlan: {
 *       branches: [ { name, nodeId, status, summary, ... }, ... ]
 *     },
 *     aggregatedDetail: {
 *       filesWritten: int,
 *       contracts: [ "POST /api/login", "JWT middleware" ],
 *       statusCounts: { done, running, pending, failed },
 *       lastActivity: ISO,
 *     },
 *     signalInbox: [
 *       { from, at, kind, payload }  // lateral signals from siblings
 *     ],
 *     status: "pending" | "running" | "done" | "failed",
 *   }
 *
 * The root's subPlan lists level-1 branches. Each level-1 branch's subPlan
 * lists its level-2 children. Etc. Recursive. Plan.md at any level renders
 * that level's view of its own sub-tree.
 *
 * Aggregation flows UP via rollUpDetail: when a leaf writes a file, we
 * walk the parent chain and merge the delta into each ancestor's
 * aggregatedDetail. By the time it reaches root, every ancestor has the
 * rolled-up picture without any polling or re-read.
 *
 * Lateral signals flow through signalInbox: when a cascade reaches a
 * sibling, appendSignalInbox pushes onto that sibling's list. Next
 * session at that sibling reads it via enrichContext.
 *
 * swarmEvents[] remains on the project root as a cheap flat audit log for
 * the dashboard and plan.md projection. It's denormalized — the
 * authoritative per-level state lives at each level.
 */

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";

const NS = "code-workspace";
const MAX_EVENTS = 30;
const MAX_CONTRACTS_PER_LEVEL = 50;
const MAX_SIGNAL_INBOX = 30;

function readMeta(node) {
  if (!node?.metadata) return null;
  if (node.metadata instanceof Map) return node.metadata.get(NS) || null;
  return node.metadata[NS] || null;
}

/**
 * Generic namespace write. Reads current code-workspace metadata, applies
 * the mutator, writes back via setExtMeta (if available) or direct $set.
 * The mutator receives a mutable draft and can either return it or mutate
 * in place.
 */
async function mutateMeta(nodeId, mutator, core) {
  if (!nodeId || typeof mutator !== "function") return null;
  try {
    const node = await Node.findById(nodeId);
    if (!node) return null;
    const current = readMeta(node) || {};
    const draft = { ...current };
    const out = mutator(draft) || draft;
    if (core?.metadata?.setExtMeta) {
      await core.metadata.setExtMeta(node, NS, out);
    } else {
      await Node.updateOne(
        { _id: node._id },
        { $set: { [`metadata.${NS}`]: out } },
      );
    }
    return out;
  } catch (err) {
    log.warn("CodeWorkspace", `mutateMeta ${nodeId} failed: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// SUB-PLAN (per-level plan of direct children)
// ─────────────────────────────────────────────────────────────────────

/**
 * Read the subPlan for a given node. Returns the subPlan object or null.
 * `null` means this node has no decomposition (a leaf executor).
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
 * Branch status lifecycle:
 *
 *   pending  — seeded, not yet dispatched
 *   running  — dispatched, LLM work in progress
 *   paused   — was running when the session aborted (CLI disconnect,
 *              timeout, explicit signal). A resume-detector reads these
 *              and treats them as "ready to retry". The tree + files
 *              from partial work are preserved.
 *   done     — completed successfully
 *   failed   — LLM error, unrecoverable. A single retry pass happens
 *              automatically; second failure is sticky.
 *
 * The resume detector (detectResumableSwarm) considers pending, paused,
 * and failed branches as resumable; done is skipped.
 */

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
 * Initialize (or re-initialize) a node as a project root with a systemSpec.
 * Called by the swarm runner when the architect produces the top-level task.
 * Cascade gets enabled here — the project becomes a nervous-system root.
 */
export async function initProjectPlan({ projectNodeId, systemSpec, core }) {
  return mutateMeta(projectNodeId, (draft) => {
    // Keep existing role/initialized/workspacePath from code-workspace init
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
    if (!Array.isArray(draft.signalInbox)) draft.signalInbox = [];
    if (!draft.swarmEvents) draft.swarmEvents = [];
    return draft;
  }, core);
}

/**
 * Store the architect's declared contracts on the project root.
 * Called from swarm.js when parseContracts returns any entries. Lives
 * on the project node's metadata so every branch session inside the
 * project can read it via enrichContext without touching the parent
 * chain.
 *
 * Shape: array of { kind: 'message'|'type', name, fields: string[], raw }
 */
export async function setProjectContracts({ projectNodeId, contracts, core }) {
  if (!projectNodeId) return;
  return mutateMeta(projectNodeId, (draft) => {
    draft.declaredContracts = Array.isArray(contracts) ? contracts : [];
    draft.declaredContractsAt = new Date().toISOString();
    return draft;
  }, core);
}

/**
 * Read the declared contracts stored on a project node (or walks
 * upward to find the nearest project if given a non-project node).
 * Returns null when no contracts were declared for this project.
 */
export async function readProjectContracts(nodeId) {
  if (!nodeId) return null;
  // Find the project root containing this node.
  let cursor = String(nodeId);
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id parent metadata").lean();
    if (!n) return null;
    const meta = readMeta(n);
    if (meta?.role === "project") {
      return Array.isArray(meta.declaredContracts) && meta.declaredContracts.length > 0
        ? meta.declaredContracts
        : null;
    }
    if (!n.parent) return null;
    cursor = String(n.parent);
    guard++;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// NODE-LOCAL PLAN STEPS
// ─────────────────────────────────────────────────────────────────────
//
// Every workspace node can carry its own checklist under
// metadata["code-workspace"].subPlan.steps[]. Shape per step:
//
//   { id, title, status: "pending"|"done"|"blocked",
//     createdAt, completedAt?, blockedReason?, note? }
//
// Steps are self-similar: a project root can have high-level steps
// ("wire auth", "wire game loop"), a branch can have its own steps,
// a file node can too. Each scope plans for itself. Rollup counts
// of (pending/done/blocked) flow UP via rollUpDetail → every ancestor
// sees the aggregated state without walking the whole tree.
//
// LLM-free for mechanical state. An LLM only enters the plan loop
// when the AI at that node reads its own steps (injected via
// enrichContext) and decides to advance one or re-plan.

function makeStepId() {
  // Short random id — human-friendlier than a UUID in the model's
  // prompt, still collision-safe for per-node use (cap ~1000 steps).
  return `s_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v === "done" || v === "blocked" || v === "pending") return v;
  return "pending";
}

/**
 * Count the local steps on a single node (this node only, no rollup).
 * Returns { pending, done, blocked, total }.
 */
function countLocalSteps(meta) {
  const steps = meta?.subPlan?.steps;
  const counts = { pending: 0, done: 0, blocked: 0, total: 0 };
  if (!Array.isArray(steps)) return counts;
  for (const s of steps) {
    const st = normalizeStatus(s?.status);
    counts[st] = (counts[st] || 0) + 1;
    counts.total += 1;
  }
  return counts;
}

/**
 * Recompute this node's aggregatedDetail.stepCounts as:
 *   (own local step counts) + (sum of every direct child's aggregated
 *   stepCounts, which themselves already include their descendants).
 *
 * So a root's stepCounts is the total of its own plan + every step in
 * every subtree, all the way down. Pure read; writes via mutateMeta.
 *
 * Called after any local step mutation. Cheap: one shallow children
 * query + one parent walk up. No recursion into grandchildren because
 * each level's aggregate already includes its descendants.
 */
async function recomputeStepRollup(nodeId, core) {
  if (!nodeId) return null;
  const node = await Node.findById(nodeId).select("_id children metadata").lean();
  if (!node) return null;
  const selfMeta = readMeta(node);
  const selfCounts = countLocalSteps(selfMeta);

  const agg = { pending: selfCounts.pending, done: selfCounts.done, blocked: selfCounts.blocked };

  const childIds = Array.isArray(node.children) ? node.children : [];
  if (childIds.length > 0) {
    const children = await Node.find({ _id: { $in: childIds } }).select("metadata").lean();
    for (const c of children) {
      const cMeta = readMeta(c);
      const cAgg = cMeta?.aggregatedDetail?.stepCounts;
      if (cAgg) {
        agg.pending += cAgg.pending || 0;
        agg.done += cAgg.done || 0;
        agg.blocked += cAgg.blocked || 0;
      }
    }
  }

  await mutateMeta(nodeId, (draft) => {
    if (!draft.aggregatedDetail) {
      draft.aggregatedDetail = {
        filesWritten: 0,
        contracts: [],
        statusCounts: { done: 0, running: 0, pending: 0, failed: 0 },
        lastActivity: null,
      };
    }
    draft.aggregatedDetail.stepCounts = agg;
    return draft;
  }, core);

  return agg;
}

/**
 * Walk from a node upward, recomputing stepCounts at every ancestor.
 * Stops at the project root OR when it hits a node without code-workspace
 * metadata. Idempotent — always produces the true rolled-up state from
 * current leaves.
 */
async function rollUpStepCounts(fromNodeId, core) {
  if (!fromNodeId) return;
  let cursor = String(fromNodeId);
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id parent metadata").lean();
    if (!n) return;
    const meta = readMeta(n);
    // Only roll through workspace-managed nodes (project/branch/file)
    if (!meta) return;
    await recomputeStepRollup(cursor, core);
    if (meta.role === "project") return;
    if (!n.parent) return;
    cursor = String(n.parent);
    guard++;
  }
}

/**
 * Overwrite a node's plan steps. Accepts a raw step array (each entry
 * minimally needs `title`) and fills in id/status/createdAt defaults.
 * After write, rolls the counts up the ancestor chain.
 */
export async function setNodePlanSteps({ nodeId, steps, core }) {
  if (!nodeId || !Array.isArray(steps)) return null;
  const nowIso = new Date().toISOString();
  // Read the previous step count so we can decide whether the parent
  // should be marked drifted. A re-set with the same count is almost
  // always a re-plan with different titles, which is structural.
  const before = await Node.findById(nodeId).select("metadata").lean();
  const beforeCount = readMeta(before)?.subPlan?.steps?.length || 0;

  const normalized = steps.map((raw) => ({
    id: raw?.id || makeStepId(),
    title: String(raw?.title || "").trim() || "(untitled step)",
    status: normalizeStatus(raw?.status),
    createdAt: raw?.createdAt || nowIso,
    completedAt: raw?.status === "done" ? (raw?.completedAt || nowIso) : null,
    blockedReason: raw?.status === "blocked" ? (raw?.blockedReason || null) : null,
    note: raw?.note || null,
  }));
  const out = await mutateMeta(nodeId, (draft) => {
    if (!draft.subPlan) draft.subPlan = { branches: [], createdAt: nowIso };
    draft.subPlan.steps = normalized;
    draft.subPlan.updatedAt = nowIso;
    // Any plan mutation counts as acknowledgment — clear drift markers.
    draft.subPlan.driftAt = null;
    draft.subPlan.driftReason = null;
    return draft;
  }, core);
  await rollUpStepCounts(nodeId, core);

  const afterCount = normalized.length;
  const reason = beforeCount === 0
    ? `set plan (${afterCount} steps)`
    : `replanned ${beforeCount} → ${afterCount} steps`;
  await maybeDriftParentOnStructuralChange({ childNodeId: nodeId, reason, core });

  return out?.subPlan?.steps || null;
}

/**
 * Append a single step to a node's plan. Returns the new step.
 */
export async function addNodePlanStep({ nodeId, title, note, core }) {
  if (!nodeId || !title) return null;
  const nowIso = new Date().toISOString();
  const step = {
    id: makeStepId(),
    title: String(title).trim(),
    status: "pending",
    createdAt: nowIso,
    completedAt: null,
    blockedReason: null,
    note: note || null,
  };
  await mutateMeta(nodeId, (draft) => {
    if (!draft.subPlan) draft.subPlan = { branches: [], createdAt: nowIso };
    if (!Array.isArray(draft.subPlan.steps)) draft.subPlan.steps = [];
    draft.subPlan.steps.push(step);
    draft.subPlan.updatedAt = nowIso;
    draft.subPlan.driftAt = null;
    draft.subPlan.driftReason = null;
    return draft;
  }, core);
  await rollUpStepCounts(nodeId, core);
  await maybeDriftParentOnStructuralChange({
    childNodeId: nodeId,
    reason: `added step "${step.title.slice(0, 60)}"`,
    core,
  });
  return step;
}

/**
 * Patch a single step by id. `patch` may set status, blockedReason, note,
 * or title. `completedAt` is auto-managed when status flips to/from done.
 */
export async function updateNodePlanStep({ nodeId, stepId, patch, core }) {
  if (!nodeId || !stepId || !patch) return null;
  const nowIso = new Date().toISOString();
  let updated = null;
  await mutateMeta(nodeId, (draft) => {
    const steps = draft?.subPlan?.steps;
    if (!Array.isArray(steps)) return draft;
    const idx = steps.findIndex((s) => s.id === stepId);
    if (idx === -1) return draft;
    const before = steps[idx];
    const next = { ...before };
    if (patch.title != null) next.title = String(patch.title).trim();
    if (patch.note != null) next.note = patch.note || null;
    if (patch.status != null) {
      next.status = normalizeStatus(patch.status);
      if (next.status === "done" && before.status !== "done") {
        next.completedAt = nowIso;
      } else if (next.status !== "done") {
        next.completedAt = null;
      }
      if (next.status === "blocked") {
        next.blockedReason = patch.blockedReason || before.blockedReason || null;
      } else {
        next.blockedReason = null;
      }
    }
    steps[idx] = next;
    if (draft.subPlan) {
      draft.subPlan.updatedAt = nowIso;
      draft.subPlan.driftAt = null;
      draft.subPlan.driftReason = null;
    }
    updated = next;
    return draft;
  }, core);
  if (updated) await rollUpStepCounts(nodeId, core);
  return updated;
}

/**
 * Read a node's plan steps (local only, no rollup).
 */
export async function readNodePlanSteps(nodeId) {
  if (!nodeId) return null;
  const n = await Node.findById(nodeId).select("metadata").lean();
  if (!n) return null;
  const meta = readMeta(n);
  return meta?.subPlan?.steps || null;
}

/**
 * Read a node's rolled-up step counts: { pending, done, blocked } across
 * this node + all descendants. Cheap — reads the precomputed field.
 */
export async function readNodeStepRollup(nodeId) {
  if (!nodeId) return null;
  const n = await Node.findById(nodeId).select("metadata").lean();
  if (!n) return null;
  const meta = readMeta(n);
  return meta?.aggregatedDetail?.stepCounts || null;
}

/**
 * Drop all steps from a node's plan. Keeps subPlan.branches intact so
 * swarm decomposition isn't affected. Rolls counts up after clearing.
 */
export async function clearNodePlanSteps({ nodeId, core }) {
  if (!nodeId) return null;
  await mutateMeta(nodeId, (draft) => {
    if (draft?.subPlan?.steps) draft.subPlan.steps = [];
    if (draft.subPlan) draft.subPlan.updatedAt = new Date().toISOString();
    return draft;
  }, core);
  await rollUpStepCounts(nodeId, core);
  await maybeDriftParentOnStructuralChange({
    childNodeId: nodeId,
    reason: "cleared its plan",
    core,
  });
  return true;
}

/**
 * Mark a node's plan as potentially stale because something upstream
 * changed (a sibling's contract, a parent's spec, etc). Records a
 * timestamp + reason. Idempotent — repeated calls just update the
 * timestamp so the AI always sees the most recent drift cause.
 *
 * Drift is cleared automatically whenever the AI mutates its own plan
 * via setNodePlanSteps / addNodePlanStep / updateNodePlanStep. The
 * reasoning: if the AI is actively editing the plan, it has either
 * acknowledged the drift or replanned around it.
 */
export async function markPlanDrift({ nodeId, reason, core }) {
  if (!nodeId) return;
  const nowIso = new Date().toISOString();
  await mutateMeta(nodeId, (draft) => {
    if (!draft.subPlan) draft.subPlan = { branches: [], createdAt: nowIso };
    draft.subPlan.driftAt = nowIso;
    draft.subPlan.driftReason = reason || draft.subPlan.driftReason || "upstream change";
    return draft;
  }, core);
}

/**
 * Walk one level up from a node that just had its plan structurally
 * changed (set / add / clear), and mark the parent's plan as drifted
 * — but only if the parent has its own plan to invalidate. Nodes
 * without plans are skipped silently so a leaf write in an unplanned
 * subtree doesn't leave random drift markers lying around.
 *
 * Only fires on STRUCTURAL changes (steps added or removed), not on
 * status flips (check / block). Status changes are already visible
 * to parents via the rollup counts; they don't invalidate the
 * parent's own step titles. Structural changes mean the AI at the
 * parent should see "this child expanded — my breakdown may no
 * longer match reality."
 *
 * No recursion: markPlanDrift just writes a timestamp, it does not
 * call back into setNodePlanSteps, so there's no ripple. The parent
 * reads the drift marker the next time its own session naturally
 * runs — cheapest possible propagation.
 */
async function maybeDriftParentOnStructuralChange({ childNodeId, reason, core }) {
  if (!childNodeId) return;
  try {
    const child = await Node.findById(childNodeId).select("_id parent name").lean();
    if (!child?.parent) return;
    const parent = await Node.findById(child.parent).select("metadata").lean();
    if (!parent) return;
    const parentMeta = readMeta(parent);
    const parentHasPlan = Array.isArray(parentMeta?.subPlan?.steps) && parentMeta.subPlan.steps.length > 0;
    if (!parentHasPlan) return;
    await markPlanDrift({
      nodeId: child.parent,
      reason: `child "${child.name}" ${reason}`,
      core,
    });
  } catch (err) {
    log.debug("CodeWorkspace", `maybeDriftParent failed: ${err.message}`);
  }
}

async function clearPlanDrift(nodeId, core) {
  if (!nodeId) return;
  await mutateMeta(nodeId, (draft) => {
    if (draft?.subPlan) {
      draft.subPlan.driftAt = null;
      draft.subPlan.driftReason = null;
    }
    return draft;
  }, core);
}

/**
 * Read a node's drift metadata. Returns { driftAt, driftReason } or null
 * when there's no drift. Used by enrichContext to render a warning at
 * the top of the node's plan.
 */
export async function readPlanDrift(nodeId) {
  if (!nodeId) return null;
  const n = await Node.findById(nodeId).select("metadata").lean();
  if (!n) return null;
  const meta = readMeta(n);
  const sp = meta?.subPlan;
  if (!sp?.driftAt) return null;
  return { driftAt: sp.driftAt, driftReason: sp.driftReason || null };
}

/**
 * Render a node's plan (local steps + rolled-up descendant counts) as a
 * readable block for enrichContext injection.
 */
export function formatNodePlan({ steps, rollup, nodeName, drift }) {
  const lines = [];
  const header = nodeName ? `# Plan for ${nodeName}` : "# Plan";
  const local = Array.isArray(steps) ? steps : [];
  const done = local.filter((s) => s.status === "done").length;
  const blocked = local.filter((s) => s.status === "blocked").length;
  const pending = local.filter((s) => s.status === "pending").length;
  const total = local.length;

  lines.push(header);
  if (drift?.driftAt) {
    lines.push(
      `⚠ PLAN MAY BE STALE (upstream changed at ${drift.driftAt}` +
      `${drift.driftReason ? `: ${drift.driftReason}` : ""}). ` +
      `Verify your steps still match reality. Editing the plan ` +
      `(set / add / check) will clear this warning.`,
    );
  }
  if (total === 0) {
    lines.push("(no local plan yet — set one with workspace-plan action=set)");
  } else {
    lines.push(`${done}/${total} done${blocked ? `, ${blocked} blocked` : ""}${pending ? `, ${pending} pending` : ""}`);
    lines.push("");
    for (const s of local) {
      const mark = s.status === "done" ? "x" : s.status === "blocked" ? "!" : " ";
      let line = `[${mark}] ${s.title}`;
      if (s.status === "blocked" && s.blockedReason) {
        line += `  — BLOCKED: ${s.blockedReason}`;
      }
      line += `  (${s.id})`;
      lines.push(line);
    }
  }

  if (rollup && (rollup.pending || rollup.done || rollup.blocked)) {
    lines.push("");
    lines.push(
      `Including descendants: ${rollup.done || 0} done, ` +
      `${rollup.pending || 0} pending, ${rollup.blocked || 0} blocked`,
    );
  }
  return lines.join("\n");
}

/**
 * Auto-promote parent branches whose children are all done.
 *
 * When a resume run completes the last non-done child of a previously-
 * paused/failed parent, the parent itself should become done — the
 * "work under here is finished" signal. This walks a project's subPlan
 * bottom-up, promoting parent branches whose subPlans contain only
 * done children.
 *
 * Idempotent. Called after every runBranchSwarm pass.
 */
export async function promoteDoneAncestors({ projectNodeId, core }) {
  if (!projectNodeId) return;
  try {
    const visit = async (nodeId, parentUpdaters) => {
      const node = await Node.findById(nodeId).select("_id name metadata").lean();
      if (!node) return { status: null, name: null };
      const meta = readMeta(node);
      const subPlan = meta?.subPlan;

      if (!subPlan || !Array.isArray(subPlan.branches) || subPlan.branches.length === 0) {
        // Leaf branch: just return its own status
        return { status: meta?.status || null, name: node.name };
      }

      // Recurse into every child first (bottom-up)
      const childStatuses = [];
      for (const entry of subPlan.branches) {
        if (!entry.nodeId) {
          childStatuses.push(entry.status || "pending");
          continue;
        }
        const childResult = await visit(entry.nodeId);
        childStatuses.push(childResult.status || entry.status || "pending");

        // If the child's actual status differs from what's in the
        // parent's subPlan entry, sync the entry. Needed because a
        // recursive promotion might have just flipped the child.
        if (childResult.status && childResult.status !== (entry.status || "pending")) {
          await upsertSubPlanEntry({
            parentNodeId: nodeId,
            core,
            child: {
              name: entry.name,
              status: childResult.status,
            },
          });
        }
      }

      // Determine this node's promoted status based on children
      const allDone = childStatuses.every((s) => s === "done");
      const currentStatus = meta?.status || "pending";

      if (allDone && currentStatus !== "done" && meta?.role === "branch") {
        // Promote this branch to done on its own metadata
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
    log.warn("CodeWorkspace", `promoteDoneAncestors failed: ${err.message}`);
  }
}

/**
 * Walk a project root's subPlan (and recursively the subPlans on each
 * branch node) to find any branches that are NOT done. Returns a flat
 * list of resumable branch specs so the orchestrator can dispatch them
 * in a single runBranchSwarm call without touching already-done work.
 *
 * Returns null if the project has no masterPlan/subPlan at all (fresh
 * project, nothing to resume). Returns { resumable: [], total: N } if
 * every branch is done (all work complete, nothing to do).
 *
 * Each resumable entry has the shape runBranchSwarm expects as input:
 *   { name, spec, path, files, slot, parentBranch, priorStatus }
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

    /**
     * Depth-first walk. For each subPlan entry we decide: is THIS the
     * level to resume, or should we descend to find finer-grained work?
     *
     * Rules:
     *   - Done entry → skip, but descend (its children may be pending
     *     since a done parent means decomposition succeeded).
     *   - Non-done entry with NO children (no subPlan or empty) → add
     *     it to resumable. It's a leaf task.
     *   - Non-done entry WITH done children → its decomposition already
     *     ran at least partially. DON'T add the parent; descend and
     *     add only the non-done children. Re-running the parent would
     *     duplicate already-done work.
     *   - Non-done entry with only non-done children (nothing succeeded
     *     below it) → add the parent itself. Re-running it will
     *     re-decompose cleanly.
     *
     * This eliminates double-dispatch when a parent and its children
     * both show as non-done in their subPlans.
     */
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
          // Descend: done parent may still have pending children
          if (entry.nodeId) {
            await visit(entry.nodeId, entry.name, depth + 1);
          }
          continue;
        }

        // Peek at this entry's own subPlan to see if it has any done
        // children. If yes, decomposition already succeeded and we
        // should resume the non-done children, not the parent itself.
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
          // Don't add this parent; descend to pick up only its
          // non-done children. The parent's decomposition already ran.
          if (entry.nodeId) {
            await visit(entry.nodeId, entry.name, depth + 1);
          }
          continue;
        }

        // Leaf task OR parent whose decomposition never ran → resumable
        resumable.push({
          name: entry.name,
          nodeId: entry.nodeId || null,
          spec: entry.spec,
          path: entry.path || null,
          files: entry.files || [],
          slot: entry.slot || "code-plan",
          parentBranch: parentBranchName,
          depth,
          priorStatus: status,
          priorError: entry.error || null,
          retries: entry.retries || 0,
        });
        // Do NOT descend further here — running this entry will
        // re-decompose its own work via nested [[BRANCHES]] if needed.
        // Descending would double-queue any stored sub-branches.
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
    log.warn("CodeWorkspace", `detectResumableSwarm failed: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// AGGREGATED DETAIL (rolled up from descendants)
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk from a leaf node upward, merging a delta into every ancestor's
 * aggregatedDetail that has code-workspace metadata. Stops at the project
 * root (role=project) once reached.
 *
 * The delta shape mirrors aggregatedDetail:
 *   {
 *     filesWrittenDelta: +1,
 *     newContracts: ["POST /api/login"],
 *     statusDelta: { done: +1 } | null,
 *     lastActivity: ISO,
 *   }
 *
 * Every affected ancestor ends up with merged counts, deduplicated
 * contracts (capped), and the most recent activity timestamp.
 */
export async function rollUpDetail({ fromNodeId, delta, core, stopAtProject = true }) {
  if (!fromNodeId || !delta) return;
  let cursor = String(fromNodeId);
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id parent metadata").lean();
    if (!n) return;
    const meta = readMeta(n);
    if (meta && (meta.role === "branch" || meta.role === "project")) {
      // Update this ancestor's aggregated detail
      await mutateMeta(n._id, (draft) => {
        if (!draft.aggregatedDetail) {
          draft.aggregatedDetail = {
            filesWritten: 0,
            contracts: [],
            statusCounts: { done: 0, running: 0, pending: 0, failed: 0 },
            lastActivity: null,
          };
        }
        const agg = draft.aggregatedDetail;
        if (delta.filesWrittenDelta) {
          agg.filesWritten = (agg.filesWritten || 0) + delta.filesWrittenDelta;
        }
        if (Array.isArray(delta.newContracts) && delta.newContracts.length) {
          const existing = new Set(agg.contracts || []);
          for (const c of delta.newContracts) existing.add(String(c));
          agg.contracts = Array.from(existing).slice(-MAX_CONTRACTS_PER_LEVEL);
        }
        if (delta.statusDelta) {
          if (!agg.statusCounts) agg.statusCounts = { done: 0, running: 0, pending: 0, failed: 0 };
          for (const [k, v] of Object.entries(delta.statusDelta)) {
            agg.statusCounts[k] = (agg.statusCounts[k] || 0) + v;
          }
        }
        // Phase 5: probe verifications. Each successful workspace-probe
        // call stamps a map key `METHOD path` → { status, returnedFields,
        // lastVerifiedAt, probedBy }. Propagates up so the project root
        // ends up with a live "verified endpoints" map across branches.
        if (delta.verifiedEndpoint) {
          if (!agg.verifiedEndpoints) agg.verifiedEndpoints = {};
          const key = delta.verifiedEndpoint.key;
          const returnedFields = delta.verifiedEndpoint.returnedFields || [];
          // Filter out the preview proxy's static fallback. When a
          // project has no backend route for `/`, the preview spawner
          // serves `public/index.html` from disk via the static
          // fallback path, which returns 200 with HTML (zero
          // parseable JSON fields). Recording that as a "verified
          // endpoint" pollutes aggregatedDetail — the operator sees
          // `GET /` as "verified" when there's no GET / handler.
          // Real root endpoints return JSON with at least one field,
          // so filter on (key === "GET /" && returnedFields empty).
          const isStaticFallback = key === "GET /" && returnedFields.length === 0;
          if (key && !isStaticFallback) {
            agg.verifiedEndpoints[key] = {
              status: delta.verifiedEndpoint.status,
              returnedFields,
              lastVerifiedAt: delta.verifiedEndpoint.lastVerifiedAt,
              probedBy: delta.verifiedEndpoint.probedBy || null,
            };
            // Keep the map bounded — newest 80 verifications
            const keys = Object.keys(agg.verifiedEndpoints);
            if (keys.length > 80) {
              const sorted = keys
                .map((k) => [k, agg.verifiedEndpoints[k].lastVerifiedAt || ""])
                .sort((a, b) => b[1].localeCompare(a[1]))
                .slice(0, 80);
              const next = {};
              for (const [k] of sorted) next[k] = agg.verifiedEndpoints[k];
              agg.verifiedEndpoints = next;
            }
          }
        }
        if (delta.lastActivity) agg.lastActivity = delta.lastActivity;
        return draft;
      }, core);

      if (stopAtProject && meta.role === "project") return;
    }
    if (!n.parent) return;
    cursor = String(n.parent);
    guard++;
  }
}

/**
 * Read a node's own aggregatedDetail (not walked — just what's stored
 * on that specific node). Used by enrichContext.
 */
export async function readAggregatedDetail(nodeId) {
  if (!nodeId) return null;
  try {
    const n = await Node.findById(nodeId).select("metadata").lean();
    if (!n) return null;
    const meta = readMeta(n);
    return meta?.aggregatedDetail || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// CASCADED CONTEXT (lateral signals from siblings)
// ─────────────────────────────────────────────────────────────────────

/**
 * Append a signal onto a target node's inbox. Capped at MAX_SIGNAL_INBOX
 * (most recent wins). The next session that runs at that node picks it
 * up via enrichContext.
 */
export async function appendSignalInbox({ nodeId, signal, core }) {
  if (!nodeId || !signal) return;
  return mutateMeta(nodeId, (draft) => {
    if (!Array.isArray(draft.signalInbox)) draft.signalInbox = [];
    draft.signalInbox.push({
      at: signal.at || new Date().toISOString(),
      ...signal,
    });
    if (draft.signalInbox.length > MAX_SIGNAL_INBOX) {
      draft.signalInbox.splice(
        0,
        draft.signalInbox.length - MAX_SIGNAL_INBOX,
      );
    }
    return draft;
  }, core);
}

export async function readSignalInbox(nodeId) {
  if (!nodeId) return [];
  try {
    const n = await Node.findById(nodeId).select("metadata").lean();
    if (!n) return [];
    const meta = readMeta(n);
    return Array.isArray(meta?.signalInbox) ? meta.signalInbox : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// TREE WALK HELPERS
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk upward from nodeId looking for the nearest project (role=project)
 * AND the immediate branch ancestor. Returns { projectNode, branchNode }
 * where branchNode may be null if nodeId is the project itself or has no
 * branch ancestor (bare file under project root without a branch).
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
 * Walk upward from any node looking for the nearest project. Returns the
 * project node or null. Used by slot handlers, routes, and the swarm
 * orchestrator to resolve "what project am I inside?".
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
 * Return the direct children of a node that have code-workspace branch
 * metadata (i.e., the sub-branches of this level). Used for lateral
 * cascade fan-out — when a branch writes a contract, we find its
 * siblings and signal them.
 */
export async function findBranchSiblings(branchNodeId) {
  if (!branchNodeId) return [];
  const me = await Node.findById(branchNodeId).select("_id parent name").lean();
  if (!me?.parent) return [];
  const parent = await Node.findById(me.parent).select("children").lean();
  if (!parent?.children?.length) return [];
  const siblings = await Node.find({
    _id: { $in: parent.children },
    _id: { $ne: me._id },
  }).select("_id name metadata").lean();
  // Keep only those with branch role
  return siblings.filter((n) => {
    const m = readMeta(n);
    return m?.role === "branch";
  });
}

// ─────────────────────────────────────────────────────────────────────
// SWARM EVENTS (flat audit log on project root)
// ─────────────────────────────────────────────────────────────────────

/**
 * Derive a short one-line summary from a file write. Prior impl just
 * returned the first line matching a broad prefix list, which for
 * every backend file meant "import express from 'express'" — the top
 * import line — and the swarm event log showed 10 identical summaries
 * for 10 different edits. Useless.
 *
 * New approach: multi-tier scan. We walk every line, classify each,
 * and return the FIRST line at the HIGHEST-priority tier we see, not
 * just the top-down first match. Import statements always lose to
 * route declarations. Route declarations always lose to specific
 * writes. Class/function definitions win over re-exports.
 *
 * Priority tiers (higher wins):
 *   3: `app.<verb>(` / `router.<verb>(` — route declarations
 *   2: `export (default |async )?(function|class|const)` — new def
 *   1: `function X(` / `class X` / `const X =` / `module.exports`
 *   0: any meaningful non-skipped line
 *
 * Skipped: blank, `//` or `#` comments, bare `import`, bare
 * `export { ... }` re-exports, `"use strict"` directives.
 */
export function summarizeWrite(content) {
  if (!content || typeof content !== "string") return "";
  const lines = content.split("\n");
  let bestTier = -1;
  let bestLine = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("//") || line.startsWith("#")) continue;
    if (line === '"use strict";' || line === "'use strict';") continue;
    if (/^import\b/.test(line)) continue;
    if (/^export\s*\{/.test(line)) continue;
    if (/^export\s*\*/.test(line)) continue;

    let tier = 0;
    if (/^(app|router|server|httpServer|expressApp)\.(get|post|put|patch|delete|use|all)\s*\(/i.test(line)) {
      tier = 3;
    } else if (/^export\s+(default\s+)?(async\s+)?(function|class|const)\b/.test(line)) {
      tier = 2;
    } else if (/^(function|class|const|let|var|async\s+function|module\.exports)\b/.test(line)) {
      tier = 1;
    }

    if (tier > bestTier) {
      bestTier = tier;
      bestLine = line;
      if (tier === 3) break; // can't beat tier 3, stop early
    }
  }

  if (bestLine) return bestLine.slice(0, 140);
  // Fallback: return the first non-empty line (even if it was skipped
  // above) so every summary has SOMETHING.
  for (const raw of lines) {
    const line = raw.trim();
    if (line) return line.slice(0, 140);
  }
  return content.slice(0, 140);
}

/**
 * Append a swarm event onto the project root's flat audit log. Capped
 * at MAX_EVENTS (most recent wins).
 *
 * Debounces same-file/same-kind/same-actor events within a 5-second
 * window: if the LAST event on the log matches all three fields and
 * its `at` is less than 5s ago, the incoming event MERGES into it
 * (bumps `at`, increments `count`, updates `summary` if the new one
 * is higher-priority). This collapses the spam case where the user
 * hit "save" 10 times in 8 seconds into one event with count=10.
 */
const DEBOUNCE_MS = 5000;

export async function recordSwarmEvent({ projectNodeId, event, core }) {
  if (!projectNodeId || !event) return;
  return mutateMeta(projectNodeId, (draft) => {
    if (!Array.isArray(draft.swarmEvents)) draft.swarmEvents = [];
    const nowIso = event.at || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const last = draft.swarmEvents[draft.swarmEvents.length - 1];

    const sameKey =
      last &&
      last.filePath === event.filePath &&
      last.kind === event.kind &&
      (last.branchId || null) === (event.branchId || null);

    const lastMs = last?.at ? Date.parse(last.at) : 0;
    const withinWindow = sameKey && Number.isFinite(lastMs) && nowMs - lastMs < DEBOUNCE_MS;

    if (withinWindow) {
      // Merge into the tail event. Advance the timestamp, bump the
      // count, and promote the summary if the new one comes from a
      // higher-priority tier (route/class/const beats import).
      last.at = nowIso;
      last.count = (last.count || 1) + 1;
      if (event.summary && (!last.summary || summaryTier(event.summary) > summaryTier(last.summary))) {
        last.summary = event.summary;
      }
    } else {
      draft.swarmEvents.push({ ...event, at: nowIso, count: 1 });
      if (draft.swarmEvents.length > MAX_EVENTS) {
        draft.swarmEvents.splice(0, draft.swarmEvents.length - MAX_EVENTS);
      }
    }
    return draft;
  }, core);
}

/**
 * Rank a summary string by the same tier system as `summarizeWrite`
 * so the debouncer can decide which summary to keep when merging.
 * Higher = more informative.
 */
function summaryTier(summary) {
  if (!summary || typeof summary !== "string") return 0;
  const s = summary.trim();
  if (/^(app|router|server|httpServer|expressApp)\.(get|post|put|patch|delete|use|all)\s*\(/i.test(s)) return 3;
  if (/^export\s+(default\s+)?(async\s+)?(function|class|const)\b/.test(s)) return 2;
  if (/^(function|class|const|let|var|async\s+function|module\.exports)\b/.test(s)) return 1;
  return 0;
}

export async function readSwarmEvents(projectNodeId) {
  if (!projectNodeId) return [];
  try {
    const n = await Node.findById(projectNodeId).select("metadata").lean();
    if (!n) return [];
    const meta = readMeta(n);
    return Array.isArray(meta?.swarmEvents) ? meta.swarmEvents : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// CONTEXT FORMATTERS (for enrichContext)
// ─────────────────────────────────────────────────────────────────────

/**
 * Format aggregated detail from a single level into a one-block string.
 * Null if nothing interesting to show. Used for injecting "what's below
 * you" into a branch's system prompt.
 */
export function formatAggregatedDetail(agg, levelName) {
  if (!agg) return null;
  const parts = [];
  if (agg.filesWritten > 0) parts.push(`${agg.filesWritten} files written`);
  if (agg.statusCounts) {
    const sc = agg.statusCounts;
    const statusParts = [];
    if (sc.done) statusParts.push(`${sc.done} done`);
    if (sc.running) statusParts.push(`${sc.running} running`);
    if (sc.pending) statusParts.push(`${sc.pending} pending`);
    if (sc.failed) statusParts.push(`${sc.failed} failed`);
    if (statusParts.length) parts.push(statusParts.join(", "));
  }
  if (parts.length === 0 && (!agg.contracts || agg.contracts.length === 0)) return null;

  const header = levelName
    ? `Aggregated state under ${levelName}: ${parts.join(" · ")}`
    : `Aggregated state under this level: ${parts.join(" · ")}`;
  const lines = [header];
  if (Array.isArray(agg.contracts) && agg.contracts.length > 0) {
    lines.push("Established contracts (from sub-tree):");
    for (const c of agg.contracts.slice(-12)) {
      lines.push(`  · ${c}`);
    }
  }
  return lines.join("\n");
}

/**
 * Cascade signal kind enum. Documents the set of recognized kinds and
 * which renderer they use in formatSignalInbox. Adding a new kind
 * means: (a) add it here, (b) add a renderer branch in
 * formatSignalInbox, (c) emit it from the source extension.
 */
export const SIGNAL_KIND = Object.freeze({
  CONTRACT: "contract",                // backend wrote routes/exports → siblings see them
  SYNTAX_ERROR: "syntax-error",        // validator caught a parse failure
  CONTRACT_MISMATCH: "contract-mismatch", // phase 2: frontend fetch ≠ backend route
  RUNTIME_ERROR: "runtime-error",      // phase 3: server crashed on smoke spawn
  TEST_FAILURE: "test-failure",        // phase 4: behavioral test failed
  DEAD_RECEIVER: "dead-receiver",      // phase 4: read-but-never-assigned property
  PROBE_FAILURE: "probe-failure",      // phase 5: workspace-probe got a 4xx/5xx/error
});

/**
 * Format an array of signalInbox signals into a readable block for
 * enrichContext injection. Renders per-kind templates so each signal
 * type reads as a CORRECTION INSTRUCTION the model can act on, not as
 * "more context noise". Errors get the strongest framing — code blocks
 * with caret markers and explicit "rewrite line N" instructions.
 *
 * Recent-N policy: keep the last 12 signals across all kinds. Errors
 * are stickier than contract signals because they're more actionable;
 * the pruning logic in pruneSignalInboxForFile clears resolved
 * errors so they don't accumulate forever.
 */
export function formatSignalInbox(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  const recent = signals.slice(-12);

  // Bucket by kind so similar signals render as a group
  const errors = recent.filter((s) => s.kind === SIGNAL_KIND.SYNTAX_ERROR);
  const contracts = recent.filter((s) => s.kind === SIGNAL_KIND.CONTRACT);
  const mismatches = recent.filter((s) => s.kind === SIGNAL_KIND.CONTRACT_MISMATCH);
  const runtime = recent.filter((s) => s.kind === SIGNAL_KIND.RUNTIME_ERROR);
  const deadReceivers = recent.filter((s) => s.kind === SIGNAL_KIND.DEAD_RECEIVER);
  const testFailures = recent.filter((s) => s.kind === SIGNAL_KIND.TEST_FAILURE);
  const probeFailures = recent.filter((s) => s.kind === SIGNAL_KIND.PROBE_FAILURE);
  const other = recent.filter((s) =>
    ![SIGNAL_KIND.SYNTAX_ERROR, SIGNAL_KIND.CONTRACT, SIGNAL_KIND.CONTRACT_MISMATCH,
      SIGNAL_KIND.RUNTIME_ERROR, SIGNAL_KIND.DEAD_RECEIVER, SIGNAL_KIND.TEST_FAILURE,
      SIGNAL_KIND.PROBE_FAILURE].includes(s.kind),
  );

  const blocks = [];

  // ── Syntax errors: high-priority, structured, action-oriented ──
  if (errors.length > 0) {
    const errorBlocks = errors.map((s) => renderSyntaxError(s)).filter(Boolean);
    if (errorBlocks.length > 0) {
      blocks.push(
        "🔴 SYNTAX ERRORS in your previous writes — feedback from the validator. " +
        "Fix THESE specific issues by rewriting the affected lines, then continue.\n\n" +
        errorBlocks.join("\n\n"),
      );
    }
  }

  // ── Contract mismatches (cross-branch seam failures) ──
  if (mismatches.length > 0) {
    const mismatchBlocks = mismatches.map((s) => renderContractMismatch(s)).filter(Boolean);
    if (mismatchBlocks.length > 0) {
      blocks.push(
        "⚠️  CROSS-BRANCH SEAM MISMATCHES — the validator found places " +
        "where your branch's wire protocol doesn't agree with a sibling " +
        "branch's. Each entry below names the specific type or field that " +
        "doesn't match AND tells you exactly how to reconcile. Fix these " +
        "before doing anything else — the swarm has flipped the involved " +
        "branches to failed and will retry after this turn lands.\n\n" +
        mismatchBlocks.join("\n\n"),
      );
    }
  }

  // ── Runtime errors from smoke run: structured, file-pointing ──
  if (runtime.length > 0) {
    const runtimeBlocks = runtime.map((s) => renderRuntimeError(s)).filter(Boolean);
    if (runtimeBlocks.length > 0) {
      blocks.push(
        "💥 RUNTIME ERRORS from smoke spawn — the server crashed when the " +
        "validator tried to start it. Fix THESE specific issues, then the " +
        "branch will be smoke-tested again.\n\n" +
        runtimeBlocks.join("\n\n"),
      );
    }
  }

  // ── Dead receivers: properties read but never assigned ──
  if (deadReceivers.length > 0) {
    const drBlocks = deadReceivers.map((s) => renderDeadReceiver(s)).filter(Boolean);
    if (drBlocks.length > 0) {
      blocks.push(
        "👻 EMPTY-SHELL BUGS — the validator found object properties that " +
        "are read in many places but never get a real value assigned. The " +
        "code looks like it works (no parse errors, no crashes) but every " +
        "read returns null/empty. This is the bug that makes 'buttons not " +
        "work' silently. Fix by either populating the property where state " +
        "first becomes available, OR by gating the reads on a different " +
        "field that IS populated.\n\n" +
        drBlocks.join("\n\n"),
      );
    }
  }

  // ── Probe failures from workspace-probe ──
  if (probeFailures.length > 0) {
    const pfBlocks = probeFailures.map((s) => renderProbeFailure(s)).filter(Boolean);
    if (pfBlocks.length > 0) {
      blocks.push(
        "🔴 PROBE FAILURES — your workspace-probe call(s) hit endpoints " +
        "you wrote and got an error response. The bug is in YOUR code, not " +
        "the probe. Read the failing endpoint's handler, find the bug, fix " +
        "it, then re-probe to confirm.\n\n" +
        pfBlocks.join("\n\n"),
      );
    }
  }

  // ── Behavioral test failures ──
  if (testFailures.length > 0) {
    const tfBlocks = testFailures.map((s) => renderTestFailure(s)).filter(Boolean);
    if (tfBlocks.length > 0) {
      blocks.push(
        "🧪 BEHAVIORAL TEST FAILURES — your spec-driven test exercised the " +
        "built project and got a wrong answer. The test is in tests/spec.test.js. " +
        "Read the failure message, find the root cause in the application " +
        "code (not the test), and fix it. Then the test re-runs.\n\n" +
        tfBlocks.join("\n\n"),
      );
    }
  }

  // ── Contract signals (lateral sibling activity, informational) ──
  if (contracts.length > 0) {
    const lines = ["Recent activity from sibling branches (keep your work consistent):"];
    for (const s of contracts) {
      const time = s.at ? new Date(s.at).toISOString().slice(11, 19) : "";
      const from = s.from ? `[${s.from}]` : "[?]";
      lines.push(`  ${time} ${from} wrote ${s.filePath || "?"} — ${formatPayload(s.payload)}`);
    }
    blocks.push(lines.join("\n"));
  }

  // ── Other signals fall through to the legacy one-liner format ──
  if (other.length > 0) {
    const lines = ["Other signals:"];
    for (const s of other) {
      const time = s.at ? new Date(s.at).toISOString().slice(11, 19) : "";
      const from = s.from ? `[${s.from}]` : "[?]";
      lines.push(`  ${time} ${from} ${s.kind || "signal"} — ${formatPayload(s.payload)}`);
    }
    blocks.push(lines.join("\n"));
  }

  if (blocks.length === 0) return null;
  return blocks.join("\n\n");
}

/**
 * Render a single syntax-error signal as a multi-line, code-block,
 * caret-pointing correction instruction. The model sees this in its
 * system prompt and should immediately rewrite the offending line.
 *
 * Format:
 *
 *   📁 backend/routes.js  (line 47, column 34)
 *   SyntaxError: Unexpected token '(', expected ','
 *
 *   45 |   const router = express.Router();
 *   46 |
 * → 47 |   router.get('/profiles/swipeable' (req, res) => {
 *      |                                    ^
 *   48 |     res.json([]);
 *
 *   Fix: rewrite line 47 with correct syntax.
 */
function renderSyntaxError(signal) {
  const p = signal?.payload;
  if (!p || typeof p !== "object") return null;
  const file = p.file || signal.filePath || "(unknown file)";
  const line = p.line || "?";
  const column = p.column || "?";
  const message = p.message || "Syntax error";
  const context = p.context || "";

  return [
    `📁 ${file}  (line ${line}, column ${column})`,
    message,
    "",
    context,
    "",
    `Fix: rewrite line ${line} with correct syntax. The error is on YOUR previous write to this file. Use workspace-edit-file with lines ${line}-${line + 1} OR workspace-add-file to rewrite the whole file.`,
  ].join("\n");
}

/**
 * Render a single runtime-error signal from the smoke validator. Same
 * shape as syntax errors (because the underlying payload IS the same
 * shape from validators/smoke.js), but the framing tells the model this
 * came from a live spawn, not a parse check. The distinction matters
 * because a runtime error may be in a DIFFERENT file than the one the
 * branch most recently wrote — the stack trace points somewhere else.
 */
function renderRuntimeError(signal) {
  const p = signal?.payload;
  if (!p || typeof p !== "object") return null;
  const file = p.file || signal.filePath || "(unknown file)";
  const line = p.line || "?";
  const column = p.column || "?";
  const message = p.message || "Runtime error";
  const context = p.context || "";

  return [
    `📁 ${file}  (line ${line}, column ${column})`,
    message,
    "",
    context,
    "",
    `Fix: the server crashed on boot. The stack trace above points at ` +
    `${file}:${line}. Rewrite that location with workspace-edit-file ` +
    `(preferred: lines ${line}-${line + 1}) or workspace-add-file for the whole file.`,
  ].join("\n");
}

/**
 * Render a cross-branch contract mismatch. Different structure from
 * runtime errors because the "where" is split across branches: the URL
 * the frontend calls, the frontend source that calls it, and the fact
 * that the backend doesn't serve it. The operator decides which side
 * bends. The model should NOT auto-fix this — the framing says so.
 */
function renderContractMismatch(signal) {
  const p = signal?.payload;
  if (!p || typeof p !== "object") return null;

  // WS seam mismatch: { kind: 'unhandled-type'|'unreceived-type'|'unknown-field',
  //                     direction, type, field?, fromBranch, toBranch, evidence, message }
  if (
    p.kind === "unhandled-type" ||
    p.kind === "unreceived-type" ||
    p.kind === "unknown-field"
  ) {
    return renderWsSeamMismatch(p);
  }

  // Phase 2 field-level mismatch: { kind, key, contractKeys, contract, expectation }
  if (p.kind === "response-missing-key" || p.kind === "request-extra-key" || p.kind === "request-missing-key") {
    return renderFieldMismatch(p);
  }

  // Phase 3 integration mismatch: { url, status, reason, sources }
  const url = p.url || "(unknown)";
  const status = p.status != null ? p.status : "—";
  const reason = p.reason || "mismatch";
  const sources = Array.isArray(p.sources) ? p.sources : [];

  const lines = [
    `🔗 ${reason}`,
    `   Probed: GET ${url} → ${status}`,
  ];
  if (sources.length > 0) {
    lines.push(`   Called from:`);
    for (const s of sources.slice(0, 5)) {
      lines.push(`     • ${s.file}:${s.line || "?"}`);
    }
  }
  lines.push("");
  lines.push(
    `   Operator decision required: either the backend grows a route to ` +
    `match ${url}, or the frontend changes its fetch target. Do NOT guess.`,
  );
  return lines.join("\n");
}

/**
 * Render a WS seam mismatch from the static wsSeam validator.
 *
 * Three shapes:
 *   - unhandled-type: frontend sends a type the backend doesn't handle
 *   - unreceived-type: backend sends a type the frontend doesn't handle
 *   - unknown-field: frontend reads data.X inside a case for type T, but
 *                    backend's broadcast of T doesn't include X
 *
 * Each case gets a concrete "do this, not that" rewrite instruction so
 * the retrying branch AI has an actionable correction rather than a
 * diagnostic.
 */
function renderWsSeamMismatch(p) {
  const ev = p.evidence || {};
  const lines = [];
  if (p.kind === "unhandled-type") {
    lines.push(`🔗 WS: Frontend sends { type: "${p.type}" } but backend has no case for it.`);
    if (ev.clientFile && ev.clientLine) {
      lines.push(`   From: ${ev.clientFile}:${ev.clientLine} (${p.fromBranch})`);
    }
    if (Array.isArray(ev.backendHandles) && ev.backendHandles.length > 0) {
      lines.push(`   Backend handles: ${ev.backendHandles.slice(0, 8).join(", ")}${ev.backendHandles.length > 8 ? ", ..." : ""}`);
    }
    lines.push("");
    lines.push(
      `   Fix: either rename the frontend send to match an existing backend ` +
      `case, or add a new "case '${p.type}':" block in the backend's message ` +
      `switch that does whatever the frontend expects to happen.`,
    );
  } else if (p.kind === "unreceived-type") {
    lines.push(`🔗 WS: Backend broadcasts { type: "${p.type}" } but frontend has no case for it.`);
    if (ev.serverFile && ev.serverLine) {
      lines.push(`   From: ${ev.serverFile}:${ev.serverLine} (${p.fromBranch})`);
    }
    if (Array.isArray(ev.clientHandles) && ev.clientHandles.length > 0) {
      lines.push(`   Frontend handles: ${ev.clientHandles.slice(0, 8).join(", ")}${ev.clientHandles.length > 8 ? ", ..." : ""}`);
    }
    lines.push("");
    lines.push(
      `   Fix: either add a "case '${p.type}':" block in the frontend's ` +
      `onmessage switch, or rename the backend broadcast to match an ` +
      `existing frontend case.`,
    );
  } else if (p.kind === "unknown-field") {
    lines.push(`🔗 WS: Frontend reads data.${p.field} in handler for '${p.type}' but backend doesn't send that field.`);
    if (ev.clientFile && ev.clientLine) {
      lines.push(`   Read at: ${ev.clientFile}:${ev.clientLine} (${p.toBranch})`);
    }
    if (ev.serverFile && ev.serverLine) {
      lines.push(`   Backend sends at: ${ev.serverFile}:${ev.serverLine} (${p.fromBranch})`);
    }
    if (Array.isArray(ev.serverFields) && ev.serverFields.length > 0) {
      lines.push(`   Backend's '${p.type}' carries fields: ${ev.serverFields.slice(0, 10).join(", ")}${ev.serverFields.length > 10 ? ", ..." : ""}`);
    }
    lines.push("");
    lines.push(
      `   Fix: one side is using the wrong name for the same concept. Either ` +
      `rename data.${p.field} to one of the fields the backend actually ` +
      `sends, or rename the backend field to "${p.field}". Pick one canonical ` +
      `name and update both.`,
    );
  } else {
    lines.push(`🔗 WS mismatch: ${p.message || p.kind}`);
  }
  return lines.join("\n");
}

/**
 * Render a field-level phase-2 mismatch. The violator (expectation) has
 * named a field that doesn't exist in the contract (or vice versa).
 * Points at the exact file and line the violator wrote, names the
 * expected field from the contract, and gives an explicit rewrite
 * instruction.
 *
 * Blame policy: "first writer wins". The contract was declared first,
 * so the expectation is the violator. The fix is ALWAYS to conform to
 * the contract, never the other way around.
 */
function renderFieldMismatch(p) {
  // Payloads are stored flat (no nested contract/expectation sub-objects) to
  // stay within metadata nesting depth. Read the hoisted scalar keys directly.
  const contractKeys = Array.isArray(p.contractKeys) ? p.contractKeys : [];
  const method = p.contractMethod || p.expectationMethod || "?";
  const endpoint = p.contractEndpoint || p.expectationEndpoint || "?";

  const contractSrc = p.contractSourceFile
    ? `${p.contractSourceFile}:${p.contractSourceLine || "?"}`
    : "(unknown source)";
  const expectationSrc = p.expectationSourceFile
    ? `${p.expectationSourceFile}:${p.expectationSourceLine || "?"}`
    : "(unknown source)";

  const lines = [];

  if (p.kind === "response-missing-key") {
    lines.push(
      `🔗 Response field mismatch on ${method} ${endpoint}`,
      ``,
      `   You wrote (${expectationSrc}):`,
      `     destructured "${p.key}" from the response`,
      ``,
      `   But the contract says (${contractSrc}):`,
      `     response shape is { ${contractKeys.join(", ")} }`,
      ``,
      `   Fix: rewrite your destructuring to use one of the declared keys. ` +
      `"${p.key}" is not a thing the backend returns. If you meant one of ` +
      `${contractKeys.join(" / ")}, use that name EXACTLY. Do not rename the ` +
      `backend — it was declared first and is ground truth.`,
    );
  } else if (p.kind === "request-extra-key") {
    lines.push(
      `🔗 Request field not accepted on ${method} ${endpoint}`,
      ``,
      `   You send (${expectationSrc}):`,
      `     body includes "${p.key}"`,
      ``,
      `   But the contract says (${contractSrc}):`,
      `     request.body reads { ${contractKeys.join(", ")} }`,
      ``,
      `   The backend won't read "${p.key}". Either drop it from your ` +
      `JSON.stringify, or rename it to one of: ${contractKeys.join(", ")}.`,
    );
  } else if (p.kind === "request-missing-key") {
    lines.push(
      `🔗 Required request field missing on ${method} ${endpoint}`,
      ``,
      `   The contract requires (${contractSrc}):`,
      `     request.body reads { ${contractKeys.join(", ")} }`,
      ``,
      `   Your call (${expectationSrc}) doesn't send "${p.key}". Add it to ` +
      `your JSON.stringify body. If this field is actually optional ` +
      `server-side, the backend should be updated to reflect that.`,
    );
  }

  return lines.join("\n");
}

/**
 * Render a single dead-receiver signal. The payload is the issue object
 * from validators/deadReceivers.js — same shape as syntax errors but
 * with a different framing because the FIX is different (assign the
 * property somewhere, or restructure the gating logic).
 */
function renderDeadReceiver(signal) {
  const p = signal?.payload;
  if (!p || typeof p !== "object") return null;
  const file = p.file || signal.filePath || "(unknown)";
  const line = p.line || "?";
  const message = p.message || "Dead receiver";
  const context = p.context || "";

  return [
    `📁 ${file}  (declaration line ${line})`,
    message,
    "",
    context,
  ].join("\n");
}

/**
 * Render a behavioral test failure signal. The payload carries the
 * test name, the assertion that failed, and the stdout/stderr from
 * the test runner. Framed as "the test caught a real bug — fix the
 * APP, not the test".
 */
/**
 * Render a probe-failure signal. The payload carries the method, path,
 * status, response body, and the branch that fired the probe. Framed
 * as "the bug is in your handler, fix it then re-probe".
 */
function renderProbeFailure(signal) {
  const p = signal?.payload;
  if (!p || typeof p !== "object") return null;
  const method = p.method || "?";
  const url = p.path || p.url || "?";
  const status = p.status != null ? p.status : "(no response)";
  const reason = p.reason || p.error || "";
  const fromBranch = signal.from ? ` from ${signal.from}` : "";
  const lines = [
    `🔴 ${method} ${url} → ${status}${fromBranch ? ` (probed${fromBranch})` : ""}`,
  ];
  if (reason) lines.push(`   ${reason}`);
  if (p.body) {
    const trimmed = String(p.body).trim().slice(0, 400);
    if (trimmed) {
      lines.push("");
      lines.push(`   response body:`);
      for (const line of trimmed.split("\n").slice(0, 6)) {
        lines.push(`     ${line}`);
      }
    }
  }
  if (p.stderrTail) {
    lines.push("");
    lines.push(`   server stderr at probe time (last lines):`);
    for (const line of String(p.stderrTail).split("\n").slice(-6)) {
      lines.push(`     ${line}`);
    }
  }
  lines.push("");
  lines.push(
    `   Fix: read the handler at ${p.handlerHint || `the route for ${method} ${url}`}, ` +
    `find the bug, edit it, then re-probe with workspace-probe to confirm. ` +
    `Do NOT call [[DONE]] until the probe returns the expected shape.`,
  );
  return lines.join("\n");
}

function renderTestFailure(signal) {
  const p = signal?.payload;
  if (!p || typeof p !== "object") return null;
  const lines = [];
  lines.push(`📁 tests/spec.test.js`);
  if (p.name) lines.push(`Test: ${p.name}`);
  if (p.message) lines.push(`Failure: ${p.message}`);
  if (p.expected != null && p.actual != null) {
    lines.push(`Expected: ${JSON.stringify(p.expected)}`);
    lines.push(`Actual:   ${JSON.stringify(p.actual)}`);
  }
  if (p.stack) {
    lines.push("");
    lines.push(`Stack (first 6 lines):`);
    lines.push(p.stack.split("\n").slice(0, 6).join("\n"));
  }
  if (p.appOutput) {
    lines.push("");
    lines.push(`App stderr during test:`);
    lines.push(p.appOutput.slice(-600));
  }
  return lines.join("\n");
}

function formatPayload(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload.message) return payload.message;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

/**
 * Remove all syntax-error signals for a specific file from a node's
 * signalInbox. Called when a re-write of the file passes validation
 * — the old error is no longer relevant and stale errors clutter the
 * model's prompt with already-resolved issues.
 *
 * Idempotent. Safe to call when no matching signals exist.
 */
export async function pruneSignalInboxForFile({ nodeId, filePath, core }) {
  if (!nodeId || !filePath) return;
  return mutateMeta(nodeId, (draft) => {
    if (!Array.isArray(draft.signalInbox)) return draft;
    const before = draft.signalInbox.length;
    draft.signalInbox = draft.signalInbox.filter((s) => {
      // Prune file-scoped signals (syntax errors and dead-receivers)
      // for THIS file only — leave other kinds alone, leave signals
      // for other files alone.
      if (s.kind !== SIGNAL_KIND.SYNTAX_ERROR && s.kind !== SIGNAL_KIND.DEAD_RECEIVER) return true;
      const errFile = s?.payload?.file || s?.filePath;
      return errFile !== filePath;
    });
    const removed = before - draft.signalInbox.length;
    if (removed > 0) {
      log.debug("CodeWorkspace", `Pruned ${removed} resolved file-scoped signal(s) for ${filePath}`);
    }
    return draft;
  }, core);
}

/**
 * Remove probe-failure signals for a specific endpoint (method+path).
 * Called when a re-probe of the same endpoint succeeds — the old
 * failure is no longer relevant. Idempotent.
 */
export async function pruneProbeFailureForEndpoint({ nodeId, method, path: urlPath, core }) {
  if (!nodeId || !method || !urlPath) return;
  return mutateMeta(nodeId, (draft) => {
    if (!Array.isArray(draft.signalInbox)) return draft;
    draft.signalInbox = draft.signalInbox.filter((s) => {
      if (s.kind !== SIGNAL_KIND.PROBE_FAILURE) return true;
      const sm = s?.payload?.method;
      const sp = s?.payload?.path || s?.payload?.url;
      return !(sm === method && sp === urlPath);
    });
    return draft;
  }, core);
}

/**
 * Remove contract-mismatch signals for a specific file. Called when a
 * frontend file is re-written so the next diff starts from a clean
 * slate — stale mismatches pointing at old lines would otherwise
 * accumulate. Idempotent.
 */
export async function pruneContractMismatchesForFile({ nodeId, filePath, core }) {
  if (!nodeId || !filePath) return;
  return mutateMeta(nodeId, (draft) => {
    if (!Array.isArray(draft.signalInbox)) return draft;
    draft.signalInbox = draft.signalInbox.filter((s) => {
      if (s.kind !== "contract-mismatch") return true;
      const mmFile = s?.payload?.expectation?.sourceFile || s?.filePath;
      return mmFile !== filePath;
    });
    return draft;
  }, core);
}

/**
 * Find the earliest unresolved hard-error signal blocking the project
 * that targets a file OTHER than the one about to be written. Walks from
 * the project node's own signalInbox and returns the first match or
 * null.
 *
 * Hard errors include parse failures (SYNTAX_ERROR), module load
 * failures and server crashes (RUNTIME_ERROR). Soft signals
 * (contract-mismatch, dead-receiver, probe-failure, test-failure,
 * contract) do NOT block writes — those are advisory and the AI can
 * fix them during normal forward progress. Only breakage that makes
 * the project fail to even load is a blocker.
 *
 * Never blocks a write that targets the broken file itself — that is
 * exactly how the AI fixes the error.
 */
const BLOCKING_SIGNAL_KINDS = new Set([
  SIGNAL_KIND.SYNTAX_ERROR,
  SIGNAL_KIND.RUNTIME_ERROR,
]);

export async function findBlockingSyntaxError({ projectNodeId, targetFilePath }) {
  if (!projectNodeId) return null;
  const node = await Node.findById(projectNodeId).select("metadata").lean();
  if (!node) return null;
  const meta = readMeta(node);
  const list = Array.isArray(meta?.signalInbox) ? meta.signalInbox : [];
  for (const sig of list) {
    if (!BLOCKING_SIGNAL_KINDS.has(sig?.kind)) continue;
    const errFile = sig?.payload?.file || sig?.filePath;
    if (!errFile) continue;
    if (targetFilePath && errFile === targetFilePath) continue;
    return sig;
  }
  return null;
}

/**
 * Remove all signals of a specific kind from a node's signalInbox.
 * Called after a successful smoke retry to clear stale runtime-error
 * signals before the next validation pass — otherwise the model keeps
 * seeing "fix this runtime error" after the error is already resolved.
 *
 * Phase-1 equivalent is pruneSignalInboxForFile (file-scoped syntax
 * errors). This variant is kind-scoped because runtime errors may span
 * multiple files and the stack trace doesn't always match the file that
 * was most recently written.
 *
 * Idempotent. Safe to call when no matching signals exist.
 */
export async function pruneSignalInboxByKind({ nodeId, kind, core }) {
  if (!nodeId || !kind) return;
  return mutateMeta(nodeId, (draft) => {
    if (!Array.isArray(draft.signalInbox)) return draft;
    const before = draft.signalInbox.length;
    draft.signalInbox = draft.signalInbox.filter((s) => s.kind !== kind);
    const removed = before - draft.signalInbox.length;
    if (removed > 0) {
      log.debug("CodeWorkspace", `Pruned ${removed} stale ${kind} signal(s) on ${nodeId}`);
    }
    return draft;
  }, core);
}

// ─────────────────────────────────────────────────────────────────────
// PHASE 2 CONTRACTS — shared truth between branches
// ─────────────────────────────────────────────────────────────────────

const MAX_CONTRACTS_AT_ROOT = 200;

/**
 * Read the full contracts list from the project root's metadata. Each
 * contract entry is keyed by `method + " " + endpoint` and carries its
 * request/response shape + source provenance. Returns [] if absent.
 *
 * Contracts are stored AT THE PROJECT ROOT, not per-branch, because
 * they're a cross-branch concept — the frontend needs to read what the
 * backend wrote, and they're in different subtrees.
 */
export async function readContracts(projectNodeId) {
  if (!projectNodeId) return [];
  try {
    const n = await Node.findById(projectNodeId).select("metadata").lean();
    if (!n) return [];
    const meta = readMeta(n);
    return Array.isArray(meta?.contracts) ? meta.contracts : [];
  } catch {
    return [];
  }
}

/**
 * Replace all contracts that came from a given source file, then merge
 * in the new contracts from that file. This is "source-file-scoped
 * replacement": when the backend rewrites routes/auth.js, every old
 * contract declared from routes/auth.js disappears and the new ones
 * from the same file take over — otherwise dead routes would haunt the
 * contracts list forever and produce false-positive mismatches.
 *
 * `declaredBy` is the branch name (e.g. "backend"); stamped on every
 * new contract for attribution in error messages and plan.md.
 *
 * Returns { added, removed, changed } — counts so the caller can log
 * meaningfully.
 */
export async function replaceContractsFromFile({ projectNodeId, sourceFile, newContracts, declaredBy, core }) {
  if (!projectNodeId || !sourceFile) return { added: 0, removed: 0, changed: 0 };
  let added = 0;
  let removed = 0;
  let changed = 0;

  await mutateMeta(projectNodeId, (draft) => {
    if (!Array.isArray(draft.contracts)) draft.contracts = [];

    // Step 1: remove old contracts from this sourceFile, note what
    // was removed so we can compute `changed` later
    const oldFromFile = draft.contracts.filter((c) => c.sourceFile === sourceFile);
    removed = oldFromFile.length;
    draft.contracts = draft.contracts.filter((c) => c.sourceFile !== sourceFile);

    // Step 2: add the new contracts from this file, stamped with
    // declaredBy + declaredAt
    const now = new Date().toISOString();
    for (const contract of newContracts || []) {
      const stamped = {
        ...contract,
        declaredBy: declaredBy || null,
        declaredAt: now,
      };
      // If this same key existed previously from a DIFFERENT source
      // file, the second writer here would be the violator and should
      // be blamed — but replaceContractsFromFile is called BEFORE diff
      // so we just record. The diff step (extractFrontend → diff against
      // contracts) handles the blame.
      draft.contracts.push(stamped);
      added++;
    }

    // Count "changed" as keys that existed before and still exist after
    // with different shapes. Useful for logging.
    const oldByKey = new Map(oldFromFile.map((c) => [c.key, c]));
    for (const nc of newContracts || []) {
      const old = oldByKey.get(nc.key);
      if (old && JSON.stringify(old.response?.shape || []) !== JSON.stringify(nc.response?.shape || [])) {
        changed++;
      }
    }

    // Cap the contracts list at MAX_CONTRACTS_AT_ROOT, trimming the
    // oldest by declaredAt. Shouldn't trigger in normal use, guard
    // against pathological projects.
    if (draft.contracts.length > MAX_CONTRACTS_AT_ROOT) {
      draft.contracts.sort((a, b) => (b.declaredAt || "").localeCompare(a.declaredAt || ""));
      draft.contracts = draft.contracts.slice(0, MAX_CONTRACTS_AT_ROOT);
    }

    return draft;
  }, core);

  return { added, removed, changed };
}

/**
 * Format the contracts list as a prompt-ready block for enrichContext
 * injection. Shown to every branch that's working on the project —
 * this is how shared truth becomes shared.
 *
 * Keeps it terse: method, path, who declared it, request+response
 * field names. No raw source, no timestamps — the model doesn't need
 * those to write correct code. One line per contract when possible,
 * wrapped to two when the field list is long.
 */
export function formatContracts(contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) return null;
  const lines = [
    "## DECLARED API CONTRACTS",
    "These are the EXACT field names other branches have committed to.",
    "Match them verbatim when you write fetch calls, destructurings, or route handlers.",
    "Do NOT invent new field names. Do NOT rename existing ones.",
    "",
  ];
  // Sort by endpoint for readability
  const sorted = [...contracts].sort((a, b) => {
    if (a.endpoint !== b.endpoint) return a.endpoint.localeCompare(b.endpoint);
    return a.method.localeCompare(b.method);
  });
  for (const c of sorted.slice(0, 60)) {
    const by = c.declaredBy ? ` [${c.declaredBy}]` : "";
    const src = c.sourceFile ? ` (${c.sourceFile}:${c.sourceLine || "?"})` : "";
    lines.push(`${c.method} ${c.endpoint}${by}${src}`);
    const body = c.request?.body || [];
    if (body.length > 0) lines.push(`  request.body: ${body.join(", ")}`);
    const shape = c.response?.shape || [];
    if (shape.length > 0) {
      lines.push(`  response: ${shape.join(", ")}`);
    } else if (c.response?.inferred === "variable") {
      lines.push(`  response: (dynamic — shape unknown)`);
    }
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// BACKWARDS-COMPAT SHIMS (for code still calling old master-plan helpers)
// ─────────────────────────────────────────────────────────────────────

/**
 * Read the subPlan on the project root. Previously called the
 * "masterPlan". Kept for any caller that still references it by that
 * name; new code should use readSubPlan directly.
 */
export async function readMasterPlan(projectNodeId) {
  return readSubPlan(projectNodeId);
}

/**
 * Upsert a child onto the project root's subPlan. Kept for callers that
 * haven't migrated to upsertSubPlanEntry(parentNodeId, child). New
 * nested swarms should write to the immediate parent, not the root.
 */
export async function upsertMasterPlanBranch({ projectNodeId, branch, core }) {
  return upsertSubPlanEntry({
    parentNodeId: projectNodeId,
    child: branch,
    core,
  });
}

/**
 * Previously a root-level plan update helper. Now a thin wrapper around
 * mutateMeta on the project so callers can still pass a custom mutator.
 */
export async function updateMasterPlan({ projectNodeId, mutator, core }) {
  return mutateMeta(projectNodeId, (draft) => {
    if (!draft.subPlan) draft.subPlan = { branches: [], createdAt: new Date().toISOString() };
    // Adapt the old shape: mutators expected draft to be the plan itself
    const planView = {
      task: draft.systemSpec,
      createdAt: draft.subPlan.createdAt,
      updatedAt: draft.subPlan.updatedAt,
      branches: draft.subPlan.branches,
    };
    const mutated = mutator(planView) || planView;
    draft.systemSpec = mutated.task || draft.systemSpec;
    draft.subPlan.createdAt = mutated.createdAt || draft.subPlan.createdAt;
    draft.subPlan.updatedAt = new Date().toISOString();
    draft.subPlan.branches = mutated.branches || draft.subPlan.branches;
    return draft;
  }, core);
}

/**
 * Format an older-style swarm event list as a lateral-context block.
 * Kept for the existing enrichContext path that hasn't migrated yet.
 */
export function formatSwarmContext(events, currentBranchName) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const others = events.filter((e) => e.branchName !== currentBranchName);
  if (others.length === 0) return null;
  const recent = others.slice(-12);
  const lines = recent.map((e) => {
    const time = e.at ? new Date(e.at).toISOString().slice(11, 19) : "";
    const branch = e.branchName ? `[${e.branchName}]` : "[?]";
    const kind = e.kind || "wrote";
    const summary = e.summary ? ` — ${e.summary}` : "";
    return `  ${time} ${branch} ${kind} ${e.filePath}${summary}`;
  });
  return [
    "Recent activity from sibling branches in this project:",
    ...lines,
    "Use this to match API routes, data shapes, and file names across branches.",
  ].join("\n");
}
