// THE DRIFT GATE (WORD-DRIVEN-PARSER.md, mechanical form) — a RATCHET over this crate's own sources.
//
// THE ONE RULE: a new sentence form is a new WORD declared in `.word`, NEVER a new regex in Rust — and
// per-verb string arms in the reader are the SAME drift relocated (the "sneaky form" tripwire). This
// test makes both mechanical:
//
//   * REGEX CENSUS: lines containing `Regex::new(` per source file may never EXCEED the checked-in
//     baseline (tests/drift_baseline.json). When migration deletes regexes, the count SHRINKS — and the
//     gate then fails the other way ("lower the baseline") so the win is locked in and can never regrow.
//
//   * STRING-LITERAL-ARM CENSUS: `"literal" =>` match arms in reader.rs (per-verb IR shapes, WASD keys,
//     role prepositions — meaning as Rust data) under the same ratchet. The endgame is 0: verbs, roles
//     and shapes read from the declared frames (verbs.word), not match arms.
//
// Raising a baseline number is NEVER the fix. Declare the form in `.word` and read it generically.

use std::collections::HashMap;

use treehash::Json;

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}

fn baseline(key: &str) -> HashMap<String, usize> {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/drift_baseline.json"))
        .expect("read drift_baseline.json");
    let doc = treehash::parse(&raw).expect("parse drift_baseline.json");
    match get(&doc, key) {
        Some(Json::Obj(e)) => e
            .iter()
            .map(|(k, v)| {
                let n = match v {
                    Json::Num(n) => *n as usize,
                    _ => panic!("baseline {key}.{k} is not a number"),
                };
                (k.clone(), n)
            })
            .collect(),
        _ => panic!("drift_baseline.json has no {key}"),
    }
}

fn src(rel: &str) -> String {
    std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel))
        .unwrap_or_else(|_| panic!("read {rel}"))
}

fn ratchet(census: &str, counts: HashMap<String, usize>, base: HashMap<String, usize>) {
    for (file, have) in &counts {
        let allowed = base.get(file).copied().unwrap_or(0);
        assert!(
            *have <= allowed,
            "DRIFT ({census}): {file} has {have}, baseline allows {allowed}. Do NOT raise the baseline — \
             the form belongs in .word (WORD-DRIVEN-PARSER.md, THE ONE RULE / the sneaky form)."
        );
        assert!(
            *have >= allowed,
            "RATCHET ({census}): {file} shrank to {have} but the baseline still says {allowed} — lower \
             the baseline in tests/drift_baseline.json so the win can never regrow."
        );
    }
    for file in base.keys() {
        assert!(counts.contains_key(file), "baseline names {file} but it was not censused (renamed? update the baseline)");
    }
}

#[test]
fn regex_census_never_grows() {
    let base = baseline("regex_lines_per_file");
    let mut counts = HashMap::new();
    for file in base.keys() {
        let n = src(file).lines().filter(|l| l.contains("Regex::new(")).count();
        counts.insert(file.clone(), n);
    }
    // a NEW source file with regexes must enter the baseline explicitly (review surface).
    for ent in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/src")).expect("read src/").flatten() {
        let name = format!("src/{}", ent.file_name().to_string_lossy());
        if name.ends_with(".rs") && !counts.contains_key(&name) {
            let n = src(&name).lines().filter(|l| l.contains("Regex::new(")).count();
            assert_eq!(n, 0, "DRIFT: new file {name} contains {n} Regex::new lines — not in the baseline");
        }
    }
    ratchet("Regex::new lines", counts, base);
}

#[test]
fn string_literal_arms_never_grow() {
    let base = baseline("string_literal_arms");
    let mut counts = HashMap::new();
    for file in base.keys() {
        let n = src(file)
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                t.starts_with('"') && t.contains("\" =>")
            })
            .count();
        counts.insert(file.clone(), n);
    }
    ratchet("\"literal\" => arms", counts, base);
}
