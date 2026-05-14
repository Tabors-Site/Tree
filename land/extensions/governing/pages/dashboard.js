// Governance dashboard page renderer.
//
// Renders the full rulership tree on one observational surface.
// Loaded in the dashboard's right iframe via
// /api/v1/root/:rootId/governance?html&inApp=1. Chat panel stays on
// the left; this page reflects state changes pushed by chat in real
// time via SSE.
//
// The page is observational only. No edit buttons, no approve/cancel
// controls. All actions happen through chat. The page is what's
// happening; chat is how operators drive it.
//
// Architecture:
//   - First load returns full HTML (page chrome + main container +
//     bootstrap script).
//   - Bootstrap script opens an SSE stream and refetches the main
//     container's HTML fragment on each update event. The fragment
//     mode (?fragment=1) returns just the inner HTML, no chrome —
//     the client swaps it in place via innerHTML.
//   - Falls back to 10s polling if SSE drops.

import { buildDashboardData, isTreeGoverned } from "../state/dashboardData.js";
import { readDashboardCSS } from "./dashboardCss.js";

const DEBUG = false;

// HTML-escape any string interpolated into the rendered output. Used
// for user-visible content (scope names, reasoning text, spec strings).
// Identifiers (nodeIds, slugs) are also escaped defensively — they're
// usually safe but the cost is trivial.
function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ─────────────────────────────────────────────────────────────────────
// VITALS — one-pass derivation of the small numbers/states each Ruler
// surfaces in chips, the lifecycle bar, and the tree minimap. Done once
// per entry so the three places that need the counts stay consistent.
// ─────────────────────────────────────────────────────────────────────

function computeRulerVitals(entry) {
  const { snapshot, planEmission, contractsEmission, executionRecord, flagsSummary, ledgers } = entry;
  const lc = snapshot?.lifecycle || {};
  const execStatus = lc.execution?.status || executionRecord?.status || "absent";

  // Phase index 0..4 (plan, contracts, dispatch, run, done). Picks the
  // FURTHEST advanced phase that's been entered. Animated segment is
  // wherever the active work is right now.
  let phaseReached = -1;
  if (planEmission || lc.plan?.present) phaseReached = 0;
  if (contractsEmission || lc.contracts?.present) phaseReached = 1;
  if (executionRecord || lc.awaiting === "dispatch") phaseReached = 2;
  if (execStatus === "running") phaseReached = 3;
  if (execStatus === "completed") phaseReached = 4;

  const activePhase =
    execStatus === "running" ? 3 :
    execStatus === "completed" ? 4 :
    lc.awaiting === "dispatch" ? 2 :
    lc.awaiting === "contracts" ? 1 :
    (planEmission && !contractsEmission) ? 1 :
    (!planEmission) ? 0 :
    phaseReached;

  // Worker tallies for the chip + minimap. Buckets the leaf steps from
  // the active execution record.
  const wb = { running: 0, done: 0, failed: 0, other: 0 };
  if (Array.isArray(executionRecord?.stepStatuses)) {
    for (const s of executionRecord.stepStatuses) {
      if (s?.type !== "leaf") continue;
      const st = s.status || "pending";
      if (st === "running") wb.running++;
      else if (st === "done") wb.done++;
      else if (st === "failed") wb.failed++;
      else wb.other++;
    }
  }

  // Plans/Contracts counts: one active emission + ledger history.
  const planCount = (ledgers?.plan?.length || 0) + (planEmission ? 1 : 0);
  const contractCount = Array.isArray(contractsEmission?.contracts)
    ? contractsEmission.contracts.length
    : 0;

  // Flags
  const flagTotal = flagsSummary?.total || 0;
  const flagBlocking = flagsSummary?.blockingCount || 0;

  // Lifecycle color key, used by minimap badges and progress bar.
  let stateKey = "idle";
  if (execStatus === "failed") stateKey = "failed";
  else if (execStatus === "running") stateKey = "running";
  else if (execStatus === "completed") stateKey = "completed";
  else if (lc.awaiting === "dispatch" || executionRecord) stateKey = "dispatch";
  else if (lc.awaiting === "contracts" || planEmission) stateKey = "contracts";
  else if (planEmission) stateKey = "plan";

  return {
    phaseReached, activePhase, execStatus, stateKey,
    workers: wb,
    planCount, contractCount,
    flagTotal, flagBlocking,
  };
}

// ─────────────────────────────────────────────────────────────────────
// LIFECYCLE PROGRESS BAR
// 5 segments: plan → contracts → dispatch → run → done. Segments fill
// up to phaseReached. The activePhase segment pulses.
// ─────────────────────────────────────────────────────────────────────

function renderLifecycleBar(vitals) {
  const PHASES = [
    { key: "plan",      label: "plan" },
    { key: "contracts", label: "contracts" },
    { key: "dispatch",  label: "dispatch" },
    { key: "run",       label: "run" },
    { key: "done",      label: "done" },
  ];
  const segs = PHASES.map((p, i) => {
    const filled = i <= vitals.phaseReached;
    const active = i === vitals.activePhase && vitals.execStatus !== "completed";
    const failed = vitals.execStatus === "failed" && i === 3;
    const cls = [
      "gov-lc-seg",
      `gov-lc-seg-${p.key}`,
      filled ? "gov-lc-seg-filled" : "gov-lc-seg-pending",
      active ? "gov-lc-seg-active" : "",
      failed ? "gov-lc-seg-failed" : "",
    ].filter(Boolean).join(" ");
    return `<div class="${cls}" title="${p.label}"><span class="gov-lc-seg-label">${p.label}</span></div>`;
  }).join("");
  return `<div class="gov-lifecycle-bar" data-state="${vitals.stateKey}">${segs}</div>`;
}

// ─────────────────────────────────────────────────────────────────────
// COLLAPSED-STATE CHIPS
// Compact row of plan/contract/worker/flag counters shown on the card
// summary so the operator can scan without expanding.
// ─────────────────────────────────────────────────────────────────────

function renderCollapsedChips(vitals) {
  const chips = [];

  if (vitals.planCount > 0) {
    chips.push(
      `<span class="gov-chip gov-chip-plan" title="${vitals.planCount} plan emission(s)">` +
      `📋 ${vitals.planCount}</span>`,
    );
  }

  if (vitals.contractCount > 0) {
    chips.push(
      `<span class="gov-chip gov-chip-contracts" title="${vitals.contractCount} contract(s) declared">` +
      `📜 ${vitals.contractCount}</span>`,
    );
  }

  const w = vitals.workers;
  if (w.running + w.done + w.failed + w.other > 0) {
    const parts = [];
    if (w.running > 0) parts.push(`<span class="gov-chip-num-running">${w.running} run</span>`);
    if (w.done > 0)    parts.push(`<span class="gov-chip-num-done">${w.done} done</span>`);
    if (w.failed > 0)  parts.push(`<span class="gov-chip-num-failed">${w.failed} failed</span>`);
    const pulseCls = w.running > 0 ? " gov-chip-pulse" : "";
    chips.push(
      `<span class="gov-chip gov-chip-workers${pulseCls}" title="worker step status">` +
      `🔨 ${parts.join(" · ")}</span>`,
    );
  }

  if (vitals.flagTotal > 0) {
    const blockMark = vitals.flagBlocking > 0
      ? ` <span class="gov-chip-num-failed">(${vitals.flagBlocking} blocking)</span>`
      : "";
    const pulseCls = vitals.flagBlocking > 0 ? " gov-chip-pulse-warn" : "";
    chips.push(
      `<span class="gov-chip gov-chip-flags${pulseCls}" title="${vitals.flagTotal} pending flag(s)">` +
      `🚩 ${vitals.flagTotal}${blockMark}</span>`,
    );
  }

  if (chips.length === 0) return "";
  return `<div class="gov-collapsed-chips">${chips.join("")}</div>`;
}

// ─────────────────────────────────────────────────────────────────────
// SUB-RENDERERS (one card section each)
// ─────────────────────────────────────────────────────────────────────

function renderLifecyclePill(snapshot) {
  if (!snapshot?.lifecycle) {
    return `<span class="gov-pill gov-pill-idle">idle</span>`;
  }
  const lc = snapshot.lifecycle;
  const execStatus = lc.execution?.status || "absent";
  // Determine the effective state. Execution status takes precedence
  // when set; otherwise awaiting tells us where in the cycle we are.
  if (execStatus === "completed") {
    return `<span class="gov-pill gov-pill-completed">completed</span>`;
  }
  if (execStatus === "failed") {
    return `<span class="gov-pill gov-pill-failed">failed</span>`;
  }
  if (execStatus === "cancelled") {
    return `<span class="gov-pill gov-pill-cancelled">cancelled</span>`;
  }
  if (execStatus === "paused") {
    return `<span class="gov-pill gov-pill-paused">paused</span>`;
  }
  if (execStatus === "superseded") {
    return `<span class="gov-pill gov-pill-superseded">superseded</span>`;
  }
  if (execStatus === "running") {
    return `<span class="gov-pill gov-pill-running">running</span>`;
  }
  // No active run — read awaiting.
  switch (lc.awaiting) {
    case "contracts": return `<span class="gov-pill gov-pill-contracts">awaiting contracts</span>`;
    case "dispatch": return `<span class="gov-pill gov-pill-dispatch">ready to dispatch</span>`;
    case "user-resume": return `<span class="gov-pill gov-pill-paused">awaiting resume</span>`;
    default:
      if (lc.plan?.present) return `<span class="gov-pill gov-pill-plan">plan emitted</span>`;
      return `<span class="gov-pill gov-pill-idle">idle</span>`;
  }
}

function renderPositionHeader(entry, vitals) {
  const { snapshot, rulerNodeId, rulerName } = entry;
  const scope = snapshot?.scope || {};
  const lineage = snapshot?.lineage;
  const promoted = scope.promotedAt
    ? `<span class="gov-meta">promoted ${esc(scope.promotedAt)}</span>`
    : "";
  const from = scope.promotedFrom
    ? `<span class="gov-meta">from: ${esc(scope.promotedFrom)}</span>`
    : "";
  const parent = lineage?.parentRulerId
    ? `<span class="gov-meta">parent: ${esc(String(lineage.parentRulerId).slice(0, 8))}` +
      (lineage.parentBranchEntryName
        ? ` / "${esc(lineage.parentBranchEntryName)}"`
        : "") +
      `</span>`
    : "";
  return `
    <div class="gov-position-header">
      <div class="gov-position-title">
        <span class="gov-position-name">${esc(rulerName || scope.name || "(unnamed)")}</span>
        <code class="gov-position-id">${esc(String(rulerNodeId).slice(0, 8))}</code>
        ${renderLifecyclePill(snapshot)}
      </div>
      <div class="gov-position-meta">${promoted} ${from} ${parent}</div>
      ${vitals ? renderLifecycleBar(vitals) : ""}
      ${vitals ? renderCollapsedChips(vitals) : ""}
    </div>`;
}

function renderPlansSection(entry) {
  const { planEmission, ledgers, snapshot } = entry;
  if (!planEmission && (!ledgers?.plan || ledgers.plan.length === 0)) {
    return `<div class="gov-section gov-section-empty"><div class="gov-section-title">Plans</div><div class="gov-empty-note">No plan yet.</div></div>`;
  }
  let activeBlock = "";
  if (planEmission) {
    const stepsList = (planEmission.steps || []).map((s, i) => {
      if (s.type === "leaf") {
        const wt = s.workerType ? `<span class="gov-tag gov-tag-${esc(s.workerType)}">${esc(s.workerType)}</span>` : "";
        return `<li class="gov-step gov-step-leaf">${wt}<span class="gov-step-num">${i + 1}.</span> ${esc(truncate(s.spec || "", 240))}</li>`;
      }
      if (s.type === "branch") {
        const subs = (s.branches || []).map((b) =>
          `<li class="gov-sub-branch"><strong>${esc(b.name)}:</strong> ${esc(truncate(b.spec || "", 200))}</li>`,
        ).join("");
        return `<li class="gov-step gov-step-branch">` +
          `<span class="gov-step-num">${i + 1}.</span> <span class="gov-tag gov-tag-branch">branch</span> ` +
          `${esc(truncate(s.rationale || "", 200))}<ul class="gov-sub-branches">${subs}</ul></li>`;
      }
      return "";
    }).join("");
    activeBlock = `
      <details class="gov-plan-card gov-plan-active" open>
        <summary>
          <span class="gov-emission-slug">${esc(planEmission.slug || `emission-${planEmission.ordinal}`)}</span>
          <span class="gov-emission-ordinal">#${planEmission.ordinal}</span>
          <span class="gov-pill gov-pill-active">active</span>
          <span class="gov-meta">${esc(planEmission.emittedAt || "")}</span>
        </summary>
        <div class="gov-emission-body">
          <div class="gov-reasoning"><h5>Reasoning</h5><p>${esc(planEmission.reasoning || "(none)")}</p></div>
          <div class="gov-steps"><h5>Steps</h5><ol>${stepsList || "<li>(no steps)</li>"}</ol></div>
        </div>
      </details>`;
  }
  // Superseded entries from ledger. Active emission shows already above
  // so we filter to non-active here.
  const activeId = snapshot?.plan?.emissionNodeId || planEmission?._emissionNodeId;
  const superseded = (ledgers?.plan || [])
    .filter((e) => {
      const ref = e?.planRef || "";
      const id = ref.includes(":") ? ref.split(":").pop() : ref;
      return id && id !== activeId;
    })
    .slice(-5);  // last 5 superseded
  const supersededBlock = superseded.length > 0
    ? `<div class="gov-superseded-list">${superseded.map((e) =>
        `<div class="gov-superseded-item">` +
        `<span class="gov-emission-ordinal">#${esc(e.planRef?.slice(-8) || "?")}</span>` +
        `<span class="gov-pill gov-pill-superseded">${esc(e.status || "superseded")}</span>` +
        `<span class="gov-meta">${esc(e.approvedAt || "")}</span>` +
        `</div>`,
      ).join("")}</div>`
    : "";
  return `
    <div class="gov-section">
      <div class="gov-section-title">Plans</div>
      ${activeBlock}
      ${supersededBlock}
    </div>`;
}

// Render one contract item (used by both active emission and in-force).
// origin indicates where the contract came from ("emitted here" vs an
// ancestor scope path).
function renderContractItem(c, origin = null) {
  let scopeStr = "global";
  if (c.scope === "global") scopeStr = "global";
  else if (c.scope?.shared) scopeStr = `shared: ${c.scope.shared.join(", ")}`;
  else if (c.scope?.local) {
    const ll = Array.isArray(c.scope.local) ? c.scope.local : [c.scope.local];
    scopeStr = `local: ${ll.join(", ")}`;
  }
  const originBadge = origin
    ? `<span class="gov-meta gov-contract-origin">from: <code>${esc(origin)}</code></span>`
    : "";
  return `<div class="gov-contract-item">` +
    `<div class="gov-contract-header">` +
    `<span class="gov-tag gov-tag-kind">${esc(c.kind || "contract")}</span>` +
    `<code class="gov-contract-name">${esc(c.name || "(unnamed)")}</code>` +
    `<span class="gov-meta">scope: ${esc(scopeStr)}</span>` +
    `${originBadge}` +
    `</div>` +
    (c.details ? `<pre class="gov-contract-details">${esc(truncate(c.details, 400))}</pre>` : "") +
    (c.rationale ? `<div class="gov-rationale">${esc(truncate(c.rationale, 300))}</div>` : "") +
    `</div>`;
}

function renderContractsSection(entry) {
  const { contractsEmission, contractsInForce, ledgers, snapshot } = entry;
  const hasAnything =
    contractsEmission ||
    (contractsInForce && contractsInForce.length > 0) ||
    (ledgers?.contracts && ledgers.contracts.length > 0);
  if (!hasAnything) {
    return `<div class="gov-section gov-section-empty"><div class="gov-section-title">Contracts</div><div class="gov-empty-note">No contracts yet.</div></div>`;
  }
  let activeBlock = "";
  if (contractsEmission) {
    const isInheritance = !!contractsEmission.inheritsFrom;
    const inheritanceBadge = isInheritance
      ? `<span class="gov-pill gov-pill-inheritance">inherits from parent</span>`
      : "";
    const contractsList = isInheritance
      ? `<div class="gov-inheritance-note">This scope inherits parent contracts; no new vocabulary committed. ` +
        `Parent contracts applied: ${(contractsEmission.parentContractsApplied || []).map((r) => `<code>${esc(r)}</code>`).join(", ") || "(none listed)"}.</div>`
      : (contractsEmission.contracts || []).map((c) => renderContractItem(c)).join("");
    activeBlock = `
      <details class="gov-contracts-card gov-contracts-active" open>
        <summary>
          <span class="gov-emission-slug">${esc(contractsEmission.slug || `emission-${contractsEmission.ordinal}`)}</span>
          <span class="gov-emission-ordinal">#${contractsEmission.ordinal}</span>
          <span class="gov-pill gov-pill-active">active</span>
          ${inheritanceBadge}
          <span class="gov-meta">${esc(contractsEmission.emittedAt || "")}</span>
        </summary>
        <div class="gov-emission-body">
          ${contractsEmission.reasoning ? `<div class="gov-reasoning"><h5>Reasoning</h5><p>${esc(contractsEmission.reasoning)}</p></div>` : ""}
          <div class="gov-contracts-list">${contractsList || "<div class='gov-empty-note'>(empty)</div>"}</div>
        </div>
      </details>`;
  }

  // Superseded emissions from the contracts approval ledger. Mirrors
  // the renderPlansSection treatment so the operator sees the full
  // history at this scope, not just the active one.
  const activeContractsId =
    snapshot?.contracts?.emissionNodeId ||
    contractsEmission?._emissionNodeId ||
    contractsEmission?.emissionNodeId;
  const supersededContracts = (ledgers?.contracts || [])
    .filter((e) => {
      const ref = e?.contractsRef || e?.emissionRef || "";
      const id = ref.includes(":") ? ref.split(":").pop() : ref;
      return id && id !== activeContractsId;
    })
    .slice(-5);
  const supersededBlock = supersededContracts.length > 0
    ? `<div class="gov-superseded-list">${supersededContracts.map((e) => {
        const ref = e?.contractsRef || e?.emissionRef || "";
        const idShort = ref.split(":").pop()?.slice(-8) || "?";
        return `<div class="gov-superseded-item">` +
          `<span class="gov-emission-ordinal">#${esc(idShort)}</span>` +
          `<span class="gov-pill gov-pill-${esc(e.status || "superseded")}">${esc(e.status || "superseded")}</span>` +
          `<span class="gov-meta">${esc(e.approvedAt || "")}</span>` +
          `</div>`;
      }).join("")}</div>`
    : "";

  // In-force vocabulary at this scope: every contract effective here
  // (this scope's emission + ancestor scopes' emissions, walked by
  // readContracts). Distinct from the active emission, which is only
  // what THIS scope's Contractor most recently ratified. Inheriting
  // scopes have an empty emission but a populated in-force list. When
  // the emission and the in-force list have the same shape (newest
  // emission covers everything inherited), this section will look
  // redundant — but for scopes that inherit it's the only place the
  // operator sees what governs them.
  let inForceBlock = "";
  if (contractsInForce && contractsInForce.length > 0) {
    // Identify which contracts came from THIS scope's active emission
    // versus an ancestor. Match by id (or kind:name fallback).
    const emittedIds = new Set(
      (contractsEmission?.contracts || []).map((c) =>
        String(c.id || `${c.kind}:${c.name}`),
      ),
    );
    const inheritedItems = contractsInForce.filter((c) =>
      !emittedIds.has(String(c.id || `${c.kind}:${c.name}`)),
    );
    const inheritedCount = inheritedItems.length;
    const localCount = contractsInForce.length - inheritedCount;
    // Only show this section when there are actually inherited
    // contracts — otherwise the "active emission" block already shows
    // everything and a second copy is noise.
    if (inheritedCount > 0) {
      inForceBlock = `
        <details class="gov-contracts-inforce">
          <summary>
            <span class="gov-section-subtitle">In force at this scope</span>
            <span class="gov-meta">· ${contractsInForce.length} total (${localCount} emitted here, ${inheritedCount} inherited)</span>
          </summary>
          <div class="gov-contracts-list gov-contracts-inforce-list">
            ${inheritedItems.map((c) => renderContractItem(c, c._origin || "ancestor")).join("")}
          </div>
        </details>`;
    }
  }

  return `
    <div class="gov-section">
      <div class="gov-section-title">Contracts ${ledgers?.contracts?.length > 0 ? `<span class="gov-meta">· ${ledgers.contracts.length} emission${ledgers.contracts.length === 1 ? "" : "s"} on ledger</span>` : ""}</div>
      ${activeBlock}
      ${supersededBlock}
      ${inForceBlock}
    </div>`;
}

function renderRunsSection(entry) {
  const { executionRecord, ledgers } = entry;
  if (!executionRecord && (!ledgers?.execution || ledgers.execution.length === 0)) {
    return `<div class="gov-section gov-section-empty"><div class="gov-section-title">Runs</div><div class="gov-empty-note">No runs yet.</div></div>`;
  }
  let activeBlock = "";
  if (executionRecord) {
    const counts = (executionRecord.stepStatuses || []).reduce((acc, s) => {
      acc[s?.status] = (acc[s?.status] || 0) + 1;
      return acc;
    }, {});
    const countsLine = Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    activeBlock = `
      <details class="gov-runs-card gov-runs-active" open>
        <summary>
          <span class="gov-emission-slug">${esc(executionRecord.slug || `record-${executionRecord.ordinal}`)}</span>
          <span class="gov-emission-ordinal">#${executionRecord.ordinal}</span>
          <span class="gov-pill gov-pill-${esc(executionRecord.status)}">${esc(executionRecord.status)}</span>
          <span class="gov-meta">${esc(countsLine)}</span>
        </summary>
        <div class="gov-emission-body">
          ${executionRecord.startedAt ? `<div class="gov-meta">started: ${esc(executionRecord.startedAt)}</div>` : ""}
          ${executionRecord.completedAt ? `<div class="gov-meta">completed: ${esc(executionRecord.completedAt)}</div>` : ""}
        </div>
      </details>`;
  }

  // Prior run records from the execution approval ledger. Mirrors how
  // renderPlansSection handles superseded plan emissions. Without this
  // the operator only sees the currently-active execution and assumes
  // earlier runs disappeared.
  const activeId = executionRecord?._executionNodeId || executionRecord?.executionNodeId;
  const priorRuns = (ledgers?.execution || [])
    .filter((e) => {
      const ref = e?.executionRef || e?.runRef || "";
      const id = ref.includes(":") ? ref.split(":").pop() : ref;
      return id && id !== activeId;
    })
    .slice(-10); // last 10 prior runs

  const priorBlock = priorRuns.length > 0
    ? `<details class="gov-runs-prior"><summary><span class="gov-meta">${priorRuns.length} prior run${priorRuns.length === 1 ? "" : "s"}</span></summary>` +
      `<div class="gov-superseded-list">` +
      priorRuns.map((e) => {
        const ref = e?.executionRef || e?.runRef || "";
        const idShort = ref.split(":").pop()?.slice(-8) || "?";
        const status = e?.status || "superseded";
        return `<div class="gov-superseded-item">` +
          `<span class="gov-emission-ordinal">#${esc(idShort)}</span>` +
          `<span class="gov-pill gov-pill-${esc(status)}">${esc(status)}</span>` +
          `<span class="gov-meta">${esc(e?.approvedAt || e?.completedAt || "")}</span>` +
          `</div>`;
      }).join("") +
      `</div></details>`
    : "";

  return `
    <div class="gov-section">
      <div class="gov-section-title">Runs ${priorRuns.length > 0 ? `<span class="gov-meta">· ${priorRuns.length + (executionRecord ? 1 : 0)} total</span>` : ""}</div>
      ${activeBlock}
      ${priorBlock}
    </div>`;
}

function renderWorkersSection(entry) {
  const { executionRecord } = entry;
  if (!executionRecord || !Array.isArray(executionRecord.stepStatuses)) {
    return `<div class="gov-section gov-section-empty"><div class="gov-section-title">Workers</div><div class="gov-empty-note">No workers dispatched yet.</div></div>`;
  }
  const buckets = { running: [], done: [], failed: [], blocked: [], advanced: [], other: [] };
  for (const s of executionRecord.stepStatuses) {
    if (s?.type !== "leaf") continue;
    const status = s.status || "pending";
    if (status === "running") buckets.running.push(s);
    else if (status === "done") buckets.done.push(s);
    else if (status === "failed") buckets.failed.push(s);
    else if (status === "blocked") buckets.blocked.push(s);
    else if (status === "advanced") buckets.advanced.push(s);
    else buckets.other.push(s);
  }
  function renderWorker(s) {
    const wt = s.workerType || "build";
    const time = s.startedAt
      ? `<span class="gov-meta">started ${esc(s.startedAt)}</span>`
      : "";
    const completed = s.completedAt
      ? `<span class="gov-meta">completed ${esc(s.completedAt)}</span>`
      : "";
    const error = s.error
      ? `<div class="gov-error">${esc(truncate(s.error, 240))}</div>`
      : "";
    const pulse = s.status === "running" ? " gov-worker-chip-pulse" : "";
    return `<details class="gov-worker-chip gov-worker-${esc(s.status)}${pulse}">` +
      `<summary>` +
      `<span class="gov-worker-chip-step">step ${s.stepIndex}</span>` +
      `<span class="gov-tag gov-tag-${esc(wt)}">${esc(wt)}</span>` +
      `<span class="gov-pill gov-pill-${esc(s.status)}">${esc(s.status)}</span>` +
      `<span class="gov-worker-chip-spec">${esc(truncate(s.spec || "(no spec)", 80))}</span>` +
      `</summary>` +
      `<div class="gov-worker-chip-body">` +
      `<div class="gov-worker-spec">${esc(truncate(s.spec || "(no spec)", 240))}</div>` +
      `<div class="gov-worker-meta">${time} ${completed}</div>` +
      error +
      `</div>` +
      `</details>`;
  }
  const sections = [];
  if (buckets.running.length > 0) {
    sections.push(`<div class="gov-workers-bucket"><h5>Active (${buckets.running.length})</h5><div class="gov-workers-row">${buckets.running.map(renderWorker).join("")}</div></div>`);
  }
  if (buckets.failed.length > 0) {
    sections.push(`<div class="gov-workers-bucket"><h5>Failed (${buckets.failed.length})</h5><div class="gov-workers-row">${buckets.failed.map(renderWorker).join("")}</div></div>`);
  }
  if (buckets.blocked.length > 0) {
    sections.push(`<div class="gov-workers-bucket"><h5>Blocked (${buckets.blocked.length})</h5><div class="gov-workers-row">${buckets.blocked.map(renderWorker).join("")}</div></div>`);
  }
  if (buckets.advanced.length > 0) {
    sections.push(`<div class="gov-workers-bucket gov-workers-collapsed"><h5>Advanced to sub-scope (${buckets.advanced.length})</h5><div class="gov-workers-row">${buckets.advanced.map(renderWorker).join("")}</div></div>`);
  }
  if (buckets.done.length > 0) {
    sections.push(`<div class="gov-workers-bucket gov-workers-collapsed"><h5>Completed (${buckets.done.length})</h5><div class="gov-workers-row">${buckets.done.map(renderWorker).join("")}</div></div>`);
  }
  if (sections.length === 0) {
    return `<div class="gov-section gov-section-empty"><div class="gov-section-title">Workers</div><div class="gov-empty-note">No active or completed leaf workers.</div></div>`;
  }
  return `
    <div class="gov-section">
      <div class="gov-section-title">Workers</div>
      ${sections.join("")}
    </div>`;
}

function renderFlagsSection(entry) {
  const { flagsSummary, flagsAll } = entry;
  if (!flagsSummary || flagsSummary.total === 0) {
    return `<div class="gov-section gov-section-empty"><div class="gov-section-title">Pending Flags</div><div class="gov-empty-note">No flags surfaced at this scope.</div></div>`;
  }
  const counts = Object.entries(flagsSummary.countsByKind || {})
    .map(([k, v]) => `<span class="gov-tag gov-tag-${esc(k)}">${esc(k)}: ${v}</span>`)
    .join(" ");
  const blockingPill = flagsSummary.blockingCount > 0
    ? `<span class="gov-pill gov-pill-blocking">${flagsSummary.blockingCount} blocking</span>`
    : "";
  const recentList = (flagsSummary.recent || []).map((f) => {
    const where = f.artifactContext?.scope
      ? `${esc(f.artifactContext.scope)}${f.artifactContext.file ? "/" + esc(f.artifactContext.file) : ""}`
      : esc(f.artifactContext?.file || "?");
    const blocker = f.blocking ? `<span class="gov-pill gov-pill-blocking">blocking</span>` : "";
    const wt = f.sourceWorker?.workerType
      ? `<span class="gov-tag gov-tag-${esc(f.sourceWorker.workerType)}">${esc(f.sourceWorker.workerType)}</span>`
      : "";
    return `<div class="gov-flag-item">` +
      `<div class="gov-flag-header">` +
      `<span class="gov-tag gov-tag-${esc(f.kind)}">${esc(f.kind)}</span>` +
      `${blocker} ${wt}` +
      `<span class="gov-meta">${where}</span>` +
      `</div>` +
      `<div class="gov-flag-choice"><strong>local choice:</strong> ${esc(truncate(f.localChoice || "(none)", 240))}</div>` +
      (f.proposedResolution ? `<div class="gov-flag-proposed"><strong>proposed:</strong> ${esc(truncate(f.proposedResolution, 240))}</div>` : "") +
      `</div>`;
  }).join("");
  // The "expand all" list — only different from recent when total >
  // lastN. Renders as a collapsed details block to keep the default
  // view focused on recent.
  const allBlock = (flagsAll && flagsAll.length > flagsSummary.recent.length)
    ? `<details class="gov-flags-all"><summary>View all ${flagsAll.length} pending flags</summary>` +
      flagsAll.map((f) => {
        const where = f.artifactContext?.scope
          ? `${esc(f.artifactContext.scope)}${f.artifactContext.file ? "/" + esc(f.artifactContext.file) : ""}`
          : esc(f.artifactContext?.file || "?");
        return `<div class="gov-flag-item">` +
          `<span class="gov-tag gov-tag-${esc(f.kind)}">${esc(f.kind)}</span> ` +
          `<span class="gov-meta">${where}</span>` +
          `<div class="gov-flag-choice">${esc(truncate(f.localChoice || "", 200))}</div>` +
          `</div>`;
      }).join("") +
      `</details>`
    : "";
  return `
    <div class="gov-section">
      <div class="gov-section-title">Pending Flags <span class="gov-meta">(${flagsSummary.total} unresolved)</span></div>
      <div class="gov-flag-counts">${counts} ${blockingPill}</div>
      <div class="gov-flag-recent">
        <h5>Recent (last ${flagsSummary.recent.length})</h5>
        ${recentList}
      </div>
      ${allBlock}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────
// TOP-LEVEL SUMMARY STRIP
// One-line totals across the whole rulership. Lets the operator's eye
// land on activity without reading the tree.
// ─────────────────────────────────────────────────────────────────────

function renderSummaryStrip(rulers, allVitals) {
  if (!rulers || rulers.length === 0) return "";

  let totalRulers = rulers.length;
  let totalActiveWorkers = 0;
  let totalDoneWorkers = 0;
  let totalFailedWorkers = 0;
  let totalFlags = 0;
  let totalBlocking = 0;
  let stateCounts = { idle: 0, plan: 0, contracts: 0, dispatch: 0, running: 0, completed: 0, failed: 0 };

  for (const v of allVitals) {
    totalActiveWorkers += v.workers.running;
    totalDoneWorkers += v.workers.done;
    totalFailedWorkers += v.workers.failed;
    totalFlags += v.flagTotal;
    totalBlocking += v.flagBlocking;
    if (stateCounts[v.stateKey] != null) stateCounts[v.stateKey]++;
  }

  const tiles = [
    `<div class="gov-summary-tile"><span class="gov-summary-num">${totalRulers}</span><span class="gov-summary-label">Ruler scopes</span></div>`,
    `<div class="gov-summary-tile gov-summary-tile-running"><span class="gov-summary-num">${totalActiveWorkers}</span><span class="gov-summary-label">workers running</span></div>`,
    `<div class="gov-summary-tile gov-summary-tile-done"><span class="gov-summary-num">${totalDoneWorkers}</span><span class="gov-summary-label">workers done</span></div>`,
  ];
  if (totalFailedWorkers > 0) {
    tiles.push(`<div class="gov-summary-tile gov-summary-tile-failed"><span class="gov-summary-num">${totalFailedWorkers}</span><span class="gov-summary-label">workers failed</span></div>`);
  }
  if (totalFlags > 0) {
    const blockSuffix = totalBlocking > 0
      ? ` <span class="gov-summary-num-sub">(${totalBlocking} blocking)</span>`
      : "";
    tiles.push(`<div class="gov-summary-tile gov-summary-tile-flags${totalBlocking > 0 ? " gov-summary-tile-warn" : ""}"><span class="gov-summary-num">${totalFlags}</span><span class="gov-summary-label">flags${blockSuffix}</span></div>`);
  }

  return `<div class="gov-summary-strip">${tiles.join("")}</div>`;
}

// ─────────────────────────────────────────────────────────────────────
// RULERSHIP MINIMAP
// A horizontal SVG strip showing every Ruler as a badge, colored by
// lifecycle state, connected parent → child. Click-jumps to the
// matching card via #ruler-{id} anchor.
//
// Layout strategy: flat layered tidy tree. Each depth is a horizontal
// row. X positions allocated equally across the row. Connections
// drawn root → children → grandchildren.
// ─────────────────────────────────────────────────────────────────────

function layoutRulershipMinimap(rulers, allVitals) {
  // Group by depth. Each entry: { entry, vitals, depth, x, y }
  const byDepth = new Map();
  for (let i = 0; i < rulers.length; i++) {
    const d = rulers[i].depth;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push({ entry: rulers[i], vitals: allVitals[i], depth: d });
  }
  const maxDepth = Math.max(...byDepth.keys());
  const WIDTH = 920;
  const ROW_H = 56;
  const PADDING_X = 24;
  // Assign x by depth row
  for (const [d, list] of byDepth) {
    const usable = WIDTH - PADDING_X * 2;
    const step = usable / Math.max(list.length, 1);
    list.forEach((node, i) => {
      node.x = PADDING_X + step * i + step / 2;
      node.y = 28 + d * ROW_H;
    });
  }
  // Flat array sorted by depth for rendering
  const nodes = [];
  for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
    for (const n of byDepth.get(d)) nodes.push(n);
  }
  const lookup = new Map();
  for (const n of nodes) {
    lookup.set(String(n.entry.rulerNodeId), n);
  }
  // Build edges from each child's parentRulerId
  const edges = [];
  for (const n of nodes) {
    const parentId = n.entry.snapshot?.lineage?.parentRulerId;
    if (!parentId) continue;
    const parent = lookup.get(String(parentId));
    if (!parent) continue;
    edges.push({ from: parent, to: n });
  }
  const height = 56 + maxDepth * ROW_H;
  return { nodes, edges, width: WIDTH, height };
}

function renderMinimap(rulers, allVitals) {
  if (!rulers || rulers.length === 0) return "";
  const { nodes, edges, width, height } = layoutRulershipMinimap(rulers, allVitals);

  const edgesSvg = edges.map((e) => {
    const midY = (e.from.y + e.to.y) / 2;
    return `<path d="M${e.from.x.toFixed(1)} ${(e.from.y + 12).toFixed(1)} C${e.from.x.toFixed(1)} ${midY.toFixed(1)} ${e.to.x.toFixed(1)} ${midY.toFixed(1)} ${e.to.x.toFixed(1)} ${(e.to.y - 12).toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="1.4" />`;
  }).join("");

  const nodesSvg = nodes.map((n) => {
    const idShort = String(n.entry.rulerNodeId).slice(0, 8);
    const stateKey = n.vitals.stateKey;
    const wRunning = n.vitals.workers.running;
    const flagsPending = n.vitals.flagTotal;
    const wFailed = n.vitals.workers.failed;
    const counts = [];
    if (wRunning > 0) counts.push(`<text x="${(n.x + 18).toFixed(1)}" y="${(n.y + 2).toFixed(1)}" fill="#fb923c" font-size="9" font-weight="700">${wRunning}🔨</text>`);
    if (flagsPending > 0) counts.push(`<text x="${(n.x + 18).toFixed(1)}" y="${(n.y + 14).toFixed(1)}" fill="${n.vitals.flagBlocking > 0 ? "#fca5a5" : "#fcd34d"}" font-size="9" font-weight="700">${flagsPending}🚩</text>`);
    if (wFailed > 0) counts.push(`<text x="${(n.x - 26).toFixed(1)}" y="${(n.y + 2).toFixed(1)}" fill="#f87171" font-size="9" font-weight="700">${wFailed}✗</text>`);
    const title = `${esc(n.entry.rulerName || idShort)} · ${stateKey}`;
    return `
      <a href="#ruler-${esc(String(n.entry.rulerNodeId))}" class="gov-minimap-node" data-state="${stateKey}">
        <title>${title}</title>
        <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="11" />
        <text class="gov-minimap-emoji" x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle">👑</text>
        ${counts.join("")}
      </a>`;
  }).join("");

  return `
    <div class="gov-minimap-wrap">
      <div class="gov-minimap-title">Rulership Map <span class="gov-meta">· click any scope to jump</span></div>
      <svg class="gov-minimap" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMin meet" role="img" aria-label="rulership minimap">
        ${edgesSvg}
        ${nodesSvg}
      </svg>
      <div class="gov-minimap-legend">
        <span data-state="idle">idle</span>
        <span data-state="plan">plan</span>
        <span data-state="contracts">contracts</span>
        <span data-state="dispatch">dispatch</span>
        <span data-state="running">running</span>
        <span data-state="completed">completed</span>
        <span data-state="failed">failed</span>
      </div>
    </div>`;
}

function renderPass2Placeholders() {
  return `
    <div class="gov-section gov-section-pass2">
      <div class="gov-section-title">Pending Courts <span class="gov-meta">(Pass 2)</span></div>
      <div class="gov-empty-note">No courts convened. Pass 2 work will populate this section.</div>
    </div>
    <div class="gov-section gov-section-pass2">
      <div class="gov-section-title">Resolved Flags <span class="gov-meta">(Pass 2)</span></div>
      <div class="gov-empty-note">No resolved flags. Pass 2 court rulings will populate this section.</div>
    </div>`;
}

function renderRulerCard(entry) {
  // Card opens expanded by default for the root (depth 0) and the
  // first 2 sub-Rulers; deeper levels stay collapsed for scanability.
  const openAttr = entry.depth <= 1 ? "open" : "";
  const indentStyle = `style="--gov-depth:${entry.depth}"`;
  const vitals = computeRulerVitals(entry);
  const anchorId = `ruler-${esc(String(entry.rulerNodeId))}`;
  return `
    <details id="${anchorId}" class="gov-ruler-card" data-ruler-id="${esc(entry.rulerNodeId)}" data-depth="${entry.depth}" data-state="${vitals.stateKey}" ${indentStyle} ${openAttr}>
      <summary class="gov-ruler-summary">
        ${renderPositionHeader(entry, vitals)}
      </summary>
      <div class="gov-ruler-body">
        ${renderPlansSection(entry)}
        ${renderContractsSection(entry)}
        ${renderRunsSection(entry)}
        ${renderWorkersSection(entry)}
        ${renderFlagsSection(entry)}
        ${renderPass2Placeholders()}
      </div>
    </details>`;
}

// ─────────────────────────────────────────────────────────────────────
// MAIN CONTAINER
// ─────────────────────────────────────────────────────────────────────

function renderMainContainer(data) {
  if (!data) {
    return `<div class="gov-empty-state"><h2>Governance dashboard</h2><p>No data available for this root.</p></div>`;
  }
  if (!data.rulers || data.rulers.length === 0) {
    return `
      <div class="gov-empty-state">
        <h2>${esc(data.root.treeName || "(untitled tree)")}</h2>
        <p class="gov-meta">root: <code>${esc(String(data.root.rootId).slice(0, 8))}</code></p>
        <p>No Ruler scopes yet at this root. Send a message in the chat panel — the first message at a workspace position promotes the root to Ruler and begins the rulership lifecycle.</p>
        <div class="gov-section gov-section-pass2">
          <div class="gov-section-title">All Active Courts <span class="gov-meta">(Pass 2)</span></div>
          <div class="gov-empty-note">No courts convened. Pass 2 work will populate this section.</div>
        </div>
      </div>`;
  }
  const truncatedWarning = data.truncated
    ? `<div class="gov-warning">⚠ Rulership tree exceeds the safety cap; some sub-Rulers may not be shown. This suggests a runaway dispatch worth investigating.</div>`
    : "";

  // Compute vitals once per Ruler so the summary strip, minimap, and
  // per-card chips all read from the same numbers. Order matches
  // data.rulers so indexing into allVitals[i] aligns with rulers[i].
  const allVitals = data.rulers.map(computeRulerVitals);

  return `
    <div class="gov-dashboard">
      <header class="gov-dashboard-header">
        <h1>${esc(data.root.treeName || "(untitled tree)")} <span class="gov-meta">/ governance</span></h1>
        <div class="gov-meta">root: <code>${esc(String(data.root.rootId).slice(0, 8))}</code> · ${data.rulers.length} Ruler scope${data.rulers.length === 1 ? "" : "s"}</div>
      </header>
      ${truncatedWarning}
      ${renderSummaryStrip(data.rulers, allVitals)}
      ${renderMinimap(data.rulers, allVitals)}
      <div class="gov-section gov-section-pass2 gov-toplevel-pass2">
        <div class="gov-section-title">All Active Courts <span class="gov-meta">(Pass 2)</span></div>
        <div class="gov-empty-note">No courts convened. Pass 2 work will populate this section with every court currently convened across the entire tree.</div>
      </div>
      <div class="gov-ruler-tree">
        ${data.rulers.map(renderRulerCard).join("")}
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────
// CLIENT BOOTSTRAP SCRIPT
// SSE subscription + refetch-on-update. Falls back to 10s polling.
// ─────────────────────────────────────────────────────────────────────

function renderBootstrapScript(rootId, token) {
  const tokenQs = token ? `&token=${encodeURIComponent(token)}` : "";
  return `<script>
(function() {
  const rootId = ${JSON.stringify(String(rootId))};
  const tokenQs = ${JSON.stringify(tokenQs)};
  const main = document.getElementById("gov-main");
  if (!main) return;
  let refreshInFlight = false;
  let lastRefreshAt = 0;
  // Capture the open/closed state of every <details> with a stable
  // identifier (data-ruler-id for Ruler cards; the summary's first
  // text for inner details so they roughly match across renders).
  // Without this, every SSE refresh slams main.innerHTML and every
  // expanded section the operator opened collapses. Felt like the
  // page was "closing my tabs" because that's effectively what was
  // happening.
  function captureOpenState() {
    const state = { rulers: {}, generic: [] };
    main.querySelectorAll("details").forEach((d) => {
      const id = d.dataset && d.dataset.rulerId;
      if (id) {
        state.rulers[id] = d.open;
      } else if (d.open) {
        // Inner <details> have no id. Key by class + summary text so a
        // re-render with the same content lands on the same element.
        const cls = d.className || "";
        const sumText = (d.querySelector("summary")?.textContent || "").trim().slice(0, 120);
        state.generic.push(cls + "|" + sumText);
      }
    });
    return state;
  }
  function restoreOpenState(state) {
    if (!state) return;
    main.querySelectorAll("details[data-ruler-id]").forEach((d) => {
      const id = d.dataset.rulerId;
      if (id in state.rulers) d.open = state.rulers[id];
    });
    const genericSet = new Set(state.generic);
    main.querySelectorAll("details:not([data-ruler-id])").forEach((d) => {
      const cls = d.className || "";
      const sumText = (d.querySelector("summary")?.textContent || "").trim().slice(0, 120);
      if (genericSet.has(cls + "|" + sumText)) d.open = true;
    });
  }
  async function refresh(reason) {
    if (refreshInFlight) return;
    // Coalesce: ignore refreshes that fire within 250ms of the last
    // one. SSE bursts during dispatch can otherwise hammer the
    // fetch endpoint.
    const now = Date.now();
    if (now - lastRefreshAt < 250) return;
    refreshInFlight = true;
    lastRefreshAt = now;
    try {
      const url = "/api/v1/root/" + encodeURIComponent(rootId) + "/governance?fragment=1" + tokenQs;
      const r = await fetch(url, { credentials: "include" });
      if (r.ok) {
        const html = await r.text();
        const openState = captureOpenState();
        const scrollY = window.scrollY;
        main.innerHTML = html;
        restoreOpenState(openState);
        // Preserve scroll position too — a refresh that resets the
        // viewport feels just as bad as collapsed tabs.
        window.scrollTo({ top: scrollY, behavior: "instant" });
      }
    } catch (e) {
      // Network blip — next event or poll will recover.
    } finally {
      refreshInFlight = false;
    }
  }
  // SSE connection. EventSource auto-reconnects on transient drops.
  let es = null;
  function connectStream() {
    try {
      const streamUrl = "/api/v1/root/" + encodeURIComponent(rootId) + "/governance/stream" + (tokenQs ? "?" + tokenQs.slice(1) : "");
      es = new EventSource(streamUrl, { withCredentials: true });
      es.addEventListener("update", function(ev) {
        let reason = "(unknown)";
        try { reason = JSON.parse(ev.data).reason || reason; } catch {}
        refresh(reason);
      });
      es.addEventListener("error", function() {
        // EventSource will retry on its own. The polling fallback
        // covers the gap if it can't.
      });
    } catch (e) {
      // SSE construction failure — polling fallback only.
    }
  }
  connectStream();
  // Polling fallback. 10s cadence — matches book-studio. The
  // refresh() coalesce above prevents double-fires when SSE is
  // working.
  setInterval(function() { refresh("poll"); }, 10000);
})();
</script>`;
}

// ─────────────────────────────────────────────────────────────────────
// TOP-LEVEL RENDERER
// ─────────────────────────────────────────────────────────────────────

/**
 * Render the governance dashboard page.
 *
 * @param {object} args
 * @param {Request} args.req       Express request (for auth context + token)
 * @param {string} args.rootId     tree root id
 * @param {boolean} args.inApp     suppress chat-bar duplication (true when loaded in dashboard iframe)
 * @param {boolean} args.fragment  return only the main container HTML, no chrome
 */
export async function renderDashboardPage({ req, rootId, inApp = false, fragment = false }) {
  const data = await buildDashboardData(rootId);

  if (DEBUG) {
    return `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
  }

  const mainHtml = renderMainContainer(data);

  if (fragment) {
    // Fragment mode: just the inner HTML of the main container, no
    // chrome. The client's bootstrap script swaps this into
    // #gov-main after SSE update events.
    return mainHtml;
  }

  const token = req?.query?.token ? String(req.query.token) : "";
  const css = await readDashboardCSS();
  const bootstrap = renderBootstrapScript(rootId, token);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Governance · ${esc(data?.root?.treeName || "TreeOS")}</title>
<style>${css}</style>
</head>
<body class="${inApp ? "gov-in-app" : ""}">
<main id="gov-main">${mainHtml}</main>
${bootstrap}
</body>
</html>`;
}
