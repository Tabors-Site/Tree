// TreeOS Extension: flow
// Scoped cascade flow queries. Land, tree, or node level.

import Node from "../../seed/models/node.js";
import { SYSTEM_ROLE } from "../../seed/protocol.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";
import { getAllCascadeResults } from "../../seed/tree/cascade.js";

/**
 * Load all .flow partition nodes, sorted newest first.
 */
async function getFlowPartitions() {
  const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id").lean();
  if (!flowNode) return [];
  return Node.find({ parent: flowNode._id })
    .select("name metadata")
    .sort({ name: -1 })
    .lean();
}

/**
 * Filter cascade results to only include entries where source is in the given set.
 * Returns { [signalId]: resultEntry[] } sorted newest first, capped at limit.
 */
function filterResultsBySource(partitions, sourceIds, limit) {
  const sourceSet = new Set(sourceIds.map(String));
  const filtered = {};
  let count = 0;

  for (const partition of partitions) {
    if (count >= limit) break;
    const results = partition.metadata instanceof Map
      ? partition.metadata.get("results") || {}
      : partition.metadata?.results || {};

    const entries = Object.entries(results).sort((a, b) => {
      const aTime = a[1][a[1].length - 1]?.timestamp || 0;
      const bTime = b[1][b[1].length - 1]?.timestamp || 0;
      return new Date(bTime) - new Date(aTime);
    });

    for (const [signalId, signalResults] of entries) {
      if (count >= limit) break;
      const matching = signalResults.filter(r => sourceSet.has(String(r.source)));
      if (matching.length > 0) {
        filtered[signalId] = matching;
        count++;
      }
    }
  }

  return filtered;
}

/**
 * Get cascade flow results scoped to the caller's position.
 *
 * - Land root node: all flow results (land level view)
 * - Tree root node (rootOwner set): results for every node in that tree
 * - Regular node: results where that node is the source
 *
 * @param {string} nodeId
 * @param {number} limit  max signal groups to return
 * @returns {{ scope: "land"|"tree"|"node", nodeId: string, results: object }}
 */
export async function getFlowForPosition(nodeId, limit = 50) {
  const node = await Node.findById(nodeId).select("systemRole rootOwner name").lean();
  if (!node) return { scope: "node", nodeId, results: {} };

  // Land root: return everything
  if (node.systemRole === SYSTEM_ROLE.LAND_ROOT) {
    const results = await getAllCascadeResults(limit);
    return { scope: "land", nodeId, results };
  }

  const partitions = await getFlowPartitions();
  if (partitions.length === 0) {
    return { scope: node.rootOwner ? "tree" : "node", nodeId, results: {} };
  }

  // Tree root: collect all descendant IDs and filter
  if (node.rootOwner) {
    const descendantIds = await getDescendantIds(nodeId);
    const results = filterResultsBySource(partitions, descendantIds, limit);
    return { scope: "tree", nodeId, results };
  }

  // Regular node: filter by this single node
  const results = filterResultsBySource(partitions, [nodeId], limit);
  return { scope: "node", nodeId, results };
}
