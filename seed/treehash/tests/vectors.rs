// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Conformance: the Rust port must reproduce every byte the JS does. We load the
// SAME golden file the JS seed verifies against (seed/past/fact/canon.vectors.json)
// and check canonicalize / computeHash / contentOf / contentOfAct across all four
// sections. Same vectors, two languages, identical output.

use treehash::*;

const VECTORS_PATH: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed/past/fact/canon.vectors.json");

fn get<'a>(v: &'a Json, k: &str) -> &'a Json {
    match v {
        Json::Obj(e) => e
            .iter()
            .find(|(kk, _)| kk == k)
            .map(|(_, x)| x)
            .unwrap_or_else(|| panic!("missing field {k}")),
        _ => panic!("expected object for field {k}"),
    }
}
fn opt<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn arr(v: &Json) -> &[Json] {
    match v {
        Json::Arr(a) => a,
        _ => panic!("expected array"),
    }
}
fn st(v: &Json) -> &str {
    match v {
        Json::Str(s) => s,
        _ => panic!("expected string"),
    }
}

#[test]
fn conformance_against_golden_vectors() {
    let txt = std::fs::read_to_string(VECTORS_PATH).expect("read canon.vectors.json");
    let v = parse(&txt).expect("parse canon.vectors.json with our own parser");

    let mut pass = 0usize;
    let mut fails: Vec<String> = Vec::new();
    let mut check = |label: String, got: String, want: &str| {
        if got == want {
            pass += 1;
        } else {
            fails.push(format!("{label}\n     got: {got}\n     exp: {want}"));
        }
    };

    // 1. canonicalize: input -> canonical
    for c in arr(get(&v, "canonicalize")) {
        let name = st(get(c, "name"));
        check(
            format!("canon/{name}"),
            canonicalize(get(c, "input")),
            st(get(c, "canonical")),
        );
    }

    // 2. computeHash: content -> canonical + hash
    for c in arr(get(&v, "computeHash")) {
        let name = st(get(c, "name"));
        let content = get(c, "content");
        let prev = st(get(c, "prev"));
        check(format!("chash-canon/{name}"), canonicalize(content), st(get(c, "canonical")));
        check(format!("chash/{name}"), compute_hash(prev, content), st(get(c, "hash")));
    }

    // 3. facts: row -> contentOf -> canonical + id
    for f in arr(get(&v, "facts")) {
        let name = st(get(f, "name"));
        let row = get(f, "row");
        let prev = st(get(f, "prev"));
        let content = content_of(row);
        check(format!("fact-canon/{name}"), canonicalize(&content), st(get(f, "canonical")));
        check(format!("fact-id/{name}"), fact_id(prev, row), st(get(f, "id")));
    }

    // 4. acts: opening -> contentOfAct -> canonical + id
    for a in arr(get(&v, "acts")) {
        let name = st(get(a, "name"));
        let opening = get(a, "opening");
        let prev = st(get(a, "prev"));
        let content = content_of_act(opening);
        check(format!("act-canon/{name}"), canonicalize(&content), st(get(a, "canonical")));
        check(format!("act-id/{name}"), act_id(prev, opening), st(get(a, "id")));

        // honor the cross-vector relations the JS file declares
        if let Some(same) = opt(a, "expectSameIdAs") {
            let other = arr(get(&v, "acts"))
                .iter()
                .find(|x| st(get(x, "name")) == st(same))
                .expect("expectSameIdAs target");
            assert_eq!(
                act_id(prev, opening),
                act_id(st(get(other, "prev")), get(other, "opening")),
                "{name} should share id with {}",
                st(same)
            );
        }
    }

    let total = pass + fails.len();
    eprintln!("\n  treehash (Rust) vs golden vectors:  {pass}/{total} byte-identical");
    if !fails.is_empty() {
        eprintln!("\n  FAILURES:\n{}", fails.join("\n"));
        panic!("{} vector(s) did not match the JS", fails.len());
    }
}

#[test]
fn sha256_known_answer() {
    // FIPS 180-4 / NIST known answers, independent of the seed vectors.
    assert_eq!(
        sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn ecmascript_number_formatting() {
    // The cross-language trap: numbers must print as JSON.stringify does.
    let cases: &[(f64, &str)] = &[
        (0.0, "0"),
        (1.0, "1"),
        (1.5, "1.5"),
        (0.1, "0.1"),
        (42.0, "42"),
        (100.0, "100"),
        (9007199254740991.0, "9007199254740991"),
        (1e21, "1e+21"),
        (1e-7, "1e-7"),
        (-0.0, "0"),
    ];
    for (n, want) in cases {
        assert_eq!(&canonicalize(&Json::Num(*n)), want, "number {n}");
    }
}
