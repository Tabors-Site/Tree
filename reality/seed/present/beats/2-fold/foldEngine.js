// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The fold engine. Generic over material type.
//
// `fold(type, id)` is the one entry point for catching a single
// aggregate's projection up to its reel. `rebuild(type, id)` is the
// cold path that replays from genesis (used when the projection cache
// is missing or known-corrupt).
//
// Per FOLD.md, this file contains zero material-specific names. It
// dispatches by type only through `reducers.get(type)`. Adding a new
// material means adding a reducer and a registry line; this engine
// never changes.
//
// The fold reads facts whose seq > foldedSeq from the reel-collection
// view of facts (target.kind + target.id), applies them in order, and
// advances the projection's `foldedSeq` marker via compare-and-set.
// CAS prevents marker regression under concurrent folds: reducers are
// pure, so concurrent computes agree on state; the guard only catches
// the case where two threads race the marker forward and the loser
// shouldn't roll it back.

import Fact from "../../../past/fact/fact.js";
import * as reducers from "../../../materials/reducers.js";
import { getProjection, applyProjection, initProjection } from "../../../materials/projections.js";

const REEL_TYPES = new Set(["being", "space", "matter"]);

// Cross-cutting projection handlers. Per-aggregate reducers build
// the aggregate's own state from its own reel; cross-cutting handlers
// build views that span reels (the position index, the inbox
// projection, future cross-reel indexes). Each handler is async and
// receives (fact, aggregateType, aggregateId) for the fact just
// applied. Handlers MUST be idempotent — the same fact may be
// dispatched again on rebuild or via a re-fold catch-up.
//
// Registration is module-load wiring: feature modules import this
// engine and call registerCrossCuttingHandler(fn). The engine knows
// nothing about what handlers do.
const _crossCuttingHandlers = [];
export function registerCrossCuttingHandler(handler) {
  if (typeof handler !== "function") {
    throw new Error("registerCrossCuttingHandler: handler must be a function");
  }
  _crossCuttingHandlers.push(handler);
}

async function dispatchCrossCutting(fact, type, id) {
  for (const handler of _crossCuttingHandlers) {
    try {
      await handler(fact, type, id);
    } catch (err) {
      // Cross-cutting projection failures are non-fatal: the source-of-
      // truth is the fact-chain, and the projection self-heals on the
      // next fold pass that touches the same fact (or on full rebuild).
      // Log and continue so a single bad handler can't strand a fold.
      // eslint-disable-next-line no-console
      console.warn(
        `cross-cutting handler failed on ${type}:${id} fact seq=${fact?.seq}: ${err?.message}`,
      );
    }
  }
}

function assertType(type) {
  if (!REEL_TYPES.has(type)) {
    throw new Error(`fold: type must be one of being/space/matter, got "${type}"`);
  }
}

/**
 * Read facts on an aggregate's reel after a given marker, sorted by
 * seq ascending. Only facts with a numeric seq are returned (non-reel
 * facts have seq:null and don't participate in the fold).
 *
 * @param {string} type
 * @param {string} id
 * @param {number|null} afterSeq  exclusive lower bound (null = from beginning)
 * @returns {Promise<Array<object>>}
 */
async function readReelAfter(type, id, afterSeq) {
  const query = {
    "target.kind": type,
    "target.id":   id,
    seq:           { $type: "number" },
  };
  if (typeof afterSeq === "number") {
    query.seq = { $type: "number", $gt: afterSeq };
  }
  return await Fact.find(query).sort({ seq: 1 }).lean();
}

/**
 * Fold an aggregate forward. Reads from the projection cache's
 * `foldedSeq` marker, queries facts after it, applies them through
 * the reducer, and advances the marker via compare-and-set.
 *
 * Returns { state, foldedSeq }: the reduced state plus the seq the
 * fold ran to (the latest fact applied, or the cache's foldedSeq when
 * the hot path skipped). Callers that only care about state can
 * destructure; callers that need the stale-detection key (moment-
 * open's foldedSeqs map) read foldedSeq.
 *
 * Concurrency: safe for many concurrent callers on the same (type,
 * id). Reducers are pure → concurrent computes agree on state. The
 * CAS guard prevents marker regression (thread A racing thread B to
 * write {foldedSeq:13} after B already wrote {foldedSeq:14}).
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @returns {Promise<{ state: object, foldedSeq: number }>}
 */
export async function fold(type, id) {
  assertType(type);
  if (!id) throw new Error("fold: id is required");

  const proj = await getProjection(type, id);
  if (!proj) {
    // No projection row exists — the aggregate's row is missing.
    // Rebuild from the reel head (no row to seed from).
    return await rebuild(type, id);
  }

  const tail = await readReelAfter(type, id, proj.foldedSeq);
  if (tail.length === 0) {
    // Hot path: nothing new since last fold. Cache read, no write.
    return { state: projectionState(proj), foldedSeq: proj.foldedSeq ?? 0 };
  }

  const reducer = reducers.get(type);
  // Start from the cached state. The projection row is sparse — only
  // fields the reducer chose to write live in `state`. Reducers should
  // be defensive about missing fields (treat undefined as initial).
  let state = projectionState(proj);
  for (const f of tail) {
    state = reducer.reduce(state, f);
    await dispatchCrossCutting(f, type, id);
  }
  const newFoldedSeq = tail[tail.length - 1].seq;
  const position = state.position !== undefined ? state.position : undefined;

  // CAS: only advance if no one beat us. On failure, the projection
  // is self-healing — the next fold catches up.
  await applyProjection(
    type,
    id,
    { state, foldedSeq: newFoldedSeq, position },
    proj.foldedSeq,
  );

  return { state, foldedSeq: newFoldedSeq };
}

/**
 * Rebuild from genesis. Cold path. Used when the projection cache is
 * absent or known-corrupt. Walks the full reel, reduces from
 * `initial()`, writes the result. No CAS — the row is being built up
 * for the first time (or recovered).
 *
 * Snapshots ({state, seq} every N facts) would bound rebuild cost on
 * very long reels; FOLD.md declares this as a "scale knob added later."
 * For now, rebuild walks the whole reel.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @returns {Promise<{ state: object, foldedSeq: number }>}
 */
export async function rebuild(type, id) {
  assertType(type);
  if (!id) throw new Error("rebuild: id is required");

  const reducer = reducers.get(type);
  const facts = await readReelAfter(type, id, null);
  let state = reducer.initial();
  for (const f of facts) {
    state = reducer.reduce(state, f);
    await dispatchCrossCutting(f, type, id);
  }
  const lastSeq = facts.length > 0 ? facts[facts.length - 1].seq : 0;

  // Phantom guard. Every aggregate's reel doctrinally begins with a
  // create-fact (be:register for beings, do:create-space / do:birth
  // for spaces and matter). If the reducer walked every fact on
  // this reel and produced an empty state, no creating fact was
  // found — the reel is malformed (most often: a be:release or
  // similar non-create fact landed against an unknown id, sometimes
  // via wire-layer arrival/session quirks). initProjection's
  // `$setOnInsert: { _id }` would materialize a row with no name
  // and no parentBeingId; that row pollutes lookups
  // (findRootOperator used to trip on it). Refusing to materialize
  // empty state cleanly drops these orphan reels — the next fold
  // round still self-heals if a create-fact later appears, because
  // the row simply doesn't exist yet.
  if (Object.keys(state).length === 0) {
    return { state, foldedSeq: lastSeq };
  }

  const position = state.position !== undefined ? state.position : undefined;

  // Upsert. The row may be new (first-ever fold for this aggregate)
  // or being restored over an existing row. initProjection handles
  // both atomically. The reducer's output is authoritative.
  await initProjection(type, id, { state, foldedSeq: lastSeq, position });

  return { state, foldedSeq: lastSeq };
}

/**
 * Extract the reducer-state slice from a projection row. Today the
 * projection row IS the cache, so "state" is whatever fields the
 * reducer cares about. Reducers stay defensive — they read what they
 * wrote, ignore what they didn't.
 *
 * Future: if the projection row's reducer-derived state grows into a
 * dedicated nested field (`projectionState: {...}`), this is the one
 * place to unwrap it.
 */
function projectionState(proj) {
  if (!proj) return {};
  // Today: pass through. Reducers write top-level fields; their state
  // is the row. position is included so reducers see it on the next
  // round.
  return proj;
}
