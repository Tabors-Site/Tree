// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// chain.rs — the server's READ side: walk the on-disk store and answer with JSON, using only the
// determinism spine (treestore reads, treeverify proves, treefold folds). No Node, no Word here — this
// is the part that is already pure Rust. The WRITE side (acts / Word execution) is the delegation seam
// in main.rs; it never lives here.

use std::fs;
use std::path::{Path, PathBuf};

use treefold::fold;
use treestore::{read_reel_file, stringify, verify_fact_chain, Json};

pub const FOLD_KINDS: &[&str] = &["being", "space", "matter", "library"];

// ── fs walk helpers ─────────────────────────────────────────────────────────
fn subdirs(p: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = fs::read_dir(p).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    out.sort();
    out
}
fn files(p: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = fs::read_dir(p).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
    out.sort();
    out
}
fn name(p: &Path) -> String {
    p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string()
}

// ── tiny JSON constructors ──────────────────────────────────────────────────
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn s(v: &str) -> Json {
    Json::Str(v.to_string())
}
fn n(v: usize) -> Json {
    Json::Num(v as f64)
}
pub(crate) fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
pub(crate) fn num_field(v: &Json, k: &str) -> Option<f64> {
    match get(v, k) {
        Some(Json::Num(x)) => Some(*x),
        _ => None,
    }
}
pub(crate) fn is_true(v: &Json, k: &str) -> bool {
    matches!(get(v, k), Some(Json::Bool(true)))
}
pub(crate) fn verdict_ok(v: &Json) -> bool {
    is_true(v, "ok")
}

/// Read the JS-written `.proj` snapshot beside a reel (the folded-state cache), if present.
pub fn read_proj(root: &Path, history: &str, kind: &str, id: &str) -> Option<Json> {
    let shard = if id.len() >= 2 { &id[..2] } else { id };
    let p = root.join("reels").join(history).join(kind).join(shard).join(format!("{id}.proj"));
    treestore::parse(std::fs::read_to_string(p).ok()?.trim()).ok()
}

/// Serialize a Json response body.
pub fn json(v: &Json) -> String {
    stringify(v)
}

/// Every reel as (history, kind, id), in directory order.
pub fn list_reels(root: &Path) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    for hist in subdirs(&root.join("reels")) {
        let history = name(&hist);
        for kind_dir in subdirs(&hist) {
            let kind = name(&kind_dir);
            for shard in subdirs(&kind_dir) {
                for f in files(&shard) {
                    if let Some(id) = name(&f).strip_suffix(".reel") {
                        out.push((history.clone(), kind.clone(), id.to_string()));
                    }
                }
            }
        }
    }
    out
}

/// GET /health — boot summary: counts + chain-verify tally over the whole store.
pub fn health(root: &Path) -> Json {
    let reels = list_reels(root);
    let (mut facts, mut verified, mut broken) = (0usize, 0usize, 0usize);
    for (h, k, id) in &reels {
        let fs_ = read_reel_file(root, h, k, id, None, None);
        facts += fs_.len();
        if verdict_ok(&verify_fact_chain(&fs_)) {
            verified += 1;
        } else {
            broken += 1;
        }
    }
    obj(vec![
        ("ok", Json::Bool(broken == 0)),
        ("store", s(&root.display().to_string())),
        ("reels", n(reels.len())),
        ("facts", n(facts)),
        ("verified", n(verified)),
        ("broken", n(broken)),
        ("engine", s("rust")),
    ])
}

/// GET /reels — the reel index as a JSON array of {history, kind, id}.
pub fn reels(root: &Path) -> Json {
    Json::Arr(
        list_reels(root)
            .into_iter()
            .map(|(h, k, id)| obj(vec![("history", s(&h)), ("kind", s(&k)), ("id", s(&id))]))
            .collect(),
    )
}

/// GET /reel/{history}/{kind}/{id} — read + verify + fold one reel.
pub fn reel(root: &Path, history: &str, kind: &str, id: &str) -> Json {
    let facts = read_reel_file(root, history, kind, id, None, None);
    let verify = verify_fact_chain(&facts);
    let state = if FOLD_KINDS.contains(&kind) {
        fold(kind, &facts)
    } else {
        Json::Null
    };
    obj(vec![
        ("history", s(history)),
        ("kind", s(kind)),
        ("id", s(id)),
        ("count", n(facts.len())),
        ("verify", verify),
        ("state", state),
        ("facts", Json::Arr(facts)),
    ])
}
