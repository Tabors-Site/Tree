// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The act-log — the ACT chain, the per-Name peer of the reel files. Where the reel chains FACTS (the
// stamps a being received), the act-log chains the ACTS a Name authored (the souls the stamper
// rasterizes into facts). One JSONL line per act under acts/<story>/<history>/<be2>/<be>.acts; the
// chain head sits in a .acthead beside it and advances under a COMPARE-AND-SET so a stale author can't
// fork the chain. Keyed by `by` (the signer Name) — only Names act, so only Names have act-chains.
//
// Ports fileStore.js appendActLine / readActHeadFile / advanceActHeadFile / readActChain. The act
// IDENTITY (act_id = compute_hash(p, content_of_act(opening))) is the Tier-1 treehash primitive; the
// full act ROW (by, rootCorrelation, answers, the seal-time `at`/`ord`) is assembled by the
// assign+seal pipeline upstream — this is the chain link + the store the seal lands on.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use treehash::{act_id, parse, stringify, Json};

use crate::stamp::GENESIS_PREV;
use crate::store::durable_append;
use crate::util::{path_safe, shard};

// ── the act stamp (identity + chain link) ───────────────────────────────────

/// An act's place in its Name's chain: the doc, its id, and the head after it.
#[derive(Debug, Clone)]
pub struct ActStamped {
    pub doc: Json,
    pub id: String,
    pub next_head_hash: String,
}

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}

/// computeActId + the chain link: `_id = act_id(head, opening)` (= compute_hash(head,
/// content_of_act(opening)), `startMessage` and wall-clock excluded), and the act doc `{_id, p,
/// ...opening}`. Acts carry NO seq — the p-chain IS the order. (The richer signed row is built
/// upstream; this is the identity + link the chain keys on.)
pub fn compute_act_doc(opening: &Json, head_hash: &str) -> ActStamped {
    let id = act_id(head_hash, opening);
    let mut doc: Vec<(String, Json)> = vec![
        ("_id".to_string(), jstr(&id)),
        ("p".to_string(), jstr(head_hash)),
    ];
    if let Json::Obj(entries) = opening {
        for (k, v) in entries {
            if k == "_id" || k == "p" {
                continue;
            }
            doc.push((k.clone(), v.clone()));
        }
    }
    ActStamped { doc: Json::Obj(doc), id: id.clone(), next_head_hash: id }
}

/// The act-log line: `JSON.stringify(actDoc) + "\n"`.
pub fn act_line(doc: &Json) -> String {
    let mut s = stringify(doc);
    s.push('\n');
    s
}

/// Parse an act-log's text into acts (one per non-empty line; unparseable lines skipped). The patch
/// overlay readActLog merges is omitted — there is no patch writer today (a sealed act is immutable).
pub fn read_act_chain(text: &str) -> Vec<Json> {
    let mut out = Vec::new();
    for line in text.split('\n') {
        if line.is_empty() {
            continue;
        }
        if let Ok(a) = parse(line) {
            out.push(a);
        }
    }
    out
}

// ── the .acthead compare-and-set ────────────────────────────────────────────

/// The outcome of advancing the act-chain head.
#[derive(Debug, Clone, PartialEq)]
pub enum HeadAdvance {
    /// The head already IS this act — a settled replay (the advance landed, the ack hadn't). No-op.
    Replayed,
    /// The head moved from `expect_prev` to the new act id.
    Advanced,
}

/// advanceActHeadFile's CAS, pure: only move the head if the current head equals the author's expected
/// prev. `cur == act_id` → settled replay (idempotent). `cur != expect_prev` → the chain moved under a
/// stale author → refuse (ACT_CHAIN_MOVED). Else advance.
pub fn advance_act_head(cur: &str, expect_prev: &str, act_id: &str) -> Result<HeadAdvance, ActChainMoved> {
    if cur == act_id {
        return Ok(HeadAdvance::Replayed);
    }
    if cur != expect_prev {
        return Err(ActChainMoved);
    }
    Ok(HeadAdvance::Advanced)
}

/// The CAS refused: the chain head moved under a stale author (ACT_CHAIN_MOVED). The chain can't fork.
#[derive(Debug, Clone, PartialEq)]
pub struct ActChainMoved;

/// Either the CAS refused, or the filesystem failed.
#[derive(Debug)]
pub enum AdvanceError {
    ChainMoved,
    Io(io::Error),
}
impl From<io::Error> for AdvanceError {
    fn from(e: io::Error) -> Self {
        AdvanceError::Io(e)
    }
}

// ── paths (path-safe segments + 2-char shard, like the reel store) ──────────

fn act_dir(root: &Path, story: &str, history: &str, being: &str) -> PathBuf {
    root.join("acts")
        .join(path_safe(story))
        .join(path_safe(history))
        .join(shard(&path_safe(being)))
}
fn act_log_path(root: &Path, story: &str, history: &str, being: &str) -> PathBuf {
    act_dir(root, story, history, being).join(format!("{}.acts", path_safe(being)))
}
fn act_head_path(root: &Path, story: &str, history: &str, being: &str) -> PathBuf {
    act_dir(root, story, history, being).join(format!("{}.acthead", path_safe(being)))
}

// ── the real fs act-log ─────────────────────────────────────────────────────

/// Append actDoc as one JSONL line to the Name's act-log (durable, fsync'd). The index maintenance the
/// JS does (actId → location + the inverted facets) is a rebuildable cache, a later phase.
pub fn append_act_line(root: &Path, story: &str, history: &str, being: &str, doc: &Json) -> io::Result<()> {
    durable_append(&act_log_path(root, story, history, being), &act_line(doc))
}

/// readActHeadFile: the Name's act-chain head (GENESIS_PREV if the chain is empty / missing).
pub fn read_act_head_file(root: &Path, story: &str, history: &str, being: &str) -> String {
    match fs::read_to_string(act_head_path(root, story, history, being)) {
        Ok(t) => {
            let h = t.trim();
            if h.is_empty() {
                GENESIS_PREV.to_string()
            } else {
                h.to_string()
            }
        }
        Err(_) => GENESIS_PREV.to_string(),
    }
}

/// advanceActHeadFile: the CAS on disk. Reads the current head, applies the pure CAS, and on `Advanced`
/// writes the new head (fsync'd). `Replayed` is a no-op; a stale author gets `AdvanceError::ChainMoved`.
pub fn advance_act_head_file(
    root: &Path,
    story: &str,
    history: &str,
    being: &str,
    act_id: &str,
    expect_prev: &str,
) -> Result<HeadAdvance, AdvanceError> {
    let cur = read_act_head_file(root, story, history, being);
    match advance_act_head(&cur, expect_prev, act_id) {
        Ok(HeadAdvance::Replayed) => Ok(HeadAdvance::Replayed),
        Ok(HeadAdvance::Advanced) => {
            crate::store::durable_write(&act_head_path(root, story, history, being), &format!("{act_id}\n"))?;
            Ok(HeadAdvance::Advanced)
        }
        Err(ActChainMoved) => Err(AdvanceError::ChainMoved),
    }
}

/// readActChain: one Name's authored acts on a (story, history), append-order (oldest-first).
pub fn read_act_chain_file(root: &Path, story: &str, history: &str, being: &str) -> Vec<Json> {
    match fs::read_to_string(act_log_path(root, story, history, being)) {
        Ok(text) => read_act_chain(&text),
        Err(_) => Vec::new(),
    }
}
