// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Content-addressed identity. Twin of seed/past/fact/hash.js (computeHash,
// contentOf) + seed/past/act/actHash.js (contentOfAct).
//
//   id = SHA-256(prev + "|" + canonical(content))
//
// `contentOf` / `contentOfAct` extract the hashable fields from a fact / act
// row. Absent keys are simply omitted (the JS sets them to `undefined`, which
// canonicalize drops — same result). `history` normalizes an absent/empty
// branch to "0". `date` (and the act's startMessage / wall-clock fields) are
// display witnesses and never enter the digest.

use crate::canon::canonicalize;
use crate::json::Json;
use crate::sha256::sha256_hex;

/// The `p` of the first fact/act on any reel/chain.
pub const GENESIS_PREV: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// `SHA-256(prev + "|" + canonical(content))`, lowercase hex.
pub fn compute_hash(prev: &str, content: &Json) -> String {
    let body = canonicalize(content);
    let mut input = String::with_capacity(prev.len() + 1 + body.len());
    input.push_str(prev);
    input.push('|');
    input.push_str(&body);
    sha256_hex(input.as_bytes())
}

fn obj_get<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, val)| val),
        _ => None,
    }
}

/// `history` field, normalized: a non-empty string stays, anything else -> "0".
fn history_of(row: &Json) -> Json {
    match obj_get(row, "history") {
        Some(Json::Str(s)) if !s.is_empty() => Json::Str(s.clone()),
        _ => Json::Str("0".to_string()),
    }
}

/// The hashable content of a Fact row (hash.js `contentOf`). `date` excluded.
pub fn content_of(fact: &Json) -> Json {
    let mut out: Vec<(String, Json)> = Vec::new();
    // Present-or-omit fields (JS `undefined` -> dropped).
    for key in [
        "through", "verb", "act", "of", "seq", "params", "result", "truncated", "actId",
        "sessionId", "homeStory", "wasRemote",
    ] {
        if let Some(v) = obj_get(fact, key) {
            out.push((key.to_string(), v.clone()));
        }
    }
    out.push(("history".to_string(), history_of(fact)));
    // foldSeq only when present AND numeric (PARALLEL FACTS §1.3).
    if let Some(v @ Json::Num(_)) = obj_get(fact, "foldSeq") {
        out.push(("foldSeq".to_string(), v.clone()));
    }
    Json::Obj(out)
}

/// The hashable opening of an Act (actHash.js `contentOfAct`). startMessage and
/// wall-clock fields excluded (moment labels are drift, 2026-06-23).
pub fn content_of_act(act: &Json) -> Json {
    let mut out: Vec<(String, Json)> = Vec::new();
    // `through`: present-or-omit (always present in practice).
    if let Some(v) = obj_get(act, "through") {
        out.push(("through".to_string(), v.clone()));
    }
    // `?? null` fields: absent OR null -> null.
    for key in [
        "to", "ibpAddress", "activeAble", "inboxMessageId", "inReplyTo", "parentThread", "story",
    ] {
        let v = match obj_get(act, key) {
            Some(Json::Null) | None => Json::Null,
            Some(x) => x.clone(),
        };
        out.push((key.to_string(), v));
    }
    out.push(("history".to_string(), history_of(act)));
    Json::Obj(out)
}

/// Fact identity from a raw row: `compute_hash(prev, content_of(row))`.
pub fn fact_id(prev: &str, fact_row: &Json) -> String {
    compute_hash(prev, &content_of(fact_row))
}

/// Act identity from a raw opening: `compute_hash(prev, content_of_act(opening))`.
pub fn act_id(prev: &str, act_opening: &Json) -> String {
    compute_hash(prev, &content_of_act(act_opening))
}
