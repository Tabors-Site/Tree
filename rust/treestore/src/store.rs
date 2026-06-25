// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The real append-only storage floor on std::fs — the "own OS" layer. Ports fileStore.js's reel + head
// I/O: durable append (fsync file AND its dir), the 2-char shard, readReelHead/writeReelHead, and
// writeFactDoc (the fsync'd reel-line append = THE stamp, idempotent by per-reel seq so a replay is a
// no-op). The reel a Rust stamp writes is byte-for-byte the reel JS writes — same line format, same
// chain — so the two stores are interchangeable (the round-trip test reads each other's output).

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use treehash::{parse, stringify, Json};

use crate::reel::read_reel;
use crate::stamp::{fact_line, Head, GENESIS_PREV};
use crate::util::shard;

/// What a `write_fact_doc` did: the fact's id + seq, and whether it was a no-op replay (the reel had
/// already reached this seq — a prior, possibly crashed-then-retried, pass landed it).
#[derive(Debug, Clone, PartialEq)]
pub struct FactWrite {
    pub id: String,
    pub seq: f64,
    pub replayed: bool,
}

// ── paths (2-char shard so no dir holds millions of reels) ──────────────────

fn reel_dir(root: &Path, history: &str, kind: &str, id: &str) -> PathBuf {
    root.join("reels").join(history).join(kind).join(shard(id))
}
fn reel_path(root: &Path, history: &str, kind: &str, id: &str) -> PathBuf {
    reel_dir(root, history, kind, id).join(format!("{id}.reel"))
}
fn head_path(root: &Path, history: &str, kind: &str, id: &str) -> PathBuf {
    reel_dir(root, history, kind, id).join(format!("{id}.head"))
}

// ── durable writes (fsync the file AND its directory) ───────────────────────

/// Best-effort directory fsync (a fsync'd file in an un-fsync'd dir can vanish on some FS). Unix opens
/// the dir as a File and sync_all; elsewhere a no-op (the file sync already ran).
fn sync_dir(dir: &Path) {
    if let Ok(f) = fs::File::open(dir) {
        let _ = f.sync_all();
    }
}

pub(crate) fn durable_append(path: &Path, bytes: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(bytes.as_bytes())?;
    f.sync_all()?;
    if let Some(parent) = path.parent() {
        sync_dir(parent);
    }
    Ok(())
}

pub(crate) fn durable_write(path: &Path, bytes: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = OpenOptions::new().create(true).write(true).truncate(true).open(path)?;
    f.write_all(bytes.as_bytes())?;
    f.sync_all()?;
    Ok(())
}

// ── the .head pointer (seq counter + chain root) ────────────────────────────

fn num_field(v: &Json, key: &str) -> Option<f64> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).and_then(|(_, x)| match x {
            Json::Num(n) if n.is_finite() => Some(*n),
            _ => None,
        }),
        _ => None,
    }
}
fn str_field(v: &Json, key: &str) -> Option<String> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).and_then(|(_, x)| match x {
            Json::Str(s) => Some(s.clone()),
            _ => None,
        }),
        _ => None,
    }
}

/// readReelHead: `{head, headHash}` beside the reel, with the JS fallbacks (non-finite head → 0,
/// non-string headHash → GENESIS_PREV). Missing/corrupt file → genesis (rebuildable by rescanning).
pub fn read_reel_head(root: &Path, history: &str, kind: &str, id: &str) -> Head {
    let p = head_path(root, history, kind, id);
    let text = match fs::read_to_string(&p) {
        Ok(t) => t,
        Err(_) => return Head::genesis(),
    };
    match parse(text.trim()) {
        Ok(h) => Head {
            head: num_field(&h, "head").unwrap_or(0.0),
            head_hash: str_field(&h, "headHash").unwrap_or_else(|| GENESIS_PREV.to_string()),
        },
        Err(_) => Head::genesis(),
    }
}

/// writeReelHead: `JSON.stringify({head, headHash}) + "\n"`, fsync'd. A DERIVED pointer (the truth is
/// the reel) — persisted only so seq-allocation + root-hash reads are O(1) instead of a full rescan.
pub fn write_reel_head(root: &Path, history: &str, kind: &str, id: &str, head: &Head) -> io::Result<()> {
    let obj = Json::Obj(vec![
        ("head".to_string(), Json::Num(head.head)),
        ("headHash".to_string(), Json::Str(head.head_hash.clone())),
    ]);
    durable_write(&head_path(root, history, kind, id), &(stringify(&obj) + "\n"))
}

// ── the stamp on disk: writeFactDoc ─────────────────────────────────────────

fn doc_str(doc: &Json, key: &str) -> String {
    str_field(doc, key).unwrap_or_default()
}
fn doc_num(doc: &Json, key: &str) -> f64 {
    num_field(doc, key).unwrap_or(0.0)
}

/// writeFactDoc: append a fully-identified fact doc to its reel (the stamp) + advance the head.
/// Idempotent by per-reel seq — if the reel already reached this seq, the fact landed on a prior pass,
/// so skip (this is what makes a retried/replayed record a pure no-op). Returns the id/seq + whether
/// it was a replay.
pub fn write_fact_doc(root: &Path, history: &str, kind: &str, id: &str, doc: &Json) -> io::Result<FactWrite> {
    let cur = read_reel_head(root, history, kind, id);
    let seq = doc_num(doc, "seq");
    let id_str = doc_str(doc, "_id");
    if cur.head >= seq {
        return Ok(FactWrite { id: id_str, seq, replayed: true });
    }
    durable_append(&reel_path(root, history, kind, id), &fact_line(doc))?; // ← the stamp
    write_reel_head(root, history, kind, id, &Head { head: seq, head_hash: id_str.clone() })?;
    Ok(FactWrite { id: id_str, seq, replayed: false })
}

/// readReel off the fs: read the reel file's text and apply the seq-range filter (empty when absent).
pub fn read_reel_file(
    root: &Path,
    history: &str,
    kind: &str,
    id: &str,
    after: Option<f64>,
    until: Option<f64>,
) -> Vec<Json> {
    match fs::read_to_string(reel_path(root, history, kind, id)) {
        Ok(text) => read_reel(&text, after, until),
        Err(_) => Vec::new(),
    }
}
