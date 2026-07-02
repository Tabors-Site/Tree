// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The stamp — where an act turns into a fact. Ports fileStore.js `computeFactDoc` + the moment's
// `ord` attach + the reel-line serialization. PURE given (spec, head, ord):
//   seq = head.head + 1 ; p = head.headHash ; _id = compute_hash(p, content_of(full))
// The reel-line APPEND of `fact_line(doc)` is THE stamp (the act of laying the fact mark); this
// module produces the exact bytes + the next head, byte-for-byte the JS.

use treehash::{compute_hash, content_of, stringify, Json};

pub const GENESIS_PREV: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

/// A reel's derived head: the seq counter + chain root. On disk: `.head` = `{head, headHash}`.
#[derive(Debug, Clone, PartialEq)]
pub struct Head {
    pub head: f64,
    pub head_hash: String,
}
impl Head {
    pub fn genesis() -> Self {
        Head { head: 0.0, head_hash: GENESIS_PREV.to_string() }
    }
}

/// The stamp result: the full fact doc (what a reel line is) + the head after it.
#[derive(Debug, Clone)]
pub struct Stamped {
    pub doc: Json,
    pub next_head: Head,
}

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj_entries(v: &Json) -> Vec<(String, Json)> {
    match v {
        Json::Obj(e) => e.clone(),
        _ => Vec::new(),
    }
}
/// JS object spread semantics: set `key`, overriding in place if present, else appending at the tail.
fn set_in_place(entries: &mut Vec<(String, Json)>, key: &str, val: Json) {
    if let Some(e) = entries.iter_mut().find(|(k, _)| k == key) {
        e.1 = val;
    } else {
        entries.push((key.to_string(), val));
    }
}
/// `typeof spec.history === "string" && spec.history.length` → that string, else None.
fn nonempty_str_field(v: &Json, key: &str) -> Option<String> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).and_then(|(_, x)| match x {
            Json::Str(s) if !s.is_empty() => Some(s.clone()),
            _ => None,
        }),
        _ => None,
    }
}

/// `computeFactDoc`: derive a fact's full identity (seq, p, _id) from (spec, head), build the reel doc
/// with the EXACT JS key order — `{_id, p, seq, ...full}` where `full = {...spec, history, seq, p}` —
/// and attach the non-digest append ordinal `ord` (if any) at the tail. `_id` is hashed over
/// `content_of(full)`, which excludes `ord`/`p`/`seq`/`_id`/`date`, so the ordinal never moves the id.
pub fn compute_fact_doc(history: &str, spec: &Json, head: &Head, ord: Option<f64>) -> Stamped {
    let seq = head.head + 1.0;
    let p = head.head_hash.clone();
    let fact_history = nonempty_str_field(spec, "history").unwrap_or_else(|| history.to_string());

    // full = { ...spec, history: factHistory, seq, p }
    let mut full = obj_entries(spec);
    set_in_place(&mut full, "history", jstr(&fact_history));
    set_in_place(&mut full, "seq", Json::Num(seq));
    set_in_place(&mut full, "p", jstr(&p));

    let id = compute_hash(&p, &content_of(&Json::Obj(full.clone())));

    // doc = { _id, p, seq, ...full } — _id,p,seq lead; full's remaining keys follow in full's order.
    let mut doc: Vec<(String, Json)> = vec![
        ("_id".to_string(), jstr(&id)),
        ("p".to_string(), jstr(&p)),
        ("seq".to_string(), Json::Num(seq)),
    ];
    for (k, v) in &full {
        if k == "_id" || k == "p" || k == "seq" {
            continue;
        }
        doc.push((k.clone(), v.clone()));
    }
    // doc.ord = ord (appended at the tail; non-digest, exactly like `date`).
    if let Some(o) = ord {
        set_in_place(&mut doc, "ord", Json::Num(o));
    }

    Stamped {
        doc: Json::Obj(doc),
        next_head: Head { head: seq, head_hash: id },
    }
}

/// The reel line: `JSON.stringify(doc) + "\n"`. The fsync'd append of this line IS the stamp.
pub fn fact_line(doc: &Json) -> String {
    let mut s = stringify(doc);
    s.push('\n');
    s
}
