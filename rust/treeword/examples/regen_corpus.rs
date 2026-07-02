// REGENERATE the corpus golden vectors from THIS parser (Rust is the golden — the JS parser is dead;
// see corpus_conformance.rs). Keeps every statement `text` (the corpus — real statements from the live
// `.word` vocabulary) and rewrites each `ir` to what `treeword::parse` produces NOW.
//
//   cargo run -p treeword --example regen_corpus
//
// Run this ONLY when a divergence is INTENTIONAL (a form migrated to the word-driven reader changed its
// IR on purpose). Regenerating to paper over an accidental divergence is drift — the diff of
// corpus.vectors.json is the review surface: every changed `ir` must be explainable as the intended change.
use treeword::{canonicalize, JsonValue as Json};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}

fn main() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/corpus.vectors.json");
    let raw = std::fs::read_to_string(path).expect("read corpus.vectors.json");
    let doc = treeword::parse_json(&raw).expect("parse corpus.vectors.json");
    let vectors = match get(&doc, "vectors") {
        Some(Json::Arr(a)) => a.clone(),
        _ => panic!("corpus.vectors.json has no vectors array"),
    };
    let mut out: Vec<Json> = Vec::with_capacity(vectors.len());
    let (mut reparsed, mut empty) = (0usize, 0usize);
    for v in &vectors {
        let text = match get(v, "text") {
            Some(Json::Str(s)) => s.clone(),
            _ => panic!("vector without text"),
        };
        let ir = treeword::parse(&text);
        if ir.is_empty() {
            empty += 1;
        }
        reparsed += 1;
        out.push(Json::Obj(vec![
            ("text".into(), Json::Str(text)),
            ("ir".into(), Json::Arr(ir)),
        ]));
    }
    let doc = Json::Obj(vec![("vectors".into(), Json::Arr(out))]);
    std::fs::write(path, canonicalize(&doc)).expect("write corpus.vectors.json");
    println!("regenerated {reparsed} vectors from the Rust parser ({empty} parse to nothing — retired forms)");
}
