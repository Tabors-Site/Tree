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

import Fact from "../../../past/fact/fact.js";
import * as reducers from "../../../materials/reducers.js";
import { loadProjection, saveProjection, initProjection, tombstoneProjection } from "../../../materials/projections.js";
import {
  resolveHistoryLineage,
  getBranchPoint,
  isMain,
  MAIN,
} from "../../../materials/history/histories.js";
import log from "../../../seedStory/log.js";

const REEL_TYPES = new Set(["being", "space", "matter", "name"]);

// Name-collision self-heal. The per-branch unique index on
// (branch, type, state.name) is a backstop on a CACHE — when two live
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
// index warrants deconfliction; a dup on _id is Mongo's known
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
 * ── Branch semantics ─────────────────────────────────────────────
 *
 * Reading a reel in branch B is "main's facts up to main's branchPoint
 * for this reel, plus #X's facts up to #X's branchPoint for this reel
 * (for every X in lineage main→B), plus B's own divergent facts." For
 * branch "0" (main) the body short-circuits to a single-branch query
 * filtered to main's own facts (pre-Pass-2 rows without a `branch`
 * field count as main).
 *
 * For non-main branches the body walks `resolveHistoryLineage(branch)`
 * once, then runs a single OR-of-ranges query against the Fact
 * collection — each ancestor contributes the seqs it OWNS for this
 * reel (between its own branchPoint and the next branch up's
 * branchPoint, or untilSeq for the leaf).
 *
 * @param {string} type
 * @param {string} id
 * @param {number|null} afterSeq         EXCLUSIVE lower bound; null = from beginning
 * @param {number|null} untilSeq         INCLUSIVE upper bound; null = to the end
 * @param {string}      [branch="0"]     branch identifier (default "0" = main)
 * @returns {Promise<Array<object>>}
 */
export async function readReelBetween(type, id, afterSeq, untilSeq, branch) {
  if (typeof branch !== "string" || !branch.length) {
    throw new Error(
      `readReelBetween: branch is required (got ${JSON.stringify(branch)}). ` +
      `Pass the moment's branch explicitly; no silent default to main.`,
    );
  }
  // Heaven routing: spaces in heaven have one reel per story, no
  // lineage. A non-MAIN read against a heaven space rewrites to
  // MAIN so the reel walk hits the canonical story-level fact
  // stream regardless of caller's branch.
  if (type === "space" && branch !== "0") {
    const { isHeavenSpace } = await import("../../../materials/space/heavenLineage.js");
    if (await isHeavenSpace(id)) branch = "0";
  }
  // Main short-circuit: one branch, no lineage walk. The branch
  // filter is REQUIRED here — branches share the seq number space
  // (each seeded from its parent's branchPoint), so without it a
  // main read swallows other branches' facts: main's state folds in
  // foreign-branch events and main's foldedSeq jumps to the global
  // max, leaving main's OWN later facts below the marker and
  // invisible to every subsequent fold (acts on main silently stop
  // materializing). Legacy pre-Pass-2 rows that lack the `branch`
  // field participate via $exists:false — the same clause the
  // lineage path below uses for its main segment.
  if (isMain(branch)) {
    const seqFilter = { $type: "number" };
    if (typeof afterSeq === "number") seqFilter.$gt  = afterSeq;
    if (typeof untilSeq === "number") seqFilter.$lte = untilSeq;
    return await Fact.find({
      "of.kind": type,
      "of.id":   id,
      seq:           seqFilter,
      $or: [{ history: MAIN }, { history: { $exists: false } }],
    }).sort({ seq: 1 }).lean();
  }

  // Non-main: walk the lineage and build a per-ancestor range query.
  // The lineage is ordered main → leaf (e.g. ["0", "1", "1a", "1a1"]).
  // For each branch X in that list, X owns the seqs from its own
  // branchPoint (or 1 for main) up to (but not including) the NEXT
  // branch's branchPoint — OR up to untilSeq if X is the leaf.
  const lineage = await resolveHistoryLineage(branch);

  // Compute each ancestor's owned [lo, hi] seq range for this reel.
  // The leaf inherits the global upper bound (untilSeq). Each non-leaf
  // X stops at the next branch's branchPoint (which is the seq at
  // which the next branch diverged from X).
  const ranges = [];
  for (let i = 0; i < lineage.length; i++) {
    const here = lineage[i];
    const next = lineage[i + 1] || null; // the branch that forked off `here`
    const lo = isMain(here) ? 0 : await getBranchPoint(here, type, id);
    // `lo` is EXCLUSIVE in the inherited semantics: facts strictly
    // after `here`'s starting point. For the LEAF (the branch we're
    // actually reading) the lower bound is afterSeq if set.
    const isLeaf = i === lineage.length - 1;
    const lower = isLeaf
      ? (typeof afterSeq === "number" ? Math.max(afterSeq, lo) : lo)
      : lo;
    const upper = isLeaf
      ? (typeof untilSeq === "number" ? untilSeq : null)
      : await getBranchPoint(next, type, id);
    if (upper != null && upper <= lower) continue; // empty range; skip
    ranges.push({ history: here, lower, upper });
  }
  if (ranges.length === 0) return [];

  // Build the OR-of-ranges query. Each clause filters by branch and
  // its seq range. For main rows that lack the `branch` field, match
  // via `$in: ["0", null, undefined]` ($exists:false) so pre-Pass-2
  // data participates in lineages that include main.
  const orClauses = ranges.map(({ history: b, lower, upper }) => {
    const seqFilter = { $type: "number", $gt: lower };
    if (upper != null) seqFilter.$lte = upper;
    const historyClause = isMain(b)
      ? { $or: [{ history: MAIN }, { history: { $exists: false } }] }
      : { history: b };
    return {
      "of.kind": type,
      "of.id":   id,
      seq:           seqFilter,
      ...historyClause,
    };
  });

  return await Fact.find({ $or: orClauses }).sort({ seq: 1 }).lean();
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
  if (typeof opts.branch !== "string" || !opts.branch.length) {
    throw new Error(
      `fold: opts.branch is required (got ${JSON.stringify(opts.branch)}). ` +
      `Pass it from the fact's branch or the wire layer; in-moment callers ` +
      `derive it from moment.actorAct.history or the target's address.`,
    );
  }
  const branch = opts.branch;

  const slot = await loadProjection(type, id, branch);
  if (!slot) {
    // No slot in this branch yet. Cold-fold via lineage-aware
    // readReelBetween (Pass 2 substrate) and land via initProjection.
    // rebuild defaults cross-cutting OFF: this walk is a replay of
    // committed history into a fresh cache slot, not fact arrival.
    return await rebuild(type, id, opts);
  }
  if (slot.tombstoned) {
    // Released in this branch. No further folding; the aggregate is
    // gone here. Return the marker state so callers can render
    // "gone-in-this-branch" cleanly.
    return { state: slot.state, foldedSeq: slot.foldedSeq ?? 0, tombstoned: true };
  }

  const tail = await readReelBetween(type, id, slot.foldedSeq, null, branch);
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

  // Gone-in-this-branch (reducer-owned predicate, e.g. ended matter's
  // spaceId=DELETED sentinel). Tombstone instead of saving: the slot
  // leaves the per-branch unique name index (freeing the name for
  // re-creation) and findByName/listByType stop returning it. The
  // reel keeps the full history; only the cache slot is closed.
  if (typeof reducer.isGone === "function" && reducer.isGone(state)) {
    // Record the terminal state WITH the tombstone: the gone-state
    // (e.g. ended matter's spaceId=DELETED) is the chain's truth, and
    // consumers reading the slot should see it. The tombstone frees
    // the name index and drops the slot from findByName/listByType.
    await tombstoneProjection(type, id, branch, newFoldedSeq, { state });
    return { state, foldedSeq: newFoldedSeq, tombstoned: true };
  }

  const position = state.position !== undefined ? state.position : undefined;

  // CAS: only advance if no one beat us. On failure, the next fold
  // catches up. Per-branch slot — main and #1 don't contend.
  try {
    await saveProjection(
      type, id, branch,
      { state, foldedSeq: newFoldedSeq, position },
      slot.foldedSeq,
    );
  } catch (err) {
    if (!isNameDupError(err)) throw err;
    state = deconflictName(state, id);
    log.warn(
      "Fold",
      `name collision folding ${type} ${String(id).slice(0, 8)} on #${branch}; ` +
      `materialized as "${state.name}" (see state.nameConflict)`,
    );
    await saveProjection(
      type, id, branch,
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
  if (typeof opts.branch !== "string" || !opts.branch.length) {
    throw new Error(
      `rebuild: opts.branch is required (got ${JSON.stringify(opts.branch)}). ` +
      `Pass it from the fact's branch or the wire layer; in-moment callers ` +
      `derive it from moment.actorAct.history or the target's address.`,
    );
  }
  const branch = opts.branch;

  const reducer = reducers.get(type);
  // Pass 2 substrate: readReelBetween with a branch returns the
  // lineage-aware fact chain (main's facts up to branchPoint plus
  // this branch's divergent facts, in seq order). For main, returns
  // every fact on the reel. For a deeper branch, walks the parent
  // chain. The reducer doesn't see the lineage; it just sees the
  // ordered facts.
  const facts = await readReelBetween(type, id, null, null, branch);
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

  // Gone-in-this-branch — same predicate as the hot fold path. A cold
  // rebuild of a lineage ending in the gone state must land a
  // TOMBSTONED slot, not a live one: initProjection of an ended
  // matter's name would re-occupy the unique name index and E11000
  // any same-named successor.
  if (typeof reducer.isGone === "function" && reducer.isGone(state)) {
    await tombstoneProjection(type, id, branch, lastSeq, { state });
    return { state, foldedSeq: lastSeq, tombstoned: true };
  }

  const position = state.position !== undefined ? state.position : undefined;
  try {
    await initProjection(type, id, branch, { state, foldedSeq: lastSeq, position });
  } catch (err) {
    if (isDupKeyError(err) && !isNameDupError(err)) {
      // _id upsert race: another fold built this slot concurrently.
      // Retry as-is — the slot exists now, the update matches it.
      await initProjection(type, id, branch, { state, foldedSeq: lastSeq, position });
      return { state, foldedSeq: lastSeq };
    }
    if (!isNameDupError(err)) throw err;
    state = deconflictName(state, id);
    log.warn(
      "Fold",
      `name collision rebuilding ${type} ${String(id).slice(0, 8)} on #${branch}; ` +
      `materialized as "${state.name}" (see state.nameConflict)`,
    );
    await initProjection(type, id, branch, { state, foldedSeq: lastSeq, position });
  }

  return { state, foldedSeq: lastSeq };
}

// projectionState helper retired 2026-06-03 — slot.state IS the
// reducer-state slice now (the Projection collection stores state in
// a dedicated `state` field rather than at the row's top level).
