// CORPUS CONFORMANCE — RUST IS THE GOLDEN. The JS parser is dead (reference corpus only); these vectors
// were regenerated FROM this parser (examples/regen_corpus.rs) over every statement in the live `.word`
// vocabulary, and this test now guards IR STABILITY: a change to the parser must reproduce the exact same
// IR over the whole real corpus, or the divergence is INTENTIONAL and the vectors are regenerated in the
// same change — where the diff of corpus.vectors.json is the review surface (every changed `ir` must be
// explainable as the intended migration). Regenerating to silence an accidental divergence is drift.
//
// Order-independent compare via treehash::canonicalize (the same canonical form the hash is defined over).

use treehash::{canonicalize, parse as pj, Json};

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
fn treeword_reproduces_the_golden_ir_on_the_real_corpus() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/corpus.vectors.json"))
        .expect("read corpus.vectors.json (regenerate: cargo run -p treeword --example regen_corpus)");
    let doc = pj(&raw).expect("parse corpus.vectors.json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors"));
    assert!(vectors.len() > 200, "expected a large corpus, got {}", vectors.len());

    let mut pass = 0;
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        let text = as_str(get(v, "text").expect("text"));
        let want = get(v, "ir").expect("ir");
        let got = Json::Arr(treeword::parse(text));
        let (want_c, got_c) = (canonicalize(want), canonicalize(&got));
        if want_c == got_c {
            pass += 1;
        } else {
            let first = text.lines().next().unwrap_or("");
            let tail = if text.contains('\n') { " [+body]" } else { "" };
            fails.push(format!("  {first}{tail}"));
        }
    }
    if std::env::var("DUMP").is_ok() {
        for f in &fails {
            println!("{f}");
        }
    }
    println!("  treeword CORPUS IR-STABILITY (Rust golden):  {}/{} identical", pass, vectors.len());
    assert!(
        fails.is_empty(),
        "{} of {} statements diverge from the golden IR (intentional? regenerate the vectors in this \
         change and review the corpus.vectors.json diff):\n{}",
        vectors.len() - pass,
        pass + fails.len(),
        fails.join("\n")
    );
}
