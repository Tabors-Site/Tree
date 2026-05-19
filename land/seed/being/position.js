// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Per-being position cache.
//
// `Being.currentPositionId` is the source of truth for where a being
// is. This module is the in-memory cache mirroring that field, so the
// runChat tool loop and websocket dispatch don't hit Mongo on every
// position read (dozens per turn).
//
// Shape: beingId -> { rootId, currentNodeId, _lastActive }
//
// `rootId` and `currentNodeId` are both tracked because the
// conversation pipeline needs them for different things:
//   - rootId is "which tree the being is in" (used for tool injection,
//     mode resolution, tree-level LLM resolution).
//   - currentNodeId is "the specific node they're attending to" (used
//     for ancestor walks, perspective, context).
//
// Cross-tree switch clears currentNodeId so an old in-tree node id
// doesn't leak into the new tree's conversation.
//
// Write-through persistence: `currentNodeId` is mirrored to
// `Being.currentPositionId` so the being's position survives server
// restart and is visible to anything else that queries the Being. The
// write is fire-and-forget — the cache is the hot path; the DB write
// happens in the background.

import Being from "../models/being.js";
import log from "../core/log.js";

const beingPositions = new Map();
let MAX_BEING_POSITIONS = 50000;

export function setMaxBeingPositions(n) {
  MAX_BEING_POSITIONS = Math.max(100, Math.min(Number(n) || 50000, 500000));
}

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
      rootId: null,
      currentNodeId: null,
      _lastActive: Date.now(),
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
 * Set the tree root a being is currently inside.
 *
 * On a genuine rootId change (cross-tree switch), clears currentNodeId
 * so the next getCurrentNodeId falls back cleanly to the new rootId
 * rather than returning a stale node from the previous tree.
 */
export function setRootId(beingId, rootId) {
  if (!beingId) return;
  const p = getBeingPositionRecord(beingId);
  if (p.rootId && rootId && String(p.rootId) !== String(rootId)) {
    p.currentNodeId = null;
    persistBeingPosition(beingId, null);
  }
  p.rootId = rootId;
}

export function getRootId(beingId) {
  if (!beingId) return null;
  return getBeingPositionRecord(beingId).rootId;
}

export function setCurrentNodeId(beingId, nodeId) {
  if (!beingId) return;
  const p = getBeingPositionRecord(beingId);
  p.currentNodeId = nodeId;
  persistBeingPosition(beingId, nodeId);
}

export function getCurrentNodeId(beingId) {
  if (!beingId) return null;
  const p = getBeingPositionRecord(beingId);
  return p.currentNodeId || p.rootId || null;
}

/**
 * Lazy-load a being's persisted current position into the cache.
 * Called from the WS handshake and other entry points so the in-memory
 * accessors return the right value on first read after a server
 * restart. Idempotent — does nothing if the cache is already populated
 * for this being.
 */
export async function loadBeingPosition(beingId) {
  if (!beingId) return;
  const key = String(beingId);
  const existing = beingPositions.get(key);
  if (existing && (existing.rootId || existing.currentNodeId)) return;
  try {
    const being = await Being.findById(key).select("currentPositionId").lean();
    const pos = being?.currentPositionId || null;
    if (!pos) return;
    const record = getBeingPositionRecord(key);
    if (!record.currentNodeId) record.currentNodeId = String(pos);
    // rootId isn't persisted on Being; the next setRootId from the WS
    // handshake or tree navigation populates it.
  } catch (err) {
    log.debug("Position", `loadBeingPosition(${String(beingId).slice(0, 8)}) failed: ${err.message}`);
  }
}

/**
 * Drop a being's in-memory position state. Used when a being is
 * deliberately reset (rare). Doesn't touch the persisted
 * Being.currentPositionId — that survives until explicitly changed.
 */
export function clearBeingPosition(beingId) {
  if (!beingId) return;
  beingPositions.delete(String(beingId));
}
