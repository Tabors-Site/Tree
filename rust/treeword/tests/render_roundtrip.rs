// RENDER round-trip: the renderer (Word IR -> Word text) is the INVERSE of the parser, verified
// self-contained — for every node in the real corpus, parse(render(node)) must equal [node]. The parser
// is many-to-one (several texts fold to one IR), so render need only produce a text that re-parses to the
// SAME IR. Drives the renderer like the parse-conformance test drove the parser: unhandled forms (None)
// are allowed (later slices); every form render DOES emit must round-trip exactly.

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

#[test]
fn render_round_trips_through_the_parser() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/corpus.vectors.json"))
        .expect("read corpus.vectors.json");
    let doc = pj(&raw).expect("parse corpus.vectors.json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors"));

    let (mut rt, mut unhandled, mut total) = (0usize, 0usize, 0usize);
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        for node in as_arr(get(v, "ir").expect("ir")) {
            total += 1;
            match treeword::render::render(node) {
                None => {
                    unhandled += 1;
                    if std::env::var("SHOW_UNHANDLED").is_ok() {
                        eprintln!("UNHANDLED: {}", canonicalize(node));
                    }
                }
                Some(text) => {
                    let reparsed = canonicalize(&Json::Arr(treeword::parse(&text)));
                    let want = canonicalize(&Json::Arr(vec![node.clone()]));
                    if reparsed == want {
                        rt += 1;
                    } else if fails.len() < 30 {
                        fails.push(format!("  node:     {}\n  rendered: {text:?}\n  reparsed: {reparsed}", want));
                    }
                }
            }
        }
    }
    println!(
        "  treeword RENDER round-trip:  {}/{} nodes round-trip  ({} unhandled [later slices], {} MISMATCH)",
        rt,
        total,
        unhandled,
        total - rt - unhandled
    );
    // every form render DOES emit must round-trip; unhandled (None) is fine for now.
    assert!(fails.is_empty(), "{} rendered forms re-parse to a DIFFERENT IR:\n\n{}", fails.len(), fails.join("\n\n"));
}
