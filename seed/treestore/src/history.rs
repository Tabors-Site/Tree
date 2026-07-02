// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The HISTORY / BRANCH registry — the reel-level half of branching, ported byte-compatible from the
// JS history layer (seed/materials/history/*.js + seed/past/reel/reelHeads.js + seed/past/fileStore.js
// forkReel). A "history" (a branch) is a divergence of an existing one at a per-reel branchPoint; from
// that seq forward the two diverge. This module owns the FLOORS the reel-union reads (reel.rs already
// ports read_reel_lineage / lineage_ranges — they take a (lineage, floors), and THESE functions
// resolve them) plus the registry record + the reel-head fork that makes the cross-fork `p` fall out
// of a normal append.
//
// WHAT MAPS FROM WHERE (the JS-layer map):
//   - The registry is NOT a folded reel. It is small mutable metadata keyed by PATH ("0","1","1a",...),
//     stored as a FileCollection (seed/past/projStore.js) at:
//         <root>/proj/history/<2-char-shard(path)>/<pathSafe(path)>.json   one JSON row per path
//         <root>/proj/history/_index.json                                  {path: row} scan cache
//     Each row's `_id` IS the path. branchPoint is a PLAIN OBJECT on the row: { "<kind>:<id>": seq }.
//     (histories.createHistory builds the row; createBranch eagerly fills branchPoint.)
//   - getBranchPoint(history, kind, id)  ->  row.branchPoint["<kind>:<id>"] (a number), else 0; null for
//     main. (histories.js getBranchPoint.)
//   - resolveHistoryLineage(path)  ->  walk row.parent up to main, ["0", ...ancestors..., path].
//     (histories.js resolveHistoryLineage; main is implicit, has no row.)
//   - fork_reel(branch, parent, kind, id, branchPoint)  ->  seed the branch's .head to
//     {head: branchPoint, headHash: <parent fact AT branchPoint>._id}, so the branch's first append
//     gets seq=branchPoint+1 with p=that tip — the cross-fork link with NO special write path.
//     (fileStore.js forkReel; reelHeads.ensureHeadAtLeast calls it at branch-creation seed time.)
//
// CLOCK-FREE: a branchPoint is a SEQ (order), never a wall-clock. Every read here is order-keyed
// (seq/p), exactly as the rest of the spine.
//
// BYTE-COMPATIBLE: the row JSON is `stringify(row) + "\n"` in the SAME key order the JS createHistory
// emits, and the .head fork writes the SAME `{head, headHash}` a normal reel head carries. A Rust
// runtime reads a JS-branched Story and vice versa.
//
// NOTE ON THE ACT-CHAIN PEER: the act-chain does NOT fork (unlike the fact reel). Acts carry no seq;
// the per-(story,history,Name) act-logs are independent chains, unioned at READ time by the append
// ordinal `ord` (seed/past/act/actChain.js readActChainLineage). A branch's first act has p =
// GENESIS_PREV on that history's own empty `.acthead` — there is no `.acthead` seed, so there is no
// fork_act_chain to port. This is a registry/read concern, not a reel-head write; documented in NOTES.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use treehash::{parse, stringify, Json};

use crate::stamp::{Head, GENESIS_PREV};
use crate::store::{read_reel_head, write_reel_head};

/// The implicit root history. Main has NO registry row (it short-circuits everywhere); its reel starts
/// at seq 1 with floor 0. Matches histories.js `MAIN = "0"`.
pub const MAIN: &str = "0";

/// histories.js `isMain`: main, or absent/empty. The hot-path predicate.
pub fn is_main(path: &str) -> bool {
    path == MAIN || path.is_empty()
}

// ── registry storage paths (the FileCollection layout, byte-for-byte projStore.js) ──────────────────

/// projStore.js `pathSafe`: non `[A-Za-z0-9._-]` -> `_`, empty -> `_`. (Same rule as util::path_safe;
/// kept local so the registry's key sanitization reads next to its callers.)
fn path_safe(s: &str) -> String {
    let out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() {
        "_".to_string()
    } else {
        out
    }
}

/// projStore.js `shard`: pathSafe then first-2-chars, or pad to 2 with `_`. (The history collection
/// shards by the SANITIZED path, exactly as FileCollection._rowPath does — shard(id) over pathSafe(id).)
fn shard(id: &str) -> String {
    let safe = path_safe(id);
    let chars: Vec<char> = safe.chars().collect();
    if chars.len() >= 2 {
        chars[..2].iter().collect()
    } else {
        let mut s: String = chars.iter().collect();
        while s.chars().count() < 2 {
            s.push('_');
        }
        s
    }
}

fn history_dir(root: &Path) -> PathBuf {
    root.join("proj").join("history")
}
fn history_row_path(root: &Path, path: &str) -> PathBuf {
    history_dir(root)
        .join(shard(path))
        .join(format!("{}.json", path_safe(path)))
}
fn history_index_path(root: &Path) -> PathBuf {
    history_dir(root).join("_index.json")
}

// ── small Json readers ──────────────────────────────────────────────────────

fn obj_get<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).map(|(_, x)| x),
        _ => None,
    }
}
/// A string field, or None for absent/non-string (JS-truthy `null`/`""` collapse to None here only at
/// the call sites that care — `parent` keeps null distinct, see `row_parent`).
fn str_of(v: &Json, key: &str) -> Option<String> {
    match obj_get(v, key) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

/// The row's `parent` field as the JS reads it: a string path, OR None for `null`/absent (main's
/// children carry `parent: null`). A non-string non-null is treated as None (corrupt -> stops the walk).
fn row_parent(row: &Json) -> Option<String> {
    match obj_get(row, "parent") {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None, // null / absent / non-string
    }
}

// ── the registry row read ────────────────────────────────────────────────────

/// Load a history row by path off disk (the per-id file is the row of record; JS reads it the same way
/// via FileCollection.findById). `None` when no row exists (including implicit-live main). A corrupt /
/// unparseable file reads as `None` (projStore.readJson swallows the parse error the same way).
pub fn load_history(root: &Path, path: &str) -> Option<Json> {
    let text = fs::read_to_string(history_row_path(root, path)).ok()?;
    parse(text.trim()).ok()
}

/// Errors the lineage / branch-point resolution raises. Map to the JS IbpError codes at the boundary:
/// `MissingRow` -> BRANCH_NOT_FOUND (a history row missing partway up the chain), `Cycle` -> the
/// resolveHistoryLineage cycle guard.
#[derive(Debug, Clone, PartialEq)]
pub enum HistoryError {
    /// A history row is missing partway up the chain (corrupt lineage). JS: IbpError BRANCH_NOT_FOUND.
    MissingRow(String),
    /// The parent chain cycles (a history that is its own ancestor). JS: resolveHistoryLineage throws.
    Cycle(String),
}

// ── resolve_history_lineage ──────────────────────────────────────────────────

/// resolveHistoryLineage: a history path -> its ordered ancestry, main first, leaf last. Main -> `["0"]`.
/// `#1a1` -> `["0","1","1a","1a1"]`. Walks `row.parent` via the registry. A missing row partway up is a
/// corrupted lineage (`MissingRow`) — reading the reel would silently swap facts from the wrong
/// history's storage, so it is loud, exactly as the JS throws. The cycle guard mirrors the JS `seen` set.
pub fn resolve_history_lineage(root: &Path, path: &str) -> Result<Vec<String>, HistoryError> {
    if is_main(path) {
        return Ok(vec![MAIN.to_string()]);
    }
    let mut chain: Vec<String> = Vec::new();
    let mut cursor = path.to_string();
    let mut seen: Vec<String> = Vec::new();
    while !cursor.is_empty() && !is_main(&cursor) {
        if seen.iter().any(|s| s == &cursor) {
            return Err(HistoryError::Cycle(cursor));
        }
        seen.push(cursor.clone());
        let row = load_history(root, &cursor).ok_or_else(|| HistoryError::MissingRow(cursor.clone()))?;
        chain.insert(0, cursor.clone());
        cursor = row_parent(&row).unwrap_or_default(); // null parent -> "" -> loop ends (main reached)
    }
    chain.insert(0, MAIN.to_string());
    Ok(chain)
}

// ── branch_point ─────────────────────────────────────────────────────────────

/// The reelKey-without-history the branchPoint map keys on: `"<kind>:<id>"`. Matches histories.js
/// getBranchPoint's `key = `${type}:${id}``.
fn branch_point_key(kind: &str, id: &str) -> String {
    format!("{kind}:{id}")
}

/// getBranchPoint: the per-reel branchPoint seq for (history, kind, id) — the FLOOR, the seq where this
/// history diverged from its parent for THIS reel. `None` for main (its reel starts at seq 1). For a
/// non-main history whose branchPoint map has no entry for this reel, `0` ("the reel had no facts at
/// branch time," so the history's own seqs start at 1). A missing history row is `MissingRow` (the JS
/// throws BRANCH_NOT_FOUND). Reads the SAME plain-object `row.branchPoint` the JS createBranch wrote.
pub fn branch_point(root: &Path, history: &str, kind: &str, id: &str) -> Result<Option<f64>, HistoryError> {
    if is_main(history) {
        return Ok(None);
    }
    let row = load_history(root, history).ok_or_else(|| HistoryError::MissingRow(history.to_string()))?;
    let key = branch_point_key(kind, id);
    let bp = obj_get(&row, "branchPoint");
    let v = match bp {
        Some(Json::Obj(e)) => e.iter().find(|(k, _)| k == &key).and_then(|(_, x)| match x {
            Json::Num(n) => Some(*n),
            _ => None,
        }),
        _ => None, // no branchPoint map -> JS returns 0
    };
    Ok(Some(v.unwrap_or(0.0)))
}

// ── the (lineage, floors) the reel union reads — fed FROM Rust now ───────────────────────────────────
//
// reel.rs::read_reel_lineage / lineage_ranges take a `(lineage: &[String], floors: &HashMap<String,
// f64>)`. In the JS path foldEngine.js / verifyReel.js resolve those (resolveHistoryLineage +
// getBranchPoint-per-history) and pass them in. `reel_floors` is the Rust resolver: the SAME loop
// (main floors at 0; each non-main ancestor floors at its own branchPoint for this reel). Thread its
// output straight into read_reel_lineage — read_reel_lineage / lineage_ranges are UNCHANGED.

/// Resolve the per-history floors for ONE reel across a lineage — `{ "0": 0, "<h>": branchPoint(h,...) }`
/// — the `floors` map read_reel_lineage / lineage_ranges consume. Mirrors foldEngine.js / verifyReel.js:
/// main floors at 0 (no branchPoint, owns from seq 1); each non-main history floors at its own
/// branchPoint for (kind, id), defaulting 0. Pure given the registry on disk + the lineage.
pub fn reel_floors(
    root: &Path,
    lineage: &[String],
    kind: &str,
    id: &str,
) -> Result<HashMap<String, f64>, HistoryError> {
    let mut floors: HashMap<String, f64> = HashMap::new();
    floors.insert(MAIN.to_string(), 0.0);
    for h in lineage {
        if is_main(h) {
            continue;
        }
        let bp = branch_point(root, h, kind, id)?.unwrap_or(0.0);
        floors.insert(h.clone(), bp);
    }
    Ok(floors)
}

/// Convenience: resolve BOTH (lineage, floors) for a (history, kind, id) in one call — the exact pair
/// foldEngine.readReelBetween / verifyReel build before calling readReelLineage. On main this is
/// `(["0"], {"0":0})` and the reel union collapses to the single-history own-reel read. Feed the
/// returned pair to `read_reel_lineage`/`lineage_ranges` (both unchanged).
pub fn lineage_and_floors(
    root: &Path,
    history: &str,
    kind: &str,
    id: &str,
) -> Result<(Vec<String>, HashMap<String, f64>), HistoryError> {
    let lineage = if is_main(history) {
        vec![MAIN.to_string()]
    } else {
        resolve_history_lineage(root, history)?
    };
    let floors = reel_floors(root, &lineage, kind, id)?;
    Ok((lineage, floors))
}

// ── create_history (write the registry row) ──────────────────────────────────

/// What a history is created with. branchPoint is the per-reel floor map (`"<kind>:<id>" -> seq`),
/// snapshotted from the parent at branch time (createBranch's snapshotParentHeads). `parent` is the
/// parent path, or `None` for a child of main (the JS stores `parent: null` for main's children, since
/// main has no row).
pub struct NewHistory<'a> {
    pub path: &'a str,
    pub parent: Option<&'a str>,
    pub branch_point: &'a HashMap<String, f64>,
    pub created_by: Option<&'a str>,
    pub created_at: Option<&'a str>,
    pub label: Option<&'a str>,
    pub scope: Option<Json>,
}

fn jstr_or_null(s: Option<&str>) -> Json {
    match s {
        Some(v) => Json::Str(v.to_string()),
        None => Json::Null,
    }
}

/// create_history: write the registry row for a new branch, in the EXACT key order + with the EXACT
/// structural defaults histories.createHistory emits, so the on-disk row is byte-identical to the JS.
/// The row's `_id` IS the path. branchPoint is written as a plain object (sorted by key, see below).
/// Writes the per-id file AND updates the `_index.json` scan cache (FileCollection._writeRow does both).
///
/// `created_at` defaults to NONE of a wall-clock here (the time-purge): the caller passes the timestamp
/// it wants stamped (graft/book replay passes the source's, a fresh create passes whatever the host
/// chooses) — treestore reads no clock. The JS createHistory defaulted to `new Date().toISOString()`;
/// here the caller owns that string, so the Rust store never reads a wall.
pub fn create_history(root: &Path, h: &NewHistory<'_>) -> std::io::Result<Json> {
    // branchPoint plain object. The JS builds it by iterating a Map (`for (const [k,v] of bp)`), whose
    // order is insertion order; a HashMap has no order, so we SORT by key for a deterministic,
    // reproducible row (two captures of the same branch -> byte-identical file). The branchPoint map is
    // read by KEY (getBranchPoint indexes by `"<kind>:<id>"`), never by position, so order is free to
    // canonicalize — and chainRoots' history fingerprint already canonicalizes it (Object.fromEntries
    // over a sorted read), so a sorted on-disk order MATCHES the fingerprint input.
    let mut bp_entries: Vec<(String, Json)> = h
        .branch_point
        .iter()
        .map(|(k, v)| (k.clone(), Json::Num(*v)))
        .collect();
    bp_entries.sort_by(|a, b| a.0.cmp(&b.0));
    let branch_point_obj = Json::Obj(bp_entries);

    // The row, in histories.createHistory's key order EXACTLY:
    //   _id, path, parent, branchPoint, createdBy, createdAt, label, paused, pausedBy, pausedAt,
    //   isLive, archivedBecause, deleted, deletedBy, deletedAt, mergeSources, scope
    let created_at = h.created_at.map(|s| s.to_string());
    let row = Json::Obj(vec![
        ("_id".to_string(), Json::Str(h.path.to_string())),
        ("path".to_string(), Json::Str(h.path.to_string())),
        ("parent".to_string(), jstr_or_null(h.parent)),
        ("branchPoint".to_string(), branch_point_obj),
        ("createdBy".to_string(), jstr_or_null(h.created_by)),
        (
            "createdAt".to_string(),
            match created_at {
                Some(ref s) => Json::Str(s.clone()),
                None => Json::Null,
            },
        ),
        ("label".to_string(), jstr_or_null(h.label)),
        ("paused".to_string(), Json::Bool(false)),
        ("pausedBy".to_string(), Json::Null),
        ("pausedAt".to_string(), Json::Null),
        ("isLive".to_string(), Json::Bool(false)),
        ("archivedBecause".to_string(), Json::Null),
        ("deleted".to_string(), Json::Bool(false)),
        ("deletedBy".to_string(), Json::Null),
        ("deletedAt".to_string(), Json::Null),
        ("mergeSources".to_string(), Json::Arr(vec![])),
        (
            "scope".to_string(),
            h.scope.clone().unwrap_or(Json::Null),
        ),
    ]);

    write_history_row(root, h.path, &row)?;
    Ok(row)
}

/// Write a history row to disk: the per-id file (`stringify(row) + "\n"`, like writeJsonFsync) PLUS the
/// `_index.json` scan-cache update (FileCollection._writeRow writes both, keyed by `_id`). Durable
/// (truncating write + fsync), matching projStore.writeJsonFsync. Idempotent overwrite (same path -> new
/// row replaces the old, index re-points), exactly as the JS create/upsert does.
pub fn write_history_row(root: &Path, path: &str, row: &Json) -> std::io::Result<()> {
    // 1. The per-id file (the row of record).
    crate::store::durable_write(&history_row_path(root, path), &(stringify(row) + "\n"))?;
    // 2. The _index.json scan cache: {path: row}. Load (or {}), set this path, save. The cache is
    //    rebuildable from the per-id files (FileCollection.rebuildIndex); we keep it warm so a JS
    //    FileCollection.find({parent}) over the index sees the Rust-written branch with no rebuild.
    let mut index = load_history_index(root);
    set_index_entry(&mut index, path, row.clone());
    crate::store::durable_write(&history_index_path(root), &(stringify(&index) + "\n"))
}

/// Load the `_index.json` scan cache as a Json::Obj ({path: row}); empty obj when absent/corrupt
/// (projStore.readJson || {}). The values are full rows.
fn load_history_index(root: &Path) -> Json {
    match fs::read_to_string(history_index_path(root)) {
        Ok(text) => match parse(text.trim()) {
            Ok(j @ Json::Obj(_)) => j,
            _ => Json::Obj(vec![]),
        },
        Err(_) => Json::Obj(vec![]),
    }
}

/// Set `index[path] = row` with JS-object semantics (override in place if present, else append).
fn set_index_entry(index: &mut Json, path: &str, row: Json) {
    if let Json::Obj(entries) = index {
        match entries.iter_mut().find(|(k, _)| k == path) {
            Some(slot) => slot.1 = row,
            None => entries.push((path.to_string(), row)),
        }
    }
}

// ── list_live_histories (the live-history enumerator the lineage walk needs) ──────────────────────────

/// listLiveHistories: every NON-deleted history PATH, sorted ascending - `HistoryCollection.find({
/// deleted: { $ne: true } }).sort({ path: 1 })` reduced to the paths (histories.js listLiveHistories).
///
/// The JS `find()` reads `Object.values(_index.json)` (the scan cache holds full rows), filters
/// `deleted !== true`, then sorts by `path` ascending. We do the same off the `_index.json` rows: a row
/// is LIVE unless its `deleted` field is exactly `true` (the JS `$ne: true` - absent / null / false all
/// pass). MAIN ("0") is the implicit root with NO registry row, so it is NOT in this set (the JS
/// listLiveHistories likewise returns only rows; callers that want main prepend it, as
/// findMatterByContentHash does). Sorted by path with the JS cursor's string comparison (byte-wise on
/// these ASCII paths == Rust `str` Ord). A missing / corrupt index reads as empty (rebuildable cache).
pub fn list_live_histories(root: &Path) -> Vec<String> {
    let index = load_history_index(root);
    let mut paths: Vec<String> = Vec::new();
    if let Json::Obj(entries) = &index {
        for (key, row) in entries {
            // deleted !== true (the $ne:true live filter): only an explicit `true` excludes the row.
            if matches!(obj_get(row, "deleted"), Some(Json::Bool(true))) {
                continue;
            }
            // The row's own `path` field is the path of record; fall back to the index KEY (the path the
            // row is filed under) when a row lacks an explicit path (createHistory always writes one).
            let path = match obj_get(row, "path") {
                Some(Json::Str(s)) => s.clone(),
                _ => key.clone(),
            };
            paths.push(path);
        }
    }
    paths.sort(); // the JS `.sort({ path: 1 })` ascending; str Ord matches the cursor's `<` on ASCII paths
    paths
}

// ── fork_reel (seed the branch reel head so the cross-fork `p` falls out of a normal append) ─────────

/// fork_reel: the WRITE-side of branching on the reel. Branching is NOT copying — a new branch seeds
/// its `.head` from the PARENT's fact AT the branchPoint, so the branch's very first append gets
/// `seq = branchPoint+1` with `p = that parent fact's _id`. The cross-fork link then falls out of a
/// normal write_fact_doc (seq = head.head+1, p = head.headHash) — NO special-case write path. Each
/// branch thereafter holds only its own divergent tail under reels/<branch>/...
///
/// IDEMPOTENT: a second fork is a no-op (the `.head` already exists -> return it untouched), so a
/// re-seed never regresses a branch that already grew its own tail. Mirrors fileStore.js forkReel +
/// reelHeads.ensureHeadAtLeast exactly, on the SAME `.head` bytes.
///
/// `read_parent(after, until)` reads the PARENT history's reel slice (the fs in production via
/// read_reel_file bound to (root, parent, kind, id); an in-memory map in tests). It is asked for the
/// single fact at branchPoint (after = branchPoint-1, until = branchPoint); the tip's `_id` becomes the
/// branch head's root hash (GENESIS_PREV when the parent reel was empty at branch time).
pub fn fork_reel<F>(
    root: &Path,
    branch_history: &str,
    kind: &str,
    id: &str,
    branch_point: f64,
    read_parent: F,
) -> std::io::Result<Head>
where
    F: Fn(Option<f64>, Option<f64>) -> Vec<Json>,
{
    // Already forked? The .head file existing means a prior fork (or the branch's own appends) already
    // seeded it; do not regress. read_reel_head returns genesis when absent, so we must distinguish
    // "absent" from "seeded at 0" — check the file directly (matches fileStore.js `existsSync(headPath)`).
    if head_exists(root, branch_history, kind, id) {
        return Ok(read_reel_head(root, branch_history, kind, id));
    }
    // The parent fact AT branchPoint: read (branchPoint-1, branchPoint]. Its _id is the chain root the
    // branch's first append will carry as `p`. Empty (parent reel had no fact at branchPoint) -> genesis.
    let at = read_parent(Some(branch_point - 1.0), Some(branch_point));
    let tip_hash = at
        .last()
        .and_then(|f| str_of(f, "_id"))
        .unwrap_or_else(|| GENESIS_PREV.to_string());
    let head = Head { head: branch_point, head_hash: tip_hash };
    write_reel_head(root, branch_history, kind, id, &head)?;
    Ok(head)
}

/// Does a reel's `.head` file exist on disk? (fileStore.js forkReel gates on this — the distinction
/// between "no head yet" and "head seeded at seq 0" that read_reel_head's genesis fallback erases.)
fn head_exists(root: &Path, history: &str, kind: &str, id: &str) -> bool {
    crate::store::head_path(root, history, kind, id).exists()
}

/// fork_reel bound to the FILESYSTEM parent reel — the production seam: read the parent history's reel
/// off disk (read_reel_file) for the at-branchPoint fact, then seed the branch head. This is the call
/// the live emit path makes when a branch's first fact is about to land (the JS reelHeads.allocSeq's
/// seed-from-parent + the prevHashAt cross-fork link, in ONE place).
pub fn fork_reel_fs(
    root: &Path,
    branch_history: &str,
    parent_history: &str,
    kind: &str,
    id: &str,
    branch_point: f64,
) -> std::io::Result<Head> {
    let parent = parent_history.to_string();
    let kind_s = kind.to_string();
    let id_s = id.to_string();
    fork_reel(
        root,
        branch_history,
        kind,
        id,
        branch_point,
        |after, until| crate::store::read_reel_file(root, &parent, &kind_s, &id_s, after, until),
    )
}

