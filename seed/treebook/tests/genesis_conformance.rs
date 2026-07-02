// GENESIS FACT-CONFORMANCE — the safety net under the whole word-foundation migration (the plan's M0.2).
// Replants the full genesis TWICE and asserts:
//
//   1. DETERMINISM: two plants (two random story keys) produce the IDENTICAL key-independent
//      fingerprint — coined word names in first-coin chain order, each coin's binding kind, the space
//      anchors, the delegate roster, the tallies. If a key-derived or clock-derived value ever leaks
//      into the fingerprinted surface, the twin plants diverge and this fails.
//
//   2. STABILITY: the fingerprint matches the checked-in golden (tests/genesis.fingerprint.json).
//      Every migration step (words moving to the rust store, the reader going word-driven, op renames)
//      must either keep this fingerprint byte-identical or regenerate it IN THE SAME CHANGE —
//      `REGEN=1 cargo test -p treebook --test genesis_conformance` — where the fingerprint diff is the
//      review surface: every changed line must be explainable as the intended change (an op rename shows
//      as exactly that word's coin renamed; anything else is drift).
//
// The fingerprint deliberately EXCLUDES signatures, pubkeys, hashes-of-signed-content, and ords — those
// vary per plant (fresh story key) or are covered by treeverify's chain checks, not conformance.

use treehash::{canonicalize, Json};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn gs<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}

/// Plant a fresh world and project its key-independent fingerprint.
fn plant_fingerprint(scratch: &str) -> String {
    let dir = std::env::temp_dir().join(scratch);
    let _ = std::fs::remove_dir_all(&dir);
    let born = treebook::full_genesis(&dir).expect("the world is born");

    // the coined vocabulary IN FIRST-COIN CHAIN ORDER off the being Am's reel (the fold order itself),
    // each with its binding kind — the word-set the whole system resolves against.
    let mut coins: Vec<Json> = Vec::new();
    for f in treestore::read_reel_file(&dir, "0", "being", treebook::AM_BEING, None, None) {
        if gs(&f, "verb") != Some("do") || gs(&f, "act") != Some("coin") {
            continue;
        }
        let params = match get(&f, "params") {
            Some(p) => p,
            None => continue,
        };
        let name = gs(params, "word").unwrap_or("");
        let kind = get(params, "binding").and_then(|b| gs(b, "kind")).unwrap_or("");
        coins.push(Json::Obj(vec![("word".into(), jstr(name)), ("kind".into(), jstr(kind))]));
    }

    let pairs = |v: &[(String, String)]| -> Json {
        Json::Arr(v.iter().map(|(a, b)| Json::Arr(vec![jstr(a), jstr(b)])).collect())
    };
    let fp = Json::Obj(vec![
        ("vocabulary_coined".into(), Json::Num(born.vocabulary_coined as f64)),
        ("grants_laid".into(), Json::Num(born.grants_laid as f64)),
        ("coins".into(), Json::Arr(coins)),
        ("spaces".into(), pairs(&born.spaces)),
        ("delegates".into(), pairs(&born.delegates)),
    ]);
    let _ = std::fs::remove_dir_all(&dir);
    canonicalize(&fp)
}

#[test]
fn genesis_fingerprint_is_deterministic_and_matches_the_golden() {
    let a = plant_fingerprint("treebook-genesis-conformance-a");

    let golden_path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/genesis.fingerprint.json");
    if std::env::var("REGEN").is_ok() {
        // at GENERATION time, prove the fingerprint is key-independent with a twin plant (a second
        // random story key). A normal run needs no twin: the golden came from a DIFFERENT key, so any
        // key-derived leak into the fingerprinted surface fails the comparison below by itself.
        let b = plant_fingerprint("treebook-genesis-conformance-b");
        assert_eq!(a, b, "two plants (two story keys) must fingerprint IDENTICALLY — a key/clock leak?");
        std::fs::write(golden_path, &a).expect("write golden fingerprint");
        println!("regenerated {golden_path}");
        return;
    }
    let golden = std::fs::read_to_string(golden_path)
        .expect("read genesis.fingerprint.json (regenerate: REGEN=1 cargo test -p treebook --test genesis_conformance)");
    assert_eq!(
        a,
        golden.trim(),
        "the genesis fingerprint drifted from the golden — intentional? regenerate IN THIS CHANGE \
         (REGEN=1) and review the fingerprint diff line by line"
    );
}
