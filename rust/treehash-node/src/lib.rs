// treehash-node — the napi FFI wrapper around the zero-dep treehash crate (Tier 1). Each function is a
// thin marshal: JSON in (a stringified JS value), the treehash primitive, a string out. seed/past/
// fact/hash.js + actHash.js delegate to these so the hottest path (every stamp's content-hash) runs in
// Rust, in-process, with NO change to the 9 callers above hash.js. The golden vectors already prove
// these match JS byte-for-byte; this just makes that the running path.
//
// #[napi] exports become camelCase in JS: compute_hash -> computeHash, etc. The treehash primitives are
// called fully-qualified (treehash::compute_hash) so the wrapper fns can share their names.

use napi_derive::napi;
use treehash::{parse, Json, GENESIS_PREV};

fn parse_arg(json: &str) -> napi::Result<Json> {
    parse(json).map_err(|e| napi::Error::from_reason(format!("treehash parse: {e}")))
}

/// `GENESIS_PREV` — the 64-zero chain root.
#[napi]
pub fn genesis_prev() -> String {
    GENESIS_PREV.to_string()
}

/// `computeHash(prev, content)` — sha256(prev + canonicalize(content)). `content` arrives as JSON text
/// (the caller's `JSON.stringify`); canonicalize sorts keys, so the stringify order is irrelevant.
#[napi]
pub fn compute_hash(prev: String, content_json: String) -> napi::Result<String> {
    Ok(treehash::compute_hash(&prev, &parse_arg(&content_json)?))
}

/// `canonicalize(value)` — the canonical-JSON twin (sorted keys, empty-object drop, ES number format).
#[napi]
pub fn canonicalize(value_json: String) -> napi::Result<String> {
    Ok(treehash::canonicalize(&parse_arg(&value_json)?))
}

/// `contentOf(fact)` — the hashable fact projection, returned as JSON text for the caller to `JSON.parse`.
#[napi]
pub fn content_of(fact_json: String) -> napi::Result<String> {
    Ok(treehash::stringify(&treehash::content_of(&parse_arg(&fact_json)?)))
}

/// `contentOfAct(act)` — the hashable act opening, returned as JSON text.
#[napi]
pub fn content_of_act(act_json: String) -> napi::Result<String> {
    Ok(treehash::stringify(&treehash::content_of_act(&parse_arg(&act_json)?)))
}

/// `computeHash(prev, contentOf(fact))` in one call — the fact's content-hash identity from a raw row.
#[napi]
pub fn fact_id(prev: String, fact_json: String) -> napi::Result<String> {
    Ok(treehash::fact_id(&prev, &parse_arg(&fact_json)?))
}

/// `computeActId(prev, act)` — the act's content-hash identity from a raw opening.
#[napi]
pub fn act_id(prev: String, act_json: String) -> napi::Result<String> {
    Ok(treehash::act_id(&prev, &parse_arg(&act_json)?))
}
