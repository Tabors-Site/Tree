// Execution stack snapshot. The Foreman's lens for call-stack-shaped
// reasoning: where am I in the recursive execution stack, what's
// running below, what's holding the stack, what's the next correct
// move?
//
// Distinct from rulerSnapshot — that one is the Ruler's "what does
// my domain need now?" lens. This one is the Foreman's "where are we
// in the call stack and what should I do?" lens. Two snapshots, one
// scope, different concerns.
//
// The snapshot walks DOWN through sub-Rulers (recursive, NO depth
// cap) and UP via lineage to capture parent-step context. Trees that
// legitimately need 12+ levels of nesting are allowed to nest as
// deep as the work demands; depth itself isn't a failure mode.
// Uncontrolled depth IS — and the kernel's tree circuit breaker is
// where that's caught, not here.
//
// Rendering applies a budget separately: the formatter shows the
// most-relevant frames in the prompt text and rolls up "+N deeper,
// status=clean" for the rest. Tree may be 20 deep; the snapshot data
// holds 20 frames; the render block presents the interesting subset.
// MAX_FRAMES below is a hard ceiling against runaway data structures
// (hundreds of frames would exhaust memory before exhausting tokens),
// not a depth limit.
//
// All reads are best-effort — a failed sub-frame walk doesn't break
// the snapshot. The Foreman gets what it can; what it can't see, it
// can probe with foreman-read-branch-detail.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { NS as ROLE_NS } from "./role.js";
import { readActivePlanEmission } from "./planApprovals.js";
import { readActiveExecutionRecord } from "./foreman.js";
import { readLineage } from "./lineage.js";

// MAX_FRAMES is a runaway-protection ceiling on the data structure,
// not a tree-depth cap. A tree with 256+ active Ruler frames is
// almost certainly a bug or a tree-circuit-breaker concern, not a
// situation we should be rendering snapshots for.
const MAX_FRAMES = 256;

// Rendering budget — how many frames to show in full. "Relevant"
// frames (active, failed, blocked) always render; remaining budget
// fills with done frames closest to the anchor; the rest collapses
// to a "+N deeper, status=clean" rollup line.
const RENDER_FRAME_BUDGET = 12;
const FAILURE_RENDER_CAP = 5;

/**
 * Compute one frame's data for the execution-stack snapshot. Reads
 * the active plan emission (for step descriptors) and the active
 * execution-record (for step statuses + failures). Returns null if
 * the node isn't a Ruler or has no active execution-record.
 */
async function buildFrame(rulerNodeId, depth) {
  if (!rulerNodeId) return null;

  const node = await Node.findById(rulerNodeId).select("_id name metadata children").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});
  if (meta[ROLE_NS]?.role !== "ruler") return null;

  const record = await readActiveExecutionRecord(rulerNodeId);
  const emission = await readActivePlanEmission(rulerNodeId);
  if (!record) {
    // Ruler exists but no execution-record yet (just promoted, plan
    // not yet approved). Render as an empty frame so the stack still
    // shows position.
    return {
      depth,
      rulerNodeId: String(rulerNodeId),
      rulerName: node.name || "(unnamed)",
      recordNodeId: null,
      recordOrdinal: null,
      status: "no-execution",
      currentStepIndex: null,
      currentStepDescriptor: null,
      totalSteps: emission?.steps?.length || 0,
      doneSteps: 0,
      failedSteps: 0,
      stepStatuses: [],
      cancellable: false,
      midExecution: false,
      pendingCancel: false,
      pendingPauseAt: null,
    };
  }

  const stepStatuses = Array.isArray(record.stepStatuses) ? record.stepStatuses : [];
  let currentStepIndex = null;
  let doneSteps = 0;
  let failedSteps = 0;
  let runningSteps = 0;
  // Artifact count proxy: STRICTLY done leaf steps = "things this
  // scope produced." advanced (Foreman override) and skipped
  // (bypassed) intentionally do NOT count as artifacts — neither
  // produced output. A workspace-specific richer artifact count
  // (file count, chapter count) can override this via metadata.
  let doneLeafCount = 0;
  // Any terminal status counts as "this step is settled, look
  // further for the current step." done, advanced, and skipped are
  // settled-with-progress; failed and cancelled are settled-without-
  // progress; superseded is replaced. All five mean "not the current
  // step."
  const STEP_TERMINAL = new Set([
    "done", "advanced", "skipped", "failed", "cancelled", "superseded",
  ]);
  for (const s of stepStatuses) {
    if (s?.status === "done") doneSteps++;
    else if (s?.status === "failed") failedSteps++;
    else if (s?.status === "running") runningSteps++;
    if (s?.type === "leaf" && s?.status === "done") doneLeafCount++;
    if (currentStepIndex === null && !STEP_TERMINAL.has(s?.status)) {
      currentStepIndex = s.stepIndex;
    }
  }

  // Step descriptor for the current step. Pulls from the plan emission
  // when available so the Foreman sees the actual spec / rationale, not
  // just an index.
  let currentStepDescriptor = null;
  if (currentStepIndex !== null && emission?.steps) {
    const step = emission.steps[currentStepIndex - 1];
    if (step?.type === "leaf") {
      currentStepDescriptor = `step ${currentStepIndex} of ${stepStatuses.length}: leaf — ${step.spec || "(no spec)"}`;
    } else if (step?.type === "branch") {
      const subs = Array.isArray(step.branches)
        ? step.branches.map((b) => b.name).filter(Boolean)
        : [];
      currentStepDescriptor =
        `step ${currentStepIndex} of ${stepStatuses.length}: branch ` +
        (subs.length ? `(${subs.join(", ")})` : "(no sub-domains)");
    }
  }

  // The pending-cancel and pending-pause-at fields land in the
  // execution-record when Phase B's stack-op tools fire. Phase A
  // surfaces them in the snapshot so subsequent phases don't have to
  // re-thread them.
  const pendingCancel = !!record.pendingCancel;
  const pendingPauseAt = typeof record.pendingPauseAt === "number"
    ? record.pendingPauseAt
    : null;

  // cancellable: a frame is cancellable while it's running (status
  // not in terminal set).
  const TERMINAL = new Set(["completed", "failed", "superseded", "paused", "cancelled"]);
  const cancellable = !TERMINAL.has(record.status);

  // midExecution: any step is currently running (or any sub-branch
  // running within a branch step).
  let midExecution = runningSteps > 0;
  if (!midExecution) {
    for (const s of stepStatuses) {
      if (s?.type !== "branch" || !Array.isArray(s.branches)) continue;
      if (s.branches.some((b) => b?.status === "running")) {
        midExecution = true;
        break;
      }
    }
  }

  return {
    depth,
    rulerNodeId: String(rulerNodeId),
    rulerName: node.name || "(unnamed)",
    recordNodeId: record._recordNodeId,
    recordOrdinal: record.ordinal,
    status: record.status,
    startedAt: record.startedAt || null,
    completedAt: record.completedAt || null,
    currentStepIndex,
    currentStepDescriptor,
    totalSteps: stepStatuses.length,
    doneSteps,
    failedSteps,
    runningSteps,
    doneLeafCount,
    stepStatuses,
    cancellable,
    midExecution,
    pendingCancel,
    pendingPauseAt,
  };
}

/**
 * Walk DOWN through sub-Rulers recursively, building one frame per
 * Ruler scope. Bounded by depth cap and total frame cap. Frames that
 * are fully done (no failures, no in-flight) collapse via the renderer
 * later but stay in the data shape so callers can inspect them.
 */
async function walkDown(rulerNodeId, depth, framesOut) {
  if (framesOut.length >= MAX_FRAMES) return;
  const frame = await buildFrame(rulerNodeId, depth);
  if (!frame) return;
  framesOut.push(frame);

  // Recurse into sub-Rulers (children with role=ruler). We use the
  // execution-record's stepStatuses[].branches[].childNodeId when
  // present (the canonical sub-Ruler reference), and fall back to the
  // tree's actual children with role=ruler when childNodeId is absent
  // (e.g., orphaned sub-Rulers from older runs).
  try {
    const rulerNode = await Node.findById(rulerNodeId).select("children").lean();
    if (!rulerNode?.children?.length) return;

    // Collect known sub-Ruler IDs from stepStatuses (more authoritative).
    const knownSubRulerIds = new Set();
    for (const step of frame.stepStatuses || []) {
      if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
      for (const b of step.branches) {
        if (b?.childNodeId) knownSubRulerIds.add(String(b.childNodeId));
      }
    }

    // Walk all child rulers — both known and orphaned. Orphaned ones
    // (rulers that the parent's stepStatuses don't reference) still
    // exist in the tree and may have their own work; the Foreman should
    // see them.
    const childIds = rulerNode.children.map(String);
    const kids = await Node.find({ _id: { $in: childIds } })
      .select("_id metadata").lean();
    for (const k of kids) {
      const km = k.metadata instanceof Map
        ? Object.fromEntries(k.metadata)
        : (k.metadata || {});
      if (km[ROLE_NS]?.role !== "ruler") continue;
      await walkDown(k._id, depth + 1, framesOut);
      if (framesOut.length >= MAX_FRAMES) break;
    }
  } catch (err) {
    log.debug("Governing/Stack", `walkDown skipped: ${err.message}`);
  }
}

/**
 * Walk UP via lineage to capture the parent step that dispatched this
 * sub-Ruler. Returns the parent context — parent ruler id, the
 * specific step + entry that produced this scope, and the parent's
 * sibling-branch states so the Foreman can see if other siblings
 * have completed/failed.
 *
 * Returns null when this scope has no parent (root Ruler).
 */
async function walkUp(rulerNodeId) {
  if (!rulerNodeId) return null;
  const lineage = await readLineage(rulerNodeId);
  if (!lineage?.parentRulerId) return null;

  const parent = await Node.findById(lineage.parentRulerId)
    .select("_id name").lean();
  if (!parent) return null;

  const parentRecord = await readActiveExecutionRecord(lineage.parentRulerId);
  let parentSiblings = [];
  let parentStepStatus = null;
  if (parentRecord && lineage.parentStepIndex) {
    const step = (parentRecord.stepStatuses || [])
      .find((s) => s?.stepIndex === lineage.parentStepIndex);
    if (step?.type === "branch" && Array.isArray(step.branches)) {
      parentStepStatus = step.status;
      parentSiblings = step.branches.map((b) => ({
        name: b.name,
        status: b.status,
        error: b.error || null,
        retries: b.retries || 0,
        completedAt: b.completedAt || null,
        // Mark which entry IS this sub-Ruler so the renderer can
        // highlight "← YOU" alongside the parent context.
        isSelf: lineage.parentBranchEntryName
          && String(b.name).toLowerCase() === String(lineage.parentBranchEntryName).toLowerCase(),
      }));
    }
  }

  return {
    parentRulerId: String(lineage.parentRulerId),
    parentRulerName: parent.name || "(unnamed)",
    parentStepIndex: lineage.parentStepIndex || null,
    parentStepStatus,
    parentBranchEntryName: lineage.parentBranchEntryName || null,
    expandingFromSpec: lineage.expandingFromSpec || null,
    parentSiblings,
  };
}

/**
 * Compute blockedOn entries — the rollup of "what's holding the
 * stack." Each entry names a frame + reason + the action category
 * the Foreman should consider. Derived from frame state by rules,
 * not from any single field.
 *
 * Rules:
 *   - A frame with at least one failed step that's out of retries:
 *     blocked on that failure; required action retry-with-approval /
 *     mark-failed / escalate.
 *   - A frame with paused status: blocked on operator-or-court resume
 *     decision.
 *   - A frame with all sub-branches done but parent still "running":
 *     blocked on rollup (terminal-detection should freeze it; if it
 *     doesn't, that's a substrate issue).
 *   - A frame with status=running + no current step movement for
 *     extended period: not detected here (no time-tracking yet);
 *     deferred to Pass 3.
 */
function computeBlockedOn(frames) {
  const out = [];
  for (const frame of frames) {
    // Failure-driven block.
    for (const step of frame.stepStatuses || []) {
      if (step?.type === "branch" && Array.isArray(step.branches)) {
        for (const b of step.branches) {
          if (b?.status === "failed") {
            const retriesLeft = (b.retries || 0) === 0; // 0 retries = none yet, but Pass 1 caps at 1
            out.push({
              frameDepth: frame.depth,
              rulerName: frame.rulerName,
              branchName: b.name,
              reason: (b.error || "(no error message)").slice(0, 200),
              retriesUsed: b.retries || 0,
              requiredAction: retriesLeft
                ? "retry-or-escalate"
                : "mark-failed-and-escalate-or-cancel",
            });
          }
        }
      } else if (step?.type === "leaf" && step.status === "failed") {
        out.push({
          frameDepth: frame.depth,
          rulerName: frame.rulerName,
          branchName: null,
          // workerType travels with the failure so the Foreman can
          // reason about whether the failure shape matches the type
          // (a build failure is different from a refine failure
          // different from a review's adverse finding).
          workerType: step.workerType || "build",
          stepIndex: step.stepIndex,
          reason: (step.error || "(no error message)").slice(0, 200),
          retriesUsed: step.retries || 0,
          requiredAction: "mark-failed-and-escalate",
        });
      }
    }
    // Paused frame.
    if (frame.status === "paused") {
      out.push({
        frameDepth: frame.depth,
        rulerName: frame.rulerName,
        branchName: null,
        reason: "execution paused — awaiting operator/court decision",
        requiredAction: "resume-or-cancel",
      });
    }
    // Pending-cancel marker (set but queue hasn't halted yet).
    if (frame.pendingCancel) {
      out.push({
        frameDepth: frame.depth,
        rulerName: frame.rulerName,
        branchName: null,
        reason: "cancellation pending — queue will halt at next dispatch boundary",
        requiredAction: "wait-for-halt",
      });
    }
  }
  return out;
}

/**
 * Compute non-prescriptive decision hints the renderer surfaces under
 * "DECISION POINTS". These are not commands; they're suggestions that
 * map blockedOn entries to candidate Foreman tools. The Foreman reads
 * the rendered hints and picks one tool — or ignores the hints and
 * picks something else if its judgment differs.
 */
function computeDecisionHints(frames, blockedOn) {
  const hints = [];
  for (const block of blockedOn) {
    if (block.requiredAction === "retry-or-escalate") {
      hints.push(
        `Retry ${block.branchName}? (` +
        `${block.retriesUsed} retr${block.retriesUsed === 1 ? "y" : "ies"} used; ` +
        `judge whether the failure looks transient)`,
      );
      hints.push(
        `Escalate to Ruler? (the parent Ruler may need to revise the plan ` +
        `if this failure indicates the decomposition is wrong)`,
      );
    } else if (block.requiredAction === "mark-failed-and-escalate-or-cancel") {
      hints.push(
        `Mark ${block.branchName || `step at ${block.rulerName}`} terminally failed ` +
        `and freeze the record? (retries exhausted)`,
      );
      hints.push(
        `Cancel the subtree? (would invalidate completed sibling work — ` +
        `weigh against the cost of re-doing successful branches)`,
      );
      hints.push(
        `Escalate to Ruler for replan? (if the failure exposes a wrong decomposition)`,
      );
    } else if (block.requiredAction === "resume-or-cancel") {
      hints.push(
        `Resume the paused frame? (will re-enter at the saved step index)`,
      );
      hints.push(
        `Cancel the subtree? (if the conditions that motivated the pause won't resolve)`,
      );
    }
  }
  return hints;
}

/**
 * Compute resume anchors — per-frame currentStepIndex captures so a
 * future foreman-resume-frame call can re-enter at the right step.
 * Frames with no current step (all done) don't produce anchors.
 */
function computeResumeAnchors(frames) {
  const out = [];
  for (const frame of frames) {
    if (frame.currentStepIndex === null) continue;
    if (!frame.recordNodeId) continue;
    out.push({
      frameDepth: frame.depth,
      rulerNodeId: frame.rulerNodeId,
      recordNodeId: frame.recordNodeId,
      currentStepIndex: frame.currentStepIndex,
    });
  }
  return out;
}

/**
 * Top-level: build the full execution-stack snapshot anchored at a
 * Ruler scope. Returns null when the node isn't a Ruler.
 *
 * The snapshot's "anchor" is the Foreman's CURRENT scope. That frame
 * lands at depth 0; sub-frames descend; parent context (if any) lives
 * in `parentContext`.
 */
export async function buildExecutionStackSnapshot(rulerNodeId) {
  if (!rulerNodeId) return null;
  const rootFrame = await buildFrame(rulerNodeId, 0);
  if (!rootFrame) return null;

  const frames = [];
  await walkDown(rulerNodeId, 0, frames);

  const parentContext = await walkUp(rulerNodeId);
  const blockedOn = computeBlockedOn(frames);
  const decisionHints = computeDecisionHints(frames, blockedOn);
  const resumeAnchors = computeResumeAnchors(frames);

  return {
    rootRulerId: String(rulerNodeId),
    rootRulerName: rootFrame.rulerName,
    frames,
    parentContext,
    blockedOn,
    decisionHints,
    resumeAnchors,
    framesTruncated: frames.length >= MAX_FRAMES,
  };
}

// ─────────────────────────────────────────────────────────────────────
// FORMATTING
// ─────────────────────────────────────────────────────────────────────

// Status icons. Each terminal status gets a distinct glyph so the
// Foreman can scan the rendered stack without confusing failure
// (tried-and-couldn't) with cancellation (decided-not-to-finish) or
// either with skipped (bypassed) or advanced (Foreman override).
const STATUS_ICON = {
  done: "✓",         // success
  completed: "✓",    // success (record-level alias)
  failed: "✗",       // tried, couldn't
  cancelled: "■",    // decided not to finish (deliberate stop)
  superseded: "↻",   // replaced by newer emission
  paused: "⏸",       // paused, will resume
  skipped: "↷",      // bypassed (precondition unmet)
  advanced: "⇒",     // Foreman explicit override past a stuck step
  blocked: "⊘",      // blocked waiting on something
  running: "▶",      // in-flight
  pending: "○",      // queued
};

function statusIcon(s) {
  return STATUS_ICON[s] || "?";
}

/**
 * Render one frame as an indented block. Pruning: a fully-done frame
 * (no failures, no in-flight) collapses to a one-liner; active frames
 * render the full step list.
 */
function formatFrame(frame, indent) {
  const pad = " ".repeat(indent * 2);
  const fullyDoneNoFailures = frame.status === "completed"
    && frame.failedSteps === 0
    && frame.totalSteps > 0;
  if (fullyDoneNoFailures) {
    // Artifact count tells the Foreman whether read-branch-detail is
    // worth calling — a frame that produced no leaf artifacts may
    // have just been a coordination scope (all branches), nothing to
    // inspect; a frame with N leaf-step outputs has work to read.
    const artifacts = frame.doneLeafCount > 0
      ? `, produced ${frame.doneLeafCount} leaf output${frame.doneLeafCount === 1 ? "" : "s"}`
      : "";
    return `${pad}${statusIcon(frame.status)} ${frame.rulerName}: completed (${frame.doneSteps}/${frame.totalSteps} steps${artifacts})`;
  }

  const lines = [];
  const headLine = frame.depth === 0
    ? `You are at: ${frame.rulerName} / ` +
      (frame.currentStepDescriptor || `(no current step — status=${frame.status})`)
    : `${pad}${statusIcon(frame.status)} ${frame.rulerName}: ` +
      (frame.currentStepDescriptor || `status=${frame.status}, ${frame.doneSteps}/${frame.totalSteps} done`);
  lines.push(headLine);

  // Render step statuses for active frames.
  if (frame.totalSteps > 0 && frame.status !== "completed") {
    for (const step of frame.stepStatuses || []) {
      const stepPad = pad + (frame.depth === 0 ? "  " : "    ");
      const icon = statusIcon(step.status || "pending");
      if (step?.type === "leaf") {
        const spec = step.spec ? `: ${truncate(step.spec, 100)}` : "";
        const wt = step.workerType ? ` ${step.workerType}` : "";
        lines.push(`${stepPad}${icon} step ${step.stepIndex} [leaf${wt}]${spec}`);
        if (step.status === "failed" && step.error) {
          lines.push(`${stepPad}    error: ${truncate(step.error, 200)}`);
        } else if (step.status === "blocked" && (step.reason || step.error)) {
          lines.push(`${stepPad}    blocked: ${truncate(step.reason || step.error, 200)}`);
        } else if (step.status === "advanced" && step.reason) {
          lines.push(`${stepPad}    advanced: ${truncate(step.reason, 200)}`);
        }
      } else if (step?.type === "branch") {
        const rationale = step.rationale ? `: ${truncate(step.rationale, 100)}` : "";
        lines.push(`${stepPad}${icon} step ${step.stepIndex} [branch]${rationale}`);
        const subs = Array.isArray(step.branches) ? step.branches : [];
        for (const b of subs) {
          const subIcon = statusIcon(b.status || "pending");
          let subLine = `${stepPad}    ${subIcon} ${b.name}: ${b.status || "pending"}`;
          if (b.retries) subLine += ` (${b.retries} retr${b.retries === 1 ? "y" : "ies"})`;
          lines.push(subLine);
          if (b.status === "failed" && b.error) {
            lines.push(`${stepPad}      error: ${truncate(b.error, 200)}`);
          }
        }
      }
    }
  }

  if (frame.pendingCancel) {
    lines.push(`${pad}  ⚠ pending-cancel set — queue halts at next dispatch boundary`);
  }
  if (frame.pendingPauseAt) {
    lines.push(`${pad}  ⏸ pending-pause-at step ${frame.pendingPauseAt}`);
  }

  return lines.join("\n");
}

function truncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Render the snapshot as a Foreman-prompt block. Format follows the
 * directive's example: indented stack tree, status icons, "WAITING
 * ON" rollup, "DECISION POINTS" hints.
 */
export function formatExecutionStack(snapshot) {
  if (!snapshot) return "";
  const lines = [];
  lines.push("=================================================================");
  lines.push(`EXECUTION STACK`);
  lines.push("=================================================================");
  lines.push("");

  // Parent context (if this is a sub-Ruler).
  if (snapshot.parentContext) {
    const pc = snapshot.parentContext;
    lines.push(`Parent: ${pc.parentRulerName} / step ${pc.parentStepIndex || "?"} ` +
      `(branch entry "${pc.parentBranchEntryName || "?"}")`);
    if (pc.expandingFromSpec) {
      lines.push(`  Inherited spec: "${truncate(pc.expandingFromSpec, 200)}"`);
    }
    if (pc.parentSiblings?.length) {
      lines.push(`  Sibling sub-Rulers under parent step ${pc.parentStepIndex}:`);
      for (const sib of pc.parentSiblings) {
        const tag = sib.isSelf ? "  ← YOU" : "";
        const errBit = sib.error ? ` (${truncate(sib.error, 100)})` : "";
        lines.push(`    ${statusIcon(sib.status)} ${sib.name}: ${sib.status}${errBit}${tag}`);
      }
    }
    lines.push("");
  }

  // Render frames within the prompt budget. "Relevant" frames
  // (active / failed / paused / pending-cancel / blocked) always
  // render in full. The remaining budget fills with done frames
  // closest to the anchor (depth 0). Frames beyond the budget
  // collapse to a "+N deeper, status=clean" rollup.
  const isRelevant = (f) =>
    f.status !== "completed"
    && f.status !== "no-execution"
    || f.failedSteps > 0
    || f.pendingCancel
    || f.pendingPauseAt;

  const relevantFrames = snapshot.frames.filter(isRelevant);
  const cleanFrames = snapshot.frames.filter((f) => !isRelevant(f));
  const remainingBudget = Math.max(0, RENDER_FRAME_BUDGET - relevantFrames.length);
  const cleanShown = cleanFrames.slice(0, remainingBudget);
  const cleanRolledUp = cleanFrames.slice(remainingBudget);

  // Render in depth order so the tree shape reads top-down.
  const rendered = new Set();
  for (const f of [...relevantFrames, ...cleanShown]) rendered.add(f);
  for (const frame of snapshot.frames) {
    if (!rendered.has(frame)) continue;
    lines.push(formatFrame(frame, frame.depth));
  }

  if (cleanRolledUp.length > 0) {
    const minDepth = Math.min(...cleanRolledUp.map((f) => f.depth));
    const maxDepth = Math.max(...cleanRolledUp.map((f) => f.depth));
    const depthRange = minDepth === maxDepth ? `depth ${minDepth}` : `depths ${minDepth}-${maxDepth}`;
    lines.push("");
    lines.push(`(+${cleanRolledUp.length} deeper frames omitted, status=clean, ${depthRange} — use foreman-read-branch-detail if you need to inspect)`);
  }
  if (snapshot.framesTruncated) {
    lines.push("");
    lines.push(`(snapshot data structure truncated at ${MAX_FRAMES} frames — deeper sub-Rulers exist that the snapshot itself didn't capture)`);
  }

  // Blocked-on rollup.
  if (snapshot.blockedOn?.length) {
    lines.push("");
    lines.push("WAITING ON:");
    for (const b of snapshot.blockedOn.slice(0, FAILURE_RENDER_CAP)) {
      const where = b.branchName
        ? `${b.rulerName} / ${b.branchName}`
        : b.rulerName;
      // For leaf failures, surface the workerType so the Foreman
      // reads "build failed" / "refine failed" / "review failed" /
      // "integrate failed" — the cognitive shape of the failed work
      // is part of the judgment surface.
      const typeTag = b.workerType
        ? ` (${b.workerType}${typeof b.stepIndex === "number" ? ` step ${b.stepIndex}` : ""})`
        : "";
      lines.push(`  • [${b.frameDepth}] ${where}${typeTag}: ${b.reason}`);
    }
    if (snapshot.blockedOn.length > FAILURE_RENDER_CAP) {
      lines.push(`  ... and ${snapshot.blockedOn.length - FAILURE_RENDER_CAP} more`);
    }
  }

  // Decision hints. Always closed with an explicit "Other" so the
  // Foreman doesn't read the list as exhaustive — its judgment is
  // free to pick a tool the hints didn't suggest.
  if (snapshot.decisionHints?.length || snapshot.blockedOn?.length) {
    lines.push("");
    lines.push("DECISION POINTS (non-exhaustive — pick by judgment, not by list):");
    for (const h of (snapshot.decisionHints || []).slice(0, 6)) {
      lines.push(`  - ${h}`);
    }
    lines.push(`  - Other? (your read of the stack may warrant a different tool — pick what fits)`);
  }

  return lines.join("\n");
}

/**
 * Convenience: build + format. Most callers want the formatted string.
 */
export async function renderExecutionStack(rulerNodeId) {
  const snapshot = await buildExecutionStackSnapshot(rulerNodeId);
  if (!snapshot) return "";
  return formatExecutionStack(snapshot);
}

// ─────────────────────────────────────────────────────────────────────
// ARTIFACT EVIDENCE (Foreman wakeup payload)
// ─────────────────────────────────────────────────────────────────────
//
// The Foreman's stack snapshot tells it WHAT THE STATUSES SAY. The
// artifact-evidence block tells it WHAT'S ACTUALLY ON THE TREE — note
// counts at the Ruler scope, child-node names with their own note
// counts, and any pending blocking flags. Without this block the
// Foreman judges only against step.status (which the dispatcher writes)
// and never against tree reality (notes / children / artifacts).
//
// All reads are best-effort. If a probe fails the Foreman just sees
// the evidence it could collect; the snapshot keeps rendering.

const EVIDENCE_NOTE_PREVIEW_CHARS = 160;
const EVIDENCE_CHILDREN_RENDER_CAP = 16;
const EVIDENCE_FLAGS_RENDER_CAP = 5;

/**
 * Probe the Ruler scope node + its children + its pending flags and
 * build a compact data structure the Foreman can scan.
 *
 * Returns null when the node isn't found.
 */
export async function buildArtifactEvidence(rulerNodeId) {
  if (!rulerNodeId) return null;
  let node;
  try {
    node = await Node.findById(rulerNodeId)
      .select("_id name type children")
      .lean();
  } catch (err) {
    log.debug("Governing/Evidence", `node lookup failed: ${err.message}`);
    return null;
  }
  if (!node) return null;

  // Probe the Ruler scope's own notes. getNotes returns { notes: [...] }.
  let scopeNotes = [];
  try {
    const { getNotes } = await import("../../../seed/tree/notes.js");
    const got = await getNotes({ nodeId: String(node._id), limit: 50 });
    scopeNotes = Array.isArray(got?.notes) ? got.notes : [];
  } catch (err) {
    log.debug("Governing/Evidence", `scope notes fetch failed: ${err.message}`);
  }

  // Probe each child: name + note count. We cap the work at a
  // reasonable number of children so a wide scope doesn't blow up the
  // probe. Children beyond the cap collapse to a count line.
  const childIds = Array.isArray(node.children) ? node.children.map(String) : [];
  const childRows = [];
  try {
    if (childIds.length > 0) {
      const probeIds = childIds.slice(0, EVIDENCE_CHILDREN_RENDER_CAP * 2);
      const childNodes = await Node.find({ _id: { $in: probeIds } })
        .select("_id name type")
        .lean();
      const byId = new Map(childNodes.map((c) => [String(c._id), c]));
      const { getNotes } = await import("../../../seed/tree/notes.js");
      for (const cid of probeIds) {
        const c = byId.get(cid);
        if (!c) continue;
        let noteCount = 0;
        let firstNotePreview = null;
        try {
          const got = await getNotes({ nodeId: cid, limit: 5 });
          const notes = Array.isArray(got?.notes) ? got.notes : [];
          noteCount = notes.length;
          // getNotes orders DESC by createdAt — most recent first.
          // The "first line" preview is the most recent note's opener.
          if (notes[0]?.content) {
            firstNotePreview = String(notes[0].content)
              .split("\n").filter((l) => l.trim().length > 0)[0] || "";
            if (firstNotePreview.length > EVIDENCE_NOTE_PREVIEW_CHARS) {
              firstNotePreview = firstNotePreview.slice(0, EVIDENCE_NOTE_PREVIEW_CHARS - 1) + "…";
            }
          }
        } catch {}
        childRows.push({
          nodeId: cid,
          name: c.name || "(unnamed)",
          type: c.type || null,
          noteCount,
          firstNotePreview,
        });
      }
    }
  } catch (err) {
    log.debug("Governing/Evidence", `children probe failed: ${err.message}`);
  }

  // Pending blocking flags at this Ruler — surfaces refusals the
  // Worker emitted during dispatch.
  let pendingFlags = [];
  try {
    const { readPendingIssues } = await import("./flagQueue.js");
    const all = await readPendingIssues(rulerNodeId);
    pendingFlags = Array.isArray(all) ? all : [];
  } catch (err) {
    log.debug("Governing/Evidence", `pending flags fetch failed: ${err.message}`);
  }

  // Pick the most-recent scope-note preview the same way as for
  // children — first non-empty line of the newest note.
  let scopeFirstNotePreview = null;
  let scopeMostRecentAt = null;
  if (scopeNotes[0]?.content) {
    scopeFirstNotePreview = String(scopeNotes[0].content)
      .split("\n").filter((l) => l.trim().length > 0)[0] || "";
    if (scopeFirstNotePreview.length > EVIDENCE_NOTE_PREVIEW_CHARS) {
      scopeFirstNotePreview = scopeFirstNotePreview.slice(0, EVIDENCE_NOTE_PREVIEW_CHARS - 1) + "…";
    }
    scopeMostRecentAt = scopeNotes[0].createdAt || null;
  }

  return {
    rulerNodeId: String(node._id),
    rulerName: node.name || "(unnamed)",
    rulerType: node.type || null,
    scopeNoteCount: scopeNotes.length,
    scopeFirstNotePreview,
    scopeMostRecentAt,
    totalChildren: childIds.length,
    childrenRendered: childRows.slice(0, EVIDENCE_CHILDREN_RENDER_CAP),
    childrenTruncated: childIds.length > EVIDENCE_CHILDREN_RENDER_CAP,
    pendingFlags,
  };
}

/**
 * Render the artifact-evidence block as a prompt-ready string. Returns
 * "" when nothing useful was collected (caller can drop the section).
 */
export function formatArtifactEvidence(evidence) {
  if (!evidence) return "";
  const lines = [];
  lines.push("=================================================================");
  lines.push("ARTIFACT EVIDENCE AT THIS SCOPE");
  lines.push("=================================================================");
  lines.push("");
  lines.push(`Ruler scope: ${evidence.rulerName} (${evidence.rulerType || "node"})`);
  lines.push("");

  // Scope-level notes.
  if (evidence.scopeNoteCount > 0) {
    lines.push(`Notes on the Ruler scope itself: ${evidence.scopeNoteCount}`);
    if (evidence.scopeFirstNotePreview) {
      lines.push(`  most-recent preview: "${evidence.scopeFirstNotePreview}"`);
    }
  } else {
    lines.push("Notes on the Ruler scope itself: 0  (no scope-level artifact present)");
  }
  lines.push("");

  // Children. A scope-decomposed plan often promises child nodes per
  // leaf (a chapter-outline node, a research-notes node, a works-cited
  // node). If those names are missing here, the Worker that "did" the
  // step didn't actually create what it promised.
  if (evidence.totalChildren > 0) {
    lines.push(`Child nodes under this scope: ${evidence.totalChildren}` +
      (evidence.childrenTruncated ? ` (showing first ${evidence.childrenRendered.length})` : ""));
    for (const c of evidence.childrenRendered) {
      const noteTag = c.noteCount > 0 ? ` — ${c.noteCount} note${c.noteCount === 1 ? "" : "s"}` : " — 0 notes (empty)";
      const typeTag = c.type ? ` [${c.type}]` : "";
      lines.push(`  • ${c.name}${typeTag}${noteTag}`);
      if (c.firstNotePreview) {
        lines.push(`      preview: "${c.firstNotePreview}"`);
      }
    }
  } else {
    lines.push("Child nodes under this scope: 0  (no sub-artifacts created)");
  }
  lines.push("");

  // Pending blocking flags — Workers refused these.
  const blockers = (evidence.pendingFlags || []).filter((f) => f && f.blocking);
  if (blockers.length > 0) {
    lines.push(`PENDING BLOCKING FLAGS: ${blockers.length}`);
    for (const f of blockers.slice(0, EVIDENCE_FLAGS_RENDER_CAP)) {
      const wt = f.sourceWorker?.workerType ? ` (${f.sourceWorker.workerType})` : "";
      const where = f.artifactContext?.scope
        ? `${f.artifactContext.scope}${f.artifactContext.file ? "/" + f.artifactContext.file : ""}`
        : (f.artifactContext?.file || "?");
      lines.push(`  • ${f.kind}${wt} at ${where}`);
      const choice = String(f.localChoice || "").slice(0, 200);
      if (choice) lines.push(`      Worker said: ${choice}`);
      if (f.proposedResolution) {
        lines.push(`      proposed:    ${String(f.proposedResolution).slice(0, 200)}`);
      }
    }
    if (blockers.length > EVIDENCE_FLAGS_RENDER_CAP) {
      lines.push(`  ... and ${blockers.length - EVIDENCE_FLAGS_RENDER_CAP} more`);
    }
    lines.push("");
  }

  lines.push("READ THIS BEFORE YOU FREEZE: a step marked done WITHOUT a");
  lines.push("matching note or child node above is a status lie — the Worker's");
  lines.push("turn ended but the promised artifact does not exist. If the plan");
  lines.push("promised a 'chapter-1-outline' node and there's no child by that");
  lines.push("name, do NOT freeze the record as completed. Use get-node-notes");
  lines.push("on specific children to verify deeper, then freeze as 'partial'");
  lines.push("or escalate to the Ruler.");
  return lines.join("\n");
}

/**
 * Convenience: build + format the artifact-evidence block.
 */
export async function renderArtifactEvidence(rulerNodeId) {
  const evidence = await buildArtifactEvidence(rulerNodeId);
  if (!evidence) return "";
  return formatArtifactEvidence(evidence);
}
