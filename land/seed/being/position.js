// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Per-being position cache.
//
// `Being.currentPositionId` is the source of truth for where a being
// is. This module is the in-memory cache mirroring that field, so the
// runChat tool loop and websocket dispatch don't hit Mongo on every
// position read (dozens per turn).
//
// Two values per being:
//
//   - currentNodeId  the specific node the being is attending to.
//                    Persisted to Being.currentPositionId on every
//                    set (write-through, fire-and-forget).
//
//   - rootId         the tree-root the being is currently inside.
//                    DERIVED — computed from currentNodeId's ancestor
//                    chain on every `setCurrentNodeId` and cached for
//                    fast sync reads. Never set independently; rootId
//                    is a function of currentNodeId.
//
// One source of truth (currentNodeId / Being.currentPositionId).
// rootId cannot drift from it. Cross-tree moves don't need a special
// reset path — they just call setCurrentNodeId with the new node and
// the derivation updates both fields together.

import Being from "./models/being.js";
import log from "./core/log.js";
import { getAncestorChain } from "./tree/ancestorCache.js";
import { getLandRootId } from "./landRoot.js";

const beingPositions = new Map();
const MAX_BEING_POSITIONS = 50000;

function getBeingPositionRecord(beingId) {
  if (!beingId) return null;
  const key = String(beingId);
  if (!beingPositions.has(key)) {
    if (beingPositions.size >= MAX_BEING_POSITIONS) {
      let oldestKey = null, oldestTime = Infinity;
      for (const [id, s] of beingPositions) {
        if ((s._lastActive || 0) < oldestTime) { oldestTime = s._lastActive || 0; oldestKey = id; }
      }
      if (oldestKey) beingPositions.delete(oldestKey);
    }
    beingPositions.set(key, {
      currentNodeId: null,
      rootId:        null,
      _lastActive:   Date.now(),
    });
  }
  const p = beingPositions.get(key);
  p._lastActive = Date.now();
  return p;
}

// Fire-and-forget DB write to Being.currentPositionId. Cache is the
// hot path; DB persistence is best-effort for restart durability.
function persistBeingPosition(beingId, nodeId) {
  if (!beingId) return;
  Being.findByIdAndUpdate(
    String(beingId),
    { $set: { currentPositionId: nodeId || null } },
  ).catch((err) => {
    log.debug("Position", `persistBeingPosition(${String(beingId).slice(0, 8)}) failed: ${err.message}`);
  });
}

/**
 * Derive the tree-root from a node's ancestor chain.
 *
 * The tree-root is the topmost ancestor whose parent is the land root
 * (i.e., the node that sits directly under "/"). When the node has no
 * such ancestor (it sits at the land root itself, or the chain stops
 * at a system boundary), the topmost non-system entry of the chain is
 * treated as the tree-root.
 */
async function deriveRootId(nodeId) {
  if (!nodeId) return null;
  const chain = await getAncestorChain(String(nodeId));
  if (!chain || chain.length === 0) return null;
  const landRootId = getLandRootId();
  if (landRootId) {
    for (const node of chain) {
      if (node?.parent && String(node.parent) === String(landRootId)) {
        return String(node._id);
      }
    }
  }
  const last = chain[chain.length - 1];
  return last?._id ? String(last._id) : null;
}

/**
 * Set the being's current position. Async because deriving rootId
 * walks the ancestor chain. The DB write to Being.currentPositionId
 * remains fire-and-forget for hot-path latency; the ancestor walk is
 * served by the in-memory ancestor cache on the warm path.
 */
export async function setCurrentNodeId(beingId, nodeId) {
  if (!beingId) return;
  const p = getBeingPositionRecord(beingId);
  p.currentNodeId = nodeId || null;
  p.rootId = await deriveRootId(nodeId);
  persistBeingPosition(beingId, nodeId);
}

export function getCurrentNodeId(beingId) {
  if (!beingId) return null;
  const p = getBeingPositionRecord(beingId);
  return p.currentNodeId || p.rootId || null;
}

export function getRootId(beingId) {
  if (!beingId) return null;
  return getBeingPositionRecord(beingId).rootId;
}
