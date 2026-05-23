// Trio-space primitive RETIRED 2026-05-18.
//
// In the new shape ([[project_substrate_as_universal_workspace]]) the
// Contractor being lives at the rulership space alongside Ruler, Planner,
// Foreman. There is no separate contracts-typed child space. Contracts
// become artifacts authored by the Contractor being.
//
// `ensureContractsNode` is retired. Returns the existing scope space so
// legacy callers don't crash during the rewrite. Logs once.

import Space from "../../../seed/models/space.js";
import log from "../../../seed/system/log.js";

let _warned = false;
export async function ensureContractsNode({ scopeSpaceId, place: _core } = {}) {
  if (!_warned) {
    _warned = true;
    log.warn("Governing", "ensureContractsNode is retired; Contractor being is spawned by promoteToRuler. Caller should read metadata.beings.contractor instead.");
  }
  if (!scopeSpaceId) return null;
  return Space.findById(scopeSpaceId).lean();
}
