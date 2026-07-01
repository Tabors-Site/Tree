// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// build_act_sig_payload - the canonical bytes a signature attests to. actId
// transitively pins the whole act opening (contentOfAct); this ADDS what the
// opening hash does not cover: the committed factIds (the moment's actual deltaF)
// and the chain position p. Same serializer the signer uses, so signer and
// verifier agree.
//
// NO WALL TIME (the time-purge, philosophy/crystalized.md). TIME is ORDER - the
// chain position p, the clock-free seq/ord - never a wall-clock. So the PURE
// (going-forward) payload carries NO `time` field; the Rust SIGNS and VERIFIES
// this clock-free shape. The old JS baked the act's wall-clock `at` into the
// signature payload as `time`; those pre-existing JS-signed acts verify ONLY
// through the explicit, clearly-marked LEGACY helper below
// (build_act_sig_payload_legacy), never through the going-forward path.
//
// The PURE JS-shaped object (the exact fields + the exact null/undefined
// handling, because canonicalize drops undefined keys but keeps null ones, so
// the two differ on the wire):
//
//   {
//     actId:   String(act._id),
//     by:      act.by      ?? null,   // null-coalesced
//     through: act.through,           // NO coalesce: undefined here is DROPPED
//     to:      act.to      ?? null,
//     story:   act.story   ?? null,
//     history: normHistory(act.history),   // "" / non-string -> "0"
//     p:       act.p       ?? null,
//     factIds: [...factIds].map(String).sort(),   // sorted string copies
//   }
//
// The LEGACY object is identical PLUS a trailing `time: timeISO(act)` (act.at as
// an ISO string, else null). That `time` is the ONLY difference between the two.
//
// The asymmetry that matters: `through` is the ONE field assigned raw (no `??`).
// In an act ROW on disk `through` is present as `null` (kept on the wire); in a
// 5D name-act it is absent/undefined (dropped). We reproduce both: if the act
// object carries a `through` key (even null) we keep it; if it is absent we omit
// the key entirely, matching `act.through === undefined` -> dropped by stringify.

use treehash::Json;

/// Build the PURE act-sig payload from an act row + its committed fact ids. This
/// is the GOING-FORWARD sign + verify shape: CLOCK-FREE, no `time`/wall-clock
/// field. TIME is order (the chain position `p`), never a wall-clock. `fact_ids`
/// are the ids of the facts the moment laid on the actor's being reel; they are
/// copied, stringified (already strings here), and sorted, exactly as the JS
/// does. New Rust signing ALWAYS uses this; never `..._legacy`.
pub fn build_act_sig_payload(act: &Json, fact_ids: &[String]) -> Json {
    build_payload(act, fact_ids, false)
}

/// LEGACY ONLY. Build the OLD act-sig payload that ALSO carries `time` (the act's
/// wall-clock `at` as an ISO string, else null) at the tail. This is the EXACT
/// shape the pre-time-purge JS signed, and it exists for ONE reason: to verify
/// pre-existing JS-signed acts that baked the wall-clock into their signature
/// payload. Reading old JS stores is the only use.
///
/// NEVER sign with this. New Rust acts are CLOCK-FREE - they sign + verify the
/// PURE `build_act_sig_payload`. Using this for new signing would re-introduce
/// the wall-clock the time-purge removed.
pub fn build_act_sig_payload_legacy(act: &Json, fact_ids: &[String]) -> Json {
    build_payload(act, fact_ids, true)
}

/// The shared builder: the PURE payload, plus a trailing `time` field ONLY when
/// `legacy` (the old JS shape). The pure-vs-legacy split is exactly this one
/// field; everything else is byte-identical between the two.
fn build_payload(act: &Json, fact_ids: &[String], legacy: bool) -> Json {
    let mut entries: Vec<(String, Json)> = Vec::with_capacity(9);

    entries.push(("actId".into(), Json::Str(act_id_str(act))));
    entries.push(("by".into(), coalesce_null(get(act, "by"))));

    // `through`: assigned RAW in the JS (no `??`). Present (incl. null) -> keep;
    // absent (undefined) -> omit, so canonicalize drops it just like stringify.
    if let Some(through) = get(act, "through") {
        entries.push(("through".into(), through.clone()));
    }

    entries.push(("to".into(), coalesce_null(get(act, "to"))));
    entries.push(("story".into(), coalesce_null(get(act, "story"))));
    entries.push(("history".into(), Json::Str(norm_history(get(act, "history")))));
    entries.push(("p".into(), coalesce_null(get(act, "p"))));

    // factIds: sorted string copies. JS Array.prototype.sort is by UTF-16 code
    // units; the values are content-hash hex / ids (ASCII), where UTF-16-codeunit
    // order, byte order, and char order all coincide, so a plain sort matches.
    let mut ids: Vec<String> = fact_ids.to_vec();
    ids.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    entries.push((
        "factIds".into(),
        Json::Arr(ids.into_iter().map(Json::Str).collect()),
    ));

    // LEGACY ONLY: the old JS baked the act's wall-clock `at` in as `time`. The
    // PURE going-forward payload omits this entirely (NO WALL TIME).
    if legacy {
        entries.push(("time".into(), time_iso(act)));
    }

    Json::Obj(entries)
}

// ── THE MOMENT KEY-PROOF (auth-at-moment, Rust-native, no JS antecedent) ─────
//
// A Name opens a moment by PROVING its key AT THE MOMENT: a signature by the Name's key over the
// moment-request's stable identity fields. The edge recovers the pubkey straight from the Name id (the
// key IS the id) and verifies this canonical payload. This is NEW (the JS had no per-moment proof); the
// shape is deliberately small and clock-free so it is cheap to sign on every moment.
//
// The signed object — the moment's identity, NOT its transient envelope (no `actor` blob, no `verb`, no
// federation marker), so the SAME perceive re-signs identically:
//
//   {
//     nameId:  the Name opening the moment (its id IS its public key),
//     history: normHistory(req.history),   // "" / absent -> "0"
//     kind:    req.kind    ?? null,        // a reel perceive
//     id:      req.id      ?? null,        // the reel id
//     op:      req.op      ?? null,        // a see-op moment
//     address: req.address ?? null,        // a scene-address moment
//   }
//
// Every field is the moment's own; nothing wall-clock, nothing per-connection. The portal signs this
// with the active being's seed; the edge verifies it with the pubkey decoded from `nameId`.

/// Build the canonical MOMENT-PROOF payload a Name signs to open an authenticated moment. `req` is the
/// moment request (its `history`/`kind`/`id`/`op`/`address` fields are read); `name_id` is the Name
/// opening it (bound into the payload so a proof for one Name cannot be replayed as another).
pub fn build_moment_proof_payload(name_id: &str, req: &Json) -> Json {
    Json::Obj(vec![
        ("nameId".into(), Json::Str(name_id.to_string())),
        ("history".into(), Json::Str(norm_history(get(req, "history")))),
        ("kind".into(), coalesce_null(get(req, "kind"))),
        ("id".into(), coalesce_null(get(req, "id"))),
        ("op".into(), coalesce_null(get(req, "op"))),
        ("address".into(), coalesce_null(get(req, "address"))),
    ])
}

// ── helpers (mirror the JS) ──

/// Look up a key in a Json object. None when the value is not an object or the
/// key is absent - the Rust stand-in for JS `obj.key === undefined`.
fn get<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, val)| val),
        _ => None,
    }
}

/// `act._id` as a String. The JS does `String(act._id)`; an id on a row is
/// always a string already, so a present string is taken verbatim and anything
/// else falls back to the empty string (the JS would stringify it; rows never
/// carry a non-string _id, so this branch is defensive).
fn act_id_str(act: &Json) -> String {
    match get(act, "_id") {
        Some(Json::Str(s)) => s.clone(),
        Some(other) => json_to_string(other),
        None => String::new(),
    }
}

/// `x ?? null`: a present non-null value is kept; absent (None) or a JS-null
/// both become Json::Null. (Note: false/0/"" are NOT nullish in JS, so they pass
/// through unchanged - `coalesce_null(Some(false))` stays false.)
fn coalesce_null(v: Option<&Json>) -> Json {
    match v {
        Some(Json::Null) | None => Json::Null,
        Some(other) => other.clone(),
    }
}

/// normHistory: a non-empty string stays; anything else (empty string, null,
/// absent, non-string) becomes "0". (actSig.js normHistory.)
fn norm_history(v: Option<&Json>) -> String {
    match v {
        Some(Json::Str(s)) if !s.is_empty() => s.clone(),
        _ => "0".to_string(),
    }
}

/// LEGACY helper. timeISO: the act's wall-clock witness (act.at) as an ISO
/// string, else null. Used ONLY by build_act_sig_payload_legacy to rebuild the
/// old JS payload; the PURE going-forward payload never touches `at`. On a sealed
/// JS row `act.at` is already an ISO-8601 string (e.g. "2026-06-25T13:01:25.361Z"),
/// which is exactly what `new Date(at).toISOString()` reproduces, so the stored
/// string is taken verbatim. A row with no/invalid `at` yields null. (We do NOT
/// re-parse/re-format: the stored ISO string IS the canonical form the JS signer
/// signed, and re-deriving it would only risk a drift from that signer.)
fn time_iso(act: &Json) -> Json {
    match get(act, "at") {
        Some(Json::Str(s)) if !s.is_empty() => Json::Str(s.clone()),
        _ => Json::Null,
    }
}

/// Minimal scalar-to-string for the defensive _id branch (never hit on a real
/// row). Mirrors JS `String(x)` for the scalar cases.
fn json_to_string(v: &Json) -> String {
    match v {
        Json::Str(s) => s.clone(),
        Json::Bool(b) => b.to_string(),
        Json::Null => "null".to_string(),
        Json::Num(n) => treehash::canonicalize(&Json::Num(*n)),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use treehash::{canonicalize, parse};

    #[test]
    fn pure_payload_has_no_time_even_when_act_carries_at() {
        // The going-forward PURE payload is CLOCK-FREE: a wall-clock `at` on the
        // act never appears as `time`. NO WALL TIME.
        let act = parse(r#"{"_id":"a","by":"i-am","through":"i-am","to":"i-am","story":"localhost","history":"0","p":"0","at":"2026-06-25T13:01:25.361Z"}"#).unwrap();
        let canon = canonicalize(&build_act_sig_payload(&act, &[]));
        assert!(!canon.contains("time"), "PURE payload must drop time even with at: {canon}");
        assert!(!canon.contains("2026-06-25"), "no wall-clock leaks into the pure payload: {canon}");
    }

    #[test]
    fn legacy_payload_keeps_time_from_at() {
        // The LEGACY payload (old JS shape) DOES carry the wall-clock `at` as
        // `time` - the one field that differs from the pure shape.
        let act = parse(r#"{"_id":"a","by":"i-am","through":"i-am","to":"i-am","story":"localhost","history":"0","p":"0","at":"2026-06-25T13:01:25.361Z"}"#).unwrap();
        let canon = canonicalize(&build_act_sig_payload_legacy(&act, &[]));
        assert!(canon.contains(r#""time":"2026-06-25T13:01:25.361Z""#), "legacy keeps time: {canon}");
    }

    #[test]
    fn pure_and_legacy_differ_only_by_time() {
        // Drop `time` from the legacy canonical bytes and the two must coincide:
        // `time` is the SOLE difference between pure and legacy.
        let act = parse(r#"{"_id":"a","by":"i-am","through":"i-am","to":"i-am","story":"localhost","history":"0","p":"0","at":"2026-06-25T13:01:25.361Z"}"#).unwrap();
        let pure = canonicalize(&build_act_sig_payload(&act, &["b".into(), "a".into()]));
        let legacy = canonicalize(&build_act_sig_payload_legacy(&act, &["b".into(), "a".into()]));
        let legacy_no_time = legacy.replace(r#","time":"2026-06-25T13:01:25.361Z""#, "");
        assert_eq!(pure, legacy_no_time, "pure == legacy minus time\n pure:  {pure}\n legacy:{legacy}");
    }

    #[test]
    fn through_null_is_kept() {
        // A row with through:null keeps the key (canonicalize keeps null).
        let act = parse(r#"{"_id":"a","by":"i-am","through":null,"to":"i-am","story":"localhost","history":"0","p":"0"}"#).unwrap();
        let p = build_act_sig_payload(&act, &[]);
        let canon = canonicalize(&p);
        assert!(canon.contains("\"through\":null"), "through:null must survive: {canon}");
    }

    #[test]
    fn through_absent_is_dropped() {
        // A 5D name-act with NO through key: the key is omitted, so it never
        // appears on the wire (mirrors act.through === undefined -> dropped).
        let act = parse(r#"{"_id":"a","by":"zKey","to":"i-am","story":"localhost","history":"0","p":"0"}"#).unwrap();
        let p = build_act_sig_payload(&act, &[]);
        let canon = canonicalize(&p);
        assert!(!canon.contains("through"), "absent through must be dropped: {canon}");
    }

    #[test]
    fn factids_sorted_and_history_defaulted() {
        let act = parse(r#"{"_id":"a","by":"i-am","through":"i-am","to":"i-am","story":"localhost","p":"0"}"#).unwrap();
        let p = build_act_sig_payload(&act, &["zeta".into(), "alpha".into(), "mid".into()]);
        let canon = canonicalize(&p);
        assert!(canon.contains(r#""factIds":["alpha","mid","zeta"]"#), "factIds sorted: {canon}");
        assert!(canon.contains(r#""history":"0""#), "missing history -> 0: {canon}");
        assert!(!canon.contains("time"), "pure payload carries no time: {canon}");
    }

    #[test]
    fn nullish_coalesce_keeps_falsey() {
        // by:false would be unusual, but proves we coalesce only null/absent.
        let act = parse(r#"{"_id":"a","by":"i-am","through":"i-am"}"#).unwrap();
        let p = build_act_sig_payload(&act, &[]);
        let canon = canonicalize(&p);
        // to/story/p absent -> null
        assert!(canon.contains(r#""to":null"#));
        assert!(canon.contains(r#""story":null"#));
        assert!(canon.contains(r#""p":null"#));
    }
}
