// Conformance: treeword's parser reproduces parser.js's IR node array byte-for-byte (order-independent
// via canonicalize). Golden vectors are produced by the REAL JS parser, so a green run means the Rust
// "words -> data shape" front matches the JS front exactly, for every covered rule.

use treeword::{canonicalize, parse as parse_word, parse_json, JsonValue};

fn get<'a>(v: &'a JsonValue, k: &str) -> Option<&'a JsonValue> {
    match v {
        JsonValue::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn as_arr(v: &JsonValue) -> &[JsonValue] {
    match v {
        JsonValue::Arr(a) => a.as_slice(),
        _ => &[],
    }
}
fn as_str(v: &JsonValue) -> &str {
    match v {
        JsonValue::Str(s) => s.as_str(),
        _ => "",
    }
}

#[test]
fn parser_conformance_against_js() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/parse.vectors.json"))
        .expect("read parse.vectors.json");
    let doc = parse_json(&raw).expect("parse vectors json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors"));

    let mut pass = 0;
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        let name = as_str(get(v, "name").expect("name"));
        let src = as_str(get(v, "src").expect("src"));
        let want = get(v, "ir").expect("ir"); // the JS IR node array
        let got = JsonValue::Arr(parse_word(src));
        if canonicalize(&got) == canonicalize(want) {
            pass += 1;
        } else {
            fails.push(format!("  {name} {src:?}\n    want: {}\n    got:  {}", canonicalize(want), canonicalize(&got)));
        }
    }
    println!("  treeword PARSER (Rust) vs parser.js:  {}/{} byte-identical IR", pass, vectors.len());
    assert!(fails.is_empty(), "parse IR mismatches:\n{}", fails.join("\n"));
}
