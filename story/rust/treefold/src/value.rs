// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Immutable JSON-object helpers over treehash::Json, mirroring the object-spread
// idioms the JS reducers use ({...state, k:v}, delete, {...a,...b}, ?? , ||).
// Object key order is irrelevant: every comparison goes through canonicalize,
// which sorts keys. So these append-on-insert and never worry about ordering.

pub use treehash::Json;

pub fn empty_obj() -> Json {
    Json::Obj(Vec::new())
}
pub fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}

/// Field lookup on an object (None if not an object or key absent).
pub fn get<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).map(|(_, x)| x),
        _ => None,
    }
}

pub fn is_object(v: &Json) -> bool {
    matches!(v, Json::Obj(_))
}
pub fn is_array(v: &Json) -> bool {
    matches!(v, Json::Arr(_))
}
pub fn is_null(v: &Json) -> bool {
    matches!(v, Json::Null)
}
/// JS `typeof v === "object"` — objects AND arrays (callers check null first).
pub fn is_js_object(v: &Json) -> bool {
    matches!(v, Json::Obj(_) | Json::Arr(_))
}

/// `{ ...obj, [key]: val }` — new object with key set (appended if absent).
pub fn set(obj: &Json, key: &str, val: Json) -> Json {
    let mut e: Vec<(String, Json)> = match obj {
        Json::Obj(x) => x.clone(),
        _ => Vec::new(),
    };
    match e.iter_mut().find(|(k, _)| k == key) {
        Some(slot) => slot.1 = val,
        None => e.push((key.to_string(), val)),
    }
    Json::Obj(e)
}

/// `{ ...obj }; delete next[key]` — new object without key.
pub fn del(obj: &Json, key: &str) -> Json {
    let e: Vec<(String, Json)> = match obj {
        Json::Obj(x) => x.iter().filter(|(k, _)| k != key).cloned().collect(),
        _ => Vec::new(),
    };
    Json::Obj(e)
}

/// `{ ...base, ...overlay }` — overlay's keys win.
pub fn merge(base: &Json, overlay: &Json) -> Json {
    let mut out: Vec<(String, Json)> = match base {
        Json::Obj(x) => x.clone(),
        _ => Vec::new(),
    };
    if let Json::Obj(ov) = overlay {
        for (k, v) in ov {
            match out.iter_mut().find(|(kk, _)| kk == k) {
                Some(slot) => slot.1 = v.clone(),
                None => out.push((k.clone(), v.clone())),
            }
        }
    }
    Json::Obj(out)
}

/// JS truthiness.
pub fn truthy(v: &Json) -> bool {
    match v {
        Json::Null => false,
        Json::Bool(b) => *b,
        Json::Num(n) => *n != 0.0 && !n.is_nan(),
        Json::Str(s) => !s.is_empty(),
        Json::Arr(_) | Json::Obj(_) => true,
    }
}

/// `a ?? b` (nullish): a unless it is null/absent.
pub fn nullish(a: Option<&Json>, b: Json) -> Json {
    match a {
        Some(x) if !matches!(x, Json::Null) => x.clone(),
        _ => b,
    }
}

/// `a || b` (truthy-or): a if truthy, else b.
pub fn or_truthy(a: Option<&Json>, b: Json) -> Json {
    match a {
        Some(x) if truthy(x) => x.clone(),
        _ => b,
    }
}

pub fn as_str(v: &Json) -> Option<&str> {
    match v {
        Json::Str(s) => Some(s),
        _ => None,
    }
}

/// Structural equality (value, not identity) — for idempotence checks.
pub fn json_eq(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Null, Json::Null) => true,
        (Json::Bool(x), Json::Bool(y)) => x == y,
        (Json::Num(x), Json::Num(y)) => x == y,
        (Json::Str(x), Json::Str(y)) => x == y,
        (Json::Arr(x), Json::Arr(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| json_eq(p, q)),
        (Json::Obj(x), Json::Obj(y)) => {
            x.len() == y.len()
                && x.iter().all(|(k, v)| y.iter().any(|(k2, v2)| k == k2 && json_eq(v, v2)))
        }
        _ => false,
    }
}
