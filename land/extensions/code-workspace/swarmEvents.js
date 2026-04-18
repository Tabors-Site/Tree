/**
 * code-workspace — code-local swarm facets.
 *
 * Swarm (the extension) owns mechanism: subPlan, inbox, aggregatedDetail,
 * events, contracts. All of that lives under metadata.swarm. Code-workspace
 * owns the code-specific facets that sit on top:
 *
 *   - SIGNAL_KIND: the cascade signal kinds code-workspace emits
 *   - summarizeWrite / summaryTier: one-line tier-ranked summary derivation
 *   - Node-local plan steps at metadata.code-workspace.plan.* (NOT swarm)
 *   - Prompt formatters for swarm's opaque state (signal inbox, aggregated
 *     detail, contracts, events, per-node plan)
 *   - Code-specific signal predicates (prune probe failure for endpoint,
 *     prune contract mismatches for file, find blocking syntax error)
 *   - replaceContractsFromFile: source-file-scoped contract replacement
 *     backed by swarm.setContracts / swarm.readContracts
 *
 * Swarm access is deferred — the file never imports swarm at module load.
 * Every call site that needs swarm primitives resolves them via
 * getExtension("swarm").exports at runtime.
 */

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";

const NS = "code-workspace";

function readMeta(node) {
  if (!node?.metadata) return null;
  if (node.metadata instanceof Map) return node.metadata.get(NS) || null;
  return node.metadata[NS] || null;
}

/**
 * Generic namespace write. Reads current code-workspace metadata, applies
 * the mutator, writes back via setExtMeta (if available) or direct $set.
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

async function getSwarm() {
  const { getExtension } = await import("../loader.js");
  return getExtension("swarm")?.exports;
}

// ─────────────────────────────────────────────────────────────────────
// SIGNAL KIND ENUM
// ─────────────────────────────────────────────────────────────────────

/**
 * Cascade signal kind enum. Adding a new kind means: (a) add it here,
 * (b) add a renderer branch in formatSignalInbox, (c) emit it from the
 * source path that detects the condition.
 */
export const SIGNAL_KIND = Object.freeze({
  CONTRACT: "contract",
  SYNTAX_ERROR: "syntax-error",
  CONTRACT_MISMATCH: "contract-mismatch",
  RUNTIME_ERROR: "runtime-error",
  TEST_FAILURE: "test-failure",
  DEAD_RECEIVER: "dead-receiver",
  PROBE_FAILURE: "probe-failure",
  COHERENCE_GAP: "coherence-gap",
});

// ─────────────────────────────────────────────────────────────────────
// NODE-LOCAL PLAN STEPS
// ─────────────────────────────────────────────────────────────────────
//
// Every workspace node can carry its own checklist under
// metadata["code-workspace"].plan.steps[]. Shape per step:
//
//   { id, title, status: "pending"|"done"|"blocked",
//     createdAt, completedAt?, blockedReason?, note? }
//
// Plan steps live in code-workspace's own namespace, separate from swarm's
// subPlan which is about branch dispatch. Rollup counts flow UP via
// rollUpStepCounts → every ancestor sees the aggregated state without
// walking the whole tree. Stored at metadata.code-workspace.plan.rollup.

function makeStepId() {
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
  const steps = meta?.plan?.steps;
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
 * Recompute this node's plan.rollup as:
 *   (own local step counts) + (sum of every direct child's rollup,
 *   which itself already includes its descendants).
 *
 * Stored at metadata.code-workspace.plan.rollup with shape
 * { pending, done, blocked }.
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
      const cAgg = cMeta?.plan?.rollup;
      if (cAgg) {
        agg.pending += cAgg.pending || 0;
        agg.done += cAgg.done || 0;
        agg.blocked += cAgg.blocked || 0;
      }
    }
  }

  await mutateMeta(nodeId, (draft) => {
    if (!draft.plan) draft.plan = {};
    draft.plan.rollup = agg;
    return draft;
  }, core);

  return agg;
}

/**
 * Walk from a node upward, recomputing stepCounts at every ancestor.
 * Stops at the project root OR when it hits a node without code-workspace
 * metadata. Idempotent.
 */
async function rollUpStepCounts(fromNodeId, core) {
  if (!fromNodeId) return;
  let cursor = String(fromNodeId);
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id parent metadata").lean();
    if (!n) return;
    const meta = readMeta(n);
    if (!meta) return;
    await recomputeStepRollup(cursor, core);
    if (meta.role === "project") return;
    if (!n.parent) return;
    cursor = String(n.parent);
    guard++;
  }
}

/**
 * Overwrite a node's plan steps. Accepts a raw step array and fills in
 * id/status/createdAt defaults. Rolls the counts up the ancestor chain.
 */
export async function setNodePlanSteps({ nodeId, steps, core }) {
  if (!nodeId || !Array.isArray(steps)) return null;
  const nowIso = new Date().toISOString();
  const before = await Node.findById(nodeId).select("metadata").lean();
  const beforeCount = readMeta(before)?.plan?.steps?.length || 0;

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
    if (!draft.plan) draft.plan = {};
    draft.plan.steps = normalized;
    draft.plan.updatedAt = nowIso;
    draft.plan.driftAt = null;
    draft.plan.driftReason = null;
    return draft;
  }, core);
  await rollUpStepCounts(nodeId, core);

  const afterCount = normalized.length;
  const reason = beforeCount === 0
    ? `set plan (${afterCount} steps)`
    : `replanned ${beforeCount} → ${afterCount} steps`;
  await maybeDriftParentOnStructuralChange({ childNodeId: nodeId, reason, core });

  return out?.plan?.steps || null;
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
    if (!draft.plan) draft.plan = {};
    if (!Array.isArray(draft.plan.steps)) draft.plan.steps = [];
    draft.plan.steps.push(step);
    draft.plan.updatedAt = nowIso;
    draft.plan.driftAt = null;
    draft.plan.driftReason = null;
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
    const steps = draft?.plan?.steps;
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
    if (draft.plan) {
      draft.plan.updatedAt = nowIso;
      draft.plan.driftAt = null;
      draft.plan.driftReason = null;
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
  return meta?.plan?.steps || null;
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
  return meta?.plan?.rollup || null;
}

/**
 * Drop all steps from a node's plan. Rolls counts up after clearing.
 */
export async function clearNodePlanSteps({ nodeId, core }) {
  if (!nodeId) return null;
  await mutateMeta(nodeId, (draft) => {
    if (draft?.plan?.steps) draft.plan.steps = [];
    if (draft.plan) draft.plan.updatedAt = new Date().toISOString();
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
 * changed. Idempotent — repeated calls update the timestamp. Drift is
 * cleared automatically whenever the AI mutates its own plan.
 */
export async function markPlanDrift({ nodeId, reason, core }) {
  if (!nodeId) return;
  const nowIso = new Date().toISOString();
  await mutateMeta(nodeId, (draft) => {
    if (!draft.plan) draft.plan = {};
    draft.plan.driftAt = nowIso;
    draft.plan.driftReason = reason || draft.plan.driftReason || "upstream change";
    return draft;
  }, core);
}

/**
 * Walk one level up from a node that just had its plan structurally
 * changed, and mark the parent's plan as drifted — but only if the
 * parent has its own plan to invalidate. Only fires on STRUCTURAL
 * changes (steps added or removed), not on status flips.
 */
async function maybeDriftParentOnStructuralChange({ childNodeId, reason, core }) {
  if (!childNodeId) return;
  try {
    const child = await Node.findById(childNodeId).select("_id parent name").lean();
    if (!child?.parent) return;
    const parent = await Node.findById(child.parent).select("metadata").lean();
    if (!parent) return;
    const parentMeta = readMeta(parent);
    const parentHasPlan = Array.isArray(parentMeta?.plan?.steps) && parentMeta.plan.steps.length > 0;
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

/**
 * Read a node's drift metadata. Returns { driftAt, driftReason } or null.
 */
export async function readPlanDrift(nodeId) {
  if (!nodeId) return null;
  const n = await Node.findById(nodeId).select("metadata").lean();
  if (!n) return null;
  const meta = readMeta(n);
  const pl = meta?.plan;
  if (!pl?.driftAt) return null;
  return { driftAt: pl.driftAt, driftReason: pl.driftReason || null };
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

// ─────────────────────────────────────────────────────────────────────
// SUMMARIZE WRITE (one-line summary of a code file)
// ─────────────────────────────────────────────────────────────────────

/**
 * Derive a short one-line summary from a file write. Multi-tier scan —
 * walks every line, classifies each, returns the FIRST line at the
 * HIGHEST-priority tier. Route declarations win over class/function
 * declarations, which win over generic top-level code.
 *
 * Priority tiers (higher wins):
 *   3: `app.<verb>(` / `router.<verb>(` — route declarations
 *   2: `export (default |async )?(function|class|const)` — new def
 *   1: `function X(` / `class X` / `const X =` / `module.exports`
 *   0: any meaningful non-skipped line
 *
 * Skipped: blank, `//` or `#` comments, bare `import`, bare `export {}`
 * re-exports, `"use strict"` directives.
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
      if (tier === 3) break;
    }
  }

  if (bestLine) return bestLine.slice(0, 140);
  for (const raw of lines) {
    const line = raw.trim();
    if (line) return line.slice(0, 140);
  }
  return content.slice(0, 140);
}

/**
 * Rank a summary string by the same tier system as `summarizeWrite` so
 * swarm's event debouncer can decide which summary to keep when merging.
 * Higher = more informative.
 */
export function summaryTier(summary) {
  if (!summary || typeof summary !== "string") return 0;
  const s = summary.trim();
  if (/^(app|router|server|httpServer|expressApp)\.(get|post|put|patch|delete|use|all)\s*\(/i.test(s)) return 3;
  if (/^export\s+(default\s+)?(async\s+)?(function|class|const)\b/.test(s)) return 2;
  if (/^(function|class|const|let|var|async\s+function|module\.exports)\b/.test(s)) return 1;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// PROMPT FORMATTERS (for enrichContext)
// ─────────────────────────────────────────────────────────────────────

/**
 * Format aggregated detail from a single level into a one-block string.
 * Null if nothing interesting to show. Used for injecting "what's below
 * you" into a branch's system prompt. Reads the structure swarm's
 * rollUpDetail produces.
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
 * Format an array of signalInbox signals into a readable block for
 * enrichContext injection. Renders per-kind templates so each signal
 * type reads as a CORRECTION INSTRUCTION the model can act on.
 *
 * Recent-N policy: keep the last 12 signals across all kinds.
 */
export function formatSignalInbox(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  const recent = signals.slice(-12);

  const errors = recent.filter((s) => s.kind === SIGNAL_KIND.SYNTAX_ERROR);
  const contracts = recent.filter((s) => s.kind === SIGNAL_KIND.CONTRACT);
  const mismatches = recent.filter((s) => s.kind === SIGNAL_KIND.CONTRACT_MISMATCH);
  const runtime = recent.filter((s) => s.kind === SIGNAL_KIND.RUNTIME_ERROR);
  const deadReceivers = recent.filter((s) => s.kind === SIGNAL_KIND.DEAD_RECEIVER);
  const testFailures = recent.filter((s) => s.kind === SIGNAL_KIND.TEST_FAILURE);
  const probeFailures = recent.filter((s) => s.kind === SIGNAL_KIND.PROBE_FAILURE);
  const coherenceGaps = recent.filter((s) => s.kind === SIGNAL_KIND.COHERENCE_GAP);
  const other = recent.filter((s) =>
    ![SIGNAL_KIND.SYNTAX_ERROR, SIGNAL_KIND.CONTRACT, SIGNAL_KIND.CONTRACT_MISMATCH,
      SIGNAL_KIND.RUNTIME_ERROR, SIGNAL_KIND.DEAD_RECEIVER, SIGNAL_KIND.TEST_FAILURE,
      SIGNAL_KIND.PROBE_FAILURE, SIGNAL_KIND.COHERENCE_GAP].includes(s.kind),
  );

  const blocks = [];

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

  if (coherenceGaps.length > 0) {
    const cgBlocks = coherenceGaps.map((s) => renderCoherenceGap(s)).filter(Boolean);
    if (cgBlocks.length > 0) {
      blocks.push(
        "🔍 CROSS-FILE / CROSS-BRANCH SYMBOL GAPS — the scout found imports " +
        "that don't line up with what the target file actually exports. This " +
        "is the class of bug where a sibling branch invented a slightly " +
        "different name than the one you imported. No syntax error, no test " +
        "failure — just an undefined reference at runtime. Reconcile by " +
        "matching EITHER your import OR the sibling's export. Copy names " +
        "exactly.\n\n" +
        cgBlocks.join("\n\n"),
      );
    }
  }

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

  if (contracts.length > 0) {
    const lines = ["Recent activity from sibling branches (keep your work consistent):"];
    for (const s of contracts) {
      const time = s.at ? new Date(s.at).toISOString().slice(11, 19) : "";
      const from = s.from ? `[${s.from}]` : "[?]";
      lines.push(`  ${time} ${from} wrote ${s.filePath || "?"} — ${formatPayload(s.payload)}`);
    }
    blocks.push(lines.join("\n"));
  }

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
 * caret-pointing correction instruction.
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
 * Render a single runtime-error signal from the smoke validator.
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
 * runtime errors because the "where" is split across branches.
 */
function renderContractMismatch(signal) {
  const p = signal?.payload;
  if (!p || typeof p !== "object") return null;

  if (
    p.kind === "unhandled-type" ||
    p.kind === "unreceived-type" ||
    p.kind === "unknown-field"
  ) {
    return renderWsSeamMismatch(p);
  }

  if (p.kind === "response-missing-key" || p.kind === "request-extra-key" || p.kind === "request-missing-key") {
    return renderFieldMismatch(p);
  }

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
 * Render a field-level phase-2 mismatch.
 */
function renderFieldMismatch(p) {
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
 * Render a single dead-receiver signal.
 */
/**
 * Render a symbol coherence gap signal. The payload names:
 *   - the importing file + line
 *   - the name that was imported
 *   - the module path it was imported from
 *   - the target file the path resolved to
 *   - the names that file actually exports
 *
 * Framing tells the AI this is a cross-branch rename problem and
 * it must pick ONE name (copy the sibling's, or ask the sibling to
 * match via NO-WRITE).
 */
function renderCoherenceGap(signal) {
  const p = signal?.payload;
  if (!p || typeof p !== "object") return null;
  const file = p.file || "(unknown)";
  const line = p.line || "?";
  const name = p.importedName || "(unknown)";
  const from = p.from || "?";
  const target = p.targetFile || "?";
  const available = Array.isArray(p.availableExports) ? p.availableExports : [];
  const branch = p.branch ? ` (${p.branch})` : "";

  const availList = available.length > 0
    ? available.slice(0, 12).map((n) => `"${n}"`).join(", ") + (available.length > 12 ? ", …" : "")
    : "(nothing — the target file has no named exports)";

  return [
    `📁 ${file}:${line}${branch}`,
    `   imports "${name}" from "${from}"`,
    `   resolves to: ${target}`,
    `   ${target} exports: ${availList}`,
    ``,
    `   Fix: either rename your import to match one of the sibling's actual ` +
    `exports, or emit [[NO-WRITE: <sibling> should export "${name}"]] if the ` +
    `sibling is wrong. Copy names EXACTLY — no case changes, no plural/singular.`,
  ].join("\n");
}

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
 * Render a probe-failure signal.
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

/**
 * Render a behavioral test failure.
 */
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
 * Format the contracts list as a prompt-ready block for enrichContext.
 * Keeps it terse: method, path, who declared it, request+response field
 * names. One line per contract when possible.
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

/**
 * Format a swarm events list as a lateral-context block for branches
 * that want to see recent activity from siblings.
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

// ─────────────────────────────────────────────────────────────────────
// SIGNAL INBOX PREDICATES (code-specific filters over swarm's inbox)
// ─────────────────────────────────────────────────────────────────────

/**
 * Remove syntax-error / dead-receiver signals for a specific file from
 * a node's inbox. Called when a re-write of the file passes validation.
 * Backed by swarm's readSignals + re-write via a filtered replay.
 */
export async function pruneSignalInboxForFile({ nodeId, filePath, core }) {
  if (!nodeId || !filePath) return;
  const sw = await getSwarm();
  if (!sw) return;
  const current = await sw.readSignals(nodeId);
  if (!Array.isArray(current) || current.length === 0) return;
  const kept = current.filter((s) => {
    if (s.kind !== SIGNAL_KIND.SYNTAX_ERROR && s.kind !== SIGNAL_KIND.DEAD_RECEIVER) return true;
    const errFile = s?.payload?.file || s?.filePath;
    return errFile !== filePath;
  });
  if (kept.length === current.length) return;
  await replaceInbox({ nodeId, signals: kept, core, sw });
  const removed = current.length - kept.length;
  log.debug("CodeWorkspace", `Pruned ${removed} resolved file-scoped signal(s) for ${filePath}`);
}

/**
 * Remove probe-failure signals for a specific endpoint (method+path).
 * Called when a re-probe of the same endpoint succeeds.
 */
export async function pruneProbeFailureForEndpoint({ nodeId, method, path: urlPath, core }) {
  if (!nodeId || !method || !urlPath) return;
  const sw = await getSwarm();
  if (!sw) return;
  const current = await sw.readSignals(nodeId);
  if (!Array.isArray(current) || current.length === 0) return;
  const kept = current.filter((s) => {
    if (s.kind !== SIGNAL_KIND.PROBE_FAILURE) return true;
    const sm = s?.payload?.method;
    const sp = s?.payload?.path || s?.payload?.url;
    return !(sm === method && sp === urlPath);
  });
  if (kept.length === current.length) return;
  await replaceInbox({ nodeId, signals: kept, core, sw });
}

/**
 * Remove contract-mismatch signals for a specific file. Called when a
 * frontend file is re-written so the next diff starts from a clean slate.
 */
export async function pruneContractMismatchesForFile({ nodeId, filePath, core }) {
  if (!nodeId || !filePath) return;
  const sw = await getSwarm();
  if (!sw) return;
  const current = await sw.readSignals(nodeId);
  if (!Array.isArray(current) || current.length === 0) return;
  const kept = current.filter((s) => {
    if (s.kind !== SIGNAL_KIND.CONTRACT_MISMATCH) return true;
    const mmFile = s?.payload?.expectation?.sourceFile || s?.filePath || s?.payload?.expectationSourceFile;
    return mmFile !== filePath;
  });
  if (kept.length === current.length) return;
  await replaceInbox({ nodeId, signals: kept, core, sw });
}

/**
 * Overwrite the swarm inbox on a node with the provided signal array.
 * Used by the prune helpers to replay a filtered inbox. Writes directly
 * into metadata.swarm.inbox via a namespace setExtMeta so we don't have
 * to wipe-and-append through swarm.appendSignal.
 */
async function replaceInbox({ nodeId, signals, core, sw }) {
  try {
    const node = await Node.findById(nodeId);
    if (!node) return;
    const current = node.metadata instanceof Map
      ? (node.metadata.get("swarm") || {})
      : (node.metadata?.swarm || {});
    const next = { ...current, inbox: Array.isArray(signals) ? signals : [] };
    if (core?.metadata?.setExtMeta) {
      await core.metadata.setExtMeta(node, "swarm", next);
    } else {
      await Node.updateOne(
        { _id: node._id },
        { $set: { "metadata.swarm": next } },
      );
    }
  } catch (err) {
    log.warn("CodeWorkspace", `replaceInbox ${nodeId} failed: ${err.message}`);
  }
}

/**
 * Find the earliest unresolved hard-error signal in a project's swarm
 * inbox that targets a file OTHER than the one about to be written.
 * Returns null when nothing blocks.
 *
 * Hard errors = SYNTAX_ERROR, RUNTIME_ERROR. Soft signals don't block
 * writes. Never blocks a write that targets the broken file itself —
 * that's how the AI fixes the error.
 */
const BLOCKING_SIGNAL_KINDS = new Set([
  SIGNAL_KIND.SYNTAX_ERROR,
  SIGNAL_KIND.RUNTIME_ERROR,
]);

export async function findBlockingSyntaxError({ projectNodeId, targetFilePath }) {
  if (!projectNodeId) return null;
  const sw = await getSwarm();
  if (!sw) return null;
  const list = await sw.readSignals(projectNodeId);
  if (!Array.isArray(list) || list.length === 0) return null;
  for (const sig of list) {
    if (!BLOCKING_SIGNAL_KINDS.has(sig?.kind)) continue;
    const errFile = sig?.payload?.file || sig?.filePath;
    if (!errFile) continue;
    if (targetFilePath && errFile === targetFilePath) continue;
    return sig;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// CONTRACTS — source-file-scoped replacement
// ─────────────────────────────────────────────────────────────────────

const MAX_CONTRACTS_AT_ROOT = 200;

/**
 * Replace all contracts that came from a given source file, then merge
 * in the new contracts from that file. Contracts live under swarm's
 * namespace (metadata.swarm.contracts), read + written via swarm primitives.
 *
 * `declaredBy` is the branch name; stamped on every new contract for
 * attribution in error messages and plan.md.
 *
 * Returns { added, removed, changed } counts.
 */
export async function replaceContractsFromFile({ projectNodeId, sourceFile, newContracts, declaredBy, core }) {
  if (!projectNodeId || !sourceFile) return { added: 0, removed: 0, changed: 0 };
  const sw = await getSwarm();
  if (!sw) return { added: 0, removed: 0, changed: 0 };

  const existingRaw = await sw.readContracts(projectNodeId);
  const existing = Array.isArray(existingRaw) ? existingRaw : [];

  const oldFromFile = existing.filter((c) => c.sourceFile === sourceFile);
  const removed = oldFromFile.length;

  const surviving = existing.filter((c) => c.sourceFile !== sourceFile);

  const now = new Date().toISOString();
  const stampedNew = (newContracts || []).map((contract) => ({
    ...contract,
    declaredBy: declaredBy || null,
    declaredAt: now,
  }));
  const added = stampedNew.length;

  let next = [...surviving, ...stampedNew];
  if (next.length > MAX_CONTRACTS_AT_ROOT) {
    next = [...next]
      .sort((a, b) => (b.declaredAt || "").localeCompare(a.declaredAt || ""))
      .slice(0, MAX_CONTRACTS_AT_ROOT);
  }

  const oldByKey = new Map(oldFromFile.map((c) => [c.key, c]));
  let changed = 0;
  for (const nc of stampedNew) {
    const old = oldByKey.get(nc.key);
    if (old && JSON.stringify(old.response?.shape || []) !== JSON.stringify(nc.response?.shape || [])) {
      changed++;
    }
  }

  await sw.setContracts({ projectNodeId, contracts: next, core });

  return { added, removed, changed };
}
