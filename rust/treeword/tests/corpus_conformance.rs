// CORPUS CONFORMANCE: the Rust `treeword` parser must reproduce the REAL JS parser's IR byte-for-byte
// over every parseable statement in the live `.word` vocabulary. The golden vectors come from the real
// seed/present/word/parser.js (see gen_corpus_vectors.mjs) — not a transcription — so a match proves the
// port is faithful on real grammar, and a mismatch is a concrete gap to close. Order-independent compare
// via treehash::canonicalize (the same canonical form the hash is defined over).

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
fn treeword_matches_the_js_parser_on_the_real_corpus() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/corpus.vectors.json"))
        .expect("read corpus.vectors.json (run `node tests/gen_corpus_vectors.mjs` to regenerate)");
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
    // FULL PARITY: every parseable statement in the live `.word` vocabulary now parses byte-identical to
    // the real JS parser. A divergence here is a genuine gap to close (or a new grammar form — regenerate
    // the vectors with `node tests/gen_corpus_vectors.mjs`, then port the missing rule). `DUMP=1` lists any.
    println!(
        "  treeword CORPUS CONFORMANCE vs the real JS parser:  {}/{} byte-identical",
        pass,
        vectors.len()
    );
    assert!(
        fails.is_empty(),
        "{} of {} statements diverge from the JS parser:\n{}",
        vectors.len() - pass,
        vectors.len(),
        fails.join("\n")
    );
}
