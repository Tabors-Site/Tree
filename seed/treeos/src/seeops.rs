// seeops.rs — pure SEE ops, dispatched as MOMENTS (the new IBP shape: a SEE never stamps, so it IS a
// moment — a perceive that computes a view). NOT HTTP routes; reached over the wire through the `moment`
// verb (ibp.rs), one of the two primitives. Today: classify-matter (treematter) + address (treeaddress).
// Errors ride the view as an IBP envelope (treeprotocol). Pure compute — no act, no fact, no I/O.

use std::path::Path;

use treehash::Json;
use treeprotocol::{code, IbpError};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn get_str(v: &Json, k: &str) -> Option<String> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}
fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// Dispatch a SEE-op moment by name. None = not a see-op (the moment handler then perceives a stored
/// target instead). The returned Json IS the perceived view.
pub fn see_op(op: &str, args: &Json, _root: &Path) -> Option<Json> {
    match op {
        "classify-matter" => Some(classify_view(args)),
        "address" => Some(address_view(args)),
        _ => None,
    }
}

/// "What matter type would this become?" — ranked candidates over the kernel seed types (extension
/// types fold from the chain on top; not wired here yet).
fn classify_view(args: &Json) -> Json {
    let input = treematter::ClassifyInput {
        mime_type: get_str(args, "mimeType"),
        file_name: get_str(args, "fileName"),
        url: get_str(args, "url"),
        ibpa: get_str(args, "ibpa"),
        text: get_str(args, "text"),
    };
    let rows: Vec<Json> = treematter::classify_matter(&input, &treematter::seed_types())
        .into_iter()
        .map(|c| obj(vec![("type", Json::Str(c.type_name)), ("score", Json::Num(c.score)), ("reason", Json::Str(c.reason))]))
        .collect();
    obj(vec![("candidates", Json::Arr(rows))])
}

/// Parse + canonicalize an IBP address (a pure read). An invalid address surfaces as an
/// ADDRESS_PARSE_ERROR envelope inside the view (a moment never throws on the wire — it perceives).
fn address_view(args: &Json) -> Json {
    let input = match get_str(args, "input") {
        Some(s) => s,
        None => return IbpError::new(code::INVALID_INPUT, "missing 'input'").envelope(),
    };
    let ctx = treeaddress::Ctx { current_story: get_str(args, "currentStory"), ..Default::default() };
    let parsed = match treeaddress::parse(&input, &ctx) {
        Ok(p) => p,
        Err(e) => return IbpError::new(code::ADDRESS_PARSE_ERROR, e.message).envelope(),
    };
    let canonical = treeaddress::format(&treeaddress::expand(&parsed, &ctx));
    obj(vec![
        ("canonical", Json::Str(canonical)),
        ("right", stance_json(&parsed.right)),
        ("left", parsed.left.as_ref().map(stance_json).unwrap_or(Json::Null)),
    ])
}

fn stance_json(s: &treeaddress::Stance) -> Json {
    let opt = |o: &Option<String>| o.clone().map(Json::Str).unwrap_or(Json::Null);
    obj(vec![
        ("story", opt(&s.story)),
        ("history", opt(&s.history)),
        ("historyPointer", opt(&s.history_pointer)),
        ("path", opt(&s.path)),
        ("being", opt(&s.being)),
    ])
}
