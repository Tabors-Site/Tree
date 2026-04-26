// Walk-up primitive for the plan extension.
//
// A plan-type node lives at the scope it coordinates — as a sibling of
// the work-units it governs, not as a metadata adverb on a content
// node. `findGoverningPlan` is the SINGLE canonical way to discover
// plan context from any starting node. Every reader that wants a
// node's plan context routes through here; no code path reads plan
// metadata by other means.
//
// Walk semantics (nearest-first):
//   1. If the starting node itself is a plan-type node → return it.
//   2. If the starting node has a plan-type child → return it.
//      (This is the "what plan lives at this scope?" case — project
//      roots, branch nodes that are themselves scopes for sub-plans.)
//   3. Walk up to the starting node's parent; look at the parent's
//      children for a plan-type sibling → return nearest match.
//   4. Continue walking until a match is found or the root is hit.
//
// Performance: one batched `Node.find` query covers both the
// self-children check and all ancestor-children checks. Deep trees
// stay O(1) DB queries.
//
// Why this shape instead of metadata-on-node:
//   - Plans can outlive their work (a plan-type node persists after
//     its work-units complete); keeping it as a distinct node makes
//     that lifetime explicit.
//   - One plan can coordinate work that doesn't neatly fit under a
//     single content node (cross-cutting concerns).
//   - Workers don't have to carry plan state themselves; they look up.

import Node from "../../../seed/models/node.js";
import { getAncestorChain } from "../../../seed/tree/ancestorCache.js";
import log from "../../../seed/log.js";

/**
 * Find the plan-type node that governs the given node's work.
 *
 * Returns a lean node object `{ _id, type, name, parent, metadata }`
 * or null when no plan is discoverable at or above the node.
 */
export async function findGoverningPlan(nodeId) {
  if (!nodeId) return null;
  const id = String(nodeId);

  try {
    const self = await Node.findById(id).select("_id type name parent metadata").lean();
    if (!self) return null;
    // Case 1: self IS a plan.
    if (self.type === "plan") return self;

    // Build the parent chain, inclusive of self. Query plans whose
    // parent is self OR any ancestor in one round trip. Self-as-parent
    // covers Case 2 (plan-child of starting scope); ancestor-as-parent
    // covers Case 3 (plan-sibling at some ancestor scope).
    const chain = await getAncestorChain(id);
    if (!chain || chain.length === 0) return null;
    const scopeIds = chain.map((n) => n._id); // includes self at chain[0]

    const plans = await Node.find({
      parent: { $in: scopeIds },
      type: "plan",
    })
      .select("_id type name parent metadata")
      .lean();

    if (plans.length === 0) return null;

    // Return the deepest match (closest to the starting node). Iterate
    // chain in order (nearest-first). Self's children win over any
    // ancestor's children; the first ancestor's plan-child wins over
    // deeper ancestors'.
    for (let i = 0; i < chain.length; i++) {
      const scopeId = String(chain[i]._id);
      const match = plans.find((p) => String(p.parent) === scopeId);
      if (match) return match;
    }
    return null;
  } catch (err) {
    log.debug("Plan", `findGoverningPlan(${id}) failed: ${err.message}`);
    return null;
  }
}

/**
 * Return the full chain of plan-type nodes from the starting node's
 * scope up to the outermost plan. Useful for Pass 2's LCA arbitration
 * and for the UI's "you are here" breadcrumb across sub-plans.
 *
 * Order: nearest plan first, outermost plan last. Each entry is a
 * lean node object with the same shape as findGoverningPlan returns.
 * Empty array if the node has no governing plan.
 */
export async function findGoverningPlanChain(nodeId) {
  const chain = [];
  // Track plan ids we've already added so we don't loop on the same
  // plan. findGoverningPlan from the plan's parent (the scope node)
  // would return THIS plan again because it's a child of that scope;
  // without this guard the loop hits the 32-hop cap on every call,
  // turning one chain-walk into 32 redundant DB round-trips and
  // saturating the heap when called from enrichContext on every chat
  // turn against a Pass 1 plan-shape tree.
  const visited = new Set();
  let current = nodeId;
  // Cap walk depth to prevent runaway loops if the tree is cyclic.
  // Real plan nesting is bounded by the architecture's depth cap; 32
  // is paranoid-safe.
  for (let hop = 0; hop < 32; hop++) {
    const plan = await findGoverningPlan(current);
    if (!plan) break;
    const planId = String(plan._id);
    if (visited.has(planId)) break;
    visited.add(planId);
    chain.push(plan);
    // To find the plan ABOVE this one, walk past the scope that this
    // plan governs (plan.parent). Use the scope's parent so the next
    // findGoverningPlan can't return the same plan we just consumed.
    if (!plan.parent) break;
    const scopeParent = await Node.findById(plan.parent).select("parent").lean();
    if (!scopeParent?.parent) break;
    current = String(scopeParent.parent);
  }
  return chain;
}
