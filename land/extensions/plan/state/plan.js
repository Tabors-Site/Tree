// Unified plan primitive. Every node can carry a metadata.plan namespace
// with the shape:
//
//   metadata.plan = {
//     steps: [
//       {
//         id: "s_<rand>",           // stable id, rotates when plan re-set
//         kind: "write" | "edit" | "branch" | "test" | "probe" | "note" |
//               "chapter" | "scene" | "task" | ...   (open set)
//         title: string,            // human readable
//         status: "pending" | "running" | "done" | "failed" | "paused" |
//                 "blocked" | "pending-approval" |
//                 "pending-nested-approval" | "archived",
//         createdAt: ISO,
//         completedAt: ISO | null,
//         blockedReason: string | null,
//         // kind specific fields:
//         //   branch/chapter:  childNodeId, path, spec, files, slot, mode
//         //   test:            command, output, passed
//         //   probe:           method, url, expectedStatus, actualStatus
//         //   write/edit:      filePath, bytes
//         //   note:            body
//       }
//     ],
//     rollup: { pending, done, blocked, running, failed, total },
//     version: N,                    // plan revision counter
//     createdAt: ISO,
//     updatedAt: ISO,
//     systemSpec: string | null,     // originating user request (project only)
//     archivedPlans: [               // bounded history of pivoted plans
//       { snapshot, reason, archivedAt, finalStatuses }
//     ],
//     _userEdit?: true,              // transient flag, consumed by hooks
//     _propagated?: true,            // transient flag, consumed by hooks
//   }
//
// Only THIS extension writes to metadata.plan. Other extensions read it
// via readPlan(nodeId) and mutate it via the exported functions here. The
// api serializes writes per node via mutateMeta so concurrent callers
// cannot clobber each other.
//
// Status vocabulary is the same strings at every kind. Clients (UI,
// facets, rollup) can filter or group by status without caring about
// kind.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { setExtMeta as kernelSetExtMeta, readNs } from "../../../seed/tree/extensionMetadata.js";

export const NS = "plan";

const ARCHIVED_PLANS_CAP = 10;

const TRANSIENT_FIELDS = new Set(["_userEdit", "_propagated"]);

// ─────────────────────────────────────────────────────────────────────
// LOW LEVEL HELPERS (private)
// ─────────────────────────────────────────────────────────────────────

// Thin wrapper over the kernel's readNs so the rest of the file can
// call readMeta(node) without repeating the namespace.
function readMeta(node) {
  return readNs(node, NS);
}

/**
 * Read modify write the plan namespace atomically. All writers go
 * through here so concurrent callers serialize on the Node document.
 * The mutator is called with a mutable draft; return the draft (or a
 * new object). Transient fields (_userEdit, _propagated) are preserved
 * across the call and the caller can set them to signal downstream
 * hooks.
 */
async function mutatePlan(nodeId, mutator, _core) {
  if (!nodeId || typeof mutator !== "function") return null;
  try {
    const node = await Node.findById(nodeId);
    if (!node) return null;
    const current = (node.metadata instanceof Map ? node.metadata.get(NS) : node.metadata?.[NS]) || null;
    const draft = current ? JSON.parse(JSON.stringify(current)) : emptyPlan();
    const out = mutator(draft) || draft;
    out.updatedAt = new Date().toISOString();
    // ALWAYS use the unscoped kernel setExtMeta. The plan extension is
    // the declared owner of metadata.plan, and callers pass their own
    // scoped `core` (from swarm, code-workspace, book-workspace, etc.)
    // which enforces a per-extension namespace whitelist and REJECTS
    // cross-namespace writes. The scope check is the right default for
    // extensions writing into THEIR OWN namespace; here the plan
    // extension is acting on its OWN behalf on behalf of the caller,
    // so we bypass the caller's scope wrapper. Using kernelSetExtMeta
    // directly keeps the atomic $set, the afterMetadataWrite hook fire,
    // and the cache invalidation intact. Caller's core arg is ignored.
    await kernelSetExtMeta(node, NS, out);
    return out;
  } catch (err) {
    log.warn("Plan", `mutatePlan ${nodeId} failed: ${err.message}`);
    return null;
  }
}

function emptyPlan() {
  const nowIso = new Date().toISOString();
  return {
    steps: [],
    rollup: { pending: 0, done: 0, blocked: 0, running: 0, failed: 0, total: 0 },
    version: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    systemSpec: null,
    archivedPlans: [],
  };
}

function makeStepId() {
  return `s_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStatus(s) {
  const v = String(s || "").toLowerCase();
  const valid = new Set([
    "pending", "running", "done", "failed", "paused", "blocked",
    "pending-approval", "pending-nested-approval", "archived",
  ]);
  return valid.has(v) ? v : "pending";
}

function cleanStep(raw) {
  if (!raw || typeof raw !== "object") return null;
  const nowIso = new Date().toISOString();
  const step = {
    id: raw.id || makeStepId(),
    kind: String(raw.kind || "task"),
    title: String(raw.title || raw.name || "").trim() || "(untitled step)",
    status: normalizeStatus(raw.status),
    createdAt: raw.createdAt || nowIso,
    completedAt: raw.status === "done" ? (raw.completedAt || nowIso) : null,
    blockedReason: raw.status === "blocked" ? (raw.blockedReason || null) : null,
  };
  // Preserve kind specific fields. We don't enforce a schema; callers
  // add whatever their kind needs (childNodeId, path, spec, files,
  // command, url, etc.).
  const kindKeys = Object.keys(raw).filter((k) =>
    k !== "id" && k !== "kind" && k !== "title" && k !== "name" &&
    k !== "status" && k !== "createdAt" && k !== "completedAt" &&
    k !== "blockedReason" && !TRANSIENT_FIELDS.has(k),
  );
  for (const k of kindKeys) {
    step[k] = raw[k];
  }
  return step;
}

/**
 * Recompute the rollup for a plan from its own steps plus any branch
 * kind step children's rollups. Does NOT walk recursively through
 * children's own plans; that's handled by the afterMetadataWrite hook
 * which propagates up the tree. This function aggregates local steps
 * plus the immediate cached rollups on branch children.
 */
async function computeRollup(plan) {
  const roll = { pending: 0, done: 0, blocked: 0, running: 0, failed: 0, total: 0 };
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  for (const s of steps) {
    const st = s.status || "pending";
    if (roll[st] != null) roll[st] += 1;
    roll.total += 1;
    // Branch steps: add the child's cached rollup (if any) so parents
    // reflect descendant state without walking the full tree.
    if (s.kind === "branch" && s.childNodeId) {
      try {
        const child = await Node.findById(s.childNodeId).select("metadata").lean();
        const childPlan = child ? readMeta(child) : null;
        const childRoll = childPlan?.rollup;
        if (childRoll) {
          roll.pending += childRoll.pending || 0;
          roll.done += childRoll.done || 0;
          roll.blocked += childRoll.blocked || 0;
          roll.running += childRoll.running || 0;
          roll.failed += childRoll.failed || 0;
          roll.total += childRoll.total || 0;
        }
      } catch {}
    }
  }
  return roll;
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────

/**
 * Read the plan at nodeId. Returns the plan object or null if the node
 * has no plan. The returned object is a snapshot, safe to read but do
 * not mutate.
 */
export async function readPlan(nodeId) {
  if (!nodeId) return null;
  try {
    const n = await Node.findById(nodeId).select("metadata").lean();
    if (!n) return null;
    return readMeta(n);
  } catch {
    return null;
  }
}

/**
 * Read the cached rollup. Cheap — no tree walk, reads a precomputed
 * field on the plan. Returns null if no plan.
 */
export async function readRollup(nodeId) {
  const plan = await readPlan(nodeId);
  return plan?.rollup || null;
}

/**
 * Read the archived plans ring. Empty array if none.
 */
export async function readArchivedPlans(nodeId) {
  const plan = await readPlan(nodeId);
  return Array.isArray(plan?.archivedPlans) ? plan.archivedPlans : [];
}

/**
 * Overwrite the entire steps array. Rebuilds step ids if missing and
 * normalizes statuses. Bumps version only if the caller passes
 * bumpVersion: true. Rollup is recomputed.
 */
export async function setSteps(nodeId, steps, core, { bumpVersion = false, systemSpec = null } = {}) {
  if (!nodeId) return null;
  const normalized = (Array.isArray(steps) ? steps : []).map(cleanStep).filter(Boolean);
  const out = await mutatePlan(nodeId, (draft) => {
    draft.steps = normalized;
    if (bumpVersion) draft.version = (draft.version || 0) + 1;
    if (systemSpec !== null && systemSpec !== undefined) {
      draft.systemSpec = systemSpec;
    }
    return draft;
  }, core);
  await recomputeRollup(nodeId, core);
  return out;
}

/**
 * Append one step. Returns the created step (with its generated id if
 * none was provided). Rollup is recomputed.
 */
export async function addStep(nodeId, step, core) {
  if (!nodeId) return null;
  const cleaned = cleanStep(step);
  if (!cleaned) return null;
  await mutatePlan(nodeId, (draft) => {
    if (!Array.isArray(draft.steps)) draft.steps = [];
    draft.steps.push(cleaned);
    return draft;
  }, core);
  await recomputeRollup(nodeId, core);
  return cleaned;
}

/**
 * Update a single step by id with a partial patch. Idempotent: if the
 * patch matches the existing step byte for byte, returns { changed:
 * false } and skips the write. Otherwise merges the patch in, updates
 * completedAt / blockedReason based on status transitions, recomputes
 * rollup.
 *
 * Callers can stamp _userEdit on the draft (via a second update) to
 * signal the propagation hook that a human edit happened. This is used
 * by the swarm plan panel's inline edit flow to fire sibling signals.
 */
export async function updateStep(nodeId, stepId, patch, core, flags = {}) {
  if (!nodeId || !stepId || !patch) return { changed: false };
  const nowIso = new Date().toISOString();
  let changed = false;
  let updatedStep = null;
  await mutatePlan(nodeId, (draft) => {
    if (!Array.isArray(draft.steps)) return draft;
    const idx = draft.steps.findIndex((s) => s.id === stepId);
    if (idx === -1) return draft;
    const before = draft.steps[idx];
    const next = { ...before };
    for (const [k, v] of Object.entries(patch)) {
      if (TRANSIENT_FIELDS.has(k)) continue;
      if (k === "status") {
        const norm = normalizeStatus(v);
        if (norm !== before.status) {
          next.status = norm;
          if (norm === "done" && before.status !== "done") {
            next.completedAt = nowIso;
          } else if (norm !== "done") {
            next.completedAt = null;
          }
          if (norm === "blocked") {
            next.blockedReason = patch.blockedReason || before.blockedReason || null;
          } else if (k === "status") {
            next.blockedReason = null;
          }
          changed = true;
        }
      } else if (k !== "blockedReason") {
        const prev = before[k];
        const same = Array.isArray(v) && Array.isArray(prev)
          ? v.length === prev.length && v.every((x, i) => x === prev[i])
          : prev === v;
        if (!same) {
          next[k] = v;
          changed = true;
        }
      }
    }
    if (changed) {
      draft.steps[idx] = next;
      updatedStep = next;
      if (flags?.userEdit) draft._userEdit = true;
    }
    return draft;
  }, core);
  if (changed) await recomputeRollup(nodeId, core);
  return { changed, step: updatedStep };
}

/**
 * Delete a step by id. Returns { removed: true } if it existed.
 */
export async function deleteStep(nodeId, stepId, core) {
  if (!nodeId || !stepId) return { removed: false };
  let removed = false;
  await mutatePlan(nodeId, (draft) => {
    if (!Array.isArray(draft.steps)) return draft;
    const before = draft.steps.length;
    draft.steps = draft.steps.filter((s) => s.id !== stepId);
    if (draft.steps.length < before) removed = true;
    return draft;
  }, core);
  if (removed) await recomputeRollup(nodeId, core);
  return { removed };
}

/**
 * Find-or-create a branch kind step on a parent's plan, matching by
 * branch name (step.title). Merges a patch into the matching step or
 * creates a new one.
 *
 * The "upsert by title" predicate is useful because swarm (and any
 * other branch-style dispatcher) tracks branches by human-readable
 * name rather than by the step's internal id. Used to live as a
 * convenience in swarm/state/planAccess.js; promoted here so that
 * any extension dispatching branch-like work shares one authoritative
 * upsert path.
 *
 *   upsertBranchStep(parentNodeId, {
 *     name: "backend", spec: "...", path: "backend",
 *     files: ["server.js"], status: "pending",
 *     nodeId: childNodeId,      // or pass as childNodeId
 *   }, core);
 *
 * Undefined fields are stripped before merge so a partial patch does
 * not clobber existing values with `undefined`.
 */
export async function upsertBranchStep(parentNodeId, branch, core) {
  if (!parentNodeId || !branch?.name) return null;
  const existing = await readPlan(parentNodeId);
  const match = existing?.steps?.find(
    (s) => s.kind === "branch" && s.title === branch.name,
  );
  const stepData = {
    kind: "branch",
    title: branch.name,
    status: branch.status || "pending",
    spec: branch.spec,
    path: branch.path,
    files: branch.files,
    slot: branch.slot,
    mode: branch.mode,
    childNodeId: branch.nodeId || branch.childNodeId || null,
    parentBranch: branch.parentBranch,
    summary: branch.summary,
    error: branch.error,
    finishedAt: branch.finishedAt,
    startedAt: branch.startedAt,
    pausedAt: branch.pausedAt,
    abortReason: branch.abortReason,
    retries: branch.retries,
  };
  // Strip undefined so we don't overwrite existing fields with nothing.
  for (const k of Object.keys(stepData)) {
    if (stepData[k] === undefined) delete stepData[k];
  }
  if (match) {
    const result = await updateStep(parentNodeId, match.id, stepData, core);
    return result?.step || match;
  }
  return addStep(parentNodeId, stepData, core);
}

/**
 * Initialize (or reinitialize) a plan at the given node. Does NOT
 * clobber existing steps. Stamps systemSpec and createdAt if missing.
 * Called by swarm when a project root first gets decomposed and by
 * extensions setting up a new planning target.
 */
export async function initPlan(nodeId, { systemSpec = null } = {}, core) {
  if (!nodeId) return null;
  return mutatePlan(nodeId, (draft) => {
    if (!draft.createdAt) draft.createdAt = new Date().toISOString();
    if (systemSpec) draft.systemSpec = systemSpec;
    if (!Array.isArray(draft.steps)) draft.steps = [];
    if (!Array.isArray(draft.archivedPlans)) draft.archivedPlans = [];
    return draft;
  }, core);
}

/**
 * Find a branch kind step that points at `childNodeId` and update its
 * status / summary / error / finishedAt. Convenience wrapper that
 * replaces the old setBranchStatus flow: when a branch execution
 * finishes, this updates the parent's view of that branch without
 * callers needing to know the parent nodeId or step id.
 *
 * parentNodeId must be provided (from the branch's swarm bookkeeping
 * metadata, parentProjectId). Falls silently if no match is found.
 */
export async function setBranchStepStatus({ parentNodeId, childNodeId, status, summary, error, core }) {
  if (!parentNodeId || !childNodeId) return { changed: false };
  const parent = await readPlan(parentNodeId);
  if (!parent) return { changed: false };
  const step = parent.steps?.find((s) => s.kind === "branch" && String(s.childNodeId) === String(childNodeId));
  if (!step) return { changed: false };
  const patch = {};
  if (status != null) patch.status = status;
  if (summary !== undefined) patch.summary = summary;
  if (error !== undefined) patch.error = error;
  patch.finishedAt = new Date().toISOString();
  return updateStep(parentNodeId, step.id, patch, core);
}

/**
 * Archive the current plan into archivedPlans[] (ring capped) and
 * reset steps. Used on user pivot, user cancel, session reset while a
 * plan is in flight.
 */
export async function archivePlan({ nodeId, reason, core }) {
  if (!nodeId) return null;
  const nowIso = new Date().toISOString();
  return mutatePlan(nodeId, (draft) => {
    const steps = Array.isArray(draft.steps) ? draft.steps : [];
    if (!Array.isArray(draft.archivedPlans)) draft.archivedPlans = [];
    if (steps.length === 0) {
      // Nothing meaningful to archive. Still ensure the reset shape.
      draft.steps = [];
      draft.version = draft.version || 0;
      return draft;
    }
    const statusCounts = steps.reduce((acc, s) => {
      const k = s.status || "unknown";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    draft.archivedPlans.push({
      snapshot: {
        steps: JSON.parse(JSON.stringify(steps)),
        version: draft.version || 0,
      },
      reason: reason || "unspecified",
      archivedAt: nowIso,
      finalStatuses: statusCounts,
    });
    while (draft.archivedPlans.length > ARCHIVED_PLANS_CAP) {
      draft.archivedPlans.shift();
    }
    draft.steps = [];
    draft.version = 0;
    return draft;
  }, core);
}

/**
 * Recompute the cached rollup and write it back. Called automatically
 * after every step mutation. Callers can invoke directly if they wrote
 * to a child's plan and want the parent's rollup to pick up the change
 * immediately (otherwise the afterMetadataWrite hook propagates within
 * the next tick).
 */
export async function recomputeRollup(nodeId, core) {
  if (!nodeId) return null;
  const plan = await readPlan(nodeId);
  if (!plan) return null;
  const roll = await computeRollup(plan);
  return mutatePlan(nodeId, (draft) => {
    draft.rollup = roll;
    draft._propagated = true; // tells the hook this write is internal
    return draft;
  }, core);
}

/**
 * Walk from nodeId upward, recomputing rollups at every ancestor. Used
 * when a deep descendant's plan changes and we want the rollup to
 * propagate immediately rather than waiting for hooks.
 */
export async function rollupUpward(nodeId, core) {
  if (!nodeId) return;
  let cursor = String(nodeId);
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id parent metadata").lean();
    if (!n) return;
    const hasPlan = !!readMeta(n);
    if (hasPlan) {
      await recomputeRollup(cursor, core);
    }
    if (!n.parent) return;
    cursor = String(n.parent);
    guard++;
  }
}

/**
 * Find the branch kind step on a parent that points at childNodeId.
 * Returns the step or null. Used by consumers that need to look up
 * step metadata (summary, status) from the child's perspective.
 */
export async function findBranchStep(parentNodeId, childNodeId) {
  const plan = await readPlan(parentNodeId);
  if (!plan) return null;
  return plan.steps?.find(
    (s) => s.kind === "branch" && String(s.childNodeId) === String(childNodeId),
  ) || null;
}

/**
 * Filter helpers that are common enough to centralize.
 */
export function branchSteps(plan) {
  if (!plan?.steps) return [];
  return plan.steps.filter((s) => s.kind === "branch");
}

export function stepsByKind(plan, kind) {
  if (!plan?.steps) return [];
  return plan.steps.filter((s) => s.kind === kind);
}

export function pendingSteps(plan) {
  if (!plan?.steps) return [];
  return plan.steps.filter((s) => s.status === "pending");
}
