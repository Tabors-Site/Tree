// THE DRIFT GATE (treeibp) — a RATCHET over op/verb MEANING LITERALS in this crate's source.
//
// treeibp is the floor's execution core: parse → authorize → rasterize → stamp. Op meaning is supposed
// to be FOLD-DRIVEN (op_word_via_fold reads the declared `.word`); every hardcoded `"birth"` /
// `"create-space"` / `"set-being"` literal in lib.rs is a pocket of MEANING frozen in Rust — the
// demotion worklist (the plan's M5: the see-op table, the be:birth special cases, self-move). This test
// counts those literals and ratchets them: the count may never EXCEED the checked-in baseline
// (tests/drift_baseline.json), and when a demotion shrinks it the baseline must be lowered in the same
// change so the win can never regrow. Raising a baseline number is NEVER the fix — the meaning belongs
// in a `.word` (a frame / a fold descriptor), not a new match arm.

use std::collections::HashMap;

use treehash::Json;

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}

#[test]
fn meaning_literal_census_never_grows() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/drift_baseline.json"))
        .expect("read drift_baseline.json");
    let doc = treehash::parse(&raw).expect("parse drift_baseline.json");
    let base: HashMap<String, usize> = match get(&doc, "meaning_literals") {
        Some(Json::Obj(e)) => e
            .iter()
            .map(|(k, v)| match v {
                Json::Num(n) => (k.clone(), *n as usize),
                _ => panic!("baseline {k} is not a number"),
            })
            .collect(),
        _ => panic!("drift_baseline.json has no meaning_literals"),
    };
    let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs")).expect("read src/lib.rs");
    for (lit, allowed) in &base {
        let have = src.matches(lit.as_str()).count();
        assert!(
            have <= *allowed,
            "DRIFT: src/lib.rs now has {have} occurrences of {lit}, baseline allows {allowed}. Do NOT \
             raise the baseline — op meaning is fold-driven (.word), not a new hardcoded literal."
        );
        assert!(
            have >= *allowed,
            "RATCHET: {lit} shrank to {have} but the baseline still says {allowed} — lower it in \
             tests/drift_baseline.json so the demotion can never regrow."
        );
    }
}
