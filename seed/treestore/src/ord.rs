// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ord.rs — the per-store GLOBAL append ordinal (bornOrd): the clock-free "world clock". Each sealed
// moment claims the next ord; "time" is the event count, never a wall-clock (the time-purge doctrine).
// One forest = one process = one store = one ord space (federation gives each forest its own; they
// never share). The counter is a lock-free per-store AtomicU64 (it scales to many names writing at
// once), seeded from a `.ord` file at boot and checkpointed back to it for durability across restarts.
//
// `ord` is NON-DIGEST: it is excluded from every _id (the content_of / content_of_act allowlists) and
// from the act-sig, so it annotates ORDER without ever moving an identity. The fold reads it as
// `bornOrd` (the catalog's clock-free creation order). The global timeline total order is `moment_order`
// — (ord ASC, then actId/_id ASC); the id tiebreak is the deterministic "coin-flip" for any equal ord.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex, OnceLock};

use treehash::{parse, stringify, Json};

use crate::store::durable_write;

/// Checkpoint the `.ord` file every Nth allocation (plus the first). The AtomicU64 is the in-process
/// truth; `.ord` only seeds the NEXT process boot, so it may lag by < N. A crash loses at most N-1 of
/// the high-water mark → on restart those ords re-allocate, harmlessly resolved by moment_order's id
/// tiebreak. This keeps the shared `.ord` file off the per-commit hot path so per-reel writes stay
/// parallel (the user's "heavy by many names at once" case).
const FLUSH_EVERY: u64 = 64;

fn ord_path(root: &Path) -> PathBuf {
    root.join(".ord")
}

/// The persisted high-water ord (`{ord: N}`), or 0 when absent/corrupt (rebuildable: the reels carry
/// every ord, so a future boot could rescan to backfill — the checkpoint suffices for monotonicity).
fn read_ord_file(root: &Path) -> u64 {
    let text = match std::fs::read_to_string(ord_path(root)) {
        Ok(t) => t,
        Err(_) => return 0,
    };
    match parse(text.trim()) {
        Ok(Json::Obj(e)) => e
            .iter()
            .find(|(k, _)| k == "ord")
            .and_then(|(_, v)| match v {
                Json::Num(n) if n.is_finite() && *n >= 0.0 => Some(*n as u64),
                _ => None,
            })
            .unwrap_or(0),
        _ => 0,
    }
}

fn write_ord_file(root: &Path, n: u64) {
    let obj = Json::Obj(vec![("ord".to_string(), Json::Num(n as f64))]);
    let _ = durable_write(&ord_path(root), &(stringify(&obj) + "\n")); // best-effort checkpoint
}

/// The per-store counters, keyed by store root so independent stores (and every test's temp dir) never
/// share an ord space. The map lock is touched only to get-or-create a root's atomic; allocation itself
/// is lock-free `fetch_add` on the atomic.
fn registry() -> &'static Mutex<HashMap<PathBuf, Arc<AtomicU64>>> {
    static REG: OnceLock<Mutex<HashMap<PathBuf, Arc<AtomicU64>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn counter(root: &Path) -> Arc<AtomicU64> {
    let mut map = registry().lock().unwrap_or_else(|e| e.into_inner());
    map.entry(root.to_path_buf())
        .or_insert_with(|| Arc::new(AtomicU64::new(read_ord_file(root))))
        .clone()
}

/// Claim the NEXT global ord (the world clock ticks): lock-free `fetch_add`, checkpointed to `.ord`
/// every FLUSH_EVERY. Returns the ord this caller owns. Monotone + unique IN-PROCESS; across a crash
/// or a (non-existent today) second writer process the id tiebreak in `moment_order` makes a repeat
/// harmless. Allocate it INSIDE the per-reel lock so a hot reel's ords match its seq (landing) order.
pub fn next_ord(root: &Path) -> f64 {
    let c = counter(root);
    let new = c.fetch_add(1, AtomicOrdering::SeqCst) + 1; // fetch_add returns the prior value
    if new == 1 || new % FLUSH_EVERY == 0 {
        write_ord_file(root, c.load(AtomicOrdering::SeqCst));
    }
    new as f64
}

/// The current global ord WITHOUT advancing — the world's "now" a being reads when it takes a moment.
/// Reflects in-process allocations (the atomic is the truth); 0 before any ord is claimed.
pub fn read_ord(root: &Path) -> f64 {
    counter(root).load(AtomicOrdering::SeqCst) as f64
}

// ── the global timeline total order ─────────────────────────────────────────

fn ord_of(row: &Json) -> Option<f64> {
    match row {
        Json::Obj(e) => e.iter().find(|(k, _)| k == "ord").and_then(|(_, v)| match v {
            Json::Num(n) if n.is_finite() => Some(*n),
            _ => None,
        }),
        _ => None,
    }
}

/// The tiebreak key: the ACT the row belongs to (`actId`), else the row's own `_id`. "" if neither.
fn tiebreak_id(row: &Json) -> String {
    match row {
        Json::Obj(e) => {
            let get = |k: &str| {
                e.iter().find(|(kk, _)| kk == k).and_then(|(_, v)| match v {
                    Json::Str(s) => Some(s.clone()),
                    _ => None,
                })
            };
            get("actId").or_else(|| get("_id")).unwrap_or_default()
        }
        _ => String::new(),
    }
}

/// The GLOBAL TIMELINE ORDER over two stamped rows (facts or acts): `(ord ASC, then actId/_id ASC)`.
/// The id compare is the deterministic "coin-flip" — when two stamps share an ord (only possible
/// cross-process / cross-crash), the older/newer ACT wins by a stable lexicographic id, never a real
/// coin. A row with no ord is pre-ordinal (genesis-era) and sorts FIRST, tiebroken by id.
pub fn moment_order(a: &Json, b: &Json) -> Ordering {
    match (ord_of(a), ord_of(b)) {
        (Some(x), Some(y)) => x.total_cmp(&y).then_with(|| tiebreak_id(a).cmp(&tiebreak_id(b))),
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
        (None, None) => tiebreak_id(a).cmp(&tiebreak_id(b)),
    }
}
