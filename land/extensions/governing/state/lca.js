// LCA correctness for governing contracts.
//
// findLCA walks the parent chain for each named node, then finds the
// deepest common ancestor across all chains. Used by the Contractor's
// scope validation: a contract's scope can name consumers across
// multiple sub-Rulers, but the LCA of those consumers MUST sit at or
// above the Contractor's emission position. Otherwise the Contractor
// is binding vocabulary outside its own domain — a violation of
// scope authority.
//
// Direct ancestor walk with a visited-set guard. Does not use any
// fallback primitives that walk up on miss (per
// feedback_fallback_primitives_in_recursion: those primitives are
// for queries that legitimately want governing-X semantics; LCA
// is a structural query that wants exact ancestry).

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

const MAX_DEPTH = 64; // paranoia cap; real trees nest much shallower

/**
 * Build the root-first ancestor chain for a node. Returns
 * [rootId, ..., parentId, nodeId]. Empty array if the node does not
 * exist or the chain hits a cycle.
 */
export async function ancestorChain(nodeId) {
  const chain = [];
  const visited = new Set();
  let cursor = String(nodeId || "");
  for (let i = 0; i < MAX_DEPTH; i++) {
    if (!cursor) break;
    if (visited.has(cursor)) {
      log.warn("Governing", `ancestorChain cycle at ${cursor.slice(0, 8)}; truncating`);
      break;
    }
    visited.add(cursor);
    chain.unshift(cursor);
    const node = await Node.findById(cursor).select("parent").lean();
    if (!node?.parent) break;
    cursor = String(node.parent);
  }
  return chain;
}

/**
 * Find the lowest common ancestor of N node ids. Returns the LCA's
 * nodeId as a string, or null if the nodes do not share an ancestor
 * (different trees) or any node is missing.
 *
 * For one node, returns that node. For zero nodes, returns null.
 */
export async function findLCA(nodeIds) {
  if (!Array.isArray(nodeIds)) return null;
  const ids = nodeIds.map(String).filter(Boolean);
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];

  const chains = await Promise.all(ids.map(ancestorChain));
  if (chains.some((c) => c.length === 0)) return null;

  let lca = null;
  const minLength = Math.min(...chains.map((c) => c.length));
  for (let i = 0; i < minLength; i++) {
    const candidate = chains[0][i];
    if (chains.every((c) => c[i] === candidate)) {
      lca = candidate;
    } else {
      break;
    }
  }
  return lca;
}

/**
 * Predicate. Is `ancestorId` an ancestor of (or equal to) `descendantId`?
 * True iff `ancestorId` appears in the descendant's root-first chain.
 */
export async function isAncestorOrSelf(ancestorId, descendantId) {
  if (!ancestorId || !descendantId) return false;
  if (String(ancestorId) === String(descendantId)) return true;
  const chain = await ancestorChain(descendantId);
  return chain.includes(String(ancestorId));
}

/**
 * Validate that a Contractor at `emitterNodeId` has authority to bind
 * a contract whose consumers live at `consumerNodeIds`. Returns
 * { valid: true } or { valid: false, reason: "..." }.
 *
 * The rule. The LCA of the named consumers must be an ancestor of
 * (or equal to) the emitter. A Contractor at any scope can only bind
 * vocabulary whose entire span is at or above its position; binding
 * scopes outside its own domain reaches into another Ruler's
 * authority.
 *
 * Trivial cases. global scope and single-consumer scopes always
 * validate true; the caller should not invoke this function for them.
 * For zero or one consumer the result is trivially valid.
 *
 * Caller maps scope names (e.g. branch names like "frontend") to node
 * ids before calling. governing has no opinion about how scope names
 * resolve to nodes; that mapping lives in the dispatch layer.
 */
export async function validateScopeAuthority({ emitterNodeId, consumerNodeIds }) {
  if (!emitterNodeId) return { valid: false, reason: "missing emitter" };
  const consumers = Array.isArray(consumerNodeIds) ? consumerNodeIds : [];
  if (consumers.length < 2) return { valid: true };

  const lca = await findLCA(consumers);
  if (!lca) {
    return { valid: false, reason: "named consumers do not share an ancestor" };
  }
  const emitterIsAtOrBelowLca = await isAncestorOrSelf(lca, emitterNodeId);
  if (!emitterIsAtOrBelowLca) {
    return {
      valid: false,
      reason: `LCA ${String(lca).slice(0, 8)} is outside emitter ${String(emitterNodeId).slice(0, 8)}'s ancestry`,
    };
  }
  return { valid: true };
}
