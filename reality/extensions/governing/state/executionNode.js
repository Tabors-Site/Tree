// Trio-space primitive RETIRED 2026-05-18.
//
// In the new shape ([[project_substrate_as_universal_workspace]]) the
// Foreman being lives at the rulership space alongside Ruler, Planner,
// Contractor. There is no separate execution-typed child space.
// Execution records become artifacts authored by the Foreman being.
//
// `ensureExecutionNode` is retired. Returns the existing scope space so
// legacy callers don't crash during the rewrite. Logs once.
// `findExecutionNode` is also retired (returns the rulership space).

import Space from "../../../seed/models/space.js";
import log from "../../../seed/system/log.js";

let _warned = false;
export async function ensureExecutionNode({ scopeSpaceId, place: _core } = {}) {
  if (!_warned) {
    _warned = true;
    log.warn("Governing", "ensureExecutionNode is retired; Foreman being is spawned by promoteToRuler. Caller should read metadata.beings.foreman instead.");
  }
  if (!scopeSpaceId) return null;
  return Space.findById(scopeSpaceId).lean();
}

export async function findExecutionNode(scopeSpaceId) {
  // Legacy callers used to walk to the execution-typed child. New shape:
  // the Foreman is at the rulership space; return that space.
  if (!scopeSpaceId) return null;
  return Space.findById(scopeSpaceId).lean();
}
