// Low-level metadata helpers for the swarm namespace.
//
// All swarm state lives under metadata.swarm on the owning node. Domain
// extensions (code-workspace, research-workspace, etc.) write to their
// own namespaces for domain-specific concerns (filesystem paths,
// validators, plan drift). Swarm never touches those namespaces and they
// never touch swarm.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { setExtMeta as kernelSetExtMeta } from "../../../seed/tree/extensionMetadata.js";

export const NS = "swarm";

export function readMeta(node) {
  if (!node?.metadata) return null;
  if (node.metadata instanceof Map) return node.metadata.get(NS) || null;
  return node.metadata[NS] || null;
}

/**
 * Read current swarm metadata on a node, apply a mutator to a draft,
 * write back via setExtMeta (unscoped kernel import). The `core` arg is
 * ignored for the write: swarm state is swarm-owned no matter who
 * triggered the call, and the loader's per-extension scoping wrapper
 * would reject the write when a caller from another extension (e.g.
 * code-workspace firing afterNote) passes its own scoped core. Using
 * the kernel's unscoped setExtMeta bypasses the callerExtName check,
 * keeps the afterMetadataWrite hook, keeps the cache invalidation, and
 * remains atomic.
 */
export async function mutateMeta(nodeId, mutator, _core) {
  if (!nodeId || typeof mutator !== "function") return null;
  try {
    const node = await Node.findById(nodeId);
    if (!node) return null;
    const current = readMeta(node) || {};
    const draft = { ...current };
    const out = mutator(draft) || draft;
    await kernelSetExtMeta(node, NS, out);
    return out;
  } catch (err) {
    log.warn("Swarm", `mutateMeta ${nodeId} failed: ${err.message}`);
    return null;
  }
}
