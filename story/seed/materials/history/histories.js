// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// History helpers — the read-side surface around the History
// collection. Every place in the substrate that needs to know about
// histories goes through these helpers, NOT through History.findById
// directly, so the in-memory ancestry cache stays warm and the
// history-aware read paths stay consistent.
//
// ── Cross-history constraint (doctrine) ────────────────────────────
//
// Histories are isolated worlds. A left-stance being and a right-
// stance target can only communicate when they share the same
// history (the `#` qualifier in an IBP address). Cross-history SEE,
// DO, SUMMON, BE — forbidden at the verb dispatch layer; the verb
// throws INVALID_INPUT (or future CROSS_BRANCH_FORBIDDEN). The
// substrate treats cross-history operations the way it treats
// cross-story calls: a federation territory that needs its own
// protocol, deferred until use cases force it.
//
// One operation crosses histories structurally: `create-branch`, which
// is itself a CREATE, not a CROSS-OP. The new history starts from a
// past point of an existing one (it branches off it); from that moment
// forward the two histories diverge. See Pass 3 (create-branch op).
//
// Pass 2 ships:
//   resolveHistoryLineage(path)   — main → leaf ordered ancestry
//   getBranchPoint(history, reel) — per-reel branchPoint seq for the
//                                   range walk in readReelBetween
//   isMain(path)                 — small predicate for hot-path gating
//   isHistoryPaused(path)         — read the pause projection
//
// Pass 3 adds: create-branch, pause/unpause facts + reducer. Pass 4
// adds: IBP address parser + moment threading + the cross-history
// dispatch gate. Pass 6.5 adds: STORY_PAUSED verb-gate using
// isHistoryPaused.
//
// Main ("0") has no row in the histories collection. It is the
// implicit root; helpers short-circuit when asked about it. Saves a
// DB lookup on the hot path.

import History from "./history.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";

export const MAIN = "0";

/**
 * True when this path is main. Hot-path predicate.
 */
export function isMain(path) {
  return path === MAIN || path == null || path === "";
}

// ──────────────────────────────────────────────────────────────────
// In-memory ancestry cache
// ──────────────────────────────────────────────────────────────────
//
// History metadata is append-only after creation (only the paused /
// archived flags toggle; the parent / branchPoint never change). The
// ancestry of a given history is therefore stable for the process
// lifetime once we've seen it. Cache aggressively.
//
// Eviction: an explicit `invalidateHistoryCache(path)` is exposed so
// the pause/unpause + create-branch facts (when they ship) can wipe
// the relevant entries. Until those ops exist, the cache is purely
// additive.

const _lineageCache = new Map(); // path → [ancestor-paths] (main → leaf)
const _historyDocCache = new Map(); // path → History row (or null sentinel)

export function invalidateHistoryCache(path) {
  if (path == null) {
    _lineageCache.clear();
    _historyDocCache.clear();
    return;
  }
  _lineageCache.delete(path);
  _historyDocCache.delete(path);
}

/**
 * Look up a History by path. Main is implicit (no row exists) UNTIL
 * the operator first pauses it — at which point pause-branch upserts
 * a row. Returns null when no doc exists for the path (including
 * implicit-live main).
 */
export async function loadHistory(path) {
  if (_historyDocCache.has(path)) return _historyDocCache.get(path);
  const row = await History.findById(path).lean();
  _historyDocCache.set(path, row || null);
  return row || null;
}

/**
 * Resolve a history path to its ordered ancestry, main first, leaf
 * last. For main returns `["0"]`. For #1a1 returns `["0", "1", "1a", "1a1"]`.
 *
 * Walks the parent chain via the History collection. Cached.
 *
 * Throws when the path doesn't resolve (a history row is missing
 * partway up the chain) — that's a corrupted lineage and reading the
 * reel would silently swap facts from the wrong history's storage.
 *
 * @param {string} path
 * @returns {Promise<string[]>}
 */
export async function resolveHistoryLineage(path) {
  if (isMain(path)) return [MAIN];
  const cached = _lineageCache.get(path);
  if (cached) return cached;

  const chain = [];
  let cursor = path;
  const seen = new Set();
  while (cursor && !isMain(cursor)) {
    if (seen.has(cursor)) {
      throw new Error(`resolveHistoryLineage: cycle detected at "${cursor}" (path="${path}")`);
    }
    seen.add(cursor);
    const row = await loadHistory(cursor);
    if (!row) {
      // Coded so the wire classifies it as 404 and clients (the portal)
      // can fall back to main / clear a stale history hash, rather than
      // letting a plain Error surface as INTERNAL — which left a client
      // pinned to a gone history storming retries.
      throw new IbpError(
        IBP_ERR.BRANCH_NOT_FOUND,
        `history "${cursor}" not found (resolving path="${path}")`,
        { history: cursor, path },
      );
    }
    chain.unshift(cursor);
    cursor = row.parent;
  }
  chain.unshift(MAIN);
  _lineageCache.set(path, chain);
  return chain;
}

/**
 * Read the per-reel branchPoint for a history + reel. Returns null
 * for main (main has no branchPoint — its reel starts at seq 1).
 * Returns 0 for histories whose branchPoint map has no entry for this
 * reel — that's "the reel had no facts at branch time," so the
 * history's own seqs start at 1.
 *
 * @param {string} history
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @returns {Promise<number|null>}
 */
export async function getBranchPoint(history, type, id) {
  if (isMain(history)) return null;
  const row = await loadHistory(history);
  if (!row) {
    throw new IbpError(
      IBP_ERR.BRANCH_NOT_FOUND,
      `history "${history}" not found`,
      { history },
    );
  }
  const key = `${type}:${id}`;
  const bp = row.branchPoint;
  if (!bp) return 0;
  // Mongoose Maps are lean'd to plain objects on lean queries.
  const v = bp instanceof Map ? bp.get(key) : bp[key];
  return typeof v === "number" ? v : 0;
}

/**
 * Cheap pause check. ALL histories including main are pauseable
 * (Tabor doctrine 2026-06-04: every history is symmetric). A main row
 * is only created lazily when the operator first pauses main; before
 * that no row exists and the default is "not paused" (live).
 *
 * Reads via loadHistory (cached). The pause-branch / unpause-branch
 * ops invalidate the cache after writes so the gate sees fresh
 * state within a microsecond of the operation.
 */
export async function isHistoryPaused(path) {
  const row = await loadHistory(path);
  return row?.paused === true;
}

/**
 * Cheap delete check. Mirrors isHistoryPaused. Soft delete: the history
 * still exists in the chain, its facts are still readable via SEE,
 * but new writes (DO/BE/SUMMON) refuse and the scheduler skips it.
 * Main is deletable (same symmetric-history doctrine as pause).
 *
 * Reads via loadHistory (cached). The delete-branch / undelete-branch
 * ops invalidate the cache after writes.
 */
export async function isHistoryDeleted(path) {
  const row = await loadHistory(path);
  return row?.deleted === true;
}

/**
 * Find the most recent shared ancestor of two histories. Walks both
 * lineages (main → leaf) and returns the deepest path present in
 * both. Always exists because main is in every lineage.
 *
 * Examples:
 *   commonAncestor("1", "2")     → "0"  (both forked from main)
 *   commonAncestor("1a", "1")    → "1"  (1a forked from 1)
 *   commonAncestor("1a", "1b")   → "1"  (both forked from 1)
 *   commonAncestor("1a1", "1a2") → "1a"
 *
 * The merged history produced by merge-branches uses this path as its
 * parent and snapshots branchPoint from there.
 */
export async function commonAncestor(pathA, pathB) {
  if (typeof pathA !== "string" || !pathA.length) {
    throw new Error("commonAncestor: pathA required");
  }
  if (typeof pathB !== "string" || !pathB.length) {
    throw new Error("commonAncestor: pathB required");
  }
  const lineageA = await resolveHistoryLineage(pathA);
  const lineageB = await resolveHistoryLineage(pathB);
  let i = 0;
  while (i < lineageA.length && i < lineageB.length && lineageA[i] === lineageB[i]) {
    i++;
  }
  if (i === 0) {
    // Shouldn't happen since main is in every lineage, but stay loud.
    throw new Error(`commonAncestor: no shared ancestor between "${pathA}" and "${pathB}"`);
  }
  return lineageA[i - 1];
}

/**
 * Return every fact on `history`'s reel-lineage that is NOT also on
 * `ancestor`'s reel-lineage. Grouped by reel key (`<kind>:<id>`).
 *
 * "Divergent" means: facts on the HISTORIES between `ancestor` and
 * `history` (exclusive of ancestor; inclusive of history). Each of
 * those histories stored its own writes with `history=<that history>`;
 * the query is `history: { $in: [divergent-histories] }`.
 *
 * Used by the merge pipeline:
 *   diff for side A = divergentFactsSince(sourceA, commonAncestor)
 *   diff for side B = divergentFactsSince(sourceB, commonAncestor)
 *   conflicts = reels touched in BOTH diffs
 *
 * Returns an empty Map when `history === ancestor` or when the
 * divergent set has no fact-emitting reels.
 *
 * @param {string} history
 * @param {string} ancestor
 * @returns {Promise<Map<string, Array<object>>>}
 */
export async function divergentFactsSince(history, ancestor) {
  if (typeof history !== "string" || !history.length) {
    throw new Error("divergentFactsSince: history required");
  }
  if (typeof ancestor !== "string" || !ancestor.length) {
    throw new Error("divergentFactsSince: ancestor required");
  }
  if (history === ancestor) return new Map();

  const historyLineage = await resolveHistoryLineage(history);
  const ancestorLineage = await resolveHistoryLineage(ancestor);
  const ancestorSet = new Set(ancestorLineage);
  const divergentHistories = historyLineage.filter(b => !ancestorSet.has(b));
  if (divergentHistories.length === 0) return new Map();

  const { default: Fact } = await import("../../past/fact/fact.js");
  const facts = await Fact.find({
    history: { $in: divergentHistories },
    "of.kind": { $in: ["being", "space", "matter"] },
    "of.id":   { $exists: true, $ne: null },
  }).sort({ seq: 1 }).lean();

  const byReel = new Map();
  for (const f of facts) {
    const key = `${f.of.kind}:${f.of.id}`;
    let bucket = byReel.get(key);
    if (!bucket) {
      bucket = [];
      byReel.set(key, bucket);
    }
    bucket.push(f);
  }
  return byReel;
}
