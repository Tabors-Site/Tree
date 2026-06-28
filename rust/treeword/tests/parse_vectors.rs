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

#[test]
fn flow_header_conformance() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/header.vectors.json"))
        .expect("read header.vectors.json");
    let doc = parse_json(&raw).expect("parse header.vectors.json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors"));

    let mut pass = 0;
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        let name = as_str(get(v, "name").expect("name"));
        let line = as_str(get(v, "line").expect("line"));
        let sv = as_str(get(v, "stateVar").expect("stateVar"));
        let want = get(v, "node").expect("node");
        match treeword::parse_header(line, sv) {
            Some(got) if canonicalize(&got) == canonicalize(want) => pass += 1,
            other => fails.push(format!(
                "  {name} {line:?}\n    want: {}\n    got:  {}",
                canonicalize(want),
                other.map(|g| canonicalize(&g)).unwrap_or_else(|| "None".to_string())
            )),
        }
    }
    println!("  treeword FLOW HEADERS (Rust) vs parseHeader:  {}/{} byte-identical", pass, vectors.len());
    assert!(fails.is_empty(), "flow-header mismatches:\n{}", fails.join("\n"));
}

#[test]
fn guard_conformance() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/guard.vectors.json"))
        .expect("read guard.vectors.json");
    let doc = parse_json(&raw).expect("parse guard.vectors.json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors"));

    let mut pass = 0;
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        let name = as_str(get(v, "name").expect("name"));
        let line = as_str(get(v, "line").expect("line"));
        let want_fwd = matches!(get(v, "forward"), Some(JsonValue::Bool(true)));
        let want_cap = matches!(get(v, "capitals"), Some(JsonValue::Bool(true)));
        let got_fwd = treeword::guard_forward(line);
        let got_cap = treeword::guard_capitals(line);
        if got_fwd == want_fwd && got_cap == want_cap {
            pass += 1;
        } else {
            fails.push(format!(
                "  {name} {line:?}: forward want {want_fwd} got {got_fwd}; capitals want {want_cap} got {got_cap}"
            ));
        }
    }
    println!("  treeword GUARDS (Rust) vs JS guards:  {}/{} match", pass, vectors.len());
    assert!(fails.is_empty(), "guard mismatches:\n{}", fails.join("\n"));
}

#[test]
fn condition_leaf_conformance() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/cond.vectors.json"))
        .expect("read cond.vectors.json");
    let doc = parse_json(&raw).expect("parse cond.vectors.json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors"));

    let mut pass = 0;
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        let name = as_str(get(v, "name").expect("name"));
        let input = as_str(get(v, "input").expect("input"));
        let want = get(v, "node").expect("node");
        let got = treeword::parse_leaf(input);
        if canonicalize(&got) == canonicalize(want) {
            pass += 1;
        } else {
            fails.push(format!("  {name} {input:?}\n    want: {}\n    got:  {}", canonicalize(want), canonicalize(&got)));
        }
    }
    println!("  treeword CONDITION LEAVES (Rust) vs parseLeaf:  {}/{} byte-identical", pass, vectors.len());
    assert!(fails.is_empty(), "condition-leaf mismatches:\n{}", fails.join("\n"));
}
