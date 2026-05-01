// Governing role lifecycle.
//
// promoteToRuler is the single function that records a node taking on
// ruler authority for a domain. Called at every depth uniformly:
//
//   1. Root node, on user request arrival. The orchestrator promotes the
//      root before dispatching a Planner.
//   2. Branch node, on sub-Ruler dispatch. When swarm parses [[BRANCHES]]
//      and creates a child node for each, that child is promoted before
//      its own Planner runs. The branch IS a sub-Ruler, not a Worker
//      pretending to coordinate.
//   3. Worker mid-build, on scope undershoot. When a Worker emits
//      [[BRANCHES]] (recognizing the work is compound), the Worker's own
//      node promotes retroactively and its sub-branches dispatch under
//      the new Ruler.
//
// The metadata write is idempotent. A second promote on a node already
// marked as ruler returns the existing record without changing
// acceptedAt; this matters for resume paths where the orchestrator
// cannot tell whether a node has been promoted before.
//
// metadata.governing has shape:
//   {
//     role: "ruler",
//     acceptedAt: ISO timestamp,
//     reason: short string describing why,
//     promotedFrom: "root" | "branch-dispatch" | "worker-undershoot",
//   }
//
// Future court hearings (Pass 2) read acceptedAt and promotedFrom to
// reconstruct the ruler chain. Pass 1 does not consume them; the data
// shape is forward-compatible.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

export const NS = "governing";

export const PROMOTED_FROM = {
  ROOT: "root",
  BRANCH_DISPATCH: "branch-dispatch",
  WORKER_UNDERSHOOT: "worker-undershoot",
};

/**
 * Promote a node to Ruler. Idempotent. Returns the governing metadata
 * record after the write (or the existing one if already promoted).
 */
export async function promoteToRuler({ nodeId, reason, promotedFrom, core }) {
  if (!nodeId) return null;
  if (!Object.values(PROMOTED_FROM).includes(promotedFrom)) {
    promotedFrom = PROMOTED_FROM.ROOT;
  }

  const node = await Node.findById(nodeId);
  if (!node) return null;

  const existing = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];

  if (existing?.role === "ruler" && existing?.acceptedAt) {
    // Already promoted. Idempotent return.
    return existing;
  }

  const data = {
    role: "ruler",
    acceptedAt: new Date().toISOString(),
    reason: typeof reason === "string" ? reason.slice(0, 200) : null,
    promotedFrom,
  };

  // Write through the kernel's atomic metadata API. core.metadata is
  // the scoped wrapper passed to init(core); if the caller didn't pass
  // core, fall back to a direct kernel call.
  if (core?.metadata?.setExtMeta) {
    await core.metadata.setExtMeta(node, NS, data);
  } else {
    const { setExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
    await setExtMeta(node, NS, data);
  }

  // Fire the lifecycle event. Subscribers (including future Pass 2
  // courts) react here.
  try {
    const { hooks } = await import("../../../seed/hooks.js");
    hooks.run("governing:rulerPromoted", { nodeId: String(nodeId), data }).catch(() => {});
  } catch (err) {
    log.debug("Governing", `governing:rulerPromoted hook fire failed: ${err.message}`);
  }

  return data;
}

/**
 * Read the governing record for a node. Returns null if the node has
 * not been promoted.
 */
export async function readRole(nodeId) {
  if (!nodeId) return null;
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});
  return meta[NS] || null;
}

/**
 * Convenience predicate: has this node been promoted to Ruler?
 */
export async function isRuler(nodeId) {
  const record = await readRole(nodeId);
  return record?.role === "ruler";
}

/**
 * Walk upward from a node, return the nearest ancestor (or self) marked
 * as Ruler. Returns the lean Node document, or null if no Ruler found
 * before reaching the tree root.
 *
 * Used by callers that need "the Ruler governing this position" — e.g.
 * swarm's resume detection, dispatcher's scope resolution. Bounded
 * 64-depth walk; visited-set guard against cycles.
 */
export async function findRulerScope(nodeId) {
  if (!nodeId) return null;
  const Node = (await import("../../../seed/models/node.js")).default;
  const visited = new Set();
  let cursor = String(nodeId);
  for (let i = 0; i < 64; i++) {
    if (!cursor || visited.has(cursor)) break;
    visited.add(cursor);
    const n = await Node.findById(cursor).select("_id name parent metadata").lean();
    if (!n) return null;
    const meta = n.metadata instanceof Map
      ? Object.fromEntries(n.metadata)
      : (n.metadata || {});
    if (meta[NS]?.role === "ruler") return n;
    if (!n.parent) return null;
    cursor = String(n.parent);
  }
  return null;
}
