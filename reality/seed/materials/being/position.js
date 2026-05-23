// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Where a being is standing. The per-being position cache.
//
// A being IS at a position. `Being.currentSpace` is the source of
// truth; this module mirrors it in memory so the runTurn tool loop
// and websocket dispatch don't hit Mongo on every position read
// (dozens per turn).
//
// Two values per being:
//
//   currentSpace   the specific Space the being is attending to.
//                  Persisted to Being.currentSpace on every set
//                  (write-through, fire-and-forget).
//
//   rootId         the tree-root the being is currently inside.
//                  Derived — computed from currentSpace's ancestor
//                  chain on every setCurrentSpace and cached for
//                  fast sync reads. Never set independently;
//                  rootId is a function of currentSpace.
//
// One source of truth (currentSpace). rootId cannot drift from it.
// Cross-tree moves need no special reset path; they just call
// setCurrentSpace with the new Space and the derivation updates
// both fields together.

import Being from "./being.js";
import log from "../../seedReality/log.js";
import { getAncestorChain } from "../space/ancestorCache.js";
import { getSpaceRootId } from "../../sprout.js";
import { logFact } from "../../past/fact/facts.js";

const beingPositions = new Map();
const MAX_BEING_POSITIONS = 50000;

function getBeingPositionRecord(beingId) {
  if (!beingId) return null;
  const key = String(beingId);
  if (!beingPositions.has(key)) {
    if (beingPositions.size >= MAX_BEING_POSITIONS) {
      let oldestKey = null,
        oldestTime = Infinity;
      for (const [id, s] of beingPositions) {
        if ((s._lastActive || 0) < oldestTime) {
          oldestTime = s._lastActive || 0;
          oldestKey = id;
        }
      }
      if (oldestKey) beingPositions.delete(oldestKey);
    }
    beingPositions.set(key, {
      currentSpace: null,
      rootId: null,
      _lastActive: Date.now(),
    });
  }
  const p = beingPositions.get(key);
  p._lastActive = Date.now();
  return p;
}

// Fire-and-forget fact emit for being position change. The cache is
// the hot path; DB persistence happens through the fact-driven flow:
// logFact appends a be:switch Fact on the being's reel under the
// append lock, eager-fold runs the being reducer (which derives
// currentSpace + position from params.toPosition), and applyProjection
// writes the row.
//
// Per STAMPER.md doctrine: the fact insert is the commit; the
// projection (the Being row) is its self-healing cache. Direct
// Being.findByIdAndUpdate would bypass the fold and corrupt the
// event-sourced model.
//
// `beingId` doubles as actor and target — the being is acting on
// itself (BE.switch is identity acting on identity).
function persistBeingPosition(beingId, spaceId) {
  if (!beingId) return;
  logFact({
    verb:    "be",
    action:  "switch",
    beingId: String(beingId),
    target:  { kind: "being", id: String(beingId) },
    params:  { toPosition: spaceId || null },
  }).catch((err) => {
    log.debug(
      "Position",
      `persistBeingPosition(${String(beingId).slice(0, 8)}) failed: ${err.message}`,
    );
  });
}

/**
 * Derive the space-root from a Space's ancestor chain.
 *
 * The space-root is the topmost ancestor whose parent is the place root
 * (i.e., the Space that sits directly under "/"). When the Space has
 * no such ancestor (it sits at the place root itself, or the chain
 * stops at a system boundary), the topmost non-system entry of the
 * chain is treated as the space-root.
 */
async function deriveSpaceRootId(spaceId) {
  if (!spaceId) return null;
  const chain = await getAncestorChain(String(spaceId));
  if (!chain || chain.length === 0) return null;
  const spaceRootId = getSpaceRootId();
  if (spaceRootId) {
    for (const space of chain) {
      if (space?.parent && String(space.parent) === String(spaceRootId)) {
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
  p.rootId = await deriveSpaceRootId(spaceId);
  persistBeingPosition(beingId, spaceId);
}

export function getCurrentSpace(beingId) {
  if (!beingId) return null;
  const p = getBeingPositionRecord(beingId);
  return p.currentSpace || p.rootId || null;
}

export function getRootIdFor(beingId) {
  if (!beingId) return null;
  return getBeingPositionRecord(beingId).rootId;
}
