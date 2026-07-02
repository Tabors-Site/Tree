// The VERTICAL SLICE: a Word → IR → fact → stamp → verify, ENTIRELY in Rust, no Node.
//
// treeword PARSES the word to IR; a minimal `rasterize` maps an act IR node to a fact spec; treestore
// STAMPS it (compute_fact_doc + the fsync'd reel append); treeverify CONFIRMS the on-disk chain. This
// closes the pipe end-to-end. (The rasterize here is a DIRECT field map — verb/act/of/params/through;
// the full JS evaluator's enrichment/auth/IBP-resolution is the deferred richer mapping. This proves
// the pipe shape: words flow in, get data-shaped, and Rust stamps them as they pass through.)

use treestore::{compute_fact_doc, read_reel_file, verify_fact_chain, write_fact_doc, Head, Json};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn get_str<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn verdict_ok(v: &Json) -> bool {
    matches!(v, Json::Obj(e) if e.iter().any(|(k, x)| k == "ok" && matches!(x, Json::Bool(true))))
}

/// Minimal rasterize: an act IR node → (reel kind, reel id, fact spec). A direct field map; the JS
/// evaluator's enrichment is the deferred richer mapping.
fn rasterize(node: &Json) -> Option<(String, String, Json)> {
    if get_str(node, "kind") != Some("act") {
        return None;
    }
    let verb = get_str(node, "verb")?;
    let act = get_str(node, "act")?;
    let by = get_str(node, "by").unwrap_or("I");
    let of = get(node, "of")?;
    let kind = get_str(of, "kind")?.to_string();
    let id = get_str(of, "id")?.to_string();
    let params = get(node, "params").cloned().unwrap_or_else(|| Json::Obj(vec![]));
    let spec = Json::Obj(vec![
        ("through".to_string(), jstr(by)),
        ("verb".to_string(), jstr(verb)),
        ("act".to_string(), jstr(act)),
        ("of".to_string(), of.clone()),
        ("params".to_string(), params),
    ]);
    Some((kind, id, spec))
}

#[test]
fn word_to_fact_pipe_pure_rust() {
    let dir = std::env::temp_dir().join("treeos-word-pipe-test");
    let _ = std::fs::remove_dir_all(&dir);

    // 1. PARSE (treeword): word text → IR
    let ir = treeword::parse("I make garden.");
    assert!(!ir.is_empty(), "parsed at least one node");
    let node = &ir[0];

    // 2. RASTERIZE: act IR node → reel + fact spec
    let (kind, id, spec) = rasterize(node).expect("rasterize the act node");
    assert_eq!((kind.as_str(), id.as_str()), ("space", "garden"), "I make garden -> make on (space, garden)");

    // 3. STAMP (treestore): derive identity + fsync'd reel append
    let stamped = compute_fact_doc("0", &spec, &Head::genesis(), None);
    let w = write_fact_doc(&dir, "0", &kind, &id, &stamped.doc).expect("write_fact_doc");
    assert!(!w.replayed, "fresh stamp, not a replay");

    // 4. READ BACK + VERIFY (treestore + treeverify): the chain holds
    let facts = read_reel_file(&dir, "0", &kind, &id, None, None);
    assert_eq!(facts.len(), 1, "the fact landed on its reel");
    assert_eq!(get_str(&facts[0], "act"), Some("make"), "the fact carries the word's act");
    assert!(verdict_ok(&verify_fact_chain(&facts)), "the on-disk chain verifies");

    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  WORD->FACT pipe (pure Rust): parse 'I make garden.' -> rasterize -> stamp -> verify  OK  (_id={})",
        get_str(&facts[0], "_id").unwrap_or("")
    );
}

#[test]
fn richer_rasterize_non_do_act_through_the_stamper() {
    // The RICHER rasterize (treeval) feeding the real stamper: a NON-do act IR + an eval context ->
    // treeval::rasterize_emit (the evaluator's emit path + resolvers, byte-identical to evaluator.js)
    // -> the exact fact spec -> treestore stamp -> treeverify. Unlike the minimal map above, the
    // resolvers actually RUN: `by: I` becomes the identity's nameId and `$name` resolves to its binding.
    let dir = std::env::temp_dir().join("treeos-richer-rasterize-test");
    let _ = std::fs::remove_dir_all(&dir);

    // a be:set-truename act with a $-bound param, and a context that binds it
    let act = treehash::parse(
        r#"{"kind":"act","verb":"be","act":"set-truename","by":"I","of":{"kind":"being","id":"b1"},"params":{"trueName":"$name"}}"#,
    ).expect("act IR");
    let ctx = treehash::parse(
        r#"{"identity":{"nameId":"alice","beingId":"b0"},"bindings":{"name":"Alice"},"state":{},"beings":{}}"#,
    ).expect("ctx");

    // 1. RASTERIZE (treeval): act IR + ctx -> the fact spec the JS stamper would seal
    let spec = treeval::rasterize_emit(&act, &ctx, None);
    let of = get(&spec, "of").expect("of");
    let kind = get_str(of, "kind").expect("kind").to_string();
    let id = get_str(of, "id").expect("id").to_string();
    assert_eq!((kind.as_str(), id.as_str()), ("being", "b1"), "the reel is the act's target");
    assert_eq!(get_str(&spec, "by"), Some("alice"), "resolveName: by I -> the identity's nameId");
    assert_eq!(get_str(&spec, "through"), Some("alice"), "through || by -> the actor");
    assert_eq!(get_str(get(&spec, "params").unwrap(), "trueName"), Some("Alice"), "resolveValue: $name -> its binding");

    // 2. STAMP (treestore) + 3. VERIFY (treeverify)
    let stamped = compute_fact_doc("0", &spec, &Head::genesis(), None);
    write_fact_doc(&dir, "0", &kind, &id, &stamped.doc).expect("write");
    let facts = read_reel_file(&dir, "0", &kind, &id, None, None);
    assert_eq!(facts.len(), 1, "the richer-rasterized fact landed");
    assert_eq!(get_str(&facts[0], "act"), Some("set-truename"));
    assert!(verdict_ok(&verify_fact_chain(&facts)), "the richer-rasterized fact's chain verifies");

    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  RICHER pipe (pure Rust): non-do act + ctx -> treeval::rasterize_emit -> stamp -> verify  OK  (by=alice, trueName=Alice, _id={})",
        get_str(&facts[0], "_id").unwrap_or("")
    );
}
