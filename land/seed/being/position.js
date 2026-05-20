// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Per-being position cache.
//
// `Being.currentSpace` is the source of truth for where a being is.
// This module is the in-memory cache mirroring that field so the
// runChat tool loop and websocket dispatch don't hit Mongo on every
// position read (dozens per turn).
//
// Two values per being:
//
//   - currentSpace   the specific Space the being is attending to.
//                    Persisted to Being.currentSpace on every set
//                    (write-through, fire-and-forget).
//
//   - rootId         the tree-root the being is currently inside.
//                    DERIVED — computed from currentSpace's ancestor
//                    chain on every `setCurrentSpace` and cached for
//                    fast sync reads. Never set independently; rootId
//                    is a function of currentSpace.
//
// One source of truth (currentSpace / Being.currentSpace). rootId
// cannot drift from it. Cross-tree moves don't need a special reset
// path — they just call setCurrentSpace with the new Space and the
// derivation updates both fields together.

import Being from "../models/being.js";
import log from "../system/log.js";
import { getAncestorChain } from "../space/ancestorCache.js";
import { getLandRootId } from "../landRoot.js";

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
      currentSpace: null,
      rootId:       null,
      _lastActive:  Date.now(),
    });
  }
  const p = beingPositions.get(key);
  p._lastActive = Date.now();
  return p;
}

// Fire-and-forget DB write to Being.currentSpace. Cache is the
// hot path; DB persistence is best-effort for restart durability.
function persistBeingPosition(beingId, spaceId) {
  if (!beingId) return;
  Being.findByIdAndUpdate(
    String(beingId),
    { $set: { currentSpace: spaceId || null } },
  ).catch((err) => {
    log.debug("Position", `persistBeingPosition(${String(beingId).slice(0, 8)}) failed: ${err.message}`);
  });
}

/**
 * Derive the tree-root from a Space's ancestor chain.
 *
 * The tree-root is the topmost ancestor whose parent is the land root
 * (i.e., the Space that sits directly under "/"). When the Space has
 * no such ancestor (it sits at the land root itself, or the chain
 * stops at a system boundary), the topmost non-system entry of the
 * chain is treated as the tree-root.
 */
async function deriveRootId(spaceId) {
  if (!spaceId) return null;
  const chain = await getAncestorChain(String(spaceId));
  if (!chain || chain.length === 0) return null;
  const landRootId = getLandRootId();
  if (landRootId) {
    for (const space of chain) {
      if (space?.parent && String(space.parent) === String(landRootId)) {
        return String(space._id);
      }
    }
  }
  const last = chain[chain.length - 1];
  return last?._id ? String(last._id) : null;
}

/**
 * Set the being's current position. Async because deriving rootId
 * walks the ancestor chain. The DB write to Being.currentSpace
 * remains fire-and-forget for hot-path latency; the ancestor walk is
 * served by the in-memory ancestor cache on the warm path.
 */
export async function setCurrentSpace(beingId, spaceId) {
  if (!beingId) return;
  const p = getBeingPositionRecord(beingId);
  p.currentSpace = spaceId || null;
  p.rootId = await deriveRootId(spaceId);
  persistBeingPosition(beingId, spaceId);
}

export function getCurrentSpace(beingId) {
  if (!beingId) return null;
  const p = getBeingPositionRecord(beingId);
  return p.currentSpace || p.rootId || null;
}

export function getRootId(beingId) {
  if (!beingId) return null;
  return getBeingPositionRecord(beingId).rootId;
}
