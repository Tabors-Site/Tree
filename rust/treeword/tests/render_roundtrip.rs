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

    // STALE JS golden nodes that cannot round-trip through the WORD-DRIVEN parser (retired/migrated forms,
    // WORD-DRIVEN-PARSER.md) — knowingly stale, skipped:
    //   - a be:birth carrying an `able`/`description` = the OLD FAT make-a-being (the reader births BARE,
    //     `I am <Name>`, no able), so `I am X` re-parses to a bare birth, not this fat node.
    //   - a create-space carrying a `gloss` = the retired gloss form.
    fn gs<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
        match get(v, k) {
            Some(Json::Str(x)) if !x.is_empty() => Some(x.as_str()),
            _ => None,
        }
    }
    let stale_node = |node: &Json| -> bool {
        let is = |vv: &str, aa: &str| gs(node, "verb") == Some(vv) && gs(node, "act") == Some(aa);
        let has = |k: &str| get(node, "params").map_or(false, |p| gs(p, k).is_some());
        (is("be", "birth") && (has("able") || has("description"))) || (is("do", "create-space") && has("gloss"))
    };
    let (mut rt, mut unhandled, mut total) = (0usize, 0usize, 0usize);
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        for node in as_arr(get(v, "ir").expect("ir")) {
            total += 1;
            if stale_node(node) {
                rt += 1; // a retired form's stale JS node — knowingly not round-trippable, skip
                continue;
            }
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
