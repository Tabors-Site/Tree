// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Branch helpers — the read-side surface around the Branch
// collection. Every place in the substrate that needs to know about
// branches goes through these helpers, NOT through Branch.findById
// directly, so the in-memory ancestry cache stays warm and the
// branch-aware read paths stay consistent.
//
// ── Cross-branch constraint (doctrine) ────────────────────────────
//
// Branches are isolated worlds. A left-stance being and a right-
// stance target can only communicate when they share the same
// branch (the `#` qualifier in an IBP address). Cross-branch SEE,
// DO, SUMMON, BE — forbidden at the verb dispatch layer; the verb
// throws INVALID_INPUT (or future CROSS_BRANCH_FORBIDDEN). The
// substrate treats cross-branch operations the way it treats
// cross-reality calls: a federation territory that needs its own
// protocol, deferred until use cases force it.
//
// One operation crosses branches structurally: `create-branch`, which
// is itself a CREATE, not a CROSS-OP. The new branch starts from a
// past point of an existing one; from that moment forward the two
// branches diverge. See Pass 3 (create-branch op).
//
// Pass 2 ships:
//   resolveBranchLineage(path)   — main → leaf ordered ancestry
//   getBranchPoint(branch, reel) — per-reel branchPoint seq for the
//                                   range walk in readReelBetween
//   isMain(path)                 — small predicate for hot-path gating
//   isBranchPaused(path)         — read the pause projection
//
// Pass 3 adds: create-branch, pause/unpause facts + reducer. Pass 4
// adds: IBP address parser + summonCtx threading + the cross-branch
// dispatch gate. Pass 6.5 adds: REALITY_PAUSED verb-gate using
// isBranchPaused.
//
// Main ("0") has no row in the branches collection. It is the
// implicit root; helpers short-circuit when asked about it. Saves a
// DB lookup on the hot path.

import Branch from "./branch.js";

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
// Branch metadata is append-only after creation (only the paused /
// archived flags toggle; the parent / branchPoint never change). The
// ancestry of a given branch is therefore stable for the process
// lifetime once we've seen it. Cache aggressively.
//
// Eviction: an explicit `invalidateBranchCache(path)` is exposed so
// the pause/unpause + create-branch facts (when they ship) can wipe
// the relevant entries. Until those ops exist, the cache is purely
// additive.

const _lineageCache = new Map(); // path → [ancestor-paths] (main → leaf)
const _branchDocCache = new Map(); // path → Branch row (or null sentinel)

export function invalidateBranchCache(path) {
  if (path == null) {
    _lineageCache.clear();
    _branchDocCache.clear();
    return;
  }
  _lineageCache.delete(path);
  _branchDocCache.delete(path);
}

/**
 * Look up a Branch by path. Main is implicit (no row exists) UNTIL
 * the operator first pauses it — at which point pause-branch upserts
 * a row. Returns null when no doc exists for the path (including
 * implicit-live main).
 */
export async function loadBranch(path) {
  if (_branchDocCache.has(path)) return _branchDocCache.get(path);
  const row = await Branch.findById(path).lean();
  _branchDocCache.set(path, row || null);
  return row || null;
}

/**
 * Resolve a branch path to its ordered ancestry, main first, leaf
 * last. For main returns `["0"]`. For #1a1 returns `["0", "1", "1a", "1a1"]`.
 *
 * Walks the parent chain via the Branch collection. Cached.
 *
 * Throws when the path doesn't resolve (a branch row is missing
 * partway up the chain) — that's a corrupted lineage and reading the
 * reel would silently swap facts from the wrong branch's storage.
 *
 * @param {string} path
 * @returns {Promise<string[]>}
 */
export async function resolveBranchLineage(path) {
  if (isMain(path)) return [MAIN];
  const cached = _lineageCache.get(path);
  if (cached) return cached;

  const chain = [];
  let cursor = path;
  const seen = new Set();
  while (cursor && !isMain(cursor)) {
    if (seen.has(cursor)) {
      throw new Error(`resolveBranchLineage: cycle detected at "${cursor}" (path="${path}")`);
    }
    seen.add(cursor);
    const row = await loadBranch(cursor);
    if (!row) {
      throw new Error(`resolveBranchLineage: branch "${cursor}" not found (resolving path="${path}")`);
    }
    chain.unshift(cursor);
    cursor = row.parent;
  }
  chain.unshift(MAIN);
  _lineageCache.set(path, chain);
  return chain;
}

/**
 * Read the per-reel branchPoint for a branch + reel. Returns null
 * for main (main has no branchPoint — its reel starts at seq 1).
 * Returns 0 for branches whose branchPoint map has no entry for this
 * reel — that's "the reel had no facts at branch time," so the
 * branch's own seqs start at 1.
 *
 * @param {string} branch
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @returns {Promise<number|null>}
 */
export async function getBranchPoint(branch, type, id) {
  if (isMain(branch)) return null;
  const row = await loadBranch(branch);
  if (!row) {
    throw new Error(`getBranchPoint: branch "${branch}" not found`);
  }
  const key = `${type}:${id}`;
  const bp = row.branchPoint;
  if (!bp) return 0;
  // Mongoose Maps are lean'd to plain objects on lean queries.
  const v = bp instanceof Map ? bp.get(key) : bp[key];
  return typeof v === "number" ? v : 0;
}

/**
 * Cheap pause check. ALL branches including main are pauseable
 * (Tabor doctrine 2026-06-04: every branch is symmetric). A main row
 * is only created lazily when the operator first pauses main; before
 * that no row exists and the default is "not paused" (live).
 *
 * Reads via loadBranch (cached). The pause-branch / unpause-branch
 * ops invalidate the cache after writes so the gate sees fresh
 * state within a microsecond of the operation.
 */
export async function isBranchPaused(path) {
  const row = await loadBranch(path);
  return row?.paused === true;
}

/**
 * Cheap delete check. Mirrors isBranchPaused. Soft delete: the branch
 * still exists in the chain, its facts are still readable via SEE,
 * but new writes (DO/BE/SUMMON) refuse and the scheduler skips it.
 * Main is deletable (same symmetric-branch doctrine as pause).
 *
 * Reads via loadBranch (cached). The delete-branch / undelete-branch
 * ops invalidate the cache after writes.
 */
export async function isBranchDeleted(path) {
  const row = await loadBranch(path);
  return row?.deleted === true;
}

/**
 * Find the most recent shared ancestor of two branches. Walks both
 * lineages (main → leaf) and returns the deepest path present in
 * both. Always exists because main is in every lineage.
 *
 * Examples:
 *   commonAncestor("1", "2")     → "0"  (both forked from main)
 *   commonAncestor("1a", "1")    → "1"  (1a forked from 1)
 *   commonAncestor("1a", "1b")   → "1"  (both forked from 1)
 *   commonAncestor("1a1", "1a2") → "1a"
 *
 * The merged branch produced by merge-branches uses this path as its
 * parent and snapshots branchPoint from there.
 */
export async function commonAncestor(pathA, pathB) {
  if (typeof pathA !== "string" || !pathA.length) {
    throw new Error("commonAncestor: pathA required");
  }
  if (typeof pathB !== "string" || !pathB.length) {
    throw new Error("commonAncestor: pathB required");
  }
  const lineageA = await resolveBranchLineage(pathA);
  const lineageB = await resolveBranchLineage(pathB);
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
 * Return every fact on `branch`'s reel-lineage that is NOT also on
 * `ancestor`'s reel-lineage. Grouped by reel key (`<kind>:<id>`).
 *
 * "Divergent" means: facts on the BRANCHES between `ancestor` and
 * `branch` (exclusive of ancestor; inclusive of branch). Each of
 * those branches stored its own writes with `branch=<that branch>`;
 * the query is `branch: { $in: [divergent-branches] }`.
 *
 * Used by the merge pipeline:
 *   diff for side A = divergentFactsSince(sourceA, commonAncestor)
 *   diff for side B = divergentFactsSince(sourceB, commonAncestor)
 *   conflicts = reels touched in BOTH diffs
 *
 * Returns an empty Map when `branch === ancestor` or when the
 * divergent set has no fact-emitting reels.
 *
 * @param {string} branch
 * @param {string} ancestor
 * @returns {Promise<Map<string, Array<object>>>}
 */
export async function divergentFactsSince(branch, ancestor) {
  if (typeof branch !== "string" || !branch.length) {
    throw new Error("divergentFactsSince: branch required");
  }
  if (typeof ancestor !== "string" || !ancestor.length) {
    throw new Error("divergentFactsSince: ancestor required");
  }
  if (branch === ancestor) return new Map();

  const branchLineage = await resolveBranchLineage(branch);
  const ancestorLineage = await resolveBranchLineage(ancestor);
  const ancestorSet = new Set(ancestorLineage);
  const divergentBranches = branchLineage.filter(b => !ancestorSet.has(b));
  if (divergentBranches.length === 0) return new Map();

  const { default: Fact } = await import("../../past/fact/fact.js");
  const facts = await Fact.find({
    branch: { $in: divergentBranches },
    "target.kind": { $in: ["being", "space", "matter"] },
    "target.id":   { $exists: true, $ne: null },
  }).sort({ seq: 1 }).lean();

  const byReel = new Map();
  for (const f of facts) {
    const key = `${f.target.kind}:${f.target.id}`;
    let bucket = byReel.get(key);
    if (!bucket) {
      bucket = [];
      byReel.set(key, bucket);
    }
    bucket.push(f);
  }
  return byReel;
}
