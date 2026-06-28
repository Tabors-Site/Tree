// Conformance: treeval::cond::resolve_cond reproduces cond.js's resolveCond byte-for-byte (the
// boolean verdict) over parsed cond IR + folded state. Golden vectors come from a faithful JS
// transcription. This is the gate a flow's When-condition rides — same answer as the JS evaluator.

use treehash::{parse as parse_json, Json};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn as_arr(v: &Json) -> &[Json] {
    match v {
        Json::Arr(a) => a.as_slice(),
        _ => &[],
    }
}
fn as_str(v: &Json) -> &str {
    match v {
        Json::Str(s) => s.as_str(),
        _ => "",
    }
}

#[test]
fn resolve_cond_conformance_against_js() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/cond.vectors.json"))
        .expect("read cond.vectors.json");
    let doc = parse_json(&raw).expect("parse cond.vectors.json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors"));

    // no host predicates in these vectors -> fail-closed
    let no_host = |_name: &str, _args: &[Json]| false;

    let mut pass = 0;
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        let name = as_str(get(v, "name").expect("name"));
        let cond = get(v, "cond").expect("cond");
        let ctx = get(v, "ctx").expect("ctx");
        let want = matches!(get(v, "want"), Some(Json::Bool(true)));
        let got = treeval::cond::resolve_cond(cond, ctx, &no_host);
        if got == want {
            pass += 1;
        } else {
            fails.push(format!("  {name}: want {want} got {got}"));
        }
    }
    println!("  treeval CONDITION EVAL (Rust) vs cond.js resolveCond:  {}/{} match", pass, vectors.len());
    assert!(fails.is_empty(), "resolve_cond mismatches:\n{}", fails.join("\n"));
}
