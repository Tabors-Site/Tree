// Low-level metadata helpers for the swarm namespace.
//
// All swarm state lives under metadata.swarm on the owning node. Domain
// extensions (code-workspace, research-workspace, etc.) write to their
// own namespaces for domain-specific concerns (filesystem paths,
// validators, plan drift). Swarm never touches those namespaces and they
// never touch swarm.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

export const NS = "swarm";

export function readMeta(node) {
  if (!node?.metadata) return null;
  if (node.metadata instanceof Map) return node.metadata.get(NS) || null;
  return node.metadata[NS] || null;
}

/**
 * Read current swarm metadata on a node, apply a mutator to a draft,
 * write back via setExtMeta (if core is available) or direct $set. The
 * mutator can return the draft or mutate in place.
 */
export async function mutateMeta(nodeId, mutator, core) {
  if (!nodeId || typeof mutator !== "function") return null;
  try {
    const node = await Node.findById(nodeId);
    if (!node) return null;
    const current = readMeta(node) || {};
    const draft = { ...current };
    const out = mutator(draft) || draft;
    if (core?.metadata?.setExtMeta) {
      await core.metadata.setExtMeta(node, NS, out);
    } else {
      await Node.updateOne(
        { _id: node._id },
        { $set: { [`metadata.${NS}`]: out } },
      );
    }
    return out;
  } catch (err) {
    log.warn("Swarm", `mutateMeta ${nodeId} failed: ${err.message}`);
    return null;
  }
}
