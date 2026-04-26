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
import { setExtMeta as kernelSetExtMeta } from "../../seed/tree/extensionMetadata.js";

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
 * Contract namespace taxonomy. Every declared contract belongs to one
 * namespace — the kind of thing it constrains. Pass 2's courts will
 * dispatch by namespace (a CharacterID dispute routes differently
 * from a StorageKey dispute). Orthogonal to scope: a contract has
 * BOTH a namespace (what it is) AND a scope (who sees it).
 *
 * Adding a namespace: add the constant here AND make sure the
 * architect prompt enumerates it as an option.
 */
export const CONTRACT_NAMESPACES = Object.freeze({
  STORAGE_KEY: "storage-key",        // localStorage / IndexedDB / etc. key names
  IDENTIFIER_SET: "identifier-set",  // enumerated string IDs (character IDs, role names, status enums)
  DOM_ID: "dom-id",                  // canvas/element id values shared across modules
  EVENT_NAME: "event-name",          // custom DOM event / pubsub topic names
  MESSAGE_TYPE: "message-type",      // WebSocket / fetch payload type discriminators
  METHOD_SIGNATURE: "method-signature", // shared function names + arg shapes between modules
  MODULE_EXPORT: "module-export",    // global names a module attaches to window/exports
});

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
  // User pivoted mid-flight. A newer plan version has been proposed
  // at the project root; this branch's spec is stale. Running branches
  // should exit cleanly via [[NO-WRITE: superseded by pivot]] rather
  // than keep burning cycles on obsolete work.
  PLAN_PIVOTED: "plan-pivoted",
  // A sub-plan dispatched from this branch has terminated. Payload
  // carries the rollup of sub-branches so the parent worker, on its
  // next turn, can decide whether to continue its own work, retry
  // sub-branches that failed, or emit [[DONE]].
  SUB_PLAN_COMPLETE: "sub-plan-complete",
  // A sub-plan couldn't settle locally (budget exhausted, unresolved
  // mismatches) and is escalating to the parent plan for attention.
  SUB_PLAN_ESCALATION: "sub-plan-escalation",
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

// Plan step api: thin wrappers over the plan extension. The data lives
// in metadata.plan (owned by the plan extension); code-workspace just
// hands operations through. Drift tracking (planDrift) stays in code
// workspace's namespace as a code specific opinion about plan
// freshness.

async function planExt() {
  const { getExtension } = await import("../loader.js");
  const ext = getExtension("plan");
  if (!ext?.exports) throw new Error("plan extension required by code-workspace");
  return ext.exports;
}

/**
 * Overwrite a node's plan steps. Accepts a raw step array and fills in
 * id/status/createdAt defaults via the plan extension. Treats raw
 * entries with only a title as `kind: "task"` write style steps.
 */
export async function setNodePlanSteps({ nodeId, steps, core }) {
  if (!nodeId || !Array.isArray(steps)) return null;
  const p = await planExt();
  const before = await p.readPlan(nodeId);
  const beforeCount = before?.steps?.length || 0;
  const normalized = steps.map((raw) => ({
    id: raw?.id,
    kind: raw?.kind || "task",
    title: String(raw?.title || "").trim() || "(untitled step)",
    status: raw?.status || "pending",
    createdAt: raw?.createdAt,
    completedAt: raw?.completedAt,
    blockedReason: raw?.blockedReason || null,
    note: raw?.note || null,
  }));
  await p.setSteps(nodeId, normalized, core);
  const after = await p.readPlan(nodeId);

  const afterCount = normalized.length;
  const reason = beforeCount === 0
    ? `set plan (${afterCount} steps)`
    : `replanned ${beforeCount} → ${afterCount} steps`;
  // Reset drift on this node since we just wrote it.
  await clearPlanDrift({ nodeId, core });
  await maybeDriftParentOnStructuralChange({ childNodeId: nodeId, reason, core });

  return after?.steps || null;
}

/**
 * Append a single step. Returns the new step.
 */
export async function addNodePlanStep({ nodeId, title, note, kind, core }) {
  if (!nodeId || !title) return null;
  const p = await planExt();
  const step = await p.addStep(nodeId, {
    kind: kind || "task",
    title: String(title).trim(),
    status: "pending",
    note: note || null,
  }, core);
  await clearPlanDrift({ nodeId, core });
  await maybeDriftParentOnStructuralChange({
    childNodeId: nodeId,
    reason: `added step "${step?.title?.slice(0, 60) || ""}"`,
    core,
  });
  return step;
}

/**
 * Patch a single step by id. `patch` may set status, blockedReason,
 * note, or title.
 */
export async function updateNodePlanStep({ nodeId, stepId, patch, core }) {
  if (!nodeId || !stepId || !patch) return null;
  const p = await planExt();
  const cleaned = {};
  if (patch.title != null) cleaned.title = String(patch.title).trim();
  if (patch.note != null) cleaned.note = patch.note || null;
  if (patch.status != null) cleaned.status = patch.status;
  if (patch.blockedReason != null) cleaned.blockedReason = patch.blockedReason;
  if (patch.kind != null) cleaned.kind = patch.kind;
  const result = await p.updateStep(nodeId, stepId, cleaned, core);
  if (result?.changed) await clearPlanDrift({ nodeId, core });
  return result?.step || null;
}

/**
 * Read a node's plan steps (local only, no rollup).
 */
export async function readNodePlanSteps(nodeId) {
  if (!nodeId) return null;
  const p = await planExt();
  const plan = await p.readPlan(nodeId);
  return plan?.steps || null;
}

/**
 * Read a node's rolled up step counts.
 */
export async function readNodeStepRollup(nodeId) {
  if (!nodeId) return null;
  const p = await planExt();
  return p.readRollup(nodeId);
}

/**
 * Drop all steps from a node's plan.
 */
export async function clearNodePlanSteps({ nodeId, core }) {
  if (!nodeId) return null;
  const p = await planExt();
  await p.setSteps(nodeId, [], core);
  await clearPlanDrift({ nodeId, core });
  await maybeDriftParentOnStructuralChange({
    childNodeId: nodeId,
    reason: "cleared its plan",
    core,
  });
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Plan drift (code workspace's stale plan marker; lives at
// metadata.code-workspace.planDrift)
// ─────────────────────────────────────────────────────────────────────

export async function markPlanDrift({ nodeId, reason, core }) {
  if (!nodeId) return;
  const nowIso = new Date().toISOString();
  await mutateMeta(nodeId, (draft) => {
    if (!draft.planDrift) draft.planDrift = {};
    draft.planDrift.driftAt = nowIso;
    draft.planDrift.driftReason = reason || draft.planDrift.driftReason || "upstream change";
    return draft;
  }, core);
}

async function clearPlanDrift({ nodeId, core }) {
  if (!nodeId) return;
  await mutateMeta(nodeId, (draft) => {
    if (draft.planDrift) {
      draft.planDrift.driftAt = null;
      draft.planDrift.driftReason = null;
    }
    return draft;
  }, core);
}

/**
 * Walk one level up from a node whose plan was structurally changed
 * and mark the parent's plan as drifted — only when the parent has its
 * own plan to invalidate.
 */
async function maybeDriftParentOnStructuralChange({ childNodeId, reason, core }) {
  if (!childNodeId) return;
  try {
    const child = await Node.findById(childNodeId).select("_id parent name").lean();
    if (!child?.parent) return;
    const p = await planExt();
    const parentPlan = await p.readPlan(child.parent);
    const parentHasPlan = Array.isArray(parentPlan?.steps) && parentPlan.steps.length > 0;
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
  const drift = meta?.planDrift;
  if (!drift?.driftAt) return null;
  return { driftAt: drift.driftAt, driftReason: drift.driftReason || null };
}

/**
 * Render a plan as a readable block. Plans live on plan-type nodes;
 * any node can ask for "the plan governing my work" via readPlan
 * (walks up). The caller passes in the resolved plan plus optional
 * worker context so the header is honest about WHICH plan and which
 * step the worker is supposed to be on.
 *
 *   steps:         the plan's branch-kind steps (or any kind)
 *   rollup:        plan.rollup counts (descendants)
 *   planScopeName: name of the SCOPE the plan coordinates (e.g. the
 *                  project root's name, or the parent branch's name
 *                  for a sub-plan). Used in the header so the worker
 *                  reads "Plan governing dd (project)" and not
 *                  "Plan for ui" (which lied — ui is a STEP in that
 *                  plan, not the plan's owner).
 *   currentNodeId: the worker's own node id. When passed, we find
 *                  the step whose childNodeId matches and mark it
 *                  with "← YOU" so the worker knows which step is
 *                  theirs.
 *   currentBranchName: fallback for matching by name when childNodeId
 *                  isn't populated yet (early-dispatch state).
 *   drift:         stale-plan warning data
 *
 *   nodeName:      legacy fallback (used as planScopeName when the
 *                  caller didn't pass planScopeName explicitly).
 */
export function formatNodePlan({
  steps,
  rollup,
  nodeName,
  planScopeName = null,
  currentNodeId = null,
  currentBranchName = null,
  drift,
}) {
  const lines = [];
  const scope = planScopeName || nodeName || null;
  const header = scope ? `# Plan governing "${scope}"` : "# Plan";
  const local = Array.isArray(steps) ? steps : [];

  // Count every status that exists in the plan, not just done/blocked/
  // pending. The previous render dropped "running" and "paused" which
  // produced text like "2/5 done, 1 pending" when the missing 2 steps
  // were running. Show every non-zero bucket so the count adds up.
  const buckets = { done: 0, running: 0, pending: 0, blocked: 0, failed: 0, paused: 0 };
  for (const s of local) {
    const k = s.status;
    if (k && Object.prototype.hasOwnProperty.call(buckets, k)) buckets[k] += 1;
  }
  const total = local.length;

  // Identify the worker's step so the render can mark it.
  const matchesWorker = (s) => {
    if (currentNodeId && s.childNodeId && String(s.childNodeId) === String(currentNodeId)) return true;
    if (currentBranchName && s.title === currentBranchName) return true;
    return false;
  };

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
    const statusLine = Object.entries(buckets)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    lines.push(`${total} step${total === 1 ? "" : "s"}: ${statusLine}`);
    lines.push("");
    for (const s of local) {
      const mark = s.status === "done" ? "x"
        : s.status === "running" ? "~"
        : s.status === "blocked" ? "!"
        : s.status === "failed" ? "✗"
        : " ";
      let line = `[${mark}] ${s.title}`;
      if (s.status === "running") line += "  (running)";
      else if (s.status === "blocked" && s.blockedReason) {
        line += `  — BLOCKED: ${s.blockedReason}`;
      } else if (s.status === "failed" && s.error) {
        line += `  — FAILED: ${String(s.error).slice(0, 80)}`;
      }
      line += `  (${s.id})`;
      if (matchesWorker(s)) line += "  ← YOU";
      lines.push(line);
    }
  }

  if (rollup && (rollup.pending || rollup.done || rollup.blocked || rollup.running || rollup.failed)) {
    lines.push("");
    const rollupParts = [];
    if (rollup.done) rollupParts.push(`${rollup.done} done`);
    if (rollup.running) rollupParts.push(`${rollup.running} running`);
    if (rollup.pending) rollupParts.push(`${rollup.pending} pending`);
    if (rollup.blocked) rollupParts.push(`${rollup.blocked} blocked`);
    if (rollup.failed) rollupParts.push(`${rollup.failed} failed`);
    lines.push(`Including descendants: ${rollupParts.join(", ")}`);
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
  const pivots = recent.filter((s) => s.kind === SIGNAL_KIND.PLAN_PIVOTED);
  const subPlanCompletes = recent.filter((s) => s.kind === SIGNAL_KIND.SUB_PLAN_COMPLETE);
  const subPlanEscalations = recent.filter((s) => s.kind === SIGNAL_KIND.SUB_PLAN_ESCALATION);
  const other = recent.filter((s) =>
    ![SIGNAL_KIND.SYNTAX_ERROR, SIGNAL_KIND.CONTRACT, SIGNAL_KIND.CONTRACT_MISMATCH,
      SIGNAL_KIND.RUNTIME_ERROR, SIGNAL_KIND.DEAD_RECEIVER, SIGNAL_KIND.TEST_FAILURE,
      SIGNAL_KIND.PROBE_FAILURE, SIGNAL_KIND.COHERENCE_GAP,
      SIGNAL_KIND.PLAN_PIVOTED, SIGNAL_KIND.SUB_PLAN_COMPLETE,
      SIGNAL_KIND.SUB_PLAN_ESCALATION].includes(s.kind),
  );

  const blocks = [];

  // Plan pivot comes first — if the plan was superseded, none of the
  // other signals matter. Render at the top so the model sees the
  // stop-work instruction before reading any stale error detail from
  // prior turns.
  if (pivots.length > 0) {
    const p = pivots[pivots.length - 1];
    const newVersion = p?.payload?.newVersion ?? "next";
    const reason = p?.payload?.reason || "user-pivot-midflight";
    blocks.push(
      `🛑 PLAN SUPERSEDED.\n\n` +
      `The user pivoted mid-flight. Your plan was archived (reason: ${reason}); ` +
      `a new plan (v${newVersion}) has been proposed at the project root. Your ` +
      `current spec is stale. DO NOT keep building against the old plan.\n\n` +
      `Your next turn MUST be a single line: ` +
      `[[NO-WRITE: superseded by pivot]]\n\n` +
      `No tool calls. No explanation. Just the marker. The branch session will ` +
      `exit cleanly and the user's new plan will dispatch fresh branches.`
    );
  }

  // Sub-plan completion / escalation. Two independent signal kinds
  // that often co-occur for the same sub-plan: COMPLETE always fires
  // when a sub-plan terminates; ESCALATION fires alongside when the
  // termination involved retry-budget exhaustion. If we render them
  // as separate blocks, the LLM sees contradictory action menus
  // (COMPLETE says "emit [[DONE]] if scope resolved"; ESCALATION says
  // "emit [[NO-WRITE: sub-plan blocked]]"). Cross-reference by
  // subPlanNodeId and render as a unified block with explicit framing
  // when they pair up. When ESCALATION fires alone (rare; only if
  // COMPLETE was somehow lost), render with its own framing. When
  // COMPLETE fires alone, render the original "settled" framing.
  const renderSubBranchLines = (subBranches) =>
    subBranches.map((b) => {
      const icon = b.status === "done" ? "✓" : b.status === "failed" ? "✗" : "•";
      const err = b.error ? ` (${String(b.error).slice(0, 80)})` : "";
      return `  ${icon} ${b.name} [${b.status || "?"}]${err}`;
    }).join("\n") || "  (no sub-branches recorded)";

  const renderEscalationDetails = (esc) => {
    const lines = [];
    const failedBranches = Array.isArray(esc.failedBranches) ? esc.failedBranches : [];
    if (failedBranches.length > 0) {
      lines.push(`Exhausted branches (retries hit budget cap):`);
      for (const fb of failedBranches.slice(0, 8)) {
        const errStr = fb.error ? ` — ${String(fb.error).slice(0, 120)}` : "";
        lines.push(`  ✗ ${fb.name} [retries: ${fb.retries ?? "?"}]${errStr}`);
      }
    }
    const unresolvedSignals = Array.isArray(esc.unresolvedSignals) ? esc.unresolvedSignals : [];
    if (unresolvedSignals.length > 0) {
      lines.push("");
      lines.push("Unresolved signals from those branches:");
      for (const s of unresolvedSignals.slice(0, 10)) {
        const k = s.kind || "signal";
        const sm = s.summary ? ` — ${s.summary}` : "";
        lines.push(`  · [${s.from || "?"}] ${k}${sm}`);
      }
    }
    return lines.length > 0 ? lines.join("\n") : null;
  };

  // Latest signal of each kind, indexed by subPlanNodeId.
  const completeBySubPlan = new Map();
  for (const c of subPlanCompletes) {
    const id = c?.payload?.subPlanNodeId || "(unknown)";
    completeBySubPlan.set(id, c);
  }
  const escalationBySubPlan = new Map();
  for (const e of subPlanEscalations) {
    const id = e?.payload?.subPlanNodeId || "(unknown)";
    escalationBySubPlan.set(id, e);
  }

  // Render paired (COMPLETE + ESCALATION for same sub-plan).
  for (const [subPlanNodeId, esc] of escalationBySubPlan) {
    const cmp = completeBySubPlan.get(subPlanNodeId);
    if (!cmp) continue;
    completeBySubPlan.delete(subPlanNodeId);

    const cp = cmp.payload || {};
    const ep = esc.payload || {};
    const subBranches = Array.isArray(cp.subBranches) ? cp.subBranches : [];
    const summary = renderSubBranchLines(subBranches);
    const reason = ep.reason || "unresolved";
    const details = ep.details ? `\n\nDetails: ${String(ep.details).slice(0, 400)}` : "";
    const escDetails = renderEscalationDetails(ep);

    blocks.push(
      `📋⚠️  SUB-PLAN COMPLETED WITH ESCALATION\n\n` +
      `The sub-plan you dispatched has terminated AND requested escalation. ` +
      `These are two views of the same outcome — the sub-plan ran to ` +
      `completion (status: ${cp.overallStatus || "partial"}), but at least ` +
      `one branch couldn't settle locally (${reason}) and is now your ` +
      `responsibility.${details}\n\n` +
      `Sub-branches (overall):\n${summary}\n\n` +
      (escDetails ? `${escDetails}\n\n` : "") +
      `Your move: this is NOT a "scope resolved, emit [[DONE]]" situation. ` +
      `Decide based on the failure pattern:\n` +
      `  • If the failures point at a fixable spec issue, revise the parent ` +
      `plan's spec and let the next dispatch try again.\n` +
      `  • If a sibling branch in your own plan can absorb the failed work, ` +
      `do that work yourself in your next turn.\n` +
      `  • If neither is feasible, emit [[NO-WRITE: sub-plan blocked]] to ` +
      `surface this to the user. The sub-plan itself is paused pending ` +
      `your direction; do NOT emit [[DONE]] while branches remain failed.`,
    );
  }

  // Remaining COMPLETE signals (no matching escalation): the clean case.
  if (completeBySubPlan.size > 0) {
    const latest = Array.from(completeBySubPlan.values()).pop();
    const p = latest?.payload || {};
    const subBranches = Array.isArray(p.subBranches) ? p.subBranches : [];
    const summary = renderSubBranchLines(subBranches);
    blocks.push(
      `📋 SUB-PLAN COMPLETE\n\n` +
      `The sub-plan you dispatched has finished. Status: ${p.overallStatus || "settled"}.\n\n` +
      `Sub-branches:\n${summary}\n\n` +
      `Continue your own work, or emit [[DONE]] if your scope is fully resolved. ` +
      `If any sub-branch failed and needs another pass, handle it in your continuation — ` +
      `you have full context of what the decomposition produced.`,
    );
  }

  // Remaining ESCALATION signals (no matching completion): rare path,
  // means we lost or never sent the COMPLETE half. Still useful to
  // surface so the parent isn't blind to the failure.
  for (const [subPlanNodeId, esc] of escalationBySubPlan) {
    if (!completeBySubPlan.has(subPlanNodeId) && !subPlanCompletes.find(c => c?.payload?.subPlanNodeId === subPlanNodeId)) {
      const ep = esc.payload || {};
      const reason = ep.reason || "unresolved";
      const details = ep.details ? `\n\nDetails: ${String(ep.details).slice(0, 400)}` : "";
      const escDetails = renderEscalationDetails(ep);
      blocks.push(
        `⚠️ SUB-PLAN ESCALATION\n\n` +
        `A sub-plan beneath this branch couldn't settle on its own (${reason}).${details}\n\n` +
        (escDetails ? `${escDetails}\n\n` : "") +
        `Decide how to handle it: adjust the parent plan's spec, re-dispatch sub-branches ` +
        `with clearer constraints, or emit [[NO-WRITE: sub-plan blocked]] to surface this ` +
        `to the user. The sub-plan itself is paused pending your direction.`,
      );
    }
  }

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

  // Load-graph "orphan-module" findings don't have importedName /
  // availableExports — they just say "branch X shipped files that no
  // index.html references." Render them with a dedicated shape so the
  // retry prompt tells the shell EXACTLY what to add.
  if (p.kind === "orphan-module") {
    const orphanBranch = p.orphanBranch || "(unknown)";
    const files = Array.isArray(p.orphanFiles) ? p.orphanFiles : [];
    const scriptTags = files.length > 0
      ? files.map((f) => `     <script src="${f}"></script>`).join("\n")
      : `     <script src="${orphanBranch}/${orphanBranch}.js"></script>`;
    return [
      `👻 ORPHAN MODULE — ${orphanBranch} wrote code nothing loads`,
      ``,
      p.message || `No <script src> references ${orphanBranch}.`,
      ``,
      `   Fix: edit index.html, add a script tag before the boot script:`,
      scriptTags,
      ``,
      `   If the orphan's functionality is duplicated inline in another`,
      `   branch, delete the duplicate inline copy and wire the module`,
      `   through its exported global instead.`,
    ].join("\n");
  }

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
    // Swarm-namespace writes from this module run under code-workspace's
    // scoped core, which rejects cross-namespace writes. Use the kernel's
    // unscoped setExtMeta directly — we're writing on swarm's behalf
    // (filtering its own inbox), not sneaking into its namespace.
    await kernelSetExtMeta(node, "swarm", next);
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

  await sw.setContracts({ scopeNodeId: projectNodeId, contracts: next, core });

  return { added, removed, changed };
}
