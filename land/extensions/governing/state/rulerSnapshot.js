// Ruler snapshot. Assembles a SUMMARY of a Ruler's scope state per
// turn, in a prompt-budget-conscious shape (~1500 tokens before the
// user message).
//
// Why a snapshot and not full state: the Ruler reads its domain on
// every turn. Full plan emissions + contract emissions + execution
// records can balloon, especially at deep trees with many sub-Rulers.
// The Ruler's job is to JUDGE, not to render every byte. The snapshot
// gives it enough to decide; tools like governing-read-plan-detail
// pull the full data when the Ruler explicitly needs it.
//
// Pass 3 reputation fields are scaffolded as null placeholders. The
// snapshot's shape doesn't change when Pass 3 lands; the fields just
// start carrying values populated from the approval ledgers + court
// records.
//
// The snapshot is read-only — no metadata writes here. Pure assembly
// from existing Pass 1 substrate.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { findRulerScope, NS as ROLE_NS } from "./role.js";

// Cross-extension import for instrumentation. The Map lives in
// tree-orchestrator/turnInstrumentation.js. Loaded lazily (rather
// than eagerly at module top) to avoid loader-order coupling
// between governing and tree-orchestrator: governing may load first.
// Read-only — we don't need to write to instrumentation, only to
// surface its data into the snapshot when present.
let _getRecentLatency = null;
async function getLatencyFn() {
  if (_getRecentLatency) return _getRecentLatency;
  try {
    const mod = await import("../../tree-orchestrator/turnInstrumentation.js");
    _getRecentLatency = mod.getRecentLatency;
    return _getRecentLatency;
  } catch {
    return null;
  }
}
import {
  readActivePlanApproval,
  readActivePlanEmission,
  readPlanApprovalsAtRuler,
} from "./planApprovals.js";
import {
  readActiveContractsEmission,
  readApprovalsAtRuler as readContractApprovalsAtRuler,
  readContracts,
} from "./contracts.js";
import {
  readActiveExecutionRecord,
  readExecutionApprovalsAtRuler,
} from "./foreman.js";
import { readLineage } from "./lineage.js";

const LEDGER_TAIL = 3;

/**
 * Produce a structured snapshot of the Ruler's scope. Used by the
 * Ruler mode's buildSystemPrompt to render its prompt-block; also
 * usable by court tooling and dashboards.
 *
 * Returns null if the node isn't a Ruler.
 */
export async function buildRulerSnapshot(rulerNodeId) {
  if (!rulerNodeId) return null;

  const rulerNode = await Node.findById(rulerNodeId).select("_id name parent metadata children").lean();
  if (!rulerNode) return null;
  const rulerMeta = rulerNode.metadata instanceof Map
    ? Object.fromEntries(rulerNode.metadata)
    : (rulerNode.metadata || {});
  if (rulerMeta[ROLE_NS]?.role !== "ruler") return null;

  const out = {
    scope: {
      id: String(rulerNode._id),
      name: rulerNode.name || "(unnamed)",
      promotedAt: rulerMeta[ROLE_NS]?.acceptedAt || null,
      promotedFrom: rulerMeta[ROLE_NS]?.promotedFrom || null,
    },
    lineage: null,
    plan: null,
    contracts: null,
    execution: null,
    ledgers: {
      planApprovals: [],
      contractApprovals: [],
      executionApprovals: [],
    },
    subRulers: [],
    // Lifecycle — the action-determining state of this Ruler scope.
    // Structured (not enum) so future passes (courts, reputation,
    // remedies) can read individual fields without re-parsing.
    //
    // The `awaiting` field is the load-bearing one: it tells the Ruler
    // which tool the architecture wants invoked next. Computed by
    // deterministic rule from the other fields after the snapshot
    // assembles (see deriveAwaiting below).
    //
    // Possible awaiting values (Stage 1):
    //   null               — no actionable next step (e.g., no plan, or
    //                        execution complete, or running mid-flight).
    //                        Ruler typically routes to Foreman for
    //                        status questions, or respond-directly.
    //   "contracts"        — plan exists, no contracts ratified. The
    //                        right tool is hire-contractor.
    //   "dispatch"         — contracts ratified, no execution started.
    //                        Stage 2: dispatch-execution. Stage 1: the
    //                        Ruler explains the state to the user.
    //   "user-approval"    — Stage 2: plan emitted, awaiting user "yes."
    //                        Ruler responds-directly explaining what
    //                        is pending; if the user message indicates
    //                        approval, advances via hire-contractor.
    //   "user-resume"      — execution paused. Ruler resume-execution.
    lifecycle: {
      plan: { present: false, ordinal: null, emissionId: null },
      contracts: { present: false, ordinal: null, count: 0 },
      execution: { status: "absent", ordinal: null, recordNodeId: null },
      awaiting: null,
    },
    // Pass 3 reputation slots. Fields shaped now; populated later.
    // trackRecord:               cumulative {plansApproved, plansRevised, contractsRatified,
    //                              contractsSuperseded, executionsCompleted, executionsFailed}
    //                              over this Ruler's lifetime
    // recentDecisionLatency:     median seconds-to-decision over last 10 turns
    // subRulerHealth:            for each sub-Ruler {id, name, completedRatio, courtIncidents}
    // courtHistory:              this Ruler's standing across past court hearings
    // contractConformance:       fraction of execution records that fulfilled their contract bindings
    reputation: {
      trackRecord: null,
      recentDecisionLatency: null,
      subRulerHealth: null,
      courtHistory: null,
      contractConformance: null,
    },
  };

  // Latency: populated as soon as instrumentation has data. Pass 1
  // doesn't surface this in the prompt by default (a quiet running
  // tree shouldn't see latency noise) but the field is here so
  // formatRulerSnapshot can render it when populated, and so future
  // callers (court tooling, dashboards) can read it.
  try {
    const fn = await getLatencyFn();
    if (fn) {
      const lat = fn(rulerNodeId);
      if (lat) out.reputation.recentDecisionLatency = lat;
    }
  } catch {}

  // Lineage — present iff this Ruler was promoted as a sub-Ruler.
  try {
    const lineage = await readLineage(rulerNodeId);
    if (lineage?.parentRulerId) out.lineage = lineage;
  } catch (err) {
    log.debug("Governing/Snapshot", `lineage read skipped: ${err.message}`);
  }

  // Active plan emission (summary).
  try {
    const emission = await readActivePlanEmission(rulerNodeId);
    if (emission) {
      const steps = Array.isArray(emission.steps) ? emission.steps : [];
      const leafCount = steps.filter((s) => s?.type === "leaf").length;
      const branchSteps = steps.filter((s) => s?.type === "branch");
      const branchCount = branchSteps.length;
      const branchNames = branchSteps.flatMap((s) =>
        Array.isArray(s.branches) ? s.branches.map((b) => b?.name).filter(Boolean) : []);
      out.plan = {
        ordinal: emission.ordinal,
        emittedAt: emission.emittedAt || null,
        reasoning: emission.reasoning || "",
        leafCount,
        branchCount,
        branchNames,
        emissionNodeId: emission._emissionNodeId || null,
      };
    }
  } catch (err) {
    log.debug("Governing/Snapshot", `plan summary skipped: ${err.message}`);
  }

  // Active contracts (own scope only — ancestor contracts surface via
  // enrichContext separately and shouldn't double-render in the Ruler's
  // self-snapshot).
  try {
    const ownEmission = await readActiveContractsEmission(rulerNodeId);
    if (ownEmission?.contracts) {
      const byKind = {};
      const names = [];
      for (const c of ownEmission.contracts) {
        const kind = c.kind || "contract";
        byKind[kind] = (byKind[kind] || 0) + 1;
        if (c.name) names.push(`${kind}:${c.name}`);
      }
      out.contracts = {
        ordinal: ownEmission.ordinal,
        ratifiedAt: ownEmission.ratifiedAt || null,
        count: ownEmission.contracts.length,
        byKind,
        names,
        emissionNodeId: ownEmission._emissionNodeId || null,
      };
    }
  } catch (err) {
    log.debug("Governing/Snapshot", `contracts summary skipped: ${err.message}`);
  }

  // Active execution-record state with rolled-up step counts.
  try {
    const record = await readActiveExecutionRecord(rulerNodeId);
    if (record) {
      const stepStatuses = Array.isArray(record.stepStatuses) ? record.stepStatuses : [];
      const counts = {
        pending: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, other: 0,
      };
      let lastTransitionAt = record.startedAt || null;
      const failures = [];
      const stuck = [];
      for (const step of stepStatuses) {
        const status = step?.status || "pending";
        if (counts[status] !== undefined) counts[status]++;
        else counts.other++;
        if (step?.completedAt && (!lastTransitionAt || step.completedAt > lastTransitionAt)) {
          lastTransitionAt = step.completedAt;
        }
        if (step?.startedAt && (!lastTransitionAt || step.startedAt > lastTransitionAt)) {
          lastTransitionAt = step.startedAt;
        }
        if (step?.type === "branch" && Array.isArray(step.branches)) {
          for (const b of step.branches) {
            if (b?.status === "failed") {
              failures.push({
                stepIndex: step.stepIndex,
                branchName: b.name,
                error: b.error || null,
                retries: b.retries || 0,
              });
            } else if (b?.status === "blocked" || b?.status === "paused") {
              stuck.push({
                stepIndex: step.stepIndex,
                branchName: b.name,
                status: b.status,
                reason: b.blockedReason || b.abortReason || null,
              });
            }
          }
        } else if (step?.type === "leaf" && step.status === "failed") {
          failures.push({
            stepIndex: step.stepIndex,
            spec: step.spec,
            error: step.error || null,
            retries: step.retries || 0,
          });
        }
      }
      out.execution = {
        ordinal: record.ordinal,
        status: record.status,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        lastTransitionAt,
        totalSteps: stepStatuses.length,
        counts,
        failures,
        stuck,
        recordNodeId: record._recordNodeId || null,
      };
    }
  } catch (err) {
    log.debug("Governing/Snapshot", `execution summary skipped: ${err.message}`);
  }

  // Approval ledger tails (last LEDGER_TAIL entries each).
  try {
    const planL = await readPlanApprovalsAtRuler(rulerNodeId);
    out.ledgers.planApprovals = planL.slice(-LEDGER_TAIL);
  } catch {}
  try {
    const contractL = await readContractApprovalsAtRuler(rulerNodeId);
    out.ledgers.contractApprovals = contractL.slice(-LEDGER_TAIL);
  } catch {}
  try {
    const execL = await readExecutionApprovalsAtRuler(rulerNodeId);
    out.ledgers.executionApprovals = execL.slice(-LEDGER_TAIL);
  } catch {}

  // Sub-Rulers under this scope + their execution status. Walks
  // direct children with role=ruler. Recursive collection (deep
  // sub-Ruler trees) is intentionally NOT done here — each Ruler
  // sees its own children, not its grandchildren. Coherence is a
  // local property propagated through the chain.
  try {
    const childIds = Array.isArray(rulerNode.children) ? rulerNode.children : [];
    if (childIds.length > 0) {
      const kids = await Node.find({ _id: { $in: childIds } })
        .select("_id name metadata").lean();
      for (const k of kids) {
        const km = k.metadata instanceof Map
          ? Object.fromEntries(k.metadata)
          : (k.metadata || {});
        if (km[ROLE_NS]?.role !== "ruler") continue;
        let subStatus = null;
        try {
          const subRecord = await readActiveExecutionRecord(k._id);
          if (subRecord) {
            subStatus = {
              executionStatus: subRecord.status,
              ordinal: subRecord.ordinal,
            };
          }
        } catch {}
        let subPlanOrdinal = null;
        try {
          const subEmission = await readActivePlanEmission(k._id);
          if (subEmission) subPlanOrdinal = subEmission.ordinal;
        } catch {}
        out.subRulers.push({
          id: String(k._id),
          name: k.name || "(unnamed)",
          planOrdinal: subPlanOrdinal,
          execution: subStatus,
        });
      }
    }
  } catch (err) {
    log.debug("Governing/Snapshot", `subRulers walk skipped: ${err.message}`);
  }

  // Lifecycle field. Computed from the snapshot's existing data so
  // there's no second round of reads — pure projection.
  out.lifecycle = deriveLifecycle(out);

  return out;
}

/**
 * Compute the lifecycle field from the assembled snapshot. Pure
 * function over the snapshot data — no I/O. The architecture's
 * lifecycle logic lives here in one place; the Ruler reads
 * lifecycle.awaiting to pick its next move.
 *
 * Rules (Stage 1):
 *   no plan                            → awaiting null   (Ruler decides from user message)
 *   plan + no contracts                → awaiting "contracts"
 *   plan + contracts + no execution    → awaiting "dispatch"
 *   plan + contracts + execution paused → awaiting "user-resume"
 *   execution running / completed      → awaiting null
 *
 * Stage 2 will add "user-approval" handling for the pending plan
 * card flow.
 */
function deriveLifecycle(snapshot) {
  const plan = {
    present: !!snapshot.plan,
    ordinal: snapshot.plan?.ordinal || null,
    emissionId: snapshot.plan?.emissionNodeId || null,
  };
  const contracts = {
    present: !!snapshot.contracts,
    ordinal: snapshot.contracts?.ordinal || null,
    count: snapshot.contracts?.count || 0,
  };
  const execution = {
    status: snapshot.execution?.status || "absent",
    ordinal: snapshot.execution?.ordinal || null,
    recordNodeId: snapshot.execution?.recordNodeId || null,
  };

  let awaiting = null;
  if (!plan.present) {
    awaiting = null;
  } else if (!contracts.present) {
    awaiting = "contracts";
  } else if (execution.status === "absent") {
    awaiting = "dispatch";
  } else if (execution.status === "paused") {
    awaiting = "user-resume";
  } else {
    // running / completed / failed / cancelled / superseded — nothing
    // the Ruler advances directly. running → user status questions
    // route to Foreman; terminal → Ruler responds with summary.
    awaiting = null;
  }

  return { plan, contracts, execution, awaiting };
}

/**
 * Render the snapshot as a prompt-text block. The Ruler mode prepends
 * this to its system prompt so the Ruler reads its domain before the
 * user's message.
 *
 * Format prioritizes scannability: the Ruler scans top-down looking
 * for "what's true now?" and "what changed recently?" The block ends
 * with the user message NOT included — the Ruler mode appends that
 * separately.
 */
export function formatRulerSnapshot(snapshot) {
  if (!snapshot) return "";
  const lines = [];

  // Identity
  lines.push("=================================================================");
  lines.push(`THE STATE OF YOUR DOMAIN`);
  lines.push("=================================================================");
  lines.push("");
  lines.push(`Scope: ${snapshot.scope.name} (${snapshot.scope.id.slice(0, 8)})`);
  if (snapshot.scope.promotedAt) {
    lines.push(`Promoted: ${snapshot.scope.promotedAt}` +
      (snapshot.scope.promotedFrom ? ` (from: ${snapshot.scope.promotedFrom})` : ""));
  }

  // Lifecycle position — what the architecture wants advanced next.
  // The `awaiting` field is your primary cue for tool selection;
  // the per-stage flags let you reason about why.
  if (snapshot.lifecycle) {
    const lc = snapshot.lifecycle;
    lines.push("");
    lines.push("Lifecycle position:");
    lines.push(`  plan        : ${lc.plan.present ? `present (emission-${lc.plan.ordinal})` : "absent"}`);
    lines.push(`  contracts   : ${lc.contracts.present ? `ratified (emission-${lc.contracts.ordinal}, ${lc.contracts.count} contract${lc.contracts.count === 1 ? "" : "s"})` : "absent"}`);
    lines.push(`  execution   : ${lc.execution.status}` +
      (lc.execution.ordinal ? ` (record-${lc.execution.ordinal})` : ""));
    lines.push(`  awaiting    : ${lc.awaiting || "(nothing the architecture advances next; pick by user-message intent)"}`);
  }

  // Lineage
  if (snapshot.lineage) {
    lines.push("");
    lines.push(`Lineage: sub-Ruler dispatched by ${snapshot.lineage.parentRulerId.slice(0, 8)}` +
      (snapshot.lineage.parentBranchEntryName
        ? ` for branch entry "${snapshot.lineage.parentBranchEntryName}"`
        : ""));
    if (snapshot.lineage.expandingFromSpec) {
      lines.push(`Inherited spec: "${snapshot.lineage.expandingFromSpec}"`);
    }
  }

  // Plan
  lines.push("");
  if (snapshot.plan) {
    const reasoningHead = snapshot.plan.reasoning
      ? snapshot.plan.reasoning.split("\n")[0].slice(0, 200) +
        (snapshot.plan.reasoning.length > 200 ? "…" : "")
      : "(no reasoning)";
    lines.push(`Active plan: emission-${snapshot.plan.ordinal} ` +
      `(${snapshot.plan.leafCount} leaf, ${snapshot.plan.branchCount} branch step(s))`);
    lines.push(`  reasoning: ${reasoningHead}`);
    if (snapshot.plan.branchNames?.length) {
      lines.push(`  sub-domains: ${snapshot.plan.branchNames.join(", ")}`);
    }
  } else {
    lines.push(`Active plan: none — no Planner has emitted at this scope yet.`);
  }

  // Contracts
  if (snapshot.contracts) {
    lines.push("");
    const kinds = Object.entries(snapshot.contracts.byKind || {})
      .map(([k, n]) => `${n} ${k}`).join(", ");
    lines.push(`Active contracts at this scope: emission-${snapshot.contracts.ordinal} ` +
      `(${snapshot.contracts.count} total — ${kinds})`);
  } else if (snapshot.plan) {
    lines.push("");
    lines.push(`Active contracts at this scope: none yet — Contractor hasn't emitted.`);
  }

  // Execution
  if (snapshot.execution) {
    lines.push("");
    const c = snapshot.execution.counts;
    lines.push(`Active execution: record-${snapshot.execution.ordinal} ` +
      `(status=${snapshot.execution.status})`);
    lines.push(`  steps: ${c.done}/${snapshot.execution.totalSteps} done` +
      (c.running ? `, ${c.running} running` : "") +
      (c.failed ? `, ${c.failed} failed` : "") +
      (c.blocked ? `, ${c.blocked} blocked` : "") +
      (c.paused ? `, ${c.paused} paused` : "") +
      (c.pending ? `, ${c.pending} pending` : ""));
    if (snapshot.execution.lastTransitionAt) {
      lines.push(`  last transition: ${snapshot.execution.lastTransitionAt}`);
    }
    if (snapshot.execution.failures?.length) {
      lines.push(`  failures:`);
      for (const f of snapshot.execution.failures.slice(0, 5)) {
        const ident = f.branchName || f.spec || `step-${f.stepIndex}`;
        lines.push(`    - ${ident}: ${(f.error || "(no error)").slice(0, 200)}` +
          (f.retries ? ` (${f.retries} retr${f.retries === 1 ? "y" : "ies"})` : ""));
      }
    }
    if (snapshot.execution.stuck?.length) {
      lines.push(`  stuck:`);
      for (const s of snapshot.execution.stuck.slice(0, 5)) {
        lines.push(`    - ${s.branchName}: ${s.status}` +
          (s.reason ? ` (${s.reason.slice(0, 200)})` : ""));
      }
    }
  }

  // Sub-Rulers
  if (snapshot.subRulers?.length) {
    lines.push("");
    lines.push(`Sub-Rulers under your scope:`);
    for (const sr of snapshot.subRulers) {
      const planBit = sr.planOrdinal ? `plan emission-${sr.planOrdinal}` : "no plan yet";
      const execBit = sr.execution
        ? `execution-${sr.execution.ordinal} ${sr.execution.executionStatus}`
        : "no execution";
      lines.push(`  - ${sr.name} (${sr.id.slice(0, 8)}): ${planBit}, ${execBit}`);
    }
  }

  // Ledger tails — terse one-liner each
  const tails = [];
  for (const e of snapshot.ledgers.planApprovals || []) {
    tails.push(`plan ${e.status}: ${e.planRef?.slice(0, 24) || "?"}` +
      (e.supersedes ? ` (supersedes ${e.supersedes.slice(0, 16)}…)` : "") +
      ` @ ${e.approvedAt}`);
  }
  for (const e of snapshot.ledgers.contractApprovals || []) {
    tails.push(`contract ${e.status}: ${e.contractRef?.slice(0, 24) || "?"}` +
      ` @ ${e.approvedAt}`);
  }
  for (const e of snapshot.ledgers.executionApprovals || []) {
    tails.push(`execution ${e.status}: ${e.executionRef?.slice(0, 24) || "?"}` +
      ` @ ${e.approvedAt}`);
  }
  if (tails.length > 0) {
    lines.push("");
    lines.push(`Recent decisions:`);
    for (const t of tails.slice(-LEDGER_TAIL * 3)) lines.push(`  - ${t}`);
  }

  // Pass 3 reputation slots — render only when populated. Pass 1
  // emits nothing here for trackRecord; the slot exists in the data
  // shape but isn't worth surfacing until the value means something.
  if (snapshot.reputation?.trackRecord) {
    lines.push("");
    lines.push(`Track record: ${JSON.stringify(snapshot.reputation.trackRecord)}`);
  }
  if (snapshot.reputation?.recentDecisionLatency) {
    const l = snapshot.reputation.recentDecisionLatency;
    lines.push("");
    lines.push(
      `Recent turn latency at this scope: median ${l.medianMs}ms, p95 ${l.p95Ms}ms ` +
      `(over last ${l.count} turns; last ${l.lastRole} ${l.lastDurationMs}ms)`,
    );
  }

  return lines.join("\n");
}

/**
 * Convenience: snapshot + format in one call. Most callers want the
 * formatted string, not the structured intermediate.
 */
export async function renderRulerSnapshot(rulerNodeId) {
  const snapshot = await buildRulerSnapshot(rulerNodeId);
  if (!snapshot) return "";
  return formatRulerSnapshot(snapshot);
}

export { findRulerScope };
