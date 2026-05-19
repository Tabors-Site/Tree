// Trio-node primitive RETIRED 2026-05-18.
//
// In the new shape ([[project_substrate_as_universal_workspace]]) the
// Contractor being lives at the rulership node alongside Ruler, Planner,
// Foreman. There is no separate contracts-typed child node. Contracts
// become artifacts authored by the Contractor being.
//
// `ensureContractsNode` is retired. Returns the existing scope node so
// legacy callers don't crash during the rewrite. Logs once.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

let _warned = false;
export async function ensureContractsNode({ scopeNodeId, core: _core } = {}) {
  if (!_warned) {
    _warned = true;
    log.warn("Governing", "ensureContractsNode is retired; Contractor being is spawned by promoteToRuler. Caller should read metadata.beings.contractor instead.");
  }
  if (!scopeNodeId) return null;
  return Node.findById(scopeNodeId).lean();
}
