// Conformance: treeval's rasterize reproduces evaluator.js's emit-path fact spec byte-for-byte
// (order-independent via canonicalize). Golden vectors are produced by a faithful transcription of
// evalAct's emit spec + the four resolvers + getPath, run over real act IR nodes + eval contexts. A
// green run means: a NON-do Word, once parsed, rasterizes to the EXACT spec the JS stamper would seal.

use treehash::{canonicalize, parse as parse_json, Json};

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
fn rasterize_emit_conformance_against_js() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/rasterize.vectors.json"))
        .expect("read rasterize.vectors.json");
    let doc = parse_json(&raw).expect("parse rasterize.vectors.json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors"));

    let mut pass = 0;
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        let name = as_str(get(v, "name").expect("name"));
        let act = get(v, "act").expect("act");
        let ctx = get(v, "ctx").expect("ctx");
        let want = get(v, "spec").expect("spec");
        let got = treeval::rasterize_emit(act, ctx, None);
        if canonicalize(&got) == canonicalize(want) {
            pass += 1;
        } else {
            fails.push(format!("  {name}\n    want: {}\n    got:  {}", canonicalize(want), canonicalize(&got)));
        }
    }
    println!("  treeval RASTERIZE (Rust) vs evaluator.js emit-path:  {}/{} byte-identical spec", pass, vectors.len());
    assert!(fails.is_empty(), "rasterize spec mismatches:\n{}", fails.join("\n"));
}
