// Trio-node primitive RETIRED 2026-05-18.
//
// In the new shape ([[project_substrate_as_universal_workspace]]), the
// Planner being lives at the rulership node alongside Ruler, Contractor,
// Foreman. There is no separate plan-typed child node. Plans become
// artifacts authored by the Planner being, NOT children of a plan-node.
//
// This file used to export createPlanNode + ensurePlanAtScope. They are
// now no-ops that return the rulership node itself, for any legacy
// caller that still references them during the governing rewrite.
//
// READ helpers (readPlan, initPlan, appendLedger, findGoverningPlan,
// findGoverningPlanChain, DEFAULT_BUDGET, PLAN_NS) are preserved because
// they read substrate state and don't depend on the trio shape.

import Space from "../../../seed/models/space.js";
import log from "../../../seed/system/log.js";

export const PLAN_NS = "plan";

export const DEFAULT_BUDGET = {
  maxIterations: 30,
  maxTokens: 100000,
};

/**
 * RETIRED. In the new shape the Planner is a being-tree child of the
 * Ruler at the same node; there is no plan-typed child node. Returns
 * the existing scope node so callers that chain on the result don't
 * crash during the rewrite. Logs a deprecation warning the first time
 * each caller hits this.
 */
let _warnedPlan = false;
export async function createPlanNode({ parentNodeId, core: _core } = {}) {
  if (!_warnedPlan) {
    _warnedPlan = true;
    log.warn("Governing", "createPlanNode is retired; plans are artifacts authored by the Planner being. Caller should be updated.");
  }
  if (!parentNodeId) return null;
  return Space.findById(parentNodeId).lean();
}

let _warnedEnsure = false;
export async function ensurePlanAtScope({ scopeNodeId, core: _core } = {}) {
  if (!_warnedEnsure) {
    _warnedEnsure = true;
    log.warn("Governing", "ensurePlanAtScope is retired; Planner being is spawned by promoteToRuler. Caller should read metadata.beings.planner instead.");
  }
  if (!scopeNodeId) return null;
  return Space.findById(scopeNodeId).lean();
}

// ─────────────────────────────────────────────────────────────────────
// Read helpers (preserved). These operate on substrate state and are
// unaffected by the trio-node retirement.
// ─────────────────────────────────────────────────────────────────────

export async function readPlan(spaceId) {
  if (!spaceId) return null;
  const node = await Space.findById(spaceId).select("metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});
  return meta[PLAN_NS] || null;
}

export async function initPlan(_nodeId, _opts = {}) {
  // No-op in the new shape. Plan state lives in plan-emission artifacts
  // authored by the Planner being.
  return null;
}

export async function appendLedger(_nodeId, _entry) {
  // No-op in the new shape. Ledger entries live in artifact metadata or
  // dids on the relevant plan-emission artifact.
  return null;
}

export async function findGoverningPlan(spaceId) {
  // Walks up looking for a node carrying metadata.beings.planner. That
  // node IS the rulership; its Planner being authors the plans.
  if (!spaceId) return null;
  let cursor = String(spaceId);
  for (let i = 0; i < 64; i++) {
    if (!cursor) return null;
    const n = await Space.findById(cursor).select("_id parent metadata").lean();
    if (!n) return null;
    const meta = n.metadata instanceof Map
      ? Object.fromEntries(n.metadata)
      : (n.metadata || {});
    if (meta?.beings?.planner?.beingId) return n;
    if (!n.parent) return null;
    cursor = String(n.parent);
  }
  return null;
}

export async function findGoverningPlanChain(spaceId) {
  // Returns the chain of governing rulership nodes from this node up to
  // root. Each entry is a node that hosts a Planner being.
  if (!spaceId) return [];
  const chain = [];
  let cursor = String(spaceId);
  for (let i = 0; i < 64; i++) {
    if (!cursor) break;
    const n = await Space.findById(cursor).select("_id parent metadata").lean();
    if (!n) break;
    const meta = n.metadata instanceof Map
      ? Object.fromEntries(n.metadata)
      : (n.metadata || {});
    if (meta?.beings?.planner?.beingId) chain.push(n);
    if (!n.parent) break;
    cursor = String(n.parent);
  }
  return chain;
}
