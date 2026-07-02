// Conformance for the STAMP (where acts turn into facts) + REAL-store interop.
//
//   Proof A — treestore's compute_fact_doc + fact_line + next_head reproduce fileStore.js's
//             computeFactDoc + JSON.stringify(doc) byte-for-byte (the act -> fact identity + the reel
//             line, including key order, spec-history override, the ord tail, and {}-kept).
//   Proof C — Rust parse_reel + verify_fact_chain read and verify a reel the REAL commitMoment wrote
//             to disk: Rust and JS stores are interchangeable (same bytes, same chain).

use treestore::{
    canonicalize, compute_fact_doc, fact_line, parse, parse_reel, verify_fact_chain, Head, Json,
};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn as_str(v: &Json) -> &str {
    match v {
        Json::Str(s) => s.as_str(),
        _ => "",
    }
}
fn as_num(v: &Json) -> f64 {
    match v {
        Json::Num(n) => *n,
        _ => 0.0,
    }
}
fn as_arr(v: &Json) -> &[Json] {
    match v {
        Json::Arr(a) => a.as_slice(),
        _ => &[],
    }
}
fn head_of(v: &Json) -> Head {
    Head {
        head: as_num(get(v, "head").expect("head")),
        head_hash: as_str(get(v, "headHash").expect("headHash")).to_string(),
    }
}
fn verdict_ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

#[test]
fn stamp_conformance_and_real_reel_interop() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/store.vectors.json"))
        .expect("read store.vectors.json");
    let doc = parse(&raw).expect("parse store.vectors.json");

    // ── Proof A: the stamp, byte-for-byte ───────────────────────────────────
    let vectors = as_arr(get(&doc, "stampVectors").expect("stampVectors"));
    let mut pass = 0;
    let mut failures: Vec<String> = Vec::new();
    for v in vectors {
        let name = as_str(get(v, "name").expect("name"));
        let history = as_str(get(v, "history").expect("history"));
        let spec = get(v, "spec").expect("spec");
        let head = head_of(get(v, "head").expect("head"));
        let ord = match get(v, "ord") {
            Some(Json::Num(n)) => Some(*n),
            _ => None,
        };
        let want_line = as_str(get(v, "line").expect("line"));
        let want_head = get(v, "nextHead").expect("nextHead");

        let stamped = compute_fact_doc(history, spec, &head, ord);
        let got_line = fact_line(&stamped.doc);
        let got_head = Json::Obj(vec![
            ("head".to_string(), Json::Num(stamped.next_head.head)),
            ("headHash".to_string(), Json::Str(stamped.next_head.head_hash.clone())),
        ]);

        if got_line == want_line && canonicalize(&got_head) == canonicalize(want_head) {
            pass += 1;
        } else {
            failures.push(format!(
                "  {name}\n    line want: {want_line:?}\n    line got:  {got_line:?}\n    head want: {}\n    head got:  {}",
                canonicalize(want_head),
                canonicalize(&got_head)
            ));
        }
    }
    println!("  treestore STAMP (Rust) vs golden:  {}/{} byte-identical", pass, vectors.len());
    assert!(failures.is_empty(), "stamp mismatches:\n{}", failures.join("\n"));

    // ── Proof C: Rust reads + verifies a reel the REAL commitMoment wrote ────
    let real = get(&doc, "realReel").expect("realReel");
    let reel_text = as_str(get(real, "reelText").expect("reelText"));
    let want_facts = as_arr(get(real, "facts").expect("facts"));
    let head_expected = get(real, "headExpected").expect("headExpected");

    let parsed = parse_reel(reel_text);
    assert_eq!(parsed.len(), want_facts.len(), "real reel: fact count differs from JS readReel");
    for (i, (g, w)) in parsed.iter().zip(want_facts).enumerate() {
        assert_eq!(canonicalize(g), canonicalize(w), "real reel: fact {i} differs from JS");
    }
    let verdict = verify_fact_chain(&parsed);
    assert!(verdict_ok(&verdict), "real reel failed chain verify: {}", canonicalize(&verdict));
    assert_eq!(
        get(&verdict, "headHash").map(as_str).unwrap_or(""),
        as_str(get(head_expected, "headHash").expect("headHash")),
        "real reel: head hash differs from the JS .head",
    );
    println!(
        "  treestore reads the REAL JS reel:  {} facts, chain verified, head matches",
        parsed.len()
    );
}
