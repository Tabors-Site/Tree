// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Where a being is standing. The per-being position cache.
//
// A being IS at a position. `Being.position` is the source of truth;
// this module mirrors it in memory so the runTurn tool loop and
// websocket dispatch don't hit the store on every position read (dozens
// per turn).
//
// Two values per being:
//
//   position   the specific Space the being is attending to.
//              Persisted to Being.position on every set (write-
//              through, fire-and-forget via the be:occupy fact).
//
//   rootId     the tree-root the being is currently inside.
//              Derived — computed from position's ancestor chain on
//              every setCurrentSpace call and cached for fast sync
//              reads. Never set independently; rootId is a function
//              of position.
//
// One source of truth (position). rootId cannot drift from it.
// Cross-tree moves need no special reset path; they just call
// setCurrentSpace with the new Space and the derivation updates both
// fields together.
//
// API note: the public functions are `setCurrentSpace` and
// `getCurrentSpace`. The names refer to the human-readable concept
// "where the being currently is" and haven't changed; only the
// underlying schema field migrated from `Being.currentSpace` to
// `Being.position` on 2026-05-29.

import log from "../../seedStory/log.js";
import { getAncestorChain } from "../space/ancestorCache.js";
import { getSpaceRootId } from "../../sprout.js";
import { emitFact } from "../../past/fact/facts.js";

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
      position: null,
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
// logFact appends a be:occupy Fact on the being's reel under the
// append lock, eager-fold runs the being reducer (which writes
// Being.position from params.toPosition), and applyProjection
// writes the row.
//
// Per STAMPER.md doctrine: the fact insert is the commit; the
// projection (the Being row) is its self-healing cache. Direct
// Being.findByIdAndUpdate would bypass the fold and corrupt the
// event-sourced model.
//
// `beingId` doubles as actor and target — the being is acting on
// itself (the being occupies a new position).
function persistBeingPosition(beingId, spaceId, moment = null) {
  if (!beingId) return;
  const spec = {
    verb: "be",
    act: "occupy",
    through: String(beingId),
    of: { kind: "being", id: String(beingId) },
    params: { toPosition: spaceId || null },
    actId: moment?.actId || null,
    history: moment?.actorAct?.history || "0",
  };
  // Inside a moment: push synchronously to ctx.deltaF (rides the
  // existing Act). The push bypasses emitFact (whose async crossOrigin
  // derivation could race the seal), so set the actor NAME here the
  // same way emitFact would — from the moment's actorAct. The being
  // occupies its OWN position, so the actor name is the being's own
  // (or, when a father drives a being he's connected to, the
  // inhabitor's name — exactly who signs the moment).
  if (moment && Array.isArray(moment.deltaF)) {
    spec.by = moment.actorAct?.by ?? null;
    moment.deltaF.push(spec);
    return;
  }
  // Outside the accumulating moment (system housekeeping): the being
  // acts as ITSELF, on its own chain, signed by its own Name — via
  // withBeingAct. (Previously wrapped in withIAmAct, which mis-attributed
  // the position change to I even though the being is the one moving.)
  // emitFact derives nameId from the being's act context. "Every fact
  // comes from an act" (MOMENT.md) — no orphan facts.
  (async () => {
    try {
      const { withBeingAct } = await import("../../sprout.js");
      await withBeingAct(
        String(beingId),
        `Position: persist @${String(beingId).slice(0, 8)}`,
        spec.history,
        async (ctx) => {
          // Re-stamp with the being's act context (spec.nameId stays
          // unset so emitFact resolves it from ctx.actorAct.by).
          await emitFact({ ...spec, actId: ctx.actId }, ctx);
        },
      );
    } catch (err) {
      log.debug(
        "Position",
        `persistBeingPosition(${String(beingId).slice(0, 8)}) failed: ${err.message}`,
      );
    }
  })();
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
async function deriveSpaceRootId(spaceId, history) {
  if (!spaceId) return null;
  const chain = await getAncestorChain(String(spaceId), history);
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
 * walks the ancestor chain. The fact emission is fire-and-forget for
 * hot-path latency (wrapped in withIAmAct when no moment); the
 * ancestor walk is served by the in-memory cache on the warm path.
 */
export async function setCurrentSpace(beingId, spaceId, moment) {
  if (!beingId) return;
  const history = moment?.actorAct?.history;
  if (typeof history !== "string" || !history) {
    throw new Error(
      "setCurrentSpace: moment.actorAct.history is required; planting a being at a position needs the actor's history to derive the right tree-root.",
    );
  }
  const p = getBeingPositionRecord(beingId);
  p.position = spaceId || null;
  p.rootId = await deriveSpaceRootId(spaceId, history);
  persistBeingPosition(beingId, spaceId, moment);
}

export function getCurrentSpace(beingId) {
  if (!beingId) return null;
  const p = getBeingPositionRecord(beingId);
  return p.position || p.rootId || null;
}

export function getRootIdFor(beingId) {
  if (!beingId) return null;
  return getBeingPositionRecord(beingId).rootId;
}
