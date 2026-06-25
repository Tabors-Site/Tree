// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// projStore.js — a tiny file-backed collection for the SECONDARY cross-cutting
// projections (inbox, threads, position). These are NOT the chain (the reels in
// fileStore.js are truth); they are DERIVED caches — one row per open summon /
// live thread / being-in-space — rebuildable by re-folding the call facts. So
// they get the simplest durable shape that does the job:
//
//   <storeRoot>/proj/<name>/<2-char-shard>/<id>.json   one JSON file per row
//   <storeRoot>/proj/<name>/_index.json                a flat {id: row-subset} cache
//
// The per-id file is the row of record; the _index is a denormalized scan cache
// so find/aggregate don't have to walk the shard tree on every read. Both are
// rebuildable from the per-id files (rebuild()); a corrupt/missing index is
// never a loss (the per-id files win).
//
// It exposes the narrow slice of the collection-model surface these projections'
// callers actually use (updateOne/deleteOne/deleteMany/findById/findOne/find/
// aggregate/countDocuments/estimatedDocumentCount), each returning the
// shapes the callers expect, so storage stays behind one seam — call sites do
// not change. Query support is the minimum the callers exercise: top-level
// equality, $gte (Date), $nin, $in, $exists, $lt, plus $sort/$limit/$skip and a
// one-level $group with $sum/$push used by getInboxSummary. No transactions, no
// secondary indexes — the single global commit mutex in fileStore serializes the
// stamper, and these are caches.

import {
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  writeSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { storeRoot } from "./fileStore.js";

// 2-char shard so no single dir holds millions of rows. ids are uuids/hashes/
// composite keys; sanitize so a key can never escape the collection dir.
function pathSafe(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, "_") || "_";
}
function shard(id) {
  const s = pathSafe(id);
  return s.length >= 2 ? s.slice(0, 2) : s.padEnd(2, "_");
}

function writeJsonFsync(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w");
  try {
    writeSync(fd, JSON.stringify(value) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// ── value matching (the query operators the callers exercise) ───────────────
function matchOp(value, cond) {
  if (cond !== null && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
    for (const [op, operand] of Object.entries(cond)) {
      switch (op) {
        case "$gte":
          if (!(toComparable(value) >= toComparable(operand))) return false;
          break;
        case "$lte":
          if (!(toComparable(value) <= toComparable(operand))) return false;
          break;
        case "$lt":
          if (!(toComparable(value) < toComparable(operand))) return false;
          break;
        case "$gt":
          if (!(toComparable(value) > toComparable(operand))) return false;
          break;
        case "$ne":
          if (eq(value, operand)) return false;
          break;
        case "$in":
          if (!Array.isArray(operand) || !operand.some((o) => eq(value, o))) return false;
          break;
        case "$nin":
          if (Array.isArray(operand) && operand.some((o) => eq(value, o))) return false;
          break;
        case "$exists":
          if (operand ? value === undefined : value !== undefined) return false;
          break;
        default:
          // Unknown operator → treat the cond as a literal object compare.
          return eq(value, cond);
      }
    }
    return true;
  }
  return eq(value, cond);
}

function toComparable(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return v;
}
function eq(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  return a === b;
}

// One row against one filter. Supports top-level equality/operator fields and a
// top-level $or (the only logical operator the callers use). For array fields
// (e.g. threads.participants) an equality cond matches membership, the
// implicit array-contains semantics the callers expect.
function rowMatches(row, filter) {
  if (!filter) return true;
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") {
      if (!Array.isArray(cond) || !cond.some((sub) => rowMatches(row, sub))) return false;
      continue;
    }
    const value = row[key];
    if (Array.isArray(value) && !(cond !== null && typeof cond === "object" && !(cond instanceof Date))) {
      // array-contains for a scalar equality cond
      if (!value.some((v) => eq(v, cond))) return false;
      continue;
    }
    if (!matchOp(value, cond)) return false;
  }
  return true;
}

// ── the $set / $setOnInsert / $addToSet apply (updateOne) ───────────────────
function applyUpdate(existing, update) {
  const row = existing ? { ...existing } : {};
  const isInsert = !existing;
  if (update.$set) Object.assign(row, update.$set);
  if (isInsert && update.$setOnInsert) Object.assign(row, update.$setOnInsert);
  if (update.$addToSet) {
    for (const [key, spec] of Object.entries(update.$addToSet)) {
      const cur = Array.isArray(row[key]) ? row[key].slice() : [];
      const items = spec && spec.$each ? spec.$each : [spec];
      for (const it of items) if (!cur.includes(it)) cur.push(it);
      row[key] = cur;
    }
  }
  return row;
}

// ── chainable cursor (find().sort().limit().skip().lean()) ──────────────────
class Cursor {
  constructor(rows) {
    this._rows = rows;
    this._sort = null;
    this._limit = null;
    this._skip = 0;
  }
  sort(spec) {
    this._sort = spec;
    return this;
  }
  // No-op field projection. Reads here always return full rows; the
  // `.find(q).select("a b").lean()` shape works unchanged because callers
  // read the fields off the full row. Kept so the history store (which used
  // .select on the collection) keeps its call shape.
  select() {
    return this;
  }
  limit(n) {
    this._limit = n;
    return this;
  }
  skip(n) {
    this._skip = n || 0;
    return this;
  }
  // Reads here are always plain objects; lean() is a no-op pass-through so the
  // call shape `.find(q).sort(...).lean()` works unchanged.
  lean() {
    return this._resolve();
  }
  then(onF, onR) {
    return Promise.resolve(this._resolve()).then(onF, onR);
  }
  _resolve() {
    let rows = this._rows.slice();
    if (this._sort) {
      const entries = Object.entries(this._sort);
      rows.sort((a, b) => {
        for (const [k, dir] of entries) {
          const av = toComparable(a[k]);
          const bv = toComparable(b[k]);
          if (av == null && bv == null) continue;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (av < bv) return dir < 0 ? 1 : -1;
          if (av > bv) return dir < 0 ? -1 : 1;
        }
        return 0;
      });
    }
    if (this._skip) rows = rows.slice(this._skip);
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return rows;
  }
}

export class FileCollection {
  constructor(name) {
    this.name = name;
  }
  _dir() {
    return join(storeRoot(), "proj", pathSafe(this.name));
  }
  _rowPath(id) {
    return join(this._dir(), shard(id), `${pathSafe(id)}.json`);
  }
  _indexPath() {
    return join(this._dir(), "_index.json");
  }
  _loadIndex() {
    return readJson(this._indexPath()) || {};
  }
  _saveIndex(idx) {
    writeJsonFsync(this._indexPath(), idx);
  }
  _writeRow(id, row) {
    writeJsonFsync(this._rowPath(id), row);
    const idx = this._loadIndex();
    idx[String(id)] = row;
    this._saveIndex(idx);
  }
  _removeRow(id) {
    const p = this._rowPath(id);
    if (existsSync(p)) rmSync(p, { force: true });
    const idx = this._loadIndex();
    if (idx[String(id)] !== undefined) {
      delete idx[String(id)];
      this._saveIndex(idx);
    }
  }
  _all() {
    // The _index is the scan cache. Values are full rows.
    return Object.values(this._loadIndex());
  }

  // ── writes ────────────────────────────────────────────────────────────────
  // updateOne with upsert. The callers only ever filter updateOne by _id (the
  // row key), with the seq/lastMoveSeq guard expressed via $or/$lt — which the
  // position fold needs to be a no-op when stale. We honor the full filter:
  // resolve the row by _id, then require it to match the rest of the filter
  // before applying (so the $or seq-guard rejects a stale fact).
  async updateOne(filter, update, opts = {}) {
    const id = filter._id;
    if (id === undefined) {
      // Fallback: scan (no caller does this today, but keep it correct).
      const row = this._all().find((r) => rowMatches(r, filter));
      if (!row) {
        if (opts.upsert) return this._insertUpsert(filter, update);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }
      return this._applyToRow(row._id, row, filter, update);
    }
    const existing = readJson(this._rowPath(id));
    if (!existing) {
      if (opts.upsert) return this._insertUpsert(filter, update);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    // Existing row must satisfy the rest of the filter (the seq guard).
    const rest = { ...filter };
    delete rest._id;
    if (!rowMatches(existing, rest)) {
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    return this._applyToRow(id, existing, filter, update);
  }
  _applyToRow(id, existing, filter, update) {
    const next = applyUpdate(existing, update);
    if (next._id === undefined) next._id = id;
    this._writeRow(id, next);
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }
  _insertUpsert(filter, update) {
    // Seed the row from any equality fields in the filter, then apply.
    const seed = {};
    for (const [k, v] of Object.entries(filter)) {
      if (v === null || typeof v !== "object" || v instanceof Date) seed[k] = v;
    }
    const next = applyUpdate(null, update);
    const merged = { ...seed, ...next };
    if (merged._id === undefined && filter._id !== undefined) merged._id = filter._id;
    this._writeRow(merged._id, merged);
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: merged._id };
  }

  async deleteOne(filter) {
    if (filter._id !== undefined) {
      const existed = existsSync(this._rowPath(filter._id));
      this._removeRow(filter._id);
      return { deletedCount: existed ? 1 : 0 };
    }
    const row = this._all().find((r) => rowMatches(r, filter));
    if (!row) return { deletedCount: 0 };
    this._removeRow(row._id);
    return { deletedCount: 1 };
  }
  async deleteMany(filter) {
    const victims = this._all().filter((r) => rowMatches(r, filter));
    for (const r of victims) this._removeRow(r._id);
    return { deletedCount: victims.length };
  }

  // Insert one doc. Mirrors the `.create(doc)` shape the
  // history store used. The doc's `_id` is the row key (the history store
  // sets `_id` to the path). Returns the stored row.
  async create(doc) {
    const row = { ...doc };
    if (row._id === undefined) {
      throw new Error("FileCollection.create: doc requires an _id");
    }
    this._writeRow(row._id, row);
    return row;
  }
  // Bulk insert. Mirrors `.insertMany(docs, { ordered:false })` used by the
  // graft restore path. `ordered:false` is honored (a bad doc doesn't stop
  // the rest); each doc requires an `_id`.
  async insertMany(docs = [], opts = {}) {
    const ordered = opts.ordered !== false ? true : false;
    const inserted = [];
    for (const doc of docs) {
      const row = { ...doc };
      if (row._id === undefined) {
        if (ordered) throw new Error("FileCollection.insertMany: doc requires an _id");
        continue;
      }
      this._writeRow(row._id, row);
      inserted.push(row);
    }
    return inserted;
  }

  // ── reads ─────────────────────────────────────────────────────────────────
  // Returns a thenable that also answers .lean() (a no-op pass-through), so both
  // `await findById(id)` and `await findById(id).lean()` resolve to the row|null.
  findById(id) {
    const get = () =>
      id === undefined || id === null ? null : readJson(this._rowPath(id));
    const handle = {
      // No-op projection so `.findById(id).select(...).lean()` works unchanged.
      select: () => handle,
      lean: () => Promise.resolve(get()),
      then: (onF, onR) => Promise.resolve(get()).then(onF, onR),
    };
    return handle;
  }
  findOne(filter = {}) {
    const rows = this._all().filter((r) => rowMatches(r, filter));
    // Return a one-row cursor so `.sort().lean()` works; resolve to the first.
    const cursor = new Cursor(rows);
    const _resolve = cursor._resolve.bind(cursor);
    cursor._resolve = () => {
      const r = _resolve();
      return r.length ? r[0] : null;
    };
    return cursor;
  }
  find(filter = {}) {
    return new Cursor(this._all().filter((r) => rowMatches(r, filter)));
  }
  async countDocuments(filter = {}) {
    return this._all().filter((r) => rowMatches(r, filter)).length;
  }
  async estimatedDocumentCount() {
    return Object.keys(this._loadIndex()).length;
  }

  // One-level aggregate: the ONLY pipeline a caller runs is getInboxSummary's
  // $match → $sort → $group({_id, total:$sum, recent:$push:$$ROOT}). Support
  // exactly that shape.
  async aggregate(pipeline = []) {
    let rows = this._all();
    for (const stage of pipeline) {
      if (stage.$match) rows = rows.filter((r) => rowMatches(r, stage.$match));
      else if (stage.$sort) {
        const c = new Cursor(rows);
        c.sort(stage.$sort);
        rows = c._resolve();
      } else if (stage.$limit != null) rows = rows.slice(0, stage.$limit);
      else if (stage.$skip != null) rows = rows.slice(stage.$skip);
      else if (stage.$group) rows = groupStage(rows, stage.$group);
    }
    return rows;
  }

  // ── rebuild the _index from the per-id files (the cache is rebuildable) ─────
  rebuildIndex() {
    const dir = this._dir();
    const idx = {};
    if (existsSync(dir)) {
      for (const shardName of readdirSync(dir)) {
        if (shardName === "_index.json") continue;
        const shardDir = join(dir, shardName);
        let entries;
        try {
          entries = readdirSync(shardDir);
        } catch {
          continue;
        }
        for (const f of entries) {
          if (!f.endsWith(".json")) continue;
          const row = readJson(join(shardDir, f));
          if (row && row._id !== undefined) idx[String(row._id)] = row;
        }
      }
    }
    this._saveIndex(idx);
    return { rebuilt: Object.keys(idx).length };
  }
}

function groupStage(rows, group) {
  const idExpr = group._id; // e.g. "$recipient"
  const keyOf = (r) =>
    typeof idExpr === "string" && idExpr.startsWith("$") ? r[idExpr.slice(1)] : idExpr;
  const buckets = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    let acc = buckets.get(String(k));
    if (!acc) {
      acc = { _id: k };
      for (const field of Object.keys(group)) {
        if (field === "_id") continue;
        const spec = group[field];
        if (spec.$sum !== undefined) acc[field] = 0;
        else if (spec.$push !== undefined) acc[field] = [];
      }
      buckets.set(String(k), acc);
    }
    for (const field of Object.keys(group)) {
      if (field === "_id") continue;
      const spec = group[field];
      if (spec.$sum !== undefined) {
        acc[field] += spec.$sum === 1 ? 1 : Number(r[String(spec.$sum).slice(1)]) || 0;
      } else if (spec.$push !== undefined) {
        acc[field].push(spec.$push === "$$ROOT" ? r : r[String(spec.$push).slice(1)]);
      }
    }
  }
  return Array.from(buckets.values());
}
