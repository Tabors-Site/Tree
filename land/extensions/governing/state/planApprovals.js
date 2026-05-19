// Plan approval ledger. Parallel to contractApprovals: the Ruler at a
// scope holds metadata.governing.planApprovals as an append-only list
// of ratification records, each pointing at the plan-type child node
// the Ruler approved. Plans, like contracts, are versioned via the
// underlying plan node's _writeSeq token (CAS bump per write); the
// supersedes ref carries the prior approved seq when a new draft
// replaces an earlier approval.
//
// Why a ledger here (parallel to contracts) rather than a flag on the
// plan node: the Ruler is the operational authority. Approval is an
// act the Ruler takes ON the plan, not a property of the plan itself.
// Pass 2 courts will read the audit chain — every approval, every
// supersession, every rejection. That chain must live with the Ruler.
//
// See project_contracts_node_architecture.md for the trio model and
// state/contracts.js for the contracts-side implementation this mirrors.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/core/log.js";

const NS = "governing";

/**
 * Build a planRef string. Same shape as contractRef: "<nodeId>:<seq>".
 * The seq is the plan node's metadata.plan._writeSeq at the moment of
 * approval, which uniquely identifies that draft of the plan.
 */
export function buildPlanRef(planNodeId, writeSeq) {
  return `${String(planNodeId)}:${String(writeSeq || "init")}`;
}

/**
 * Parse a planRef into { planNodeId, writeSeq }. Returns null on bad
 * shape. Mirrors parseContractRef.
 */
export function parsePlanRef(ref) {
  if (typeof ref !== "string" || !ref) return null;
  const idx = ref.indexOf(":");
  if (idx <= 0) return null;
  const planNodeId = ref.slice(0, idx);
  const writeSeq = ref.slice(idx + 1);
  if (!planNodeId || !writeSeq) return null;
  return { planNodeId, writeSeq };
}

/**
 * Read the current _writeSeq token from a plan-type node's
 * metadata.plan namespace. Returns null when the field is absent (a
 * brand-new plan that hasn't been written yet); callers default to
 * "init" via buildPlanRef.
 */
async function readPlanWriteSeq(planNodeId) {
  const node = await Node.findById(planNodeId).select("_id metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get("plan")
    : node.metadata?.plan;
  return meta?._writeSeq || null;
}

/**
 * Atomically append an approval entry to metadata.governing.planApprovals
 * on the Ruler scope node. Read-modify-write: the namespace blob is one
 * field, so $push on a nested array can't go through extensionMetadata's
 * helpers without losing the rest of the namespace. The contention
 * window is short (one Ruler approves at most one plan per cycle).
 */
export async function appendPlanApproval({
  rulerNodeId,
  planNodeId,
  status = "approved",
  supersedes = null,
  reason = null,
  // Phase 3 ([[project_seed_four_verbs_only]]): callers thread core.
  core,
}) {
  if (!rulerNodeId || !planNodeId) return null;
  if (!core?.do) throw new Error("appendPlanApproval requires `core` (verb surface)");
  const node = await Node.findById(rulerNodeId);
  if (!node) return null;

  const writeSeq = await readPlanWriteSeq(planNodeId);
  const planRef = buildPlanRef(planNodeId, writeSeq);
  const approvedAt = new Date().toISOString();

  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  const existing = Array.isArray(meta?.planApprovals) ? meta.planApprovals : [];

  const entry = {
    planRef,
    approvedAt,
    status,
    supersedes: supersedes || null,
    reason: reason || null,
  };

  // Phase 3 migration ([[project_seed_four_verbs_only]]): write through
  // the verb surface so plan-approval writes auto-audit as Dids.
  // merge:true preserves other keys in NS atomically (the prior
  // read-spread-write would clobber concurrent writes to sibling keys).
  await core.do(node, "set-meta", {
    namespace: NS,
    data: { planApprovals: [...existing, entry] },
    merge: true,
  });

  // Fire ratification hook so Pass 2 courts and dashboard listeners
  // can observe plan approvals the same way they observe contract
  // approvals. Mirrors the governing:contractRatified pattern.
  try {
    const { hooks } = await import("../../../seed/core/hooks.js");
    hooks.run("governing:planRatified", {
      rulerNodeId: String(rulerNodeId),
      planNodeId: String(planNodeId),
      planRef,
      approvedAt,
      status,
      supersedes,
    }).catch(() => {});
  } catch (err) {
    log.debug("Governing", `governing:planRatified hook fire failed: ${err.message}`);
  }

  return entry;
}

/**
 * Read the plan-approval ledger from a Ruler scope. Returns the array
 * of approval entries or empty array. Mirrors readApprovalLedger for
 * contracts.
 */
export function readPlanApprovalLedger(rulerNode) {
  if (!rulerNode) return [];
  const meta = rulerNode.metadata instanceof Map
    ? rulerNode.metadata.get(NS)
    : rulerNode.metadata?.[NS];
  return Array.isArray(meta?.planApprovals) ? meta.planApprovals : [];
}

/**
 * Read the full plan-approval ledger at a Ruler scope by id, including
 * superseded entries. Pass 2 courts read this for the audit chain.
 */
export async function readPlanApprovalsAtRuler(rulerNodeId) {
  if (!rulerNodeId) return [];
  const node = await Node.findById(rulerNodeId).select("_id metadata").lean();
  if (!node) return [];
  return readPlanApprovalLedger(node);
}

/**
 * Find the latest non-superseded plan approval at a Ruler scope,
 * regardless of status. Used by the snapshot to surface "pending"
 * plans (waiting on the Ruler's delegate to ratify) alongside
 * approved ones. Caller inspects `.status` to branch.
 *
 * `supersedes` chains apply: a status="approved" entry that supersedes
 * a prior planRef removes the prior from the active set. Same logic
 * for any other transition (e.g., a pending entry replaces a prior
 * pending if it carries `supersedes`).
 */
export async function readLatestPlanApproval(rulerNodeId) {
  const ledger = await readPlanApprovalsAtRuler(rulerNodeId);
  if (!ledger.length) return null;
  const supersededSet = new Set();
  for (const entry of ledger) {
    if (entry?.supersedes) supersededSet.add(String(entry.supersedes));
  }
  for (let i = ledger.length - 1; i >= 0; i--) {
    const entry = ledger[i];
    if (!entry) continue;
    if (supersededSet.has(String(entry.planRef))) continue;
    return entry;
  }
  return null;
}

/**
 * Find the most recent approved (non-superseded) plan approval at a
 * Ruler scope. Returns the entry or null.
 */
export async function readActivePlanApproval(rulerNodeId) {
  const ledger = await readPlanApprovalsAtRuler(rulerNodeId);
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
    if (supersededSet.has(String(entry.planRef))) continue;
    return entry;
  }
  return null;
}

/**
 * Read the structured plan emission currently active at a Ruler scope.
 * Walks active approval → planRef → emission child node →
 * metadata.governing.emission payload. Returns the payload (with
 * `reasoning`, `steps[]`, `emittedAt`) or null when nothing is active.
 *
 * This is the dispatch-side read for phase 2 prototype: dispatch reads
 * the structured emission as source-of-truth for compound vs leaf
 * routing (rather than parsing [[BRANCHES]] text from the Planner's
 * answer). The text path stays callable as a fallback for non-tool
 * Planners during the migration.
 */
export async function readActivePlanEmission(rulerNodeId) {
  const active = await readActivePlanApproval(rulerNodeId);
  if (!active?.planRef) {
    log.debug("Governing",
      `readActivePlanEmission(${String(rulerNodeId).slice(0, 8)}): no active planApproval`);
    return null;
  }
  const parsed = parsePlanRef(active.planRef);
  if (!parsed) {
    log.warn("Governing",
      `readActivePlanEmission(${String(rulerNodeId).slice(0, 8)}): unparseable planRef "${active.planRef}"`);
    return null;
  }
  const node = await Node.findById(parsed.planNodeId).select("_id type metadata").lean();
  if (!node) {
    log.warn("Governing",
      `readActivePlanEmission(${String(rulerNodeId).slice(0, 8)}): planRef points at missing node ${String(parsed.planNodeId).slice(0, 8)}`);
    return null;
  }
  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  if (meta?.role !== "plan-emission") {
    log.warn("Governing",
      `readActivePlanEmission(${String(rulerNodeId).slice(0, 8)}): planRef points at node ${String(parsed.planNodeId).slice(0, 8)} ` +
      `(type=${node.type}) with governing.role=${meta?.role || "(none)"}, expected "plan-emission"`);
    return null;
  }
  if (meta?.emission) {
    return { ...meta.emission, _emissionNodeId: String(node._id) };
  }
  log.warn("Governing",
    `readActivePlanEmission(${String(rulerNodeId).slice(0, 8)}): emission node ${String(parsed.planNodeId).slice(0, 8)} ` +
    `has role=plan-emission but no metadata.governing.emission payload (likely depth-cap rejection during stamp)`);
  return null;
}

/**
 * Read the structured plan emission for a PENDING approval. Symmetric
 * to readActivePlanEmission but reads the latest entry regardless of
 * status, and only resolves when status === "pending". Used by the
 * snapshot to surface plan content waiting on the Ruler's delegate
 * to ratify (see memory `card-is-a-summon` for the architecture).
 *
 * Returns the emission payload (`reasoning`, `steps[]`, `emittedAt`,
 * `_emissionNodeId`) or null.
 */
export async function readPendingPlanEmission(rulerNodeId) {
  const latest = await readLatestPlanApproval(rulerNodeId);
  if (!latest || latest.status !== "pending" || !latest.planRef) return null;
  const parsed = parsePlanRef(latest.planRef);
  if (!parsed) return null;
  const node = await Node.findById(parsed.planNodeId).select("_id type metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  if (meta?.role !== "plan-emission" || !meta?.emission) return null;
  return { ...meta.emission, _emissionNodeId: String(node._id), _planRef: latest.planRef };
}
