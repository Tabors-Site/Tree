// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// fileStore.js — the append-only-file storage engine that replaces Mongo as the
// chain-of-truth (philosophy/mongorust.md; plan elegant-cooking-teapot, the Mongo rip).
// The storage finally matches the ontology: an ordered log of stamps stored as an
// ordered log of stamps, one layer closer to the bits.
//
// TRUTH LAYERS (only the first is irreducible):
//   moment-journal (WAL)  the atomic write unit. A moment's facts are written here FIRST
//                         (one framed line, fsync'd) — that is the commit point. Apply to the
//                         per-reel files follows; a crash replays un-acked records idempotently.
//   reel files .reel      per (history,kind,id), JSONL of canonical facts, carrying the SAME
//                         per-reel hash-chain as the Mongo path (_id = computeHash(p, contentOf)).
//   .head                 {head, headHash} beside each reel — the seq counter + chain root.
//                         (Replaces ReelHead's $inc + denormalized headHash.)
//   [head snapshots + derived indexes are a later phase — rebuildable fold over the reels.]
//
// One-word note: at the one-word target every record carries ONE fact; the record holds a LIST
// only to tolerate the legacy multi-fact (run-on) moments still mid-conversion (Phase A). seq/p/_id
// are computed at APPLY time from the .head (never stored in the record) — that is what makes
// replay a no-op when a record already landed (the _id is already the reel's head line).
//
// Single-writer: ONE global commit mutex serializes commitMoment, so per-reel .reel/.head are
// single-writer by construction (no append lock needed). One stamper process owns the data dir.
//
// Reuses past/fact/hash.js so a reel file is byte-for-byte fold- and verify-compatible with the
// facts the Mongo stamper wrote — the swap is a STORAGE change, not a fact-shape change.

import {
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  writeSync,
  readFileSync,
  existsSync,
  appendFileSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeHash, contentOf, GENESIS_PREV } from "./fact/hash.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── data root + STORIES ────────────────────────────────────────────────────
// A "story" is the file equivalent of a Mongo database name: a subfolder under <story>/store/. The
// MAIN/default story is `store/past` (Tabor: "main one is just past and default"); a NAMED story is
// `store/<name>` — so multiple stories (test isolation, exactly like Mongo's per-test DBs) coexist as
// sibling folders, no renaming. Each holds its own chain (reels/ + journal/). CAS (store/cas) is
// shared across stories — content-addressed, so cross-story dedup is correct.
// From seed/past/ → ../../ is <story>, then store.
const STORE_BASE = process.env.TREEOS_STORE_BASE || resolve(__dirname, "../../store");
const DEFAULT_STORY = "past"; // the main story's folder is literally `past`

let ROOT = process.env.TREEOS_STORE_ROOT || join(STORE_BASE, DEFAULT_STORY);

// ── append ordinal: the cross-reel order, clock-free (Fork 1 of the clock removal) ──────────────
// An act's POSITION in the single append-only commit order. withCommitLock serializes every commit, so
// this counter is monotonic AND causally correct under ONE writer (nothing commits "before" a thing it
// causally depends on). It is NOT a clock: reproducible (replay the journal → same order), caused (write
// order respects causality), and it never reads a wall — the "wordstamp as a number" that a prior act wall-clock was
// faking. LOCAL ONLY: it totally-orders THIS story's acts; across federated/sovereign stories there is
// no global order, only causal links (partial, the inReplyTo/rootCorrelation tree). Never read `ord` as
// a universal timeline. Restored lazily from the max ord already on the act-logs — the acts ARE the
// record, so there is no separate counter file to drift out of sync with them.
let _ordCounter = null;
function nextOrd() {
  if (_ordCounter == null) {
    let max = 0;
    try {
      for (const a of listAllActs()) {
        const o = Number(a?.ord);
        if (Number.isFinite(o) && o > max) max = o;
      }
    } catch {}
    _ordCounter = max;
  }
  return ++_ordCounter;
}

// currentOrd() . the latest committed append ordinal WITHOUT consuming a new
// position. Read-only peek at the same counter nextOrd() advances, restored
// lazily from the act-logs (the acts ARE the record) on first call. A
// moment-LESS writer (a fact stamped outside a moment, so commitMoment gets no
// act and stamps no ord on the fact) reads this to learn the arrival ordinal it
// sits just after, and threads it as the entry's order key. It never advances
// the counter (a peek, not an allocation), so it cannot collide with the next
// real commit's nextOrd(). Returns 0 before any act has committed.
export function currentOrd() {
  if (_ordCounter == null) {
    let max = 0;
    try {
      for (const a of listAllActs()) {
        const o = Number(a?.ord);
        if (Number.isFinite(o) && o > max) max = o;
      }
    } catch {}
    _ordCounter = max;
  }
  return _ordCounter;
}

// Run-on fan-out census: acts that lay facts across >1 reel (the journal's old reason to exist). The
// no-journal floor's tail-truncation recovery is only atomic with ONE reel per act, so these must be
// decomposed to one-word; until then commitMoment warns + records them here. Read via fanOutRunOns().
const _fanOutRunOns = new Set();
export function fanOutRunOns() {
  return [..._fanOutRunOns];
}

// Point the engine at a story (no mongod, no URI):
//   { root }   explicit dir override (tests use a temp dir) — wins over story.
//   { story }  a story name → store/<story>; "past"/"main"/absent → store/past (the default).
// Sanitized so a story name can never escape the store base (no path traversal).
export function configureStore({ root, story } = {}) {
  if (root) ROOT = String(root);
  else if (story && story !== DEFAULT_STORY && story !== "main")
    ROOT = join(STORE_BASE, String(story).replace(/[^A-Za-z0-9._-]/g, "_"));
  else ROOT = join(STORE_BASE, DEFAULT_STORY);
  mkdirSync(join(ROOT, "reels"), { recursive: true });
  _ordCounter = null; // re-restore the append ordinal lazily for the (possibly new) store
  return ROOT;
}
export function storeRoot() {
  return ROOT;
}
export function storeBase() {
  return STORE_BASE;
}

// wipeChain() — remove the on-disk chain (reels + acts + journal + the derived
// index) under the current story root. The FileStore peer of plantGraft's
// unplant deleteMany over the chain collections: when a verbatim plant fails
// verification it must restore the void it started from (plant gates on an
// EMPTY store, so "back to before" is emptiness). Idempotent (missing dirs are
// a no-op). Does NOT touch the shared CAS (content-addressed; the retention
// sweeper owns orphans) nor the history FileCollection (proj/history) — the
// caller clears that through its curated seam.
export function wipeChain() {
  for (const sub of ["reels", "acts", "journal", "index"]) {
    try {
      rmSync(join(ROOT, sub), { recursive: true, force: true });
    } catch {
      /* missing dir — nothing to wipe */
    }
  }
}

// ── paths ────────────────────────────────────────────────────────────────
// 2-char shard so no directory holds millions of reels; .reel + .head share one dir.
function shard(id) {
  const s = String(id);
  return s.length >= 2 ? s.slice(0, 2) : s.padEnd(2, "_");
}
function reelDir(history, kind, id) {
  return join(ROOT, "reels", String(history), String(kind), shard(id));
}
function reelPath(history, kind, id) {
  return join(reelDir(history, kind, id), `${id}.reel`);
}
function headPath(history, kind, id) {
  return join(reelDir(history, kind, id), `${id}.head`);
}

// ── durable append helper ──────────────────────────────────────────────────
// Append bytes to a file and fsync both the file AND its directory (so the entry
// survives a crash — a fsync'd file in an un-fsync'd dir can vanish on some FS).
function durableAppend(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// ── reel head (seq counter + chain root) ────────────────────────────────────
export function readReelHead(history, kind, id) {
  const p = headPath(history, kind, id);
  if (!existsSync(p)) return { head: 0, headHash: GENESIS_PREV };
  try {
    const h = JSON.parse(readFileSync(p, "utf8"));
    return {
      head: Number.isFinite(h.head) ? h.head : 0,
      headHash: typeof h.headHash === "string" ? h.headHash : GENESIS_PREV,
    };
  } catch {
    return { head: 0, headHash: GENESIS_PREV };
  }
}
// The .head is NOT the stamp (Tabor): STAMPING IS THE ACT — appending the fact line is the act, and
// the fact (the line) is what's stamped; it's stamped the moment it's a fact on the reel. The head is
// a DERIVED pointer — the read of where the reel's head sits (last line's seq + _id) — rebuildable by
// scanning the reel to its end. We persist + fsync it only so seq-allocation and root-hash reads are
// O(1) instead of a full rescan each boot; on any doubt it's reconstructed from the reel (the truth).
function writeReelHead(history, kind, id, head, headHash) {
  const p = headPath(history, kind, id);
  mkdirSync(dirname(p), { recursive: true });
  const fd = openSync(p, "w");
  try {
    writeSync(fd, JSON.stringify({ head, headHash }) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// ── compute a fact's full identity (seq + p + _id) from a head snapshot ──────
// Pure given (spec, head): seq = head.head+1, p = head.headHash (single-writer ⇒ the head IS seq-1's
// identity; lineage walk across histories is a later phase), _id = computeHash(p, contentOf). Returns
// the FULL fact doc (what a reel line is) + the next head. The identity is computed ONCE at commit
// and carried in the WAL record, so replay never re-derives it against a moved head (the bug a
// recompute-at-replay would cause: a duplicate at a fresh seq).
function computeFactDoc(history, kind, id, spec, head) {
  const seq = head.head + 1;
  const p = head.headHash;
  const factHistory =
    typeof spec.history === "string" && spec.history.length ? spec.history : String(history);
  const full = { ...spec, history: factHistory, seq, p };
  const _id = computeHash(p, contentOf(full));
  return { doc: { _id, p, seq, ...full }, nextHead: { head: seq, headHash: _id } };
}

// Write a FULLY-IDENTIFIED fact doc to its reel. The reel-line APPEND is THE STAMP — the act of
// laying the fact mark; it is stamped the moment it's a line on the reel. The head write that follows
// just advances the derived pointer. Idempotent by per-reel seq: if the reel already reached this
// seq, the fact landed on a prior (possibly crashed-then-replayed) pass — skip. That makes journal
// replay a no-op for already-applied records and an append for un-applied ones.
function writeFactDoc(history, kind, id, doc) {
  const cur = readReelHead(history, kind, id);
  if (cur.head >= doc.seq) return { _id: doc._id, seq: doc.seq, replayed: true };
  durableAppend(reelPath(history, kind, id), JSON.stringify(doc) + "\n"); // ← the stamp (lay the fact)
  writeReelHead(history, kind, id, doc.seq, doc._id); // advance the derived head pointer
  return { _id: doc._id, seq: doc.seq, replayed: false };
}

// Truncate a reel back to seq <= keepSeq — the rollback primitive for a verbatim INSTATE that
// failed partway (book/graft receive). A normal stamp is never undone (the chain only grows), but a
// transplant lands a tail of foreign facts under an application-level landed[] rollback; if a later
// step throws, the receiver's pre-existing chain must be left EXACTLY as it was. An append-only reel
// can't shed a tail by skipping a head pointer alone (the orphaned lines stay physically on the reel
// and would re-surface in readReel/dedup), so we rewrite the file keeping only the kept prefix and
// reset the .head to that prefix's tip (GENESIS_PREV when keepSeq <= 0). Single-writer ⇒ no lock.
// Returns the head after truncation. A no-op when the reel is already at/below keepSeq.
export function truncateReelTo(history, kind, id, keepSeq) {
  const p = reelPath(history, kind, id);
  if (!existsSync(p)) return readReelHead(history, kind, id);
  const kept = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line) continue;
    let f;
    try {
      f = JSON.parse(line);
    } catch {
      continue;
    }
    if (f.seq <= keepSeq) kept.push(line);
  }
  // Rewrite the reel file (fsync) with only the kept prefix.
  mkdirSync(dirname(p), { recursive: true });
  const fd = openSync(p, "w");
  try {
    writeSync(fd, kept.length ? kept.join("\n") + "\n" : "");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Reset the derived head to the kept tip (or genesis when nothing kept).
  if (kept.length) {
    const tip = JSON.parse(kept[kept.length - 1]);
    writeReelHead(history, kind, id, tip.seq, tip._id);
    return { head: tip.seq, headHash: tip._id };
  }
  writeReelHead(history, kind, id, 0, GENESIS_PREV);
  return { head: 0, headHash: GENESIS_PREV };
}

// ── read a reel back (the readReelBetween substrate) ────────────────────────
// Returns the facts on (history,kind,id) with afterSeq < seq <= untilSeq, in seq order. Lines are
// already seq-ascending (single-writer appends in order). Lineage range-union across histories is a
// later phase (mirrors foldEngine.readReelBetween); this is the own-history read.
export function readReel(history, kind, id, afterSeq = null, untilSeq = null) {
  const p = reelPath(history, kind, id);
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line) continue;
    let f;
    try {
      f = JSON.parse(line);
    } catch {
      continue;
    }
    if (afterSeq != null && !(f.seq > afterSeq)) continue;
    if (untilSeq != null && !(f.seq <= untilSeq)) continue;
    out.push(f);
  }
  return out;
}

// ── reel enumeration (the cross-reel scan substrate) ─────────────────────────
// The reels of a (history, kind) live under reels/<history>/<kind>/<shard>/<id>.reel. A few CURATED
// readers fold ACROSS reels in one history — the world/book read (every fact in a branch, all
// kinds, all authors), graft's whole-genome dump. There is no per-reel index for "every reel of a
// kind" (the reels ARE the truth; the .proj/index caches are per-aggregate), so these scan the
// directory. listReelKinds(history) → the reel-kinds present under a history (the dir names);
// listReelIds(history, kind) → the reel ids of that kind (one per <id>.reel file). Both are pure
// directory reads; missing dirs return []. The caller (facts.js) unions them into a world fact read.
export function listReelKinds(history) {
  const dir = join(ROOT, "reels", String(history));
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
export function listReelIds(history, kind) {
  const dir = join(ROOT, "reels", String(history), String(kind));
  if (!existsSync(dir)) return [];
  const out = [];
  let shards;
  try {
    shards = readdirSync(dir);
  } catch {
    return [];
  }
  for (const shardName of shards) {
    let files;
    try {
      files = readdirSync(join(dir, shardName));
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith(".reel")) out.push(f.slice(0, -".reel".length));
    }
  }
  return out;
}

// ── predicate read: readReel + filter (the Fact.find substrate) ──────────────
// Read (history,kind,id) and keep only the facts the predicate accepts, in seq order. This is the
// file-native peer of the Mongo Fact.find({...}) the chokepoints can't express as a single seq range:
// the verb/act/params filters wordStore's coin/retire reads run on I's being-reel (verb==="do",
// act==="coin", params.word===X). The caller writes the predicate; this file stays domain-free.
//   predicate  (fact) => boolean
export function readReelWhere(history, kind, id, predicate) {
  const out = [];
  for (const f of readReel(history, kind, id)) if (predicate(f)) out.push(f);
  return out;
}

// ── facts laid by one act (the Fact.find({ actId }) substrate) ───────────────
// "What facts did this moment lay?" Under the one-word doctrine a moment lays ONE fact (multi-fact
// only at the I-Am root), so this is usually 0..1 — but the scan is general. The actor's facts ride
// the actor's own being-reel, so we read that reel and keep the facts carrying this actId.
//   factsByActId(history, actorBeingId, actId) -> fact[]
export function factsByActId(history, actorBeingId, actId) {
  if (actId == null) return [];
  return readReelWhere(history, "being", actorBeingId, (f) => f.actId === actId);
}

// ── BRANCH-AWARE read: union a story's lineage (Tabor: "past splits by branches") ───────────
// A branch (a non-main story/history) forks from its parent at a branchPoint PER REEL, and stores
// ONLY its own divergent facts under reels/<history>/... — it never copies the parent's prefix. So a
// read on a branch is a UNION: the parent lineage up to each branchPoint, then the branch's own tail.
// This is the file-native peer of foldEngine.readReelBetween's OR-of-ranges, and it's PURE given:
//   lineage  main→leaf history ids, e.g. ["0","1","1a"]
//   floors   history -> the seq it forked at for THIS reel (floors["0"]=0); history h OWNS (floor_h, floor_next]
// The caller resolves lineage + floors (materials/history/histories.js) and passes them in, so all
// branch logic lives in ONE function and this file stays boot-free. The result is seq-ascending:
// each history's owned range is contiguous, and the ranges chain across the forks.
//
// WRITE-SIDE COMPANIONS (the next-session seam, mirroring the Mongo path's reelHeads/prevHashAt):
//   (1) seed a new branch's .head to its branchPoint so its first fact gets seq branchPoint+1
//       (reelHeads.allocSeq's $setOnInsert seed-from-parent);
//   (2) for that first divergent fact, set p to the PARENT's fact at the branchPoint, not this
//       history's empty head — the cross-fork link verifyReelFile checks (facts.js prevHashAt). Both
//       want the same (lineage, floors) inputs as this read; resolve once, thread to computeFactDoc.
export function readReelLineage(lineage, floors, kind, id, afterSeq = null, untilSeq = null) {
  const out = [];
  for (let i = 0; i < lineage.length; i++) {
    const h = String(lineage[i]);
    const lo = Number.isFinite(floors?.[h]) ? floors[h] : 0; // h owns (lo, hi]
    const nextH = i + 1 < lineage.length ? String(lineage[i + 1]) : null;
    const hi = nextH && Number.isFinite(floors?.[nextH]) ? floors[nextH] : null;
    const lower = afterSeq != null ? Math.max(lo, afterSeq) : lo;
    const upper =
      untilSeq != null && hi != null ? Math.min(hi, untilSeq) : untilSeq != null ? untilSeq : hi;
    for (const f of readReel(h, kind, id, lower, upper)) out.push(f);
  }
  return out;
}

// ── verify a reel file's hash-chain (the verifyReel.js peer, on files) ──────
// Recompute each fact's _id from its p + content and confirm the p-links form one chain. Returns
// { ok, length, brokenAt }. This is the integrity proof the whole storage swap rests on.
function verifyFactChain(facts) {
  let prev = GENESIS_PREV;
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    if (f.p !== prev) return { ok: false, length: facts.length, brokenAt: i, reason: "p-link" };
    if (computeHash(f.p, contentOf(f)) !== f._id)
      return { ok: false, length: facts.length, brokenAt: i, reason: "hash" };
    if (f.seq !== i + 1) return { ok: false, length: facts.length, brokenAt: i, reason: "seq" };
    prev = f._id;
  }
  return { ok: true, length: facts.length, brokenAt: -1 };
}
// Verify one history's own reel.
export function verifyReelFile(history, kind, id) {
  return verifyFactChain(readReel(history, kind, id));
}
// Verify a BRANCH's unioned chain across its forks — main prefix + branch tail, with each branch's
// first fact's p chaining to the parent's fact at the branchPoint (the cross-fork link). The union's
// seqs are contiguous (a branch continues from branchPoint+1), so the same chain check applies.
export function verifyReelLineage(lineage, floors, kind, id) {
  return verifyFactChain(readReelLineage(lineage, floors, kind, id));
}

// ── fork a reel onto a branch (the write-side of branching, Tabor's note) ───────────────────────
// Branching is NOT copying: a new branch seeds its .head from the PARENT's fact at the branchPoint,
// so the branch's very first append gets seq = branchPoint+1 with p = that parent fact's _id — the
// cross-fork link falls out of normal appendFact (no special-case write path). Each branch then holds
// only its own divergent tail under reels/<branch>/... Idempotent: a second fork is a no-op. Mirrors
// reelHeads.allocSeq's seed-from-parent + prevHashAt's lineage link, on files.
export function forkReel(branchHistory, parentHistory, kind, id, branchPoint) {
  if (existsSync(headPath(branchHistory, kind, id)))
    return readReelHead(branchHistory, kind, id); // already forked
  const at = readReel(parentHistory, kind, id, branchPoint - 1, branchPoint); // the parent fact AT branchPoint
  const tipHash = at.length ? at[at.length - 1]._id : GENESIS_PREV;
  writeReelHead(branchHistory, kind, id, branchPoint, tipHash);
  return { head: branchPoint, headHash: tipHash };
}

// ── projection snapshots (.proj) — the folded-state CACHE backing projections.js ────────────────
// A snapshot is the reducer's folded state for a (history,kind,id) — what Mongo's projection doc held
// (state, foldedSeq, position, tombstoned). It is a CACHE, rebuildable by folding the reel; never
// truth. Backs projections.loadProjection / saveProjection / initProjection / tombstoneProjection.
function snapPath(history, kind, id) {
  return join(reelDir(history, kind, id), `${id}.proj`);
}
export function loadSnapshot(history, kind, id) {
  const p = snapPath(history, kind, id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
// CAS-guarded write: when expectedFoldedSeq is given, only advance if the on-disk foldedSeq matches
// (mirrors projections.saveProjection's compare-and-set — a stale concurrent fold loses, the next
// fold catches up). Returns true if written.
export function saveSnapshot(history, kind, id, slot, expectedFoldedSeq = undefined) {
  const old = loadSnapshot(history, kind, id);
  if (expectedFoldedSeq !== undefined) {
    if (old && old.foldedSeq !== expectedFoldedSeq) return false;
  }
  const p = snapPath(history, kind, id);
  mkdirSync(dirname(p), { recursive: true });
  const fd = openSync(p, "w");
  try {
    writeSync(fd, JSON.stringify(slot) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Keep the derived index consistent with the .proj snapshots: diff old→new and
  // re-bucket this id. The index is rebuildable (rebuildIndex), never truth.
  updateIndexFromSlot(history, kind, id, old, slot);
  return true;
}
export function initSnapshot(history, kind, id, slot) {
  return saveSnapshot(history, kind, id, slot); // unconditional upsert (cold-fold landing)
}

// ── the act-log (the act-chain, peer of the reel files) ─────────────────────
// A being's ACTS are their own per-being JSONL chain, a sibling to the reel files. Where the reel
// chains FACTS (the stamps a being received in a world), the act-log chains the ACTS a being
// authored — the souls the stamper rasterizes into facts. Each act is one JSONL line under
// acts/<story>/<historySafe>/<being2>/<being>.acts; the chain head sits in a .acthead beside it and
// advances under a CAS (so a stale author can't fork the chain). Durable like the reel append.
//
// path-safety: each segment is sanitized so a hostile story/history/being can never escape the acts
// root (no path traversal); the being also gets a 2-char shard so no directory holds millions.
function pathSafe(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, "_") || "_";
}
function actDir(story, history, being) {
  return join(ROOT, "acts", pathSafe(story), pathSafe(history), shard(pathSafe(being)));
}
function actLogPath(story, history, being) {
  return join(actDir(story, history, being), `${pathSafe(being)}.acts`);
}
function actHeadPath(story, history, being) {
  return join(actDir(story, history, being), `${pathSafe(being)}.acthead`);
}

// Append actDoc as one JSONL line to the being's act-log. Durable (fsync file + dir), like the reel
// append. Returns the byte length appended (a thin witness for callers/tests).
//
// The same call maintains the derived ACT INDEX (the cross-being/cross-history lookups the Mongo Act
// secondary indexes served): actId → location, and the inverted facet maps (rootCorrelation /
// inReplyTo / through / to / activeAble / ibpAddress / answers → [actId]). The index is single-writer
// (the commit mutex) and rebuildable from the .acts logs (rebuildActIndex), so a missing/corrupt
// index is never a loss of truth.
export function appendActLine(story, history, being, actDoc) {
  const line = JSON.stringify(actDoc) + "\n";
  durableAppend(actLogPath(story, history, being), line);
  indexActDoc(story, history, being, actDoc);
  return { bytes: Buffer.byteLength(line, "utf8") };
}

// Read the being's act-chain head. The head is the last act's id (GENESIS_PREV if the chain is
// empty) — a DERIVED pointer, rebuildable by scanning the act-log to its end. Persisted + fsync'd
// (in advanceActHeadFile) only so the CAS read is O(1).
export function readActHeadFile(story, history, being) {
  const p = actHeadPath(story, history, being);
  if (!existsSync(p)) return GENESIS_PREV;
  try {
    const h = readFileSync(p, "utf8").trim();
    return h.length ? h : GENESIS_PREV;
  } catch {
    return GENESIS_PREV;
  }
}

// Advance the act-chain head under a compare-and-set: only move the head if the on-disk head equals
// the author's expected prev. A stale author (whose expectPrev no longer matches) is REFUSED with
// ACT_CHAIN_MOVED — the chain can't fork. Idempotent: if the head already IS actId, this is a
// settled replay (the prior advance landed, the ack just hadn't recorded it) → no-op, no throw.
export function advanceActHeadFile(story, history, being, actId, expectPrev) {
  const cur = readActHeadFile(story, history, being);
  if (cur === actId) return { head: actId, replayed: true }; // settled replay — already advanced
  if (cur !== expectPrev) throw new Error("ACT_CHAIN_MOVED");
  const p = actHeadPath(story, history, being);
  mkdirSync(dirname(p), { recursive: true });
  const fd = openSync(p, "w");
  try {
    writeSync(fd, String(actId) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return { head: actId, replayed: false };
}

// Instate VERBATIM acts — a graft/plant transplant of one being's act-chain on a (story, history),
// the act-log peer of commitVerbatim. Unlike the live seal path (assign mints p / sealAct advances
// under a CAS), these acts arrive carrying their ORIGINAL identity from the source story and land
// byte-for-byte: append each .acts line (and index it) in chain order, then SET the .acthead to the
// supplied tip (the bundle's actHead.headHash). Idempotent: appendActLine never double-buckets an
// actId, and the head set is the tip regardless. The caller (plantGraft) runs the freshness gate and
// the post-plant chain walk; this is the raw verbatim write.
//   actDocs  the being's acts (chain-ordered); headHash  the chain tip to pin (null ⇒ leave at last).
export function instateActsVerbatim(story, history, being, actDocs = [], headHash = null) {
  for (const a of actDocs) {
    if (a && a._id != null) appendActLine(story, history, being, a);
  }
  const tip = headHash != null ? String(headHash) : null;
  if (tip) {
    const p = actHeadPath(story, history, being);
    mkdirSync(dirname(p), { recursive: true });
    const fd = openSync(p, "w");
    try {
      writeSync(fd, tip + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  return { count: actDocs.length, head: readActHeadFile(story, history, being) };
}

// ── the derived ACT INDEX (rebuildable — backs actChain.js act-query layer) ──
// The reels' index has a peer here: the act-log is partitioned per (story, history, being), but the
// Mongo Act collection answered CROSS-being/CROSS-history queries (every act in a rootCorrelation,
// every reply to an act, every act a being authored). So the act index lives PER STORY, spanning its
// histories + beings:
//   acts/<story>/_index/id.json        actId  → { history, being }   (the line's location)
//   acts/<story>/_index/<facet>.json   value  → [actId, ...]         (the inverted lookups)
// where facet ∈ {rootCorrelation, inReplyTo, through, to, activeAble, ibpAddress, answers}. Single-
// writer (the commit mutex) ⇒ no lock. Rebuildable by scanning the .acts logs (rebuildActIndex).
const ACT_FACETS = [
  "rootCorrelation",
  "inReplyTo",
  "through",
  "to",
  "activeAble",
  "ibpAddress",
  "answers",
];
function actIndexDir(story) {
  return join(ROOT, "acts", pathSafe(story), "_index");
}
function actIndexPath(story, facet) {
  return join(actIndexDir(story), `${pathSafe(facet)}.json`);
}
function loadActIndex(story, facet) {
  const p = actIndexPath(story, facet);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) || {};
  } catch {
    return {};
  }
}
function saveActIndex(story, facet, map) {
  const p = actIndexPath(story, facet);
  mkdirSync(dirname(p), { recursive: true });
  const fd = openSync(p, "w");
  try {
    writeSync(fd, JSON.stringify(map) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Maintain every act-index facet for one appended act. actId → {history, being} (the location read
// primitives use to find the line); each facet value → the actId appended to its bucket. Idempotent
// per facet value (an actId never double-buckets), so a re-append (settled replay) is a no-op.
export function indexActDoc(story, history, being, actDoc) {
  const actId = actDoc?._id != null ? String(actDoc._id) : null;
  if (!actId) return;
  {
    const m = loadActIndex(story, "id");
    m[actId] = { history: String(history), being: String(being) };
    saveActIndex(story, "id", m);
  }
  for (const facet of ACT_FACETS) {
    const v = actDoc?.[facet];
    if (v == null || v === "") continue;
    const m = loadActIndex(story, facet);
    setAdd(m, String(v), actId);
    saveActIndex(story, facet, m);
  }
}

// ── post-seal act PATCH OVERLAY (generic store primitive; no current writer) ──
// An act-log line is append-only, so any post-seal field write would be an OVERLAY file beside the
// logs, keyed by actId; reads merge it over the logged line (readActLog). This is the file-native peer
// of Mongo's Act.findOneAndUpdate, NOT part of the act's content hash (the hash was over the OPENING),
// so it never changes the act's identity. There is no caller today: a sealed act is immutable (an act
// is present, a fact is past). The former writers (status, innerFace, the thread-cut severedAt) were
// all retired; the overlay machinery is kept generic for any future closure field that earns one.
function actPatchPath(story, actId) {
  return join(ROOT, "acts", pathSafe(story), "_patches", shard(pathSafe(actId)), `${pathSafe(actId)}.json`);
}
function loadActPatch(story, actId) {
  const p = actPatchPath(story, actId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
// Merge a partial onto the act's patch overlay (shallow merge; last write wins per key). Returns the
// merged patch. The raw store write for the overlay; a caller would hold any monotonic-transition
// guard. No caller today (acts are immutable). Single-writer ⇒ the load→merge→save is atomic.
export function patchAct(story, actId, partial) {
  if (actId == null || !partial || typeof partial !== "object") return null;
  const id = String(actId);
  const cur = loadActPatch(story, id) || {};
  const next = { ...cur, ...partial };
  const p = actPatchPath(story, id);
  mkdirSync(dirname(p), { recursive: true });
  const fd = openSync(p, "w");
  try {
    writeSync(fd, JSON.stringify(next) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return next;
}

// ── act reads (the file-native peer of Act.find*) ───────────────────────────
// Scan one being's act-log and return its acts (oldest-first; the log is append-order). Each is the
// logged line with any patch overlay merged on top (the overlay has no writer today; see above).
function readActLog(story, history, being) {
  const p = actLogPath(story, history, being);
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line) continue;
    let a;
    try {
      a = JSON.parse(line);
    } catch {
      continue;
    }
    const patch = a?._id != null ? loadActPatch(story, String(a._id)) : null;
    out.push(patch ? { ...a, ...patch } : a);
  }
  return out;
}

// readActById(story, actId) → the act doc (patch-merged), or null. O(1) location via the id index,
// then a single being-log scan for the line.
export function readActById(story, actId) {
  if (actId == null) return null;
  const id = String(actId);
  const loc = loadActIndex(story, "id")[id];
  if (!loc) return null;
  for (const a of readActLog(story, loc.history, loc.being)) {
    if (String(a._id) === id) return a;
  }
  return null;
}

// actsByField(story, facet, value) → every act carrying that facet value (patch-merged), in index
// order. facet ∈ ACT_FACETS (rootCorrelation/inReplyTo/through/to/activeAble/ibpAddress/answers).
export function actsByField(story, facet, value) {
  if (!ACT_FACETS.includes(facet) || value == null) return [];
  const ids = loadActIndex(story, facet)[String(value)];
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const a = readActById(story, id);
    if (a) out.push(a);
  }
  return out;
}

// actsByCorrelation(story, rootCorrelation) → the whole chain sharing one rootCorrelation (the
// rootCorrelation walk I uses for cancellation + conversation grouping).
export function actsByCorrelation(story, rootCorrelation) {
  return actsByField(story, "rootCorrelation", rootCorrelation);
}

// readActChain(story, history, being) → one being's authored acts on a (story, history), append-
// order (oldest-first), patch-merged. The own-(story,history) read; the lineage union across parent
// histories lives in the curated actChain.js layer (like readReel vs readReelLineage).
export function readActChain(story, history, being) {
  return readActLog(story, history, being);
}

// actCount(story, filter) → number of acts matching a single-facet equality filter (or ALL acts in
// the story when filter is empty/absent). filter is { <facet>: value } for an ACT_FACET, or
// { _id: actId } for an existence count. Mirrors Mongo Act.countDocuments for the shapes callers use.
export function actCount(story, filter = {}) {
  const keys = filter && typeof filter === "object" ? Object.keys(filter) : [];
  if (keys.length === 0) {
    // count every located act (the id index has one entry per act in the story)
    return Object.keys(loadActIndex(story, "id")).length;
  }
  if (keys.length === 1) {
    const k = keys[0];
    if (k === "_id") return readActById(story, filter._id) ? 1 : 0;
    if (ACT_FACETS.includes(k)) {
      const ids = loadActIndex(story, k)[String(filter[k])];
      return Array.isArray(ids) ? ids.length : 0;
    }
  }
  // multi-key / unsupported facet: fall back to a count over the matching first-facet bucket
  const k = keys.find((x) => ACT_FACETS.includes(x));
  if (!k) return 0;
  const ids = loadActIndex(story, k)[String(filter[k])];
  if (!Array.isArray(ids)) return 0;
  let n = 0;
  for (const id of ids) {
    const a = readActById(story, id);
    if (a && keys.every((kk) => kk === k || String(a[kk]) === String(filter[kk]))) n++;
  }
  return n;
}

// rebuildActIndex(story) — re-derive the act index by scanning every .acts log under the story. Proves
// the rebuildable property (the index is a pure function of the logs). Patches are left untouched
// (they overlay the logs, not the index).
export function rebuildActIndex(story) {
  for (const facet of ["id", ...ACT_FACETS]) saveActIndex(story, facet, {});
  const storyDir = join(ROOT, "acts", pathSafe(story));
  if (!existsSync(storyDir)) return { rebuilt: 0 };
  let rebuilt = 0;
  for (const histName of readdirSync(storyDir)) {
    if (histName === "_index" || histName === "_patches") continue;
    const histDir = join(storyDir, histName);
    let shardDirs;
    try {
      shardDirs = readdirSync(histDir);
    } catch {
      continue;
    }
    for (const shardName of shardDirs) {
      const shardDir = join(histDir, shardName);
      let files;
      try {
        files = readdirSync(shardDir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".acts")) continue;
        const being = f.slice(0, -".acts".length);
        for (const line of readFileSync(join(shardDir, f), "utf8").split("\n")) {
          if (!line) continue;
          let a;
          try {
            a = JSON.parse(line);
          } catch {
            continue;
          }
          indexActDoc(story, histName, being, a);
          rebuilt++;
        }
      }
    }
  }
  return { rebuilt };
}

// ── the derived INDEX (rebuildable — backs projections.js find* queries) ─────
// The reels are truth; the .proj snapshots are the folded-state cache; this index is a cache OF that
// cache — the inverted lookups (name→id, space→occupants, parent→children, kind→ids, heavenSpace→id)
// that Mongo served from secondary indexes. It is maintained incrementally: every saveSnapshot /
// initSnapshot diffs old→new slot and re-buckets the id (updateIndexFromSlot). It is fully
// rebuildable from the reels (rebuildIndex), so a corrupt/missing index is never a loss of truth.
//
// One JSON file per (history, kind, facet) at index/<historySafe>/<kind>.<facet>.json. Each is a
// plain map; values are either a single id (name, heavenSpace — unique per key) or an id-array
// (position, parent, type — many per key). Single-writer (the commit mutex) ⇒ no lock needed.
function indexDir(history) {
  return join(ROOT, "index", pathSafe(history));
}
function indexPath(history, kind, facet) {
  return join(indexDir(history), `${pathSafe(kind)}.${pathSafe(facet)}.json`);
}
function loadIndex(history, kind, facet) {
  const p = indexPath(history, kind, facet);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) || {};
  } catch {
    return {};
  }
}
function saveIndex(history, kind, facet, map) {
  const p = indexPath(history, kind, facet);
  mkdirSync(dirname(p), { recursive: true });
  const fd = openSync(p, "w");
  try {
    writeSync(fd, JSON.stringify(map) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Scope the name key so per-kind name uniqueness matches the Mongo partial indexes: beings are
// global per history; spaces are scoped by their parent space; matter is scoped by (spaceId,
// parentMatterId) folder. The key folds the scope in so two folders may both hold a "config".
function nameKey(kind, state) {
  if (kind === "space") return `${state?.parent ?? ""} ${state?.name}`;
  if (kind === "matter")
    return `${state?.spaceId ?? ""} ${state?.parentMatterId ?? ""} ${state?.name}`;
  return String(state?.name);
}
// The parent key per kind (being→parentBeingId, space→parent, matter→parentMatterId).
function parentOf(kind, state) {
  if (kind === "being") return state?.parentBeingId ?? null;
  if (kind === "space") return state?.parent ?? null;
  if (kind === "matter") return state?.parentMatterId ?? null;
  return null;
}
function setRemove(map, key, id) {
  if (key == null) return;
  const arr = map[key];
  if (!Array.isArray(arr)) return;
  const next = arr.filter((x) => x !== id);
  if (next.length) map[key] = next;
  else delete map[key];
}
function setAdd(map, key, id) {
  if (key == null) return;
  const arr = Array.isArray(map[key]) ? map[key] : [];
  if (!arr.includes(id)) arr.push(id);
  map[key] = arr;
}

// Diff old→new slot and re-bucket `id` across every facet index. Called by saveSnapshot /
// initSnapshot so the index tracks the .proj snapshots. A tombstoned slot is REMOVED from every live
// index (so tombstones never leak into a find); a live slot is (re-)added at its new keys.
export function updateIndexFromSlot(history, kind, id, oldSlot, newSlot) {
  const oldState = oldSlot?.state || {};
  const newState = newSlot?.state || {};
  const oldDead = !oldSlot || oldSlot.tombstoned;
  const newDead = !newSlot || newSlot.tombstoned;

  // name (unique per scoped key → single id value)
  {
    const m = loadIndex(history, kind, "name");
    if (!oldDead && oldState.name != null) {
      const k = nameKey(kind, oldState);
      if (m[k] === id) delete m[k];
    }
    if (!newDead && newState.name != null) m[nameKey(kind, newState)] = id;
    saveIndex(history, kind, "name", m);
  }
  // position (space → many occupants). slot.position is the spaceId.
  {
    const m = loadIndex(history, kind, "position");
    if (!oldDead) setRemove(m, oldSlot?.position ?? null, id);
    if (!newDead && newSlot?.position != null) setAdd(m, newSlot.position, id);
    saveIndex(history, kind, "position", m);
  }
  // parent (parentBeingId / parent / parentMatterId → many children)
  {
    const m = loadIndex(history, kind, "parent");
    if (!oldDead) setRemove(m, parentOf(kind, oldState), id);
    if (!newDead) setAdd(m, parentOf(kind, newState), id);
    saveIndex(history, kind, "parent", m);
  }
  // type (kind → all live ids of this kind). Tombstoned ids drop out.
  {
    const m = loadIndex(history, kind, "type");
    if (newDead) setRemove(m, kind, id);
    else setAdd(m, kind, id);
    saveIndex(history, kind, "type", m);
  }
  // heavenSpace (state.heavenSpace → the one space id; singleton per kind/key)
  {
    const m = loadIndex(history, kind, "heavenSpace");
    if (!oldDead && oldState.heavenSpace != null && m[oldState.heavenSpace] === id)
      delete m[oldState.heavenSpace];
    if (!newDead && newState.heavenSpace != null) m[newState.heavenSpace] = id;
    saveIndex(history, kind, "heavenSpace", m);
  }
}

// ── find* queries (own-history; lineage inheritance is a follow-up) ──────────
// These read the inverted index → an id (or ids) → the .proj snapshot(s). Own-history only: the
// lazy parent-lineage walk projections.js does (findByName/findByParent/listByType recursing into
// the parent history) is a TODO — resolve (lineage, floors) like readReelLineage and union the
// per-history index reads. The own-history path is clean now.

// findByName(history, kind, name) → the slot (with id), or null.
export function findByName(history, kind, name, scope = {}) {
  if (name == null) return null;
  const m = loadIndex(history, kind, "name");
  // Most callers pass a bare name; for scoped kinds we honor an optional scope to disambiguate.
  const probe =
    kind === "being" ? String(name) : nameKey(kind, { ...scope, name });
  let id = m[probe] !== undefined ? m[probe] : m[String(name)];
  // Parent-agnostic fallback (a Mongo-parity restore): the scoped index key for a space/matter is
  // "<parent...> <name>", so a BARE-name caller (no scope) misses it. The old Mongo findByName was
  // `Projection.findOne({ "state.name": name })` — matched by name ALONE, parent-agnostic, first hit.
  // When the scoped + bare probes both miss, scan for the first key whose trailing name segment is
  // `name` (sibling-unique means at most one per parent; a globally unique name resolves cleanly).
  if (id === undefined && kind !== "being") {
    // nameKey joins the scope segments with a NUL byte ("<parent> <name>" for a space), so the
    // bare name is the final NUL-delimited segment. First hit wins (sibling-unique → one per parent).
    for (const k of Object.keys(m)) {
      if (k.split(" ").pop() === String(name)) { id = m[k]; break; }
    }
  }
  if (id === undefined) return null;
  const slot = loadSnapshot(history, kind, id);
  if (!slot || slot.tombstoned) return null;
  return { id, ...slot };
}
// findByPosition(history, spaceId) → the live occupants across kinds at that space.
export function findByPosition(history, spaceId) {
  if (spaceId == null) return [];
  const out = [];
  for (const kind of ["being", "space", "matter"]) {
    const ids = loadIndex(history, kind, "position")[spaceId];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const slot = loadSnapshot(history, kind, id);
      if (slot && !slot.tombstoned) out.push({ kind, id, ...slot });
    }
  }
  return out;
}
// findByParent(history, parentId, kind) → the live children of parentId in this kind.
export function findByParent(history, parentId, kind) {
  if (parentId == null) return [];
  const ids = loadIndex(history, kind, "parent")[parentId];
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const slot = loadSnapshot(history, kind, id);
    if (slot && !slot.tombstoned) out.push({ kind, id, ...slot });
  }
  return out;
}
// listByType(history, kind) → the live ids of this kind (tombstoned excluded).
export function listByType(history, kind) {
  const ids = loadIndex(history, kind, "type")[kind];
  return Array.isArray(ids) ? ids.slice() : [];
}
// findByHeavenSpace(history, kind) → the singleton seed-space slot, or null. The marker KIND is the
// state.heavenSpace value (config/heaven/threads/...); pass it as the kind arg's heaven-key.
export function findByHeavenSpace(history, kind, heavenSpaceKind = kind) {
  const id = loadIndex(history, "space", "heavenSpace")[heavenSpaceKind];
  if (id === undefined) return null;
  const slot = loadSnapshot(history, "space", id);
  if (!slot || slot.tombstoned) return null;
  return { id, ...slot };
}

// rebuildIndex(history, kind) — re-derive the index for a kind by scanning its reels + folding to
// the current snapshot, then re-bucketing each id. Proves the rebuildable property: the index is a
// pure function of the snapshots (which are a pure fold of the reels). Wipes the kind's facet files
// first, then re-adds every live id from its .proj. (Snapshot existence is assumed current; a full
// reel re-fold belongs to the fold engine, not the store.)
export function rebuildIndex(history, kind) {
  for (const facet of ["name", "position", "parent", "type", "heavenSpace"]) {
    saveIndex(history, kind, facet, {});
  }
  const dir = join(ROOT, "reels", String(history), String(kind));
  if (!existsSync(dir)) return { rebuilt: 0 };
  let rebuilt = 0;
  // Walk every shard dir, find each <id>.proj, re-bucket from its slot.
  for (const shardName of readdirSync(dir)) {
    const shardDir = join(dir, shardName);
    let entries;
    try {
      entries = readdirSync(shardDir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".proj")) continue;
      const id = f.slice(0, -".proj".length);
      const slot = loadSnapshot(history, kind, id);
      if (!slot) continue;
      updateIndexFromSlot(history, kind, id, null, slot);
      rebuilt++;
    }
  }
  return { rebuilt };
}

// ── CROSS-AGGREGATE enumerators (the chain-structure roll-ups + the genome dump) ─────────────────
// The reels are partitioned per (history, kind, id) and the act-logs per (story, history, being);
// most reads target ONE partition. But three callers roll up the WHOLE chain and have no per-reel
// peer: chainRoots (history/story fingerprints over every reel-head + act-head), graft (the genome
// dump = every fact + every act verbatim), and graft's restore-time freshness/unplant. The Mongo path
// served these from ReelHead.find / ActHead.find / Fact.find({}) / Act.find({}); these are their
// FileStore-native peers — a directory walk over the reel/act file trees. Single-writer (the commit
// mutex) ⇒ a scan sees a consistent tree. The shapes match the old Mongo rows exactly (so chainRoots'
// rollup and graft's bundle stay byte-identical), down to the `_id` keys (reelKey / actHeadKey form).

// The reel head's `_id` shape — "<history>:<type>:<id>" — matches reelHeads.reelKey, kept local so
// fileStore stays import-free of the reel layer (which imports fileStore).
function reelKeyOf(history, type, id) {
  return `${history}:${type}:${id}`;
}

// Every history that has reels in this story (the reels/ subdirs). The curated history-enumeration
// peer the per-branch rebuilds need (rehydrateWordsFromFacts' overlay): a partitioned-per-history
// store has no global Fact.find, so a caller that must fold an aggregate's reel across ALL branches
// (not just heaven "0") iterates this. Order is readdir order; callers that need "0" first sort it.
export function listHistories() {
  const reelsRoot = join(ROOT, "reels");
  if (!existsSync(reelsRoot)) return [];
  try {
    return readdirSync(reelsRoot).filter((h) => {
      try { return statSync(join(reelsRoot, h)).isDirectory(); } catch { return false; }
    });
  } catch {
    return [];
  }
}

// Walk reels/<history>/<kind>/<shard>/ for the given file extension, calling fn(history, kind, id)
// for each matching reel id. When `history` is null, every history under reels/ is walked.
function eachReel(historyFilter, ext, fn) {
  const reelsRoot = join(ROOT, "reels");
  if (!existsSync(reelsRoot)) return;
  const histories =
    historyFilter != null ? [String(historyFilter)] : readdirSync(reelsRoot);
  for (const h of histories) {
    const histDir = join(reelsRoot, h);
    let kinds;
    try {
      kinds = readdirSync(histDir);
    } catch {
      continue;
    }
    for (const kind of kinds) {
      const kindDir = join(histDir, kind);
      let shards;
      try {
        shards = readdirSync(kindDir);
      } catch {
        continue;
      }
      for (const shardName of shards) {
        const shardDir = join(kindDir, shardName);
        let files;
        try {
          files = readdirSync(shardDir);
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.endsWith(ext)) continue;
          fn(h, kind, f.slice(0, -ext.length));
        }
      }
    }
  }
}

// listReelHeads(history?) → every reel's head row, the FileStore peer of ReelHead.find({history?}).
// Row shape mirrors the Mongo ReelHead doc the chainRoots/graft roll-ups read:
//   { _id: "<history>:<type>:<id>", history, type, id, head, headHash }
// `history` null ⇒ every history (the story-root + genome sweep); a path ⇒ that history only.
export function listReelHeads(history = null) {
  const out = [];
  eachReel(history, ".head", (h, kind, id) => {
    const { head, headHash } = readReelHead(h, kind, id);
    out.push({ _id: reelKeyOf(h, kind, id), history: h, type: kind, id, head, headHash });
  });
  return out;
}

// listAllFacts() → every fact on every reel, across every history. The FileStore peer of Fact.find({})
// the genome dump used. Ordered seq-ascending then by _id (the content hash) so two captures of the
// same chain produce a byte-identical array — exactly the Mongo path's `.sort({ seq: 1, _id: 1 })`.
export function listAllFacts() {
  const out = [];
  eachReel(null, ".reel", (h, kind, id) => {
    for (const f of readReel(h, kind, id)) out.push(f);
  });
  out.sort((a, b) => {
    const sa = a.seq ?? 0;
    const sb = b.seq ?? 0;
    if (sa !== sb) return sa - sb;
    return String(a._id) < String(b._id) ? -1 : String(a._id) > String(b._id) ? 1 : 0;
  });
  return out;
}

// Walk acts/<storySafe>/<historySafe>/<shard>/ for the given extension, calling fn(historySafe, being)
// per matching file. _index / _patches are skipped (not history dirs). The being name is the file stem.
function eachActBeing(story, ext, fn) {
  const storyDir = join(ROOT, "acts", pathSafe(story));
  if (!existsSync(storyDir)) return;
  for (const histName of readdirSync(storyDir)) {
    if (histName === "_index" || histName === "_patches") continue;
    const histDir = join(storyDir, histName);
    let shards;
    try {
      shards = readdirSync(histDir);
    } catch {
      continue;
    }
    for (const shardName of shards) {
      const shardDir = join(histDir, shardName);
      let files;
      try {
        files = readdirSync(shardDir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(ext)) continue;
        fn(histName, f.slice(0, -ext.length));
      }
    }
  }
}

// listActHeads(story, history?) → every being's act-chain head in the story, the FileStore peer of
// ActHead.find({history?}). Row shape mirrors the Mongo ActHead doc:
//   { _id: "<story>:<history>:<beingId>", story, history, beingId, headHash }
// The on-disk segments are pathSafe'd; the row carries those sanitized forms (the same the write path
// keyed under), so `_id` lines up with actHeadKey for the chainRoots/graft roll-ups.
export function listActHeads(story, history = null) {
  const out = [];
  const s = pathSafe(story);
  const histFilter = history != null ? pathSafe(history) : null;
  eachActBeing(story, ".acthead", (histName, being) => {
    if (histFilter != null && String(histFilter) !== String(histName)) return;
    const headHash = readActHeadFile(story, histName, being);
    out.push({
      _id: `${s}:${histName}:${being}`,
      story: s,
      history: histName,
      beingId: being,
      headHash: headHash === GENESIS_PREV ? null : headHash,
    });
  });
  return out;
}

// listAllActs(story) → every act in the story (patch-merged), the FileStore peer of Act.find({}) the
// genome dump used. Ordered by _id (the act hash) so two captures are byte-identical — the Mongo
// path's `.sort({ _id: 1 })` (acts carry no per-reel seq; the hash is the deterministic order).
export function listAllActs(story) {
  const out = [];
  eachActBeing(story, ".acts", (histName, being) => {
    for (const a of readActChain(story, histName, being)) out.push(a);
  });
  out.sort((a, b) =>
    String(a._id) < String(b._id) ? -1 : String(a._id) > String(b._id) ? 1 : 0,
  );
  return out;
}

// the atomic commit (NO journal) ─────────────────────────────────────────────
// A record = one moment = { recId, act?, facts: [{ history, kind, id, spec }] }. commitMoment computes
// each fact's identity, ENFORCES one reel per act (a fan-out is a run-on), and applies it — the fsync'd
// reel-line append (writeFactDoc) IS the stamp, i.e. the commit. There is no WAL: one fact on one reel
// has no multi-reel "all-or-none" to protect, and the fact's _id is itself the torn-write check (a half
// append leaves a line the .head never advanced past, which readReel skips). The journal / ack / frame /
// crc / replay were retired — the act/fact divide is the stamp, the stamp is the durable write.

// One global serialization point. A tiny promise-chain mutex: every commit awaits the previous.
let _commitTail = Promise.resolve();
function withCommitLock(fn) {
  const run = _commitTail.then(fn, fn);
  // keep the chain alive regardless of fn's outcome (don't let a rejection poison the tail)
  _commitTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Apply a persisted record (facts carry their FULL pre-computed docs) to the reel files. Idempotent
// by per-reel seq, so re-applying a committed record on replay is a pure no-op.
function applyRecord(record) {
  const factIds = [];
  for (const f of record.facts || []) {
    if (!f.doc) continue;
    const { _id } = writeFactDoc(f.history, f.kind, f.id, f.doc);
    factIds.push(_id);
  }
  // (act-file append + .acthead CAS is the next phase; the record already carries record.act.)
  return { factIds, actId: record.act?._id ?? record.actId ?? null };
}


/**
 * Commit one moment atomically: WAL-append (the commit point) → apply to reels → ack.
 * @param {{recId?:string, act?:object, actId?:string, facts: Array<{history:string,kind:string,id:string,spec:object}>}} record
 * @returns {Promise<{factIds:string[], actId:string|null}>}
 */
export function commitMoment(record) {
  return withCommitLock(() => {
    // The append ordinal (clock-free cross-reel order; see the _ordCounter note above) is assigned
    // HERE, under the commit lock and BEFORE the WAL append, so it journals with the act and rides the
    // act-log verbatim. One act per moment (one-word) → one ord per commit.
    if (record.act && record.act.ord == null) record.act.ord = nextOrd();
    const ord = record.act?.ord ?? null;
    // (1) Compute each fact's identity ONCE, threading per-reel heads (a moment may touch >1 reel
    //     during the run-on transition). Build the persisted record carrying the FULL fact docs, so
    //     replay re-applies the EXACT facts (never re-derives a fresh seq against a moved head).
    const heads = new Map();
    const facts = (record.facts || []).map((f) => {
      const key = `${f.history}:${f.kind}:${f.id}`;
      const head = heads.get(key) || readReelHead(f.history, f.kind, f.id);
      const { doc, nextHead } = computeFactDoc(f.history, f.kind, f.id, f.spec, head);
      // The moment's append ordinal also rides each FACT (= its act's ord): the clock-free GLOBAL order
      // the fact sits at across reels (per-reel `seq` is only local). Non-digest — contentOf excludes
      // it, so it never affects _id or verifyReel, exactly like `date`. Lets the fold read a birth
      // fact's `ord` as the aggregate's birth position (the createdAt replacement), no clock.
      if (ord != null) doc.ord = ord;
      heads.set(key, nextHead);
      return { history: f.history, kind: f.kind, id: f.id, doc };
    });
    // ONE ACT, ONE FACT, ONE REEL. Tail-truncation recovery (drop an unfinished act by cutting its
    // reel's tail) is only atomic if an act never FANS across reels — a multi-reel act is the run-on
    // that brought the journal back. Enforce it so the no-journal floor stays sound: a live act's
    // facts must all land on a SINGLE reel (0 facts is fine — a factless act, e.g. a cross-world attempt).
    const reels = new Set(facts.map((f) => `${f.history}:${f.kind}:${f.id}`));
    if (reels.size > 1) {
      // The act fans across reels — a run-on. Surfaced loudly (and counted) so the remaining run-ons
      // get decomposed to one-word; once they're gone this becomes a hard throw (the invariant the
      // no-journal floor rests on). For now we warn-and-proceed so the in-flight conversion still boots.
      _fanOutRunOns.add(`${record.actId || record.act?._id || "?"}→${[...reels].join("+")}`);
      // eslint-disable-next-line no-console
      console.warn(
        `commitMoment FAN-OUT (run-on): act lays facts on ${reels.size} reels (${[...reels].join(", ")}). ` +
          `One act = one fact = one reel; decompose into one word per reel.`,
      );
    }
    const persisted = { recId: record.recId, act: record.act, actId: record.actId, facts };
    // WRITE-THROUGH — no journal. The fact-line append IS the stamp: writeFactDoc fsyncs the reel, and
    // the fact's _id IS the finished-and-whole check (a torn append leaves a line the .head never
    // advanced past, which readReel skips). With no fan-out there is no multi-reel "all-or-none" to
    // protect, so there is no WAL, no ack, no replay — the act/fact divide is the stamp itself.
    return applyRecord(persisted);
  });
}

/**
 * Instate VERBATIM facts — a graft/book transplant, not a fresh stamp.
 * Unlike commitMoment (which DERIVES each fact's seq/p/_id from the local
 * head, i.e. a new act), the facts here arrive carrying their ORIGINAL
 * identity (_id/seq/p) from the source story and must land byte-for-byte
 * (the content hash IS the address; re-deriving it would re-home the chain
 * and break verifyReel). So we journal + apply them as-is. Idempotent by
 * per-reel seq (writeFactDoc skips a seq the reel already reached), so a
 * re-received book is a no-op. The caller (instateReel) has already run the
 * cold gates (scope/integrity/dedup/divergence) before calling this.
 *
 * @param {Array<{history:string,kind:string,id:string,doc:object}>} facts
 *   each `doc` is a FULL fact (carrying _id, seq, p, ...) to land verbatim.
 * @returns {Promise<{factIds:string[]}>}
 */
export function commitVerbatim(facts) {
  return withCommitLock(() => {
    const list = (facts || []).filter((f) => f && f.doc);
    const persisted = { verbatim: true, facts: list };
    // Write-through (no journal). A verbatim transplant is a BULK graft/book instate, not one live
    // act's stamp, so the one-reel rule does not apply (it lands a whole genome across many reels). Each
    // fact carries its own pre-built _id, idempotent by per-reel seq; a torn append is skipped by
    // readReel and the content hash is the whole-check. The receiver's rollback (truncateReelTo) is the
    // application-level all-or-none for a partial instate — not a storage WAL.
    return applyRecord(persisted);
  });
}

/**
 * Advance a reel's head verbatim (advance-only) — the file-native peer of
 * the ReelHead.create / ReelHead.updateOne($set head/headHash) the graft/
 * book instate used. A reel's .head is a DERIVED pointer (seq counter +
 * chain root); commitVerbatim already advances it for reels whose facts
 * the book carries, but a book may carry reelHeads for reels it does NOT
 * ship facts for (a heads-only advance). Never regresses — only moves the
 * head forward; a lower/equal head is a no-op and returns the current head.
 *
 * @returns {{head:number, headHash:string}}  the head after the (no-)advance.
 */
export function advanceReelHead(history, kind, id, head, headHash) {
  const cur = readReelHead(history, kind, id);
  if ((head || 0) > (cur.head || 0)) {
    writeReelHead(history, kind, id, head, headHash);
    return { head, headHash };
  }
  return cur;
}

/**
 * Boot recovery. There is NO journal to replay — the WAL was retired. One act lays ONE fact on ONE
 * reel; the reel-line append IS the stamp (fsync'd), and the fact's _id is the finished-and-whole
 * check, so a torn mid-append leaves a line the .head never advanced past and readReel skips. There is
 * no multi-reel "all-or-none" to recover (commitMoment refuses a fan-out). Kept as a no-op so the boot
 * caller (dbConfig) is unchanged; the drop-unfinished-act recovery (act-first/fact-last) is the next layer.
 * @returns {{replayed:number, torn:boolean}}
 */
export function replayJournal() {
  return { replayed: 0, torn: false };
}
