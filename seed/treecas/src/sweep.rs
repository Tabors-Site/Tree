// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Retention sweep for the CAS — the SWEEP MECHANICS of seed/materials/matter/
// casSweep.js (sweepCas). Content blobs are addressed by hash and possibly
// shared by many matter rows across many histories (dedup), so the question is
// never "which row owns this file" — it is "does ANYTHING still reference this
// hash." A blob is dead only when no live reference names it.
//
// The reference set is an INPUT here, not re-derived. casSweep.js computes it
// two ways (policy "all" = every fact's cas ref; policy "latest" = every live
// projection's current content) by scanning the chain/projections — that scan
// is the JS runtime's job and stays in JS. treecas takes the resulting
// `referenced` set as a parameter and does the disk side: walk the store,
// delete every blob NOT in the set, respecting the safety furniture:
//
//   - Grace period: blobs younger than `grace_ms` are spared — they may belong
//     to a put whose fact hasn't sealed yet (the write path puts BEFORE the
//     fact by design). The age is `now_ms - mtime_ms` (an OS file-mtime check;
//     see the clock note below).
//   - TOCTOU guard: re-stat before delete; skip if the size/mtime moved since
//     the walk saw it (the blob was touched — likely a concurrent re-put).
//   - Per-cycle cap: at most `max_deletions` removals per call, so one sweep
//     cannot block for long; the rest reclaim next cycle.
//
// CLOCK NOTE: the JS computes `now = Date.now()` inside sweepCas and compares it
// to each blob's file mtime. The port keeps the store clock-free for ORDERING
// (no fact, no chain link, no sweep DECISION depends on a world clock); the only
// time involved is the grace freshness check, which is a relative
// mtime-vs-cutoff comparison. To keep that explicit and tests deterministic, the
// caller passes `now_ms` (mirroring the JS `Date.now()`) and `grace_ms`. A blob
// with `now_ms - mtime_ms < grace_ms` is spared. This is exactly the JS check,
// with the clock read lifted to the caller.

use std::collections::HashSet;
use std::path::Path;

use crate::store::{delete_content, list_hashes, HashEntry};
use crate::util::CasError;

/// What one sweep cycle did. Mirrors the JS sweepCas return
/// `{ scanned, deleted, freedKB, capped }` (the JS `policy` field is dropped —
/// policy lives in the caller that built `referenced`, not in treecas).
#[derive(Debug, Clone, PartialEq)]
pub struct SweepResult {
    /// Blobs walked this cycle.
    pub scanned: usize,
    /// Blobs deleted this cycle.
    pub deleted: usize,
    /// Bytes reclaimed (sum of deleted blob sizes).
    pub freed_bytes: u64,
    /// True if the per-cycle cap was hit (more remain for the next cycle).
    pub capped: bool,
    /// The hashes deleted this cycle (so the caller can log / audit which bytes
    /// went). The JS only counts; the Rust port returns them too — strictly
    /// more information, and the test asserts on it.
    pub deleted_hashes: Vec<String>,
}

/// sweepCas's disk side. Walks the store and deletes blobs the reference set no
/// longer retains, respecting grace + TOCTOU + the per-cycle cap.
///
/// - `referenced`: the live reference set (hashes still named by a fact or a
///   live projection). The caller derives this from the chain/projections; it
///   is taken as-is here. A blob whose hash is in the set is ALWAYS kept.
/// - `now_ms`: the current wall-clock millis (the JS `Date.now()`); used ONLY
///   for the grace freshness comparison, never for ordering.
/// - `grace_ms`: spare blobs younger than this (age = `now_ms - mtime_ms`).
/// - `max_deletions`: per-cycle cap on removals.
pub fn sweep(
    root: &Path,
    referenced: &HashSet<String>,
    now_ms: f64,
    grace_ms: f64,
    max_deletions: usize,
) -> Result<SweepResult, CasError> {
    let entries = list_hashes(root)?;
    sweep_entries(root, &entries, referenced, now_ms, grace_ms, max_deletions)
}

/// The sweep loop over an already-walked entry list. Split out so a caller (or a
/// test) can drive the walk itself; `sweep` is the convenience that walks then
/// loops. The TOCTOU re-stat still hits the disk per candidate, exactly as the
/// JS does between the listHashes yield and the deleteContent.
pub fn sweep_entries(
    root: &Path,
    entries: &[HashEntry],
    referenced: &HashSet<String>,
    now_ms: f64,
    grace_ms: f64,
    max_deletions: usize,
) -> Result<SweepResult, CasError> {
    let mut scanned = 0usize;
    let mut deleted = 0usize;
    let mut freed_bytes = 0u64;
    let mut capped = false;
    let mut deleted_hashes = Vec::new();

    for entry in entries {
        scanned += 1;
        // Referenced blobs are never touched (this is the whole point of the
        // ref-set: a hash anything still names stays).
        if referenced.contains(&entry.hash) {
            continue;
        }
        if deleted >= max_deletions {
            capped = true;
            break;
        }
        // Grace: a fresh blob may belong to a put whose fact hasn't sealed (or a
        // two-step upload whose make is coming). `now_ms - mtime_ms`
        // is the JS check (mtime is an OS file property, not a world clock).
        if now_ms - entry.mtime_ms < grace_ms {
            continue;
        }
        // TOCTOU guard: re-stat right before delete; skip if the blob vanished
        // or its mtime moved since the walk saw it. The JS re-reads `mtimeMs`
        // and bails when it differs (`if (!recheck || recheck.mtimeMs !==
        // mtimeMs) continue`) — a moved mtime means a concurrent re-put, so the
        // blob is live again and must not be reclaimed.
        match crate::store::restat_mtime(root, &entry.hash)? {
            None => continue, // vanished since the walk (a concurrent delete won)
            Some((_size, mtime_ms)) if mtime_ms != entry.mtime_ms => continue, // touched
            Some(_) => {}
        }
        match delete_content(root, &entry.hash) {
            Ok(true) => {
                deleted += 1;
                freed_bytes += entry.size;
                deleted_hashes.push(entry.hash.clone());
            }
            Ok(false) => { /* already gone — idempotent, count nothing */ }
            Err(_) => { /* a reclaim fault is logged-and-skipped in JS; skip */ }
        }
    }

    Ok(SweepResult {
        scanned,
        deleted,
        freed_bytes,
        capped,
        deleted_hashes,
    })
}
