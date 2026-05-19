// Trio-node primitive RETIRED 2026-05-18.
//
// In the new shape ([[project_substrate_as_universal_workspace]]) the
// Foreman being lives at the rulership node alongside Ruler, Planner,
// Contractor. There is no separate execution-typed child node.
// Execution records become artifacts authored by the Foreman being.
//
// `ensureExecutionNode` is retired. Returns the existing scope node so
// legacy callers don't crash during the rewrite. Logs once.
// `findExecutionNode` is also retired (returns the rulership node).

import Node from "../../../seed/models/node.js";
import log from "../../../seed/core/log.js";

let _warned = false;
export async function ensureExecutionNode({ scopeNodeId, core: _core } = {}) {
  if (!_warned) {
    _warned = true;
    log.warn("Governing", "ensureExecutionNode is retired; Foreman being is spawned by promoteToRuler. Caller should read metadata.beings.foreman instead.");
  }
  if (!scopeNodeId) return null;
  return Node.findById(scopeNodeId).lean();
}

export async function findExecutionNode(scopeNodeId) {
  // Legacy callers used to walk to the execution-typed child. New shape:
  // the Foreman is at the rulership node; return that node.
  if (!scopeNodeId) return null;
  return Node.findById(scopeNodeId).lean();
}
