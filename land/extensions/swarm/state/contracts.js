// Shared contracts: invariants every branch must respect within its
// scope. Storage moved from swarm-namespace on the project root to
// plan-namespace on plan-type nodes (Pass 1 Path B). Contracts now
// live on the plan that declares them; readers walk the plan chain
// to gather all contracts visible at a given depth, then filter to
// the slice scoped for a particular branch.
//
// Contract entry shape (canonical, post-parse):
//
//   {
//     id:        string,                   // unique within the plan
//     namespace: string,                   // see CONTRACT_NAMESPACES
//     name:      string,                   // human label
//     value:     any,                      // canonical value
//     scope:                               // who must comply:
//       "global" | { shared: [string] } | { local: string }
//     fields, values, raw                  // legacy parser fields
//   }

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

/**
 * Resolve the plan extension lazily (avoids a hard import cycle since
 * plan + swarm depend on each other through different layers).
 */
async function planExt() {
  try {
    const { getExtension } = await import("../../loader.js");
    return getExtension("plan")?.exports || null;
  } catch {
    return null;
  }
}

/**
 * Write contracts onto the plan governing the given scope. Replaces
 * the entire contract list — callers re-emit the full set when the
 * architect refreshes the plan. Resolves the scope's plan-type child
 * via ensurePlanAtScope so the contracts land on the plan's
 * metadata.plan.contracts, not on the scope node itself.
 *
 * scopeNodeId is the node whose governing plan should hold these
 * contracts. For a top-level project, that's the project root; for a
 * sub-plan, that's the sub-plan's parent (the worker's branch node).
 */
export async function setContracts({ scopeNodeId, contracts, userId, systemSpec = null, core }) {
  if (!scopeNodeId) return null;
  const scope = scopeNodeId;
  const p = await planExt();
  if (!p) {
    log.warn("Swarm", "setContracts: plan extension not loaded");
    return null;
  }
  let planNode = null;
  if (p.ensurePlanAtScope && userId) {
    // Pass systemSpec so when ensurePlanAtScope CREATES the plan node
    // for the first time, the plan-created ledger entry captures the
    // originating user request. Without this, contract-write paths
    // that create a plan as a side effect produce ledger entries with
    // systemSpec: null, breaking the historical trace from a plan
    // back to the request that spawned it.
    planNode = await p.ensurePlanAtScope(scope, { userId, systemSpec }, core);
  } else if (p.findGoverningPlan) {
    planNode = await p.findGoverningPlan(scope);
  }
  if (!planNode) {
    log.warn("Swarm", `setContracts: no plan resolvable at scope ${scope}`);
    return null;
  }
  const next = Array.isArray(contracts) ? contracts : [];
  await writeContractsToPlan(planNode._id, next, core);
  return planNode;
}

/**
 * Direct write to a plan-type node's contracts field. Used internally
 * by setContracts after resolving the plan node, and also by the
 * plan extension's own contract-amendment paths (Pass 2 will use it
 * when courts rule new contracts into existence).
 */
async function writeContractsToPlan(planNodeId, contracts, core) {
  // Use the plan extension's mutatePlan via initPlan-like path.
  // We don't have a public setContracts on plan; reach in via
  // metadata write. The plan extension owns the namespace, so we
  // route through its public surface where possible.
  const { setExtMeta: kernelSetExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
  const node = await Node.findById(planNodeId);
  if (!node) return null;
  const current = (node.metadata instanceof Map ? node.metadata.get("plan") : node.metadata?.plan) || {};
  const next = {
    ...current,
    contracts: Array.isArray(contracts) ? contracts : [],
    contractsAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await kernelSetExtMeta(node, "plan", next);
  return next;
}

/**
 * Read ALL contracts visible at a node's position. Walks the plan
 * chain from the node upward, collecting contracts from each plan
 * encountered. Returns a flat array (with scope tags preserved) so
 * downstream filters can pick the slice they need.
 *
 * Order: contracts from the nearest plan first, root-most plan last.
 * Duplicate IDs (same contract redeclared at multiple levels) keep
 * the nearest declaration — closer plans override outer ones.
 */
export async function readContracts(nodeId) {
  if (!nodeId) return [];
  const p = await planExt();
  if (!p?.findGoverningPlanChain) return [];
  const chain = await p.findGoverningPlanChain(nodeId);
  if (!chain || chain.length === 0) return [];
  const seenIds = new Set();
  const out = [];
  for (const planNode of chain) {
    const planMeta = (planNode.metadata instanceof Map
      ? planNode.metadata.get("plan")
      : planNode.metadata?.plan) || {};
    const list = Array.isArray(planMeta.contracts) ? planMeta.contracts : [];
    for (const c of list) {
      const id = c.id || `${c.kind || c.namespace || "contract"}:${c.name || ""}`;
      if (seenIds.has(id)) continue; // nearer plan already declared this id
      seenIds.add(id);
      out.push(c);
    }
  }
  return out;
}

/**
 * Read the scoped slice of contracts visible to a specific branch.
 * Walks the plan chain via readContracts, then filters each contract
 * against the branch:
 *
 *   scope === "global"                       → include
 *   scope.shared includes branchName         → include
 *   scope.local === branchName               → include
 *   anything else                            → exclude
 *
 * The result is what the branch's enrichContext renders into the
 * builder's prompt: "your contracts, scoped to you."
 */
export async function readScopedContracts({ nodeId, branchName }) {
  const all = await readContracts(nodeId);
  if (!branchName) return all; // no branch context → return everything
  const lower = String(branchName).trim().toLowerCase();
  return all.filter((c) => {
    const scope = c.scope || "global";
    if (scope === "global") return true;
    if (typeof scope !== "object") return true; // unrecognized → safe-default include
    if (Array.isArray(scope.shared)) {
      return scope.shared.some((b) => String(b).trim().toLowerCase() === lower);
    }
    if (scope.local) {
      return String(scope.local).trim().toLowerCase() === lower;
    }
    return true;
  });
}
