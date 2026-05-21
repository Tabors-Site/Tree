// Foreman API. The Foreman is the governing role responsible for
// EXECUTION OVERSIGHT: deploying workers per the active plan emission,
// redeploying on retry, tracking what's been done as a mutable
// execution ledger, freezing records on completion or supersession,
// and (in later passes) handing off to courts when ambiguous failures
// require adjudication.
//
// Phase A scope: data home. The execution-record is created when the
// Ruler-cycle ratifies a plan emission, with stepStatuses initialized
// from the plan's structured steps. Subsequent phases wire swarm to
// update step statuses through this API instead of writing to
// metadata.plan.steps[] directly. The LLM reasoning surface for the
// Foreman mode (retry-vs-escalate decisions, court convening) places
// in Pass 2.
//
// Architecture:
//
//   ruler-space
//   ├── plan-space (Planner's surface)
//   │   └── plan-emission-N (immutable plan draft)
//   ├── contracts-space (Contractor's surface)
//   │   └── contracts-emission-M (immutable contracts draft)
//   ├── execution-space (Foreman's surface)
//   │   ├── execution-record-1 (mutable while running, frozen at
//   │   │                       completion/supersession)
//   │   └── execution-record-N (current — tied to plan-emission-N)
//   └── (sub-Rulers)
//
// Each plan-emission has an associated execution-record (1:1 by
// ordinal). The Ruler's metadata.governing.executionApprovals ledger
// records which record is active at any moment, with supersedes refs
// preserving the audit chain.

import Space from "../../../seed/models/space.js";
import log from "../../../seed/system/log.js";
import { ensureExecutionNode, findExecutionNode } from "./executionSpace.js";

const NS = "governing";

// Step-status semantic sets. Used by code that needs to discriminate
// between "settled with progress" vs "settled without progress" vs
// "tried-and-couldn't" vs "deliberate stop." Single source of truth
// so readers don't drift.
//
//   done       — work completed normally, output produced, contracts met
//   advanced   — Foreman explicit override; step's work deemed
//                complete-enough or non-blocking. Distinct from done:
//                reputation will weigh advanced steps against the
//                Foreman's track record (judgment was applied).
//   skipped    — step bypassed (precondition unmet, work not needed).
//                Distinct from done: nothing was produced; consumers
//                that need step output (e.g., file-import validators)
//                must NOT treat skipped as done.
//   failed     — tried, couldn't. Errored out.
//   cancelled  — decided not to finish. Operator/court intent.
//   superseded — replaced by a newer emission.
//   blocked    — waiting on something external.
//   paused     — paused, will resume.
//   running / pending — non-terminal.
export const STEP_TERMINAL_STATUSES = new Set([
  "done", "advanced", "skipped", "failed", "cancelled", "superseded",
]);
// "Settled with progress" — the work is considered to have happened
// in some form, whether normally or by override. Used by parent
// rollups that need to know "are all my children settled (no
// failure, no in-flight)?"
export const STEP_PROGRESSED_STATUSES = new Set(["done", "advanced", "skipped"]);
// Strictly "produced output." Used by readers that depend on the
// step's actual artifact (file produced, chapter written, etc.).
// advanced/skipped do NOT belong here.
export const STEP_OUTPUT_PRODUCED_STATUSES = new Set(["done"]);

/**
 * Build an executionRef string. Same shape as planRef / contractRef:
 * "<executionSpaceId>:<recordId>".
 */
export function buildExecutionRef(executionSpaceId, recordId) {
  return `${String(executionSpaceId)}:${String(recordId)}`;
}

/**
 * Parse an executionRef into { executionSpaceId, recordId }. Returns
 * null on bad shape.
 */
export function parseExecutionRef(ref) {
  if (typeof ref !== "string" || !ref) return null;
  const idx = ref.indexOf(":");
  if (idx <= 0) return null;
  const executionSpaceId = ref.slice(0, idx);
  const recordId = ref.slice(idx + 1);
  if (!executionSpaceId || !recordId) return null;
  return { executionSpaceId, recordId };
}

/**
 * Compute the next execution-record ordinal under an execution-space.
 * Counts existing execution-record children and increments.
 */
async function nextRecordOrdinal(executionSpaceId) {
  const count = await Space.countDocuments({
    parent: executionSpaceId,
    type: "execution-record",
  });
  return count + 1;
}

/**
 * Build the initial stepStatuses array from a plan emission. One
 * entry per step in plan order; nested branch-step entries carry
 * sub-statuses per branch (one per named sub-domain).
 *
 * Status starts "pending" everywhere. Phase B wires swarm to flip
 * statuses to "running" / "done" / "failed" / "blocked" as branches
 * dispatch and complete.
 */
function buildInitialStepStatuses(planEmission) {
  const out = [];
  const steps = Array.isArray(planEmission?.steps) ? planEmission.steps : [];
  steps.forEach((step, i) => {
    const stepIndex = i + 1;
    if (step?.type === "leaf") {
      // workerType travels with the step so the Foreman snapshot,
      // failure wakeups, and Pass 3 reputation reads can see which
      // cognitive shape this step had. Defaults to "build" for plans
      // emitted before typed-worker landed.
      const workerType = typeof step.workerType === "string" ? step.workerType : "build";
      out.push({
        stepIndex,
        type: "leaf",
        workerType,
        spec: step.spec || "",
        status: "pending",
        startedAt: null,
        completedAt: null,
        retries: 0,
        error: null,
      });
    } else if (step?.type === "branch") {
      const branches = Array.isArray(step.branches) ? step.branches : [];
      out.push({
        stepIndex,
        type: "branch",
        rationale: step.rationale || "",
        status: "pending",
        startedAt: null,
        completedAt: null,
        branches: branches.map((b) => ({
          name: b?.name || "",
          spec: b?.spec || "",
          status: "pending",
          childSpaceId: null,
          startedAt: null,
          completedAt: null,
          retries: 0,
          error: null,
        })),
      });
    }
  });
  return out;
}

/**
 * Create a new execution-record child space under the Ruler's
 * execution-space, initialize its stepStatuses from the active plan
 * emission, and append an executionApproval entry to the Ruler.
 *
 * Idempotent for the same ordinal: if a record at the next ordinal
 * already exists, returns it without creating a duplicate (race-safe
 * via the type+parent filter).
 *
 * Required: rulerSpaceId, beingId, planEmissionRef, planEmission (the
 * payload, used to seed stepStatuses). Optional:
 * contractsEmissionRef.
 *
 * Returns { recordNode, executionRef, ordinal, supersedes }.
 */
export async function appendExecutionRecord({
  rulerSpaceId,
  beingId,
  identity = null,
  core,
  planEmissionRef,
  planEmission,
  contractsEmissionRef = null,
}) {
  // For stance auth: prefer explicit identity, fall back to {beingId}.
  // Legacy callers passing only beingId get authed as that being.
  const authIdentity = identity || (beingId ? { beingId } : null);
  if (!rulerSpaceId || !planEmissionRef) return null;

  // Ensure the execution-space parent exists.
  let executionSpace = await findExecutionNode(rulerSpaceId);
  if (!executionSpace) {
    executionSpace = await ensureExecutionNode({ scopeSpaceId: rulerSpaceId, beingId, core });
  }
  if (!executionSpace) {
    log.warn("Governing", `appendExecutionRecord: no execution-space resolvable at ${String(rulerSpaceId).slice(0, 8)}`);
    return null;
  }

  // Detect prior active record so we can mark it superseded and
  // freeze it before creating the new one. The prior record's content
  // stays readable as bark.
  const priorActive = await readActiveExecutionRecord(rulerSpaceId);
  const priorApprovalRef = priorActive?._approvalRef || null;
  if (priorActive?._recordNodeId) {
    try {
      await freezeExecutionRecord({
        recordNodeId: priorActive._recordNodeId,
        nextStatus: "superseded",
        identity: authIdentity,
        core,
      });
    } catch (err) {
      log.debug("Governing", `appendExecutionRecord: prior freeze skipped: ${err.message}`);
    }
  }

  const ordinal = await nextRecordOrdinal(executionSpace._id);
  // Run records inherit their slug from the plan emission they're
  // dispatching. A run named after the plan it executes makes the
  // tree readable: "runs/single-react-component-canvas-toolbar"
  // tells you what was attempted without expanding the space. Falls
  // back to "record-N" when planEmission has no reasoning.
  const { slugifyEmission } = await import("./slugifyEmission.js");
  const planSlug = slugifyEmission(planEmission?.reasoning, ordinal);
  const recordName = planSlug.startsWith("emission-")
    ? `record-${ordinal}`
    : planSlug;
  const startedAt = new Date().toISOString();

  // Phase 3 migration: verb-surface create. Fires kernel hooks + Did.
  let recordNode = null;
  try {
    recordNode = await core.do(executionSpace._id, "create-child", {
      name: recordName,
      type: "execution-record",
      beingId,
    }, { identity: authIdentity });
  } catch (err) {
    log.debug("Governing", `core.do(create-child) failed for execution-record: ${err.message}; falling back to direct insert`);
  }

  if (!recordNode) {
    const { default: NodeModel } = await import("../../../seed/models/space.js");
    const { v4: uuid } = await import("uuid");
    recordNode = await NodeModel.create({
      _id: uuid(),
      name: recordName,
      type: "execution-record",
      parent: executionSpace._id,
      children: [],
      contributors: [],
      status: "active",
    });
    await NodeModel.updateOne(
      { _id: executionSpace._id },
      { $addToSet: { children: recordNode._id } },
    );
  }

  // Initialize the execution payload. stepStatuses seeded from the
  // plan emission so reads can render the running plan even before
  // the first dispatch.
  const stepStatuses = buildInitialStepStatuses(planEmission);
  const payload = {
    ordinal,
    planEmissionRef: String(planEmissionRef),
    contractsEmissionRef: contractsEmissionRef ? String(contractsEmissionRef) : null,
    startedAt,
    completedAt: null,
    status: "running",
    stepStatuses,
  };

  try {
    // Phase 3 migration ([[project_seed_four_verbs_only]]): verb-surface
    // write. merge:true preserves other NS keys atomically; no manual
    // read-spread-write.
    const space = await Space.findById(recordNode._id);
    if (space) {
      await core.do(space, "set-meta", {
        namespace: NS,
        data: {
          role: "execution-record",
          execution: payload,
          ordinal,
          startedAt,
        },
        merge: true,
      }, { identity: authIdentity });
    }
  } catch (err) {
    log.warn("Governing", `failed to stamp execution-record metadata at ${String(recordNode._id).slice(0, 8)}: ${err.message}`);
  }

  // Append executionApproval on the Ruler.
  const executionRef = buildExecutionRef(executionSpace._id, recordNode._id);
  let approvalRef = null;
  try {
    approvalRef = await appendExecutionApproval({
      rulerSpaceId,
      executionRef,
      supersedes: priorApprovalRef || null,
      reason: priorActive ? "supersedes prior execution-record" : null,
      core,
    });
  } catch (err) {
    log.warn("Governing", `appendExecutionRecord: approval write failed: ${err.message}`);
  }

  log.info("Governing",
    `🔧 execution-record-${ordinal} created at ruler ${String(rulerSpaceId).slice(0, 8)} ` +
    `(planRef=${String(planEmissionRef).slice(0, 16)}…, ${stepStatuses.length} step(s))`);

  return {
    recordNode,
    executionRef,
    approvalRef,
    ordinal,
    supersedes: priorApprovalRef,
  };
}

/**
 * Atomically append an approval entry to metadata.governing
 * .executionApprovals on the Ruler scope. Returns the approval ref
 * id (matches contractApprovals shape).
 */
export async function appendExecutionApproval({
  rulerSpaceId,
  executionRef,
  status = "approved",
  supersedes = null,
  reason = null,
  identity = null,
  // Phase 3 ([[project_seed_four_verbs_only]]): callers thread core.
  core,
}) {
  if (!rulerSpaceId || !executionRef) return null;
  if (!core?.do) throw new Error("appendExecutionApproval requires `core` (verb surface)");
  const space = await Space.findById(rulerSpaceId);
  if (!space) return null;

  const meta = space.qualities instanceof Map
    ? space.qualities.get(NS)
    : space.qualities?.[NS];
  const existing = Array.isArray(meta?.executionApprovals) ? meta.executionApprovals : [];

  const { v4: uuid } = await import("uuid");
  const approvalId = uuid();
  const entry = {
    id: approvalId,
    approvedAt: new Date().toISOString(),
    executionRef: String(executionRef),
    status,
    supersedes: supersedes || null,
    reason: reason || null,
  };

  // Phase 3 migration: verb-surface write. merge:true atomically adds
  // executionApprovals without clobbering other NS keys.
  await core.do(space, "set-meta", {
    namespace: NS,
    data: { executionApprovals: [...existing, entry] },
    merge: true,
  }, { identity });

  // Fire the ratification hook for Pass 2 court listeners and the
  // dashboard. Mirrors governing:planRatified / contractRatified.
  try {
    const { hooks } = await import("../../../seed/system/hooks.js");
    hooks.run("governing:executionRatified", {
      rulerSpaceId: String(rulerSpaceId),
      executionRef: String(executionRef),
      approvalId,
      supersedes,
      status,
    }).catch(() => {});
  } catch (err) {
    log.debug("Governing", `governing:executionRatified hook fire failed: ${err.message}`);
  }

  return approvalId;
}

/**
 * Read the executionApprovals ledger from a Ruler scope by id.
 * Returns the full array (including superseded entries) for audit
 * walks.
 */
export async function readExecutionApprovalsAtRuler(rulerSpaceId) {
  if (!rulerSpaceId) return [];
  const space = await Space.findById(rulerSpaceId).select("_id metadata").lean();
  if (!space) return [];
  const meta = space.qualities instanceof Map
    ? space.qualities.get(NS)
    : space.qualities?.[NS];
  return Array.isArray(meta?.executionApprovals) ? meta.executionApprovals : [];
}

/**
 * Find the most recent approved (non-superseded) execution approval
 * at a Ruler scope. Returns the approval entry or null.
 */
export async function readActiveExecutionApproval(rulerSpaceId) {
  const ledger = await readExecutionApprovalsAtRuler(rulerSpaceId);
  if (!ledger.length) return null;
  const supersededSet = new Set();
  for (const entry of ledger) {
    if (entry?.status === "approved" && entry.supersedes) {
      supersededSet.add(String(entry.supersedes));
    }
  }
  for (let i = ledger.length - 1; i >= 0; i--) {
    const entry = ledger[i];
    if (entry?.status !== "approved") continue;
    if (supersededSet.has(String(entry.id))) continue;
    return entry;
  }
  return null;
}

/**
 * Read the active execution-record at a Ruler scope. Walks the
 * approvals ledger to find the active executionRef, resolves to the
 * record space, returns the execution payload. Carries the record
 * space id and the approval id as `_recordNodeId` and `_approvalRef`
 * for callers that need them (e.g., supersession bookkeeping).
 *
 * Returns null when no execution-record is active (fresh Ruler before
 * the first emission, or all records superseded with no replacement).
 */
export async function readActiveExecutionRecord(rulerSpaceId) {
  const active = await readActiveExecutionApproval(rulerSpaceId);
  if (!active?.executionRef) return null;
  const parsed = parseExecutionRef(active.executionRef);
  if (!parsed) return null;
  const space = await Space.findById(parsed.recordId).select("_id metadata").lean();
  if (!space) return null;
  const meta = space.qualities instanceof Map
    ? space.qualities.get(NS)
    : space.qualities?.[NS];
  if (meta?.role !== "execution-record" || !meta?.execution) return null;
  return {
    ...meta.execution,
    _recordNodeId: String(space._id),
    _approvalRef: active.id || null,
  };
}

/**
 * Mutate one stepStatus entry on an execution-record. Used by swarm
 * (and reconcile) as branches transition through pending → running →
 * done / failed / blocked.
 *
 * stepIdentifier is { stepIndex } for leaf steps or { stepIndex,
 * branchName } for branch sub-statuses. updates is a partial object
 * merged onto the matching status entry; supports any field on the
 * stepStatus shape (status, startedAt, completedAt, error, retries,
 * childSpaceId).
 */
export async function updateStepStatus({
  recordNodeId,
  stepIndex,
  branchName = null,
  updates,
  identity = null,
  // Phase 3 ([[project_seed_four_verbs_only]]): callers thread core.
  core,
}) {
  if (!recordNodeId || typeof stepIndex !== "number" || !updates) return null;
  if (!core?.do) throw new Error("updateStepStatus requires `core` (verb surface)");
  const space = await Space.findById(recordNodeId);
  if (!space) return null;

  const meta = space.qualities instanceof Map
    ? space.qualities.get(NS)
    : space.qualities?.[NS];
  if (meta?.role !== "execution-record" || !meta?.execution) return null;

  const execution = { ...meta.execution };
  const stepStatuses = Array.isArray(execution.stepStatuses)
    ? execution.stepStatuses.map((s) => ({ ...s }))
    : [];

  const stepIdx = stepStatuses.findIndex((s) => s?.stepIndex === stepIndex);
  if (stepIdx < 0) return null;

  if (branchName) {
    // Branch-step sub-status update.
    const step = stepStatuses[stepIdx];
    if (step.type !== "branch" || !Array.isArray(step.branches)) return null;
    const subBranches = step.branches.map((b) =>
      String(b.name).toLowerCase() === String(branchName).toLowerCase()
        ? { ...b, ...updates }
        : b,
    );
    stepStatuses[stepIdx] = { ...step, branches: subBranches };
  } else {
    // Leaf-step or branch-step top-level status update.
    stepStatuses[stepIdx] = { ...stepStatuses[stepIdx], ...updates };
  }

  execution.stepStatuses = stepStatuses;

  // Phase 3 migration: verb-surface write with atomic merge.
  await core.do(space, "set-meta", {
    namespace: NS,
    data: { execution },
    merge: true,
  }, { identity });
  return execution;
}

/**
 * Convenience wrapper for swarm: locate the active execution-record
 * at a Ruler scope, find the step containing a branch with this name,
 * and apply the status update. Returns the updated execution payload
 * or null if no record / step / branch matches.
 *
 * Used by the swarm dual-write path during Phase B (status changes
 * write to both metadata.plan.steps[] legacy field and the active
 * execution-record's stepStatuses). Phase E removes the legacy write;
 * the structured execution-record becomes the sole status home.
 *
 * Matching: case-insensitive on branch name. If multiple branch
 * steps contain branches with the same name (a substrate bug — the
 * Planner's own validator forbids duplicate names), the first match
 * wins.
 */
export async function updateStepStatusByBranchName({
  rulerSpaceId,
  branchName,
  updates,
  identity = null,
  // Phase 3: thread core through to the underlying updateStepStatus.
  core,
}) {
  if (!rulerSpaceId || !branchName || !updates) return null;
  const active = await readActiveExecutionRecord(rulerSpaceId);
  if (!active?._recordNodeId) return null;
  const lowerBranch = String(branchName).trim().toLowerCase();
  const stepStatuses = Array.isArray(active.stepStatuses) ? active.stepStatuses : [];
  for (const step of stepStatuses) {
    if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
    const match = step.branches.find((b) => String(b?.name || "").toLowerCase() === lowerBranch);
    if (match) {
      return updateStepStatus({
        recordNodeId: active._recordNodeId,
        stepIndex: step.stepIndex,
        branchName,
        updates,
        identity,
        core,
      });
    }
  }
  return null;
}

/**
 * Freeze an execution-record. Flips its status to a terminal value
 * ("completed" | "failed" | "superseded" | "paused" | "cancelled")
 * and stamps completedAt.
 *
 * Fires a per-status hook so Pass 2 courts and Pass 3 reputation can
 * discriminate cleanly: `governing:executionCompleted`,
 * `governing:executionFailed`, `governing:executionCancelled`,
 * `governing:executionPaused`, `governing:executionSuperseded`.
 *
 * Distinct hook names matter because:
 *   - Cancelled (decided-not-to-finish) shouldn't trigger court
 *     adjudication the way Failed (tried-and-couldn't) might.
 *   - Reputation accounting treats them differently — failure dings
 *     the Ruler's track record; cancellation doesn't (operator
 *     intent isn't a Ruler failure).
 *   - Plan refinement triggers should fire on cancellation differently
 *     from failure (replan-around vs recover-from).
 */
export async function freezeExecutionRecord({
  recordNodeId,
  nextStatus = "completed",
  identity = null,
  // Phase 3 ([[project_seed_four_verbs_only]]): callers thread core.
  core,
}) {
  if (!recordNodeId) return null;
  if (!core?.do) throw new Error("freezeExecutionRecord requires `core` (verb surface)");
  const space = await Space.findById(recordNodeId);
  if (!space) return null;

  const meta = space.qualities instanceof Map
    ? space.qualities.get(NS)
    : space.qualities?.[NS];
  if (meta?.role !== "execution-record" || !meta?.execution) return null;

  const priorStatus = meta.execution.status;
  const execution = {
    ...meta.execution,
    status: nextStatus,
    completedAt: meta.execution.completedAt || new Date().toISOString(),
  };

  // Phase 3 migration: verb-surface write of the terminal execution
  // status. merge:true preserves siblings atomically.
  await core.do(space, "set-meta", {
    namespace: NS,
    data: { execution },
    merge: true,
  }, { identity });

  // Per-terminal-status hook fires. Fire only on actual transition
  // to a terminal state (idempotent re-freezes don't re-fire).
  if (nextStatus !== priorStatus) {
    const hookMap = {
      completed: "governing:executionCompleted",
      failed: "governing:executionFailed",
      cancelled: "governing:executionCancelled",
      paused: "governing:executionPaused",
      superseded: "governing:executionSuperseded",
    };
    const hookName = hookMap[nextStatus];
    if (hookName) {
      try {
        const { hooks } = await import("../../../seed/system/hooks.js");
        hooks.run(hookName, {
          recordNodeId: String(recordNodeId),
          priorStatus,
          completedAt: execution.completedAt,
          ordinal: execution.ordinal,
          planEmissionRef: execution.planEmissionRef,
          contractsEmissionRef: execution.contractsEmissionRef,
        }).catch(() => {});
      } catch (err) {
        log.debug("Governing", `${hookName} fire failed: ${err.message}`);
      }
    }
  }

  return execution;
}
