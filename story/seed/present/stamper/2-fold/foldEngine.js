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
// view of facts (of.kind + of.id), applies them in order, and
// advances the projection's `foldedSeq` marker via compare-and-set.
// CAS prevents marker regression under concurrent folds: reducers are
// pure, so concurrent computes agree on state; the guard only catches
// the case where two threads race the marker forward and the loser
// shouldn't roll it back.

import * as reducers from "../../../materials/reducers.js";
import { loadProjection, saveProjection, initProjection, tombstoneProjection } from "../../../materials/projections.js";
import {
  resolveHistoryLineage,
  getBranchPoint,
  isMain,
  MAIN,
} from "../../../materials/history/histories.js";
import { readReelLineage } from "../../../past/fileStore.js";
import log from "../../../seedStory/log.js";

const REEL_TYPES = new Set(["being", "space", "matter", "name", "library"]);

// Name-collision self-heal. The per-history unique index on
// (history, type, state.name) is a backstop on a CACHE — when two live
// reels of one type collide on name (the pre-stamp check is per-op,
// no cross-reel lock), the facts have already committed and the chain
// is the truth. Refusing to materialize the second slot would poison
// that reel forever (every fold re-throws E11000; the aggregate never
// resolves). Instead: materialize under a deconflicted name carrying
// a visible conflict marker. Deterministic across re-folds while the
// winner holds the name; if the winner is later tombstoned, a rebuild
// re-claims the original name — the cache heals toward the chain.
function isDupKeyError(err) {
  return err?.code === 11000 || err?.cause?.code === 11000;
}
// E11000 carries the offending index in its message. Only the NAME
// index warrants deconfliction; a dup on _id is the store's known
// concurrent-upsert race on the same slot (benign — the slot exists
// now, a plain retry matches it).
function isNameDupError(err) {
  return isDupKeyError(err) && /state\.name/.test(String(err?.message || err?.cause?.message || ""));
}
function deconflictName(state, id) {
  const base = typeof state.name === "string" ? state.name : "unnamed";
  return {
    ...state,
    name: `${base}~conflict-${String(id).slice(0, 8)}`,
    nameConflict: { name: base },
  };
}

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
 * Read facts on an aggregate's reel within a seq range, sorted by seq
 * ascending. Only facts with a numeric seq are returned (non-reel
 * facts carry seq:null and don't participate in the fold).
 *
 * Both bounds optional. Their semantics differ deliberately:
 *   - afterSeq is EXCLUSIVE — match the live-fold "advance past my
 *     marker" semantic: `proj.foldedSeq` is the seq I've already
 *     applied, so I want seqs strictly greater than it.
 *   - untilSeq is INCLUSIVE — match the historical-fold "give me
 *     the world as of seq N" semantic: a target seq is the last
 *     fact I want applied, not the first I want excluded.
 *
 * ── History semantics ────────────────────────────────────────────
 *
 * Reading a reel in history B is "main's facts up to main's branchPoint
 * for this reel, plus #X's facts up to #X's branchPoint for this reel
 * (for every X in lineage main→B), plus B's own divergent facts." For
 * history "0" (main) the body short-circuits to a single-history query
 * filtered to main's own facts (pre-Pass-2 rows without a `history`
 * field count as main).
 *
 * For non-main histories the body walks `resolveHistoryLineage(history)`
 * once, then runs a single OR-of-ranges query against the Fact
 * collection — each ancestor contributes the seqs it OWNS for this
 * reel (between its own branchPoint and the next history up's
 * branchPoint, or untilSeq for the leaf).
 *
 * @param {string} type
 * @param {string} id
 * @param {number|null} afterSeq         EXCLUSIVE lower bound; null = from beginning
 * @param {number|null} untilSeq         INCLUSIVE upper bound; null = to the end
 * @param {string}      [history="0"]    history identifier (default "0" = main)
 * @returns {Promise<Array<object>>}
 */
export async function readReelBetween(type, id, afterSeq, untilSeq, history) {
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      `readReelBetween: history is required (got ${JSON.stringify(history)}). ` +
      `Pass the moment's history explicitly; no silent default to main.`,
    );
  }
  // Heaven routing: spaces in heaven have one reel per story, no
  // lineage. A non-MAIN read against a heaven space rewrites to
  // MAIN so the reel walk hits the canonical story-level fact
  // stream regardless of caller's history.
  if (type === "space" && history !== "0") {
    const { isHeavenSpace } = await import("../../../materials/space/heavenLineage.js");
    if (await isHeavenSpace(id)) history = "0";
  }

  // The lineage range-union is a fileStore reel read: the
  // fold/rebuild reducer logic reads from the append-only reel files,
  // and the file `_id` = computeHash(p, contentOf) is the store's
  // content-hash _id, so folds stay byte-compatible.
  //
  // resolveHistoryLineage(history) gives main → leaf (["0", "1", ...]);
  // floors[h] is h's per-reel branchPoint (the seq it forked at), and
  // fileStore.readReelLineage walks each history's owned (floor_h,
  // floor_next] range with afterSeq EXCLUSIVE / untilSeq INCLUSIVE —
  // the same range arithmetic the OR-of-ranges encoded. Main's floor
  // is 0 (it owns from seq 1). On main, lineage is ["0"] and the walk
  // collapses to the single-history own-reel read.
  const lineage = isMain(history) ? [MAIN] : await resolveHistoryLineage(history);

  // floors: history → per-reel branchPoint seq. Main floors at 0 (no
  // branchPoint — its reel starts at seq 1). Each non-main ancestor
  // floors at its own branchPoint for THIS reel.
  const floors = { [MAIN]: 0 };
  for (const h of lineage) {
    if (isMain(h)) continue;
    floors[h] = (await getBranchPoint(h, type, id)) || 0;
  }

  const a = typeof afterSeq === "number" ? afterSeq : null;
  const u = typeof untilSeq === "number" ? untilSeq : null;
  return readReelLineage(lineage, floors, type, id, a, u);
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
 * @param {object} [opts]
 * @param {boolean} [opts.skipCrossCutting=false]  suppress cross-cutting handler
 *   dispatch on every applied fact. Defaults to false — the live fold ALWAYS
 *   keeps inbox / position / threads projections in sync. The historical
 *   read path (foldAt.js) passes true: re-firing cross-cutting handlers for
 *   facts already long-applied would corrupt current-state projections.
 * @returns {Promise<{ state: object, foldedSeq: number }>}
 */
export async function fold(type, id, opts = {}) {
  assertType(type);
  if (!id) throw new Error("fold: id is required");
  const skipCrossCutting = opts.skipCrossCutting === true;
  // SEAM: opts key is `history` (the foldEngine/descriptor convention;
  // facts.js + projections.js callers pass `history`); the value is the
  // history slot.
  if (typeof opts.history !== "string" || !opts.history.length) {
    throw new Error(
      `fold: opts.history is required (got ${JSON.stringify(opts.history)}). ` +
      `Pass it from the fact's history or the wire layer; in-moment callers ` +
      `derive it from moment.actorAct.history or the target's address.`,
    );
  }
  const history = opts.history;

  const slot = await loadProjection(type, id, history);
  if (!slot) {
    // No slot in this history yet. Cold-fold via lineage-aware
    // readReelBetween (Pass 2 substrate) and land via initProjection.
    // rebuild defaults cross-cutting OFF: this walk is a replay of
    // committed history into a fresh cache slot, not fact arrival.
    return await rebuild(type, id, opts);
  }
  if (slot.tombstoned) {
    // Released in this history. No further folding; the aggregate is
    // gone here. Return the marker state so callers can render
    // "gone-in-this-history" cleanly.
    return { state: slot.state, foldedSeq: slot.foldedSeq ?? 0, tombstoned: true };
  }

  const tail = await readReelBetween(type, id, slot.foldedSeq, null, history);
  if (tail.length === 0) {
    // Hot path: nothing new since last fold. Cache read, no write.
    return { state: slot.state, foldedSeq: slot.foldedSeq ?? 0 };
  }

  const reducer = reducers.get(type);
  let state = slot.state;
  for (const f of tail) {
    state = reducer.reduce(state, f);
    if (!skipCrossCutting) await dispatchCrossCutting(f, type, id);
  }
  const newFoldedSeq = tail[tail.length - 1].seq;

  // Gone-in-this-history (reducer-owned predicate, e.g. ended matter's
  // spaceId=DELETED sentinel). Tombstone instead of saving: the slot
  // leaves the per-history unique name index (freeing the name for
  // re-creation) and findByName/listByType stop returning it. The
  // reel keeps the full history; only the cache slot is closed.
  if (typeof reducer.isGone === "function" && reducer.isGone(state)) {
    // Record the terminal state WITH the tombstone: the gone-state
    // (e.g. ended matter's spaceId=DELETED) is the chain's truth, and
    // consumers reading the slot should see it. The tombstone frees
    // the name index and drops the slot from findByName/listByType.
    await tombstoneProjection(type, id, history, newFoldedSeq, { state });
    return { state, foldedSeq: newFoldedSeq, tombstoned: true };
  }

  const position = state.position !== undefined ? state.position : undefined;

  // CAS: only advance if no one beat us. On failure, the next fold
  // catches up. Per-history slot — main and #1 don't contend.
  try {
    await saveProjection(
      type, id, history,
      { state, foldedSeq: newFoldedSeq, position },
      slot.foldedSeq,
    );
  } catch (err) {
    if (!isNameDupError(err)) throw err;
    state = deconflictName(state, id);
    log.warn(
      "Fold",
      `name collision folding ${type} ${String(id).slice(0, 8)} on #${history}; ` +
      `materialized as "${state.name}" (see state.nameConflict)`,
    );
    await saveProjection(
      type, id, history,
      { state, foldedSeq: newFoldedSeq, position },
      slot.foldedSeq,
    );
  }

  return { state, foldedSeq: newFoldedSeq };
}

/**
 * Rebuild from genesis. Cold path. Used when the projection cache is
 * absent or known-corrupt. Walks the full reel, reduces from
 * `initial()`, writes the result. No CAS — the row is being built up
 * for the first time (or recovered).
 *
 * Cross-cutting handlers default OFF here, the opposite of `fold`.
 * A rebuild is a REPLAY of long-committed facts (a branch slot
 * cold-folding its inherited lineage, a cache recovery), not fact
 * arrival — every fact in the walk already fired its handlers when
 * it committed. Re-firing them resurrects consumed state: an
 * already-answered summon re-upserts its InboxProjection row and the
 * scheduler re-executes the transport act ("Name already taken"
 * retries after a be:switch cold-folded cherub onto a new branch),
 * and the portal fact-push handler re-streams history to clients.
 * Pass skipCrossCutting:false only for a deliberate projection
 * recovery that intends to rebuild the cross-cutting projections too.
 *
 * Snapshots ({state, seq} every N facts) would bound rebuild cost on
 * very long reels; FOLD.md declares this as a "scale knob added later."
 * For now, rebuild walks the whole reel.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {object} [opts]
 * @param {boolean} [opts.skipCrossCutting=true]  see above — replay, not arrival.
 * @returns {Promise<{ state: object, foldedSeq: number }>}
 */
export async function rebuild(type, id, opts = {}) {
  assertType(type);
  if (!id) throw new Error("rebuild: id is required");
  const skipCrossCutting = opts.skipCrossCutting !== false;
  // SEAM: opts key is `history` (foldEngine/descriptor convention); value
  // is the history slot.
  if (typeof opts.history !== "string" || !opts.history.length) {
    throw new Error(
      `rebuild: opts.history is required (got ${JSON.stringify(opts.history)}). ` +
      `Pass it from the fact's history or the wire layer; in-moment callers ` +
      `derive it from moment.actorAct.history or the target's address.`,
    );
  }
  const history = opts.history;

  const reducer = reducers.get(type);
  // Pass 2 substrate: readReelBetween with a history returns the
  // lineage-aware fact chain (main's facts up to branchPoint plus
  // this history's divergent facts, in seq order). For main, returns
  // every fact on the reel. For a deeper history, walks the parent
  // chain. The reducer doesn't see the lineage; it just sees the
  // ordered facts.
  const facts = await readReelBetween(type, id, null, null, history);
  let state = reducer.initial();
  for (const f of facts) {
    state = reducer.reduce(state, f);
    if (!skipCrossCutting) await dispatchCrossCutting(f, type, id);
  }
  const lastSeq = facts.length > 0 ? facts[facts.length - 1].seq : 0;

  // Phantom guard. Every aggregate's reel doctrinally begins with a
  // create-fact (be:register for beings, do:create-space / do:birth
  // for spaces and matter). If the reducer walked every fact and
  // produced an empty state, no creating fact was found — the reel
  // is malformed (most often: a be:release or similar non-create
  // fact landed against an unknown id, sometimes via wire-layer
  // arrival/session quirks). Refusing to materialize empty state
  // cleanly drops these orphan reels — the next fold round still
  // self-heals if a create-fact later appears.
  if (Object.keys(state).length === 0) {
    return { state, foldedSeq: lastSeq };
  }

  // Gone-in-this-history — same predicate as the hot fold path. A cold
  // rebuild of a lineage ending in the gone state must land a
  // TOMBSTONED slot, not a live one: initProjection of an ended
  // matter's name would re-occupy the unique name index and E11000
  // any same-named successor.
  if (typeof reducer.isGone === "function" && reducer.isGone(state)) {
    await tombstoneProjection(type, id, history, lastSeq, { state });
    return { state, foldedSeq: lastSeq, tombstoned: true };
  }

  const position = state.position !== undefined ? state.position : undefined;
  try {
    await initProjection(type, id, history, { state, foldedSeq: lastSeq, position });
  } catch (err) {
    if (isDupKeyError(err) && !isNameDupError(err)) {
      // _id upsert race: another fold built this slot concurrently.
      // Retry as-is — the slot exists now, the update matches it.
      await initProjection(type, id, history, { state, foldedSeq: lastSeq, position });
      return { state, foldedSeq: lastSeq };
    }
    if (!isNameDupError(err)) throw err;
    state = deconflictName(state, id);
    log.warn(
      "Fold",
      `name collision rebuilding ${type} ${String(id).slice(0, 8)} on #${history}; ` +
      `materialized as "${state.name}" (see state.nameConflict)`,
    );
    await initProjection(type, id, history, { state, foldedSeq: lastSeq, position });
  }

  return { state, foldedSeq: lastSeq };
}

// projectionState helper retired 2026-06-03 — slot.state IS the
// reducer-state slice now (the Projection collection stores state in
// a dedicated `state` field rather than at the row's top level).
