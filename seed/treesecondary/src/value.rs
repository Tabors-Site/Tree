// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Tiny JSON helpers over treehash::Json for the secondary-projection folds. The
// rows these folds build are byte-compatible with the JS projStore rows, and
// treehash::stringify serializes in INSERTION ORDER (no key sort, like
// JSON.stringify). So the fold builders push keys in the exact order the JS
// applyUpdate produces (traced from projStore.js: _id first, then $set keys in
// literal order, then $setOnInsert extras, then $addToSet). undefined fields the
// JS drops (JSON.stringify drops undefined) are simply never pushed here.

pub use treehash::Json;

/// Field lookup on an object (None if not an object or key absent).
pub fn get<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).map(|(_, x)| x),
        _ => None,
    }
}

/// A string field, or None when absent / null / non-string.
pub fn str_of<'a>(v: &'a Json, key: &str) -> Option<&'a str> {
    match get(v, key) {
        Some(Json::Str(s)) => Some(s),
        _ => None,
    }
}

/// A numeric field, or None when absent / non-number.
pub fn num_of(v: &Json, key: &str) -> Option<f64> {
    match get(v, key) {
        Some(Json::Num(n)) => Some(*n),
        _ => None,
    }
}

/// `fact.params` as an object, or an empty object (JS `fact.params || {}`).
pub fn params(fact: &Json) -> Json {
    match get(fact, "params") {
        Some(p @ Json::Obj(_)) => p.clone(),
        _ => Json::Obj(Vec::new()),
    }
}

/// `fact.of` - the reel-owner ref. Returns (kind, id) when both present.
pub fn of_ref(fact: &Json) -> Option<(String, String)> {
    let of = get(fact, "of")?;
    let kind = str_of(of, "kind")?.to_string();
    let id = str_of(of, "id")?.to_string();
    Some((kind, id))
}

/// JS truthiness on an optional value.
pub fn truthy(v: Option<&Json>) -> bool {
    match v {
        None | Some(Json::Null) => false,
        Some(Json::Bool(b)) => *b,
        Some(Json::Num(n)) => *n != 0.0 && !n.is_nan(),
        Some(Json::Str(s)) => !s.is_empty(),
        Some(Json::Arr(_) | Json::Obj(_)) => true,
    }
}

/// `a || b` (truthy-or): clone `a` when truthy, else `b`.
pub fn or_truthy(a: Option<&Json>, b: Json) -> Json {
    if truthy(a) {
        a.unwrap().clone()
    } else {
        b
    }
}

/// `a ?? b` (nullish): clone `a` unless it is null/absent.
pub fn nullish(a: Option<&Json>, b: Json) -> Json {
    match a {
        Some(x) if !matches!(x, Json::Null) => x.clone(),
        _ => b,
    }
}

/// `Number.isFinite(x)` - finite f64 (not NaN, not +/-Inf). Mirrors the JS guard.
pub fn is_finite_num(v: &Json) -> bool {
    matches!(v, Json::Num(n) if n.is_finite())
}

// ── insertion-order object builder (byte-compat with JSON.stringify) ─────────
/// Build a row by pushing (key, value) pairs in order; an absent (None) value is
/// SKIPPED entirely (the JS leaves the field undefined and JSON.stringify drops
/// it). Use this to assemble a fresh row in the exact JS key order.
pub struct RowBuilder {
    pairs: Vec<(String, Json)>,
}
impl RowBuilder {
    pub fn new() -> Self {
        RowBuilder { pairs: Vec::new() }
    }
    /// Push key=value (always emitted, even null).
    pub fn put(mut self, key: &str, value: Json) -> Self {
        self.pairs.push((key.to_string(), value));
        self
    }
    /// Push key=value only when Some; a None is dropped (the JS `undefined` case).
    pub fn put_opt(mut self, key: &str, value: Option<Json>) -> Self {
        if let Some(v) = value {
            self.pairs.push((key.to_string(), v));
        }
        self
    }
    pub fn build(self) -> Json {
        Json::Obj(self.pairs)
    }
}

impl Default for RowBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Set/overwrite a key on an existing object, preserving position if present and
/// appending (insertion order) when new. Mirrors `Object.assign(row, {k:v})`.
pub fn obj_set(obj: &Json, key: &str, value: Json) -> Json {
    let mut e: Vec<(String, Json)> = match obj {
        Json::Obj(x) => x.clone(),
        _ => Vec::new(),
    };
    match e.iter_mut().find(|(k, _)| k == key) {
        Some(slot) => slot.1 = value,
        None => e.push((key.to_string(), value)),
    }
    Json::Obj(e)
}

/// `$addToSet` of a list of string ids onto an array field (dedup, preserve order,
/// append at the array's tail). Mirrors projStore applyUpdate's $addToSet.
pub fn add_to_set(obj: &Json, key: &str, ids: &[String]) -> Json {
    let mut cur: Vec<Json> = match get(obj, key) {
        Some(Json::Arr(a)) => a.clone(),
        _ => Vec::new(),
    };
    for id in ids {
        if !cur.iter().any(|x| matches!(x, Json::Str(s) if s == id)) {
            cur.push(Json::Str(id.clone()));
        }
    }
    obj_set(obj, key, Json::Arr(cur))
}
