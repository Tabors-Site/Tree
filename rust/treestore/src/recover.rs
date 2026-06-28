// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The act/fact-boundary corruption-prevention with NO journal (theorems.md Theorem 7 Scope +
// Cor 7.1). The `.head`/`.acthead` IS the commit marker: a fact/act is committed ONLY when its head
// advances to it. A crash between the line-append and the head-advance leaves an ORPHAN - a line on
// disk the head never reached. The TRUE head is the COMMITTED head; an orphan tail PAST it is IGNORED.
// The next commit RE-DERIVES seq/p from that committed head (the seal + write already do, since both
// key off `.head`, not the reel tail) AND physically drops the orphan tail (this module) so the fresh
// fact overwrites it FORWARD. The crashed moment leaves zero trace. A COMMITTED (head-advanced) fact
// is NEVER touched: overwriting committed data breaks every downstream `p`; overwriting an uncommitted
// orphan is safe (it was never real). That distinction IS the safety property.
//
// WHY THE COMMITTED HEAD, NOT THE WALK: an orphan whose LINE completed (only the head-advance was
// lost) is a perfectly valid standalone fact - it parses, re-hashes, and chains from the prior fact -
// so the p-walk alone reads it as chained and CANNOT mark it. What marks it uncommitted is exactly the
// lagging head ("headHash one fact behind ... the root witnesses the lagging head"). So the orphan
// boundary is the committed head. The `walked_*_head` helpers (the pure walk) answer the neighbouring
// question - the last CORRECTLY-CHAINED link - and catch a genuinely BROKEN (bad-p/hash) tail; the
// commit path uses them to cross-check the committed prefix is intact, never as the drop boundary.
//
// A CLEAN store (file tip at/under the committed head) is left byte-for-byte untouched - recovery is a
// no-op there, so a non-torn sequence produces exactly today's reel/.acts bytes. Reuses treeverify's
// walk (the same verifyReel/verifyActChain p-link verification).

use std::path::Path;

use treehash::Json;
use treeverify::{verify_act_chain, verify_fact_chain};

use crate::act_log::{act_line, act_paths, read_act_chain_file, read_act_head_file};
use crate::stamp::{fact_line, Head, GENESIS_PREV};
use crate::store::{durable_write, read_reel_file, read_reel_head, reel_path, write_reel_head};

// ── small read-only Json accessors ──────────────────────────────────────────

fn get_num(v: &Json, key: &str) -> Option<f64> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).and_then(|(_, x)| match x {
            Json::Num(n) if n.is_finite() => Some(*n),
            _ => None,
        }),
        _ => None,
    }
}
fn get_str<'a>(v: &'a Json, key: &str) -> Option<&'a str> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).and_then(|(_, x)| match x {
            Json::Str(s) => Some(s.as_str()),
            _ => None,
        }),
        _ => None,
    }
}
/// `true` when a treeverify verdict is `{ok:true,...}` - the whole chain held.
fn verdict_ok(v: &Json) -> bool {
    matches!(v, Json::Obj(e) if e.iter().any(|(k, x)| k == "ok" && matches!(x, Json::Bool(true))))
}
/// The breaking position from a (broken) treeverify verdict: `count` is the 1-based index of the
/// fact/act the walk STALLED on, so the last correctly-chained link is the one just before it
/// (`count - 1`). `None` when the verdict is `ok` (no break).
fn break_count(v: &Json) -> Option<usize> {
    if verdict_ok(v) {
        return None;
    }
    get_num(v, "count").map(|c| c as usize)
}

// ── the walked (true) head ───────────────────────────────────────────────────

/// The reel's TRUE head - the last correctly-chained fact (the orphan tail excluded). Runs the same
/// forward p-link walk verifyReel does (`verify_fact_chain`); on a break the chain is whole up to the
/// fact BEFORE the break (those links verified), so the walked tip is that fact. `(seq, headHash)`,
/// or genesis `(0, GENESIS_PREV)` when nothing chains (empty reel / first fact already an orphan).
pub fn walked_reel_head(facts: &[Json]) -> Head {
    let verdict = verify_fact_chain(facts);
    walked_head_from(facts, &verdict)
}

/// The act-chain's TRUE head - the last correctly-chained act's id (orphan tail excluded). Acts carry
/// no seq, so this returns just the id (`GENESIS_PREV` when nothing chains). Same walk verifyActChain
/// runs (`verify_act_chain`).
pub fn walked_act_head(acts: &[Json]) -> String {
    let verdict = verify_act_chain(acts);
    if verdict_ok(&verdict) {
        // The whole chain holds - the walked head is the verdict's headHash (the last act's id).
        return get_str(&verdict, "headHash")
            .map(str::to_string)
            .unwrap_or_else(|| GENESIS_PREV.to_string());
    }
    // A break at 1-based `count` means acts[0 .. count-1] chained; the walked head is acts[count-2].
    match break_count(&verdict) {
        Some(c) if c >= 2 => get_str(&acts[c - 2], "_id")
            .map(str::to_string)
            .unwrap_or_else(|| GENESIS_PREV.to_string()),
        _ => GENESIS_PREV.to_string(), // the FIRST act is already the orphan -> nothing committed
    }
}

/// Shared: turn a fact-chain verdict into the walked `Head`. Whole chain -> the verdict head; a break
/// at 1-based `count` -> the fact at index `count-2` is the last good one (its seq + _id).
fn walked_head_from(facts: &[Json], verdict: &Json) -> Head {
    if verdict_ok(verdict) {
        let head = get_num(verdict, "count").unwrap_or(0.0);
        let head_hash = get_str(verdict, "headHash").map(str::to_string);
        // count is the number of facts, which (genesis-seeded, contiguous) equals the tip seq; but
        // read seq off the last fact to stay exact under an anchored/grafted start.
        return match (facts.last(), head_hash) {
            (Some(f), Some(h)) => Head {
                head: get_num(f, "seq").unwrap_or(head),
                head_hash: h,
            },
            _ => Head::genesis(),
        };
    }
    match break_count(verdict) {
        Some(c) if c >= 2 => {
            let last_good = &facts[c - 2];
            Head {
                head: get_num(last_good, "seq").unwrap_or((c - 1) as f64),
                head_hash: get_str(last_good, "_id")
                    .map(str::to_string)
                    .unwrap_or_else(|| GENESIS_PREV.to_string()),
            }
        }
        _ => Head::genesis(), // the FIRST fact is already the orphan -> nothing committed
    }
}

// ── self-heal: drop the orphan tail BEFORE the fresh append ──────────────────

/// Recover a reel before a commit appends to it. The TRUE head is the COMMITTED `.head` (the commit
/// marker): a torn write left line(s) PAST it that `.head` never advanced to - the orphan tail. A
/// committed orphan line is a perfectly valid standalone fact (it parses, it re-hashes, it even
/// chains from the prior fact), so the p-walk ALONE cannot tell it from a committed fact - what marks
/// it uncommitted is precisely that `.head` lags it (theorems.md Theorem 7 Scope: "headHash one fact
/// behind until the next append self-heals; the root witnesses the lagging head"). So the orphan
/// boundary is `.head.head`, not the walk's end.
///
/// If the reel file carries lines past the committed head, physically rewrite the reel to the
/// committed prefix and (re)assert `.head` at the committed tip - the orphan is overwritten-forward,
/// the crashed moment leaves zero trace. A CLEAN reel (file tip == committed tip) is LEFT UNTOUCHED
/// (no rewrite -> byte-identical to today). A COMMITTED fact is NEVER dropped: the boundary is the
/// committed head, and the prefix `[1 .. .head.head]` is kept verbatim.
///
/// The walk is the cross-check: it confirms the committed prefix is INTACT (its `_id`s recompute, its
/// p-links hold). If the committed prefix itself fails to verify, that is TAMPER, not a torn write:
/// per math.md INTEGRITY the chain "detects, does not repair" (replication restores a good copy); we
/// do NOT truncate committed data, so we leave the prefix as-is and let verification surface it. Only
/// the uncommitted tail is ever dropped. Returns the committed `Head` (what the next stamp allocates
/// from - the seal already keys off this same `.head`).
pub fn recover_reel_before_commit(
    root: &Path,
    history: &str,
    kind: &str,
    id: &str,
) -> std::io::Result<Head> {
    let committed = read_reel_head(root, history, kind, id); // the commit marker = the true head
    let facts = read_reel_file(root, history, kind, id, None, None);

    // Clean iff the file holds nothing past the committed head: the file's last line is at the
    // committed seq (and the file length equals the committed seq for a contiguous reel).
    let file_tip_seq = facts.last().and_then(|f| get_num(f, "seq"));
    let clean = match file_tip_seq {
        Some(tip) => tip <= committed.head,
        None => true, // empty reel -> nothing to heal
    };
    if clean {
        return Ok(committed);
    }

    // There IS an orphan tail (lines past the committed head). Drop it: keep the committed prefix
    // `[1 .. committed.head]` verbatim, rewrite the reel, reassert `.head` at the committed tip.
    // Mirrors fileStore.js truncateReelTo, byte-identical line format (fact_line == the stamp's bytes).
    let kept = keep_prefix(&facts, committed.head);
    let body: String = kept.iter().map(|f| fact_line(f)).collect();
    durable_write(&reel_path(root, history, kind, id), &body)?;
    write_reel_head(root, history, kind, id, &committed)?;
    Ok(committed)
}

/// Recover an act-chain before a commit appends to it: the act-chain peer of the reel recovery. The
/// TRUE head is the COMMITTED `.acthead` (a bare act id - acts carry no seq, the p-chain IS the
/// order). A torn act left a line in `.acts` that `.acthead` never advanced to; like a reel orphan it
/// is a valid standalone act (it re-hashes, it chains from the prior act), so the boundary is the
/// committed `.acthead`, not the walk's end. If `.acts` carries act lines past the committed head,
/// rewrite to the committed prefix (up to and including the `.acthead` act) and reassert `.acthead`.
/// A clean chain is untouched (byte-identical `.acts`). A committed act is never dropped. Returns the
/// committed head id (what the next act chains from).
pub fn recover_act_before_commit(
    root: &Path,
    story: &str,
    history: &str,
    being: &str,
) -> std::io::Result<String> {
    let committed = read_act_head_file(root, story, history, being); // the commit marker = true head
    let acts = read_act_chain_file(root, story, history, being);

    // Clean iff the file's last act IS the committed head (nothing appended past it). An empty chain,
    // or a committed head of GENESIS_PREV with no acts, is clean too.
    let file_tip_id = acts.last().and_then(|a| get_str(a, "_id"));
    let clean = match file_tip_id {
        Some(tip) => tip == committed,
        None => true, // empty .acts -> nothing to heal (committed is GENESIS_PREV)
    };
    if clean {
        return Ok(committed);
    }

    // Drop the orphan act tail: keep the prefix up to and including the committed-head act. If the
    // committed head is GENESIS_PREV (nothing committed) the whole file is orphan -> keep nothing.
    let mut kept: Vec<&Json> = Vec::new();
    if committed != GENESIS_PREV {
        for a in &acts {
            kept.push(a);
            if get_str(a, "_id") == Some(committed.as_str()) {
                break;
            }
        }
    }
    let body: String = kept.iter().map(|a| act_line(a)).collect();
    let (log_path, head_path) = act_paths(root, story, history, being);
    durable_write(&log_path, &body)?;
    let head_line = if committed == GENESIS_PREV {
        String::new() // an empty .acthead reads back as GENESIS_PREV (the empty-chain sentinel)
    } else {
        format!("{committed}\n")
    };
    durable_write(&head_path, &head_line)?;
    Ok(committed)
}

/// Keep the reel prefix `[1 .. boundary_seq]`, seq-ascending: the FIRST occurrence of each seq from 1
/// up to and including `boundary_seq` (the committed head's seq). At `boundary_seq == 0` (genesis)
/// nothing is kept. Anything past the boundary (the orphan tail), or a stray duplicate landing at a
/// seq already taken, is left out. The committed prefix is contiguous (single-writer), so first-of-
/// each-seq IS the committed chain.
fn keep_prefix(facts: &[Json], boundary_seq: f64) -> Vec<&Json> {
    if boundary_seq <= 0.0 {
        return Vec::new();
    }
    let mut kept: Vec<&Json> = Vec::new();
    let mut next_seq = 1.0_f64;
    for f in facts {
        if next_seq > boundary_seq {
            break;
        }
        if get_num(f, "seq") == Some(next_seq) {
            kept.push(f);
            next_seq += 1.0;
        }
        // A line whose seq != the expected next (a duplicate/orphan landing early) is skipped.
    }
    kept
}
