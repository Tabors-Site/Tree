// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// historyStore.js — the file-backed home of the History registry.
//
// History metadata is NOT a folded reel. It is small mutable metadata
// keyed by PATH ("0", "1", "1a", ...): { path, parent, branchPoint (a
// reelKey→seq map), createdBy, createdAt, label, paused, pausedBy,
// pausedAt, isLive, deleted, mergeSources, scope }. Only the paused /
// deleted / merge flags ever toggle after creation; parent and
// branchPoint are stable. So it gets the SAME shape the secondary
// cross-cutting projections (inbox / threads / position) use: a
// FileCollection, one JSON doc per row keyed by path, under the store
// (<storeRoot>/proj/history/...).
//
// The row's `_id` IS the path (one doc per history path), exactly as the
// old `_id: path` schema. `findById(path)` resolves the single row;
// `findOne({path})` / `findOne({_id})` and `find({parent})` scan the
// index by the matching field (path / parent are stored fields).
//
// Main ("0") has no row until first paused/deleted (lazy upsert), same
// as before. histories.js is the curated read/write seam everything
// SHOULD call; this module is the storage primitive + the raw-surface
// escape hatch for the few cross-history enumerators (chainRoots,
// graft, wakeSchedule, subscriptions) that need find({}) / insertMany /
// countDocuments and have no curated single-row peer.

import { FileCollection } from "../../past/projStore.js";

// One instance, shared process-wide. Keyed by path (each doc's _id ===
// its path). Stored as JSON under <storeRoot>/proj/history/.
export const HistoryCollection = new FileCollection("history");

export default HistoryCollection;
