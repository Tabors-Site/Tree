// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The .proj snapshot store — the folded-state CACHE for a (history, kind, id), beside its reel. Ports
// fileStore.js snapPath / loadSnapshot / saveSnapshot. A snapshot is the reducer's folded slot
// ({state, foldedSeq, ...}) written `stringify(slot) + "\n"`; it is CAS-guarded on `foldedSeq` so a
// stale concurrent fold loses (and the next fold, reading the advanced snapshot, catches up). It is a
// cache (rebuildable by folding the reel), never truth.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use treehash::{parse, stringify, Json};

/// fileStore.js `shard`: first 2 chars, or pad to 2 with `_` (so no directory holds millions).
fn shard(id: &str) -> String {
    let chars: Vec<char> = id.chars().collect();
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

/// `reels/<history>/<kind>/<shard>/<id>.proj` — the snapshot sits beside the reel it folds.
fn snap_path(root: &Path, history: &str, kind: &str, id: &str) -> PathBuf {
    root.join("reels")
        .join(history)
        .join(kind)
        .join(shard(id))
        .join(format!("{id}.proj"))
}

/// The slot's `foldedSeq` — the reel seq this snapshot has folded up to — or None.
pub fn folded_seq(slot: &Json) -> Option<f64> {
    match slot {
        Json::Obj(e) => e
            .iter()
            .find(|(k, _)| k == "foldedSeq")
            .and_then(|(_, v)| match v {
                Json::Num(n) => Some(*n),
                _ => None,
            }),
        _ => None,
    }
}

/// loadSnapshot: the folded slot for (history, kind, id), or None if absent/corrupt (rebuild by folding).
pub fn load_snapshot(root: &Path, history: &str, kind: &str, id: &str) -> Option<Json> {
    let text = fs::read_to_string(snap_path(root, history, kind, id)).ok()?;
    parse(text.trim()).ok()
}

/// saveSnapshot: a durable (fsync'd) write of the slot. When `expected_folded_seq` is Some it is a
/// compare-and-set: write only if the on-disk `foldedSeq` matches (a stale fold returns Ok(false) and
/// loses; the next fold reads the advanced snapshot and catches up). A first write (no snapshot yet)
/// always lands. Returns Ok(true) when written. Mirrors projections.saveProjection's CAS.
pub fn save_snapshot(
    root: &Path,
    history: &str,
    kind: &str,
    id: &str,
    slot: &Json,
    expected_folded_seq: Option<f64>,
) -> io::Result<bool> {
    if let Some(exp) = expected_folded_seq {
        if let Some(old) = load_snapshot(root, history, kind, id) {
            if folded_seq(&old) != Some(exp) {
                return Ok(false); // a stale concurrent fold loses the CAS
            }
        }
    }
    let p = snap_path(root, history, kind, id);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&p)?;
    f.write_all((stringify(slot) + "\n").as_bytes())?;
    f.sync_all()?;
    Ok(true)
}
