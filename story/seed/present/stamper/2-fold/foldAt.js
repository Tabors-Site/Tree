// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// foldAt — the historical fold primitive.
//
// The live fold (foldEngine.js#fold / #rebuild) is a function whose
// side effects keep current-state projections in sync: it walks new
// facts past a marker, applies them through the reducer, writes the
// new state to the projection row, fires cross-cutting handlers for
// inbox / position / threads. Live folds CHANGE the world's caches.
//
// foldAt is the pure version. Given a target reel and a past point,
// it walks the reel from genesis to that point (inclusive), applies
// the reducer, and returns the projection — with NO side effects.
// Nothing is written. Cross-cutting handlers don't fire. Repeat calls
// at the same point produce byte-identical state (the reducer is pure,
// the chain is immutable).
//
// ── The two flavors of fold (doctrine) ────────────────────────────
//
// Live folds advance current-state projections and dispatch cross-
// cutting handlers as side effects of reading current truth.
// Historical folds compute past projections as pure functions of the
// chain, with no side effects. Both share the reducer; they differ
// in whether the computation commits anything.
//
// ── seq is the truth; timestamps are a human helper ───────────────
//
// `seq` is the substrate's truth: monotonic per reel, allocated under
// lock at append, the only valid ordering across facts on the same
// reel. `date` (timestamp) is a human helper: it resolves to the
// highest seq with `date <= target` via a two-step query. Historical
// queries internally always operate on seq; timestamps translate to
// seq before any fold work begins. Cross-reel ordering by timestamp
// is NEVER trusted — only per-reel seq ordering is. Step 2's
// historian assembles per-reel historical folds; it cannot ask for
// a globally-consistent cross-reel timestamp slice. That's a
// property of the substrate, not a limitation to fix.
//
// ── Branch parameter is forward-compatible ────────────────────────
//
// Today only `"0"` (main) exists; the read path is single-branch.
// When branch storage lands, this signature stays — only the body
// grows to walk inherited facts from parent branches up to the branch
// point, then divergent facts from the current branch. Callers
// don't need to change.

import { getFactsOnReelWhere } from "../../../past/fact/facts.js";
import * as reducers from "../../../materials/reducers.js";
import { readReelBetween } from "./foldEngine.js";
import { assertHistoryOrThrow } from "../../../materials/projections.js";

const REEL_TYPES = new Set(["being", "space", "matter", "name", "library"]);

/**
 * Thrown when a historical fold is requested for a target that had no
 * facts at the queried point. Distinguishable from "current target has
 * empty state" — the historical caller asked an explicit question and
 * deserves an explicit answer: this thing did not exist yet then.
 *
 * Named (rather than generic Error) so callers (the past-fold being,
 * the timeline UI, the IBP layer when SEE-at-time lands) can catch
 * this specific failure and degrade gracefully.
 */
export class NoSuchHistoricalState extends Error {
  constructor(type, id, until) {
    super(
      `No historical state for ${type}:${String(id).slice(0, 8)} ` +
      `at ${formatUntil(until)} — the target had no facts at that point.`,
    );
    this.name   = "NoSuchHistoricalState";
    this.type   = type;
    this.id     = String(id);
    this.until  = until;
  }
}

function formatUntil(until) {
  if (until?.atSeq != null) return `seq=${until.atSeq}`;
  if (until?.atTimestamp != null) {
    const d = until.atTimestamp instanceof Date ? until.atTimestamp : new Date(until.atTimestamp);
    return `t=${d.toISOString()}`;
  }
  return "(unknown)";
}

function assertType(type) {
  if (!REEL_TYPES.has(type)) {
    throw new Error(`foldAt: type must be one of being/space/matter, got "${type}"`);
  }
}

/**
 * Resolve a historical fold's "until" anchor into an absolute seq on
 * the target reel.
 *
 * Accepts either:
 *   - { atSeq: N }       — direct seq; returned verbatim.
 *   - { atTimestamp: D } — wall-clock; resolves to the highest seq
 *                          whose Fact.date <= D on this reel.
 *
 * `atSeq` wins if both are given. Returns null when the timestamp
 * resolution finds no Fact at or before the given date (the reel was
 * empty at that wall-clock time).
 *
 * @param {string} type
 * @param {string} id
 * @param {{ atSeq?: number, atTimestamp?: Date|string, history?: string }} until
 * @returns {Promise<number|null>}
 */
export async function resolveUntil(type, id, until, opts = {}) {
  if (until == null || typeof until !== "object") {
    throw new Error("resolveUntil: `until` is required; pass { atSeq } or { atTimestamp }");
  }
  if (typeof until.atSeq === "number") {
    return until.atSeq;
  }
  if (until.atTimestamp == null) {
    throw new Error("resolveUntil: provide { atSeq } or { atTimestamp }");
  }
  const at = until.atTimestamp instanceof Date
    ? until.atTimestamp
    : new Date(until.atTimestamp);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`resolveUntil: invalid atTimestamp "${until.atTimestamp}"`);
  }
  // History-aware AND lineage-aware: the latest fact at-or-before the
  // timestamp anywhere in the history's inherited reel. For heaven this
  // is just heaven's facts; for a child history this is heaven up to the
  // branch point + the history's own divergent facts. Without the lineage
  // walk, a past view on #1 where no divergent facts exist for the
  // target returns null → foldAt throws → descriptor drops the row, and
  // the entire scene empties out (the user's "grid spaces disappear in
  // past view on #1" symptom). History is required from the caller; the
  // historian path used to default to heaven silently.
  // SEAM: opts key is `history` (foldEngine/descriptor convention);
  // the value is the history slot.
  const history = assertHistoryOrThrow(opts.history || until.history, "resolveUntil(opts)");
  const atMs = at.getTime();
  // The highest seq on this reel whose date <= at. FileStore reels are
  // seq-ascending; read via the curated getFactsOnReelWhere (the file-
  // native peer of Fact.find) and reduce in JS. A fact with no/invalid
  // date never counts (mirrors the Mongo `date <= at` clause). seq must
  // be a number (the old `seq: { $type: "number" }` guard).
  const dateOK = (f) => {
    if (typeof f.seq !== "number") return false;
    const t = f?.date != null ? Date.parse(f.date) : NaN;
    return !Number.isNaN(t) && t <= atMs;
  };
  const maxSeq = (facts) => {
    let best = null;
    for (const f of facts) if (best == null || f.seq > best) best = f.seq;
    return best;
  };

  if (history === "0") {
    // Own-history (main) read. Legacy facts with no history field landed
    // on the main reel too, so the own-reel read is complete.
    return maxSeq(getFactsOnReelWhere("0", type, id, dateOK));
  }
  // Non-main: walk the lineage and union each ancestor's own reel for
  // this target so a fact on the inherited prefix of main counts toward
  // the history's view at past time (the file-native peer of the old
  // OR-of-histories clause).
  const { resolveHistoryLineage } = await import("../../../materials/history/histories.js");
  const lineage = await resolveHistoryLineage(history);
  let best = null;
  for (const b of lineage) {
    const s = maxSeq(getFactsOnReelWhere(String(b), type, id, dateOK));
    if (s != null && (best == null || s > best)) best = s;
  }
  return best;
}

/**
 * Fold a target's reel to a past point. Pure read. No projection-cache
 * write. No cross-cutting handler dispatch.
 *
 * Throws `NoSuchHistoricalState` when the target had no facts at or
 * before the queried point — the target did not exist yet. Callers
 * who want graceful "didn't exist" handling catch this specific error.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {object} until
 * @param {number} [until.atSeq]        substrate-native; the truth
 * @param {Date|string} [until.atTimestamp] human helper; resolves to highest seq with date <= this
 * @param {string} [until.history="0"]   history identifier (forward-compat)
 * @returns {Promise<{ state: object, foldedSeq: number }>}
 */
export async function foldAt(type, id, until, opts = {}) {
  assertType(type);
  if (!id) throw new Error("foldAt: id is required");

  // History can come from opts.history (the descriptor's threaded value;
  // SEAM: opts key is `history` per the foldEngine/descriptor
  // convention, value is the history slot) or from until.history (legacy
  // callers that packed it into the historical anchor). Prefer opts so
  // the descriptor sweep doesn't have to re-pack until objects. No
  // silent default — caller must attach history via descriptor or anchor.
  const history = assertHistoryOrThrow(opts.history || until?.history, "foldAt(opts)");

  const untilSeq = await resolveUntil(type, id, until, { history: history });
  if (untilSeq == null) {
    throw new NoSuchHistoricalState(type, id, until);
  }

  const facts = await readReelBetween(type, id, null, untilSeq, history);

  // No facts at or before this seq — the target hadn't been birthed
  // yet (or the reel was malformed). Distinguish from "fold returned
  // empty state on current"; foldAt's contract is "this did not
  // exist," surfaced as the named error.
  if (facts.length === 0) {
    throw new NoSuchHistoricalState(type, id, until);
  }

  // Cold reduce from genesis. Same path as the live engine's
  // rebuild() — start from the reducer's initial state, apply each
  // fact in seq order — but bounded at untilSeq and NEVER calling
  // applyProjection or dispatchCrossCutting. Pure function of
  // (chain prefix, reducer).
  const reducer = reducers.get(type);
  let state = reducer.initial();
  for (const f of facts) {
    state = reducer.reduce(state, f);
  }

  // Phantom guard parity. The live rebuild path treats "walked every
  // fact and produced empty state" as a malformed reel and refuses
  // to materialize. Historical fold doesn't materialize anything,
  // but the empty-state output still indicates a reel that has facts
  // but no create-fact among them — surface the same way the caller
  // would treat "didn't exist."
  if (Object.keys(state).length === 0) {
    throw new NoSuchHistoricalState(type, id, until);
  }

  return { state, foldedSeq: facts[facts.length - 1].seq };
}
