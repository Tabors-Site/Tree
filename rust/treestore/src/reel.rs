// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Reading a reel back — the readReelBetween substrate. A reel file is JSONL of canonical fact docs,
// already seq-ascending (single-writer appends in order). `read_reel` is the own-history seq-range
// read; `read_reel_lineage` unions a branch's lineage (parent prefix up to each branchPoint + the
// branch's own tail) via the same OR-of-ranges the fold reads. Ports fileStore.js readReel /
// readReelLineage. Pure given the file text(s) + (lineage, floors); the fs lives in store.rs.

use std::collections::HashMap;
use treehash::{parse, Json};

fn seq_of(f: &Json) -> Option<f64> {
    match f {
        Json::Obj(e) => e.iter().find(|(k, _)| k == "seq").and_then(|(_, v)| match v {
            Json::Num(n) => Some(*n),
            _ => None,
        }),
        _ => None,
    }
}

/// Parse a reel file's text into facts — one per non-empty line; an unparseable line is skipped
/// (a torn mid-append the `.head` never advanced past, exactly as the JS readReel drops it).
pub fn parse_reel(text: &str) -> Vec<Json> {
    let mut out = Vec::new();
    for line in text.split('\n') {
        if line.is_empty() {
            continue;
        }
        if let Ok(f) = parse(line) {
            out.push(f);
        }
    }
    out
}

/// readReel: the facts with `after < seq <= until`, in seq order. `None` bound = unbounded that side.
/// A fact with no numeric `seq` fails any present bound (matches JS `f.seq > afterSeq` on `undefined`).
pub fn read_reel(text: &str, after: Option<f64>, until: Option<f64>) -> Vec<Json> {
    let mut out = Vec::new();
    for f in parse_reel(text) {
        let s = seq_of(&f);
        if let Some(a) = after {
            if !s.map_or(false, |x| x > a) {
                continue;
            }
        }
        if let Some(u) = until {
            if !s.map_or(false, |x| x <= u) {
                continue;
            }
        }
        out.push(f);
    }
    out
}

/// The per-history (lower, upper) ranges a branch read unions. Pure given (lineage, floors, after,
/// until): history `lineage[i]` owns `(floor(h), floor(next)]`; the leaf is unbounded above; main's
/// floor is 0. Mirrors readReelLineage's range math (and verifyReel's floors). `lower` is always a
/// number (the seq to read AFTER); `upper` is `Some(seq)` or `None` (the leaf / no ceiling).
pub fn lineage_ranges(
    lineage: &[String],
    floors: &HashMap<String, f64>,
    after: Option<f64>,
    until: Option<f64>,
) -> Vec<(String, f64, Option<f64>)> {
    let mut out = Vec::new();
    for i in 0..lineage.len() {
        let h = lineage[i].clone();
        let lo = floors.get(&h).copied().unwrap_or(0.0); // h owns (lo, hi]
        let hi = if i + 1 < lineage.len() {
            floors.get(&lineage[i + 1]).copied()
        } else {
            None
        };
        let lower = match after {
            Some(a) => lo.max(a),
            None => lo,
        };
        let upper = match (until, hi) {
            (Some(u), Some(h)) => Some(u.min(h)),
            (Some(u), None) => Some(u),
            (None, hi) => hi,
        };
        out.push((h, lower, upper));
    }
    out
}

/// readReelLineage: read each history's owned range (via `read`) and concatenate, seq-ascending.
/// `read(history, after, until)` is the per-history reader (store.rs binds it to the fs; tests bind an
/// in-memory map). The ranges chain across the forks, so the union is one contiguous chain.
pub fn read_reel_lineage<F>(
    lineage: &[String],
    floors: &HashMap<String, f64>,
    after: Option<f64>,
    until: Option<f64>,
    read: F,
) -> Vec<Json>
where
    F: Fn(&str, Option<f64>, Option<f64>) -> Vec<Json>,
{
    let mut out = Vec::new();
    for (h, lower, upper) in lineage_ranges(lineage, floors, after, until) {
        out.extend(read(&h, Some(lower), upper));
    }
    out
}
