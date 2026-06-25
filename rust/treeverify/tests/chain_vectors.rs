// Conformance: treeverify's chain walk must reproduce the JS verifyReel / verifyActChain verdict
// byte-for-byte across every break shape. Golden vectors are built by the generator from the REAL
// JS hash primitives (computeHash/contentOf, computeActId/contentOfAct), so a green run means the
// Rust re-hash + p-link walk agrees with the JS integrity check on valid AND tampered chains.

use treeverify::{canonicalize, parse, verify_act_chain, verify_fact_chain, Json};

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
fn chain_verify_conformance_against_golden() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/chain.vectors.json"))
        .expect("read chain.vectors.json");
    let doc = parse(&raw).expect("parse chain.vectors.json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors key"));

    let total = vectors.len();
    let mut pass = 0;
    let mut failures: Vec<String> = Vec::new();

    for v in vectors {
        let kind = as_str(get(v, "kind").expect("kind"));
        let name = as_str(get(v, "name").expect("name"));
        let items = as_arr(get(v, "items").expect("items"));
        let want = canonicalize(get(v, "verdict").expect("verdict"));

        let got_verdict = match kind {
            "fact" => verify_fact_chain(items),
            "act" => verify_act_chain(items),
            other => panic!("unknown chain kind {other:?} in vector {name}"),
        };
        let got = canonicalize(&got_verdict);

        if got == want {
            pass += 1;
        } else {
            failures.push(format!("  {name} [{kind}]\n    want: {want}\n    got:  {got}"));
        }
    }

    println!(
        "  treeverify (Rust) vs golden chain verdicts:  {}/{} byte-identical",
        pass, total
    );
    assert!(failures.is_empty(), "chain verdict mismatches:\n{}", failures.join("\n"));
}
