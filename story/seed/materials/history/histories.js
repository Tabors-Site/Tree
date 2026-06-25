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

import { HistoryCollection } from "./historyStore.js";
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
  const row = await HistoryCollection.findById(path).lean();
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

// ──────────────────────────────────────────────────────────────────
// Curated CRUD over the file-backed history store
// ──────────────────────────────────────────────────────────────────
//
// The History registry is no longer a Mongoose model; it is a
// FileCollection (historyStore.js) keyed by path. These helpers are the
// curated write + multi-row read seam so callers (historiesCatalog,
// historyCreation, history-manager/ops) never touch HistoryCollection
// directly. Each write that toggles a flag must be followed by the
// caller's invalidateHistoryCache(path) so the cached doc reflects it
// (kept the caller's responsibility, unchanged from the Mongo path).

/**
 * Direct children of a history path. Rows whose `parent` field equals
 * the given path. Main's children carry parent=null (main has no row),
 * so pass `null` for them. Excludes soft-deleted rows by default.
 * Sorted by path ascending for stable rendering.
 *
 * @param {string|null} parentPath  history path, or null for main's children
 * @param {object} [opts]
 * @param {boolean} [opts.includeDeleted=false]
 * @returns {Promise<object[]>}
 */
export async function listHistoryChildren(parentPath, { includeDeleted = false } = {}) {
  const filter = { parent: parentPath ?? null };
  if (!includeDeleted) filter.deleted = { $ne: true };
  return HistoryCollection.find(filter).sort({ path: 1 }).lean();
}

/**
 * Sibling paths under a parent. Used by createBranch's nextChildPath
 * arithmetic. For main pass `null` (main's children have parent=null).
 *
 * @param {string|null} parentPath
 * @returns {Promise<string[]>}
 */
export async function listSiblingPaths(parentPath) {
  const rows = await HistoryCollection.find({ parent: parentPath ?? null }).lean();
  return rows.map((r) => r.path);
}

/**
 * Every history row (no filter). The cross-history enumerators
 * (chainRoots fingerprints, graft export, scheduler axes) need the full
 * set; there is no per-history single-row peer for "all histories."
 * @returns {Promise<object[]>}
 */
export async function listAllHistories() {
  return HistoryCollection.find({}).lean();
}

/**
 * Every non-deleted history row (the live set). Sorted by path.
 * @returns {Promise<object[]>}
 */
export async function listLiveHistories() {
  return HistoryCollection.find({ deleted: { $ne: true } }).sort({ path: 1 }).lean();
}

/**
 * Count of history rows. Mirrors History.countDocuments({}).
 * @returns {Promise<number>}
 */
export async function countHistories() {
  return HistoryCollection.countDocuments({});
}

/**
 * Bulk-insert verbatim history rows — the curated peer of the
 * History.insertMany({ ordered: false }) the graft/plant restore used. Each
 * doc lands keyed by its `_id` (the path); the cache is invalidated so the
 * freshly-planted rows resolve. The plant gates on an empty store, so there is
 * nothing to collide with.
 *
 * @param {object[]} docs  full history rows (carrying _id/path/parent/branchPoint/...)
 * @returns {Promise<object[]>}  the stored rows
 */
export async function insertHistories(docs = []) {
  if (!Array.isArray(docs) || docs.length === 0) return [];
  const stored = await HistoryCollection.insertMany(docs, { ordered: false });
  invalidateHistoryCache(null);
  return stored;
}

/**
 * Remove every history row — the curated peer of the History.deleteMany({})
 * the graft unplant used to restore an empty store after a failed plant.
 * Invalidates the cache. Idempotent.
 *
 * @returns {Promise<number>}  rows removed
 */
export async function deleteAllHistories() {
  const { deletedCount } = await HistoryCollection.deleteMany({});
  invalidateHistoryCache(null);
  return deletedCount || 0;
}

/**
 * Create a history row. `_id` is the path (one doc per path). Returns
 * the stored row. The caller invalidates the lineage cache afterward.
 *
 * @param {object} doc  { path, parent, branchPoint, createdBy, label, scope, ... }
 * @returns {Promise<object>}
 */
export async function createHistory(doc) {
  const path = doc.path ?? doc._id;
  if (!path) throw new Error("createHistory: doc requires a path");
  const row = {
    _id: path,
    path,
    parent: doc.parent ?? null,
    branchPoint: doc.branchPoint || {},
    createdBy: doc.createdBy ?? null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
    label: doc.label ?? null,
    paused: doc.paused ?? false,
    pausedBy: doc.pausedBy ?? null,
    pausedAt: doc.pausedAt ?? null,
    isLive: doc.isLive ?? false,
    archivedBecause: doc.archivedBecause ?? null,
    deleted: doc.deleted ?? false,
    deletedBy: doc.deletedBy ?? null,
    deletedAt: doc.deletedAt ?? null,
    mergeSources: Array.isArray(doc.mergeSources) ? [...doc.mergeSources] : [],
    scope: doc.scope ?? null,
  };
  const stored = await HistoryCollection.create(row);
  invalidateHistoryCache(path);
  return stored;
}

/**
 * Hard-delete a history row by path. Mirrors History.deleteOne({_id:path}).
 * This is the structural DELETE the book/graft instate's rollback needs:
 * when a verbatim instate inserts a fresh history row and a later step
 * throws, the landed[]-undo removes exactly that row (the receiver's
 * pre-existing histories are untouched). Distinct from the SOFT delete
 * (the `deleted` lifecycle flag setHistoryFields toggles) — this removes
 * the row entirely. Invalidates the cache.
 *
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function deleteHistory(path) {
  if (typeof path !== "string" || !path.length) {
    throw new Error("deleteHistory: path required");
  }
  await HistoryCollection.deleteOne({ _id: path });
  invalidateHistoryCache(path);
}

/**
 * Upsert flag/metadata fields on a history row, keyed by path. Mirrors
 * the History.updateOne({path}, {$set, $setOnInsert}, {upsert:true})
 * the lifecycle ops (pause/unpause/delete/undelete/merge) used. When no
 * row exists yet (implicit-live main, or first toggle on a path) a row
 * is created carrying the $set fields plus the supplied structural
 * defaults. Invalidates the cache.
 *
 * @param {string} path
 * @param {object} set           fields to $set
 * @param {object} [setOnInsert] structural fields applied only on create (e.g. parent)
 * @returns {Promise<object>}    the stored row
 */
export async function setHistoryFields(path, set = {}, setOnInsert = {}) {
  const existing = await HistoryCollection.findById(path).lean();
  let row;
  if (existing) {
    row = { ...existing, ...set, _id: path, path };
  } else {
    // New row: structural defaults + the set fields. Mirror the create
    // shape so listings/serialization see a complete doc.
    row = {
      _id: path,
      path,
      parent: setOnInsert.parent ?? null,
      branchPoint: setOnInsert.branchPoint ?? {},
      createdBy: setOnInsert.createdBy ?? null,
      createdAt: setOnInsert.createdAt
        ? new Date(setOnInsert.createdAt).toISOString()
        : new Date().toISOString(),
      label: setOnInsert.label ?? null,
      paused: false,
      pausedBy: null,
      pausedAt: null,
      isLive: setOnInsert.isLive ?? false,
      archivedBecause: null,
      deleted: false,
      deletedBy: null,
      deletedAt: null,
      mergeSources: setOnInsert.mergeSources ?? [],
      scope: setOnInsert.scope ?? null,
      ...set,
    };
  }
  const stored = await HistoryCollection.create(row);
  invalidateHistoryCache(path);
  return stored;
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

  // Curated read: there is no cross-history fact scan primitive, so we
  // enumerate the reel-bearing aggregates touched on each divergent
  // history and read each one's OWN-history reel through the curated
  // seam. listByType(type, history) over-collects (it inherits the
  // lineage), but getFactsOnReelWhere reads only `history`'s own reel
  // file — an inherited aggregate with no divergent facts yields [] and
  // contributes nothing, so the union is exactly the facts STAMPED on
  // the divergent histories (what the old Fact.find({history:$in}) did).
  const { listByType } = await import("../projections.js");
  const { getFactsOnReelWhere } = await import("../../past/fact/facts.js");
  const REEL_KINDS = ["being", "space", "matter"];

  const byReel = new Map();
  for (const h of divergentHistories) {
    for (const kind of REEL_KINDS) {
      const occupants = await listByType(kind, h);
      for (const occ of occupants) {
        const facts = getFactsOnReelWhere(h, kind, occ.id, (f) => !!f?.of?.id);
        if (!facts.length) continue;
        const key = `${kind}:${occ.id}`;
        let bucket = byReel.get(key);
        if (!bucket) {
          bucket = [];
          byReel.set(key, bucket);
        }
        for (const f of facts) bucket.push(f);
      }
    }
  }
  // Within each reel bucket, order seq-ascending (a reel may collect
  // facts from multiple divergent histories, e.g. #1 and #1a).
  for (const bucket of byReel.values()) {
    bucket.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }
  return byReel;
}
