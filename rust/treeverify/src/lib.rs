// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treeverify — Tier 3: chain verification.
//
// Re-hash each fact/act and walk the p-links, on the proven Tier-1 `treehash`. Ported from
// seed/past/fact/verifyReel.js (the fact-chain forward walk) and seed/past/act/actHash.js
// `verifyActChain` (the act-chain). Per math.md INTEGRITY the chain DETECTS tampering; it never
// repairs. A verdict points at the FIRST break and the caller decides (re-fetch a clean copy,
// quarantine, alert).
//
// The I/O stays in JS — reading a history-lineage reel (readReelLineage + branchPoint floors) for
// facts, walking a head backward through the act store for acts. This crate is the PURE kernel:
// given an ordered chain (oldest-first), is it whole? The verdict objects match the JS shape
// byte-for-byte, so `canonicalize(verdict)` cross-checks against the JS walk.

pub use treehash::{canonicalize, parse, Json};
use treehash::{act_id, fact_id, GENESIS_PREV};

// ── small read-only Json accessors (treeverify never mutates) ───────────────

fn obj_get<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, x)| x),
        _ => None,
    }
}
fn get_str<'a>(v: &'a Json, key: &str) -> Option<&'a str> {
    match obj_get(v, key) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}
fn get_num(v: &Json, key: &str) -> Option<f64> {
    match obj_get(v, key) {
        Some(Json::Num(n)) => Some(*n),
        _ => None,
    }
}
fn num(n: f64) -> Json {
    Json::Num(n)
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// JS `/^[0-9a-f]{64}$/` — exactly 64 lowercase hex chars (a content-hash `_id` shape).
fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn ok_verdict(count: f64, head: Option<String>) -> Json {
    obj(vec![
        ("ok", Json::Bool(true)),
        ("count", num(count)),
        ("headHash", head.map(Json::Str).unwrap_or(Json::Null)),
    ])
}

fn broken(count: f64, broken_at: Json, reason: &str, expected: Json, actual: Json) -> Json {
    obj(vec![
        ("ok", Json::Bool(false)),
        ("count", num(count)),
        ("brokenAt", broken_at),
        ("reason", jstr(reason)),
        ("expected", expected),
        ("actual", actual),
    ])
}

// ── the fact-chain (verifyReel.js) ──────────────────────────────────────────

/// Walk a reel's facts oldest-first (the order the fold reads — readReelBetween across a history
/// lineage), recompute each fact's identity from its `p` + content, and confirm the chain holds.
/// Four break shapes, tested in the JS order:
///   - `seq-gap`       — a hole in the visible seq ranges.
///   - `unaddressed`   — missing `p`, or `_id` is not a 64-hex content hash (pre-CAS / foreign row).
///   - `prev-mismatch` — `f.p` doesn't equal the prior fact's identity (across branchPoints too).
///   - `hash-mismatch` — `f._id` doesn't equal `compute_hash(f.p, content_of(f))`.
///
/// Returns `{ok:true, count, headHash}` or `{ok:false, count, brokenAt, reason, expected, actual}`.
pub fn verify_fact_chain(facts: &[Json]) -> Json {
    if facts.is_empty() {
        return ok_verdict(0.0, None);
    }
    let mut expected_prev = GENESIS_PREV.to_string();
    let mut expected_seq = 1.0_f64;
    let mut count = 0.0_f64;
    for f in facts {
        count += 1.0;
        match get_num(f, "seq") {
            Some(s) if s == expected_seq => {}
            other => {
                return broken(
                    count,
                    num(expected_seq),
                    "seq-gap",
                    num(expected_seq),
                    other.map(num).unwrap_or(Json::Null),
                );
            }
        }
        let seq_at = num(expected_seq);
        let p = get_str(f, "p").map(str::to_string);
        let id = get_str(f, "_id").map(str::to_string);
        let id_addressed = id.as_deref().map(is_hex64).unwrap_or(false);
        let (p, id) = match (p, id) {
            (Some(p), Some(id)) if id_addressed => (p, id),
            (p, _) => {
                return broken(
                    count,
                    seq_at,
                    "unaddressed",
                    jstr(&expected_prev),
                    p.map(Json::Str).unwrap_or(Json::Null),
                );
            }
        };
        if p != expected_prev {
            return broken(count, seq_at, "prev-mismatch", jstr(&expected_prev), jstr(&p));
        }
        let expected_id = fact_id(&p, f);
        if id != expected_id {
            return broken(count, seq_at, "hash-mismatch", jstr(&expected_id), jstr(&id));
        }
        expected_prev = id;
        expected_seq += 1.0;
    }
    ok_verdict(count, Some(expected_prev))
}

// ── the act-chain (actHash.js verifyActChain) ───────────────────────────────

/// Walk a Name's act chain oldest-first, recompute each act's identity from its `p` + opening
/// (`content_of_act`), and confirm the chain holds. Acts carry no `seq` — the `p`-chain IS the
/// order. Break shapes: `unaddressed`, `prev-mismatch`, `hash-mismatch`. `brokenAt` is the breaking
/// act's `_id` (the JS verifyActChain walks the head backward and reports the hash `h` it stalls on).
///
/// (The JS verifier is head-driven and adds a `missing-act` shape — a `p` that resolves to no row
/// in the store. That is an I/O concern; given a materialized oldest-first list, a dangling `p`
/// surfaces here as `prev-mismatch` at the gap.)
pub fn verify_act_chain(acts: &[Json]) -> Json {
    if acts.is_empty() {
        return ok_verdict(0.0, None);
    }
    let mut expected_prev = GENESIS_PREV.to_string();
    let mut count = 0.0_f64;
    for a in acts {
        count += 1.0;
        let p = get_str(a, "p").map(str::to_string);
        let id = get_str(a, "_id").map(str::to_string);
        let id_addressed = id.as_deref().map(is_hex64).unwrap_or(false);
        let (p, id) = match (p, id) {
            (Some(p), Some(id)) if id_addressed => (p, id),
            (p, id) => {
                return broken(
                    count,
                    id.map(Json::Str).unwrap_or(Json::Null),
                    "unaddressed",
                    jstr(&expected_prev),
                    p.map(Json::Str).unwrap_or(Json::Null),
                );
            }
        };
        if p != expected_prev {
            return broken(count, jstr(&id), "prev-mismatch", jstr(&expected_prev), jstr(&p));
        }
        let expected_id = act_id(&p, a);
        if id != expected_id {
            return broken(count, jstr(&id), "hash-mismatch", jstr(&expected_id), jstr(&id));
        }
        expected_prev = id;
    }
    ok_verdict(count, Some(expected_prev))
}

/// Convenience: the canonical-JSON form of a verdict (what the cross-check compares).
pub fn verdict_canonical(verdict: &Json) -> String {
    canonicalize(verdict)
}
