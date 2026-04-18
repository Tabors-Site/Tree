// Shared contracts: invariants every branch must respect. What "contract"
// means is domain-dependent — code projects use message shapes, research
// projects use terminology, books use character/timeline/voice. Swarm
// stores them as opaque objects.
//
// Stored on the project root. Branches read via enrichContext (the domain
// extension renders the shape into its facets).

import Node from "../../../seed/models/node.js";
import { mutateMeta, readMeta } from "./meta.js";

/**
 * Write contracts onto a project node. Overwrites any prior set.
 */
export async function setContracts({ projectNodeId, contracts, core }) {
  if (!projectNodeId) return;
  return mutateMeta(projectNodeId, (draft) => {
    draft.contracts = Array.isArray(contracts) ? contracts : [];
    draft.contractsAt = new Date().toISOString();
    return draft;
  }, core);
}

/**
 * Read the contracts stored on a project node (or walk upward to find
 * the nearest project if given a non-project node). Returns null when
 * no contracts were declared.
 */
export async function readContracts(nodeId) {
  if (!nodeId) return null;
  let cursor = String(nodeId);
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id parent metadata").lean();
    if (!n) return null;
    const meta = readMeta(n);
    if (meta?.role === "project") {
      return Array.isArray(meta.contracts) && meta.contracts.length > 0
        ? meta.contracts
        : null;
    }
    if (!n.parent) return null;
    cursor = String(n.parent);
    guard++;
  }
  return null;
}
