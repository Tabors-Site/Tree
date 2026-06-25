// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Conformance: fold the SAME reels the live JS reducers folded (generated into
// fold.vectors.json) and assert the canonicalized state is byte-identical. Two
// languages, one fold result.

use treefold::*;

const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fold.vectors.json");

fn get<'a>(v: &'a Json, k: &str) -> &'a Json {
    match v {
        Json::Obj(e) => e
            .iter()
            .find(|(kk, _)| kk == k)
            .map(|(_, x)| x)
            .unwrap_or_else(|| panic!("missing field {k}")),
        _ => panic!("expected object for {k}"),
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
fn fold_conformance_against_golden_reels() {
    let txt = std::fs::read_to_string(PATH).expect("read fold.vectors.json");
    let v = parse(&txt).expect("parse fold vectors");

    let mut pass = 0usize;
    let mut fails: Vec<String> = Vec::new();

    for r in arr(get(&v, "reels")) {
        let kind = st(get(r, "kind"));
        let name = st(get(r, "name"));
        let facts = arr(get(r, "facts"));

        let state = fold(kind, facts);
        let got = canonicalize(&state);
        let want = st(get(r, "canonical"));
        if got == want {
            pass += 1;
        } else {
            fails.push(format!("{name} [{kind}] state mismatch\n   got: {got}\n   exp: {want}"));
        }

        // matter reels carry the isGone verdict (ended -> tombstone)
        if let Some(g) = opt(r, "isGone") {
            let want_gone = matches!(g, Json::Bool(true));
            let got_gone = is_gone_matter(&state);
            if got_gone == want_gone {
                pass += 1;
            } else {
                fails.push(format!("{name} isGone: got {got_gone}, exp {want_gone}"));
            }
        }
    }

    let total = pass + fails.len();
    eprintln!("\n  treefold (Rust) vs golden reels:  {pass}/{total} byte-identical");
    if !fails.is_empty() {
        eprintln!("\nFAILURES:\n{}", fails.join("\n\n"));
        panic!("{} fold mismatch(es)", fails.len());
    }
}
