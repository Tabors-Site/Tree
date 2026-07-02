// commit_moment: the Word hands over ONE act with its facts inside (deltaF), and the kernel stamps the
// act on its Name's act-chain AND each fact on its reel, one moment ord on both, and returns the ids.
// Both chains verify. A two-moment sequence shows the chains grow. The act/fact divide as one call,
// pure Rust — the entry the http/ws host plugs into to stamp what the Word produced.

use treestore::{
    commit_moment, read_act_chain_file, read_reel_file, verify_act_chain, verify_fact_chain,
    CommitError, Json,
};

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn id_of(v: &Json) -> String {
    match get(v, "_id") {
        Some(Json::Str(s)) => s.clone(),
        _ => String::new(),
    }
}
fn verdict_ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

// The I-Am authors an act whose single deltaF fact does `op` on @be1. The Word computed all of this;
// the caller just sends the act.
fn iam_act(label: &str, fact: Json) -> Json {
    obj(vec![
        ("by", jstr("i-am")), // the signing Name — the act-chain key
        ("through", jstr("i-am")),
        ("to", jstr("i-am")),
        ("story", jstr("main")),
        ("history", jstr("0")),
        ("startMessage", obj(vec![("content", jstr(label)), ("source", jstr("i-am"))])),
        ("deltaF", Json::Arr(vec![fact])),
    ])
}

#[test]
fn commit_moment_stamps_acts_with_their_facts() {
    let dir = std::env::temp_dir().join("treestore-commit-moment");
    let _ = std::fs::remove_dir_all(&dir);

    // Moment 1: a birth act carrying its birth fact.
    let birth = obj(vec![
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("name", jstr("Alice")), ("homeSpace", jstr("sp1"))])),
        ("history", jstr("0")),
    ]);
    let c1 = commit_moment(&dir, &iam_act("birth Alice", birth), 1.0).expect("commit 1");
    assert_eq!(c1.fact_ids.len(), 1, "the act laid one fact");

    // The act landed on the i-am act-chain; the fact landed on be1's reel; both verify.
    let acts = read_act_chain_file(&dir, "main", "0", "i-am");
    let facts = read_reel_file(&dir, "0", "being", "be1", None, None);
    assert_eq!(acts.len(), 1, "one act on the Name's chain");
    assert_eq!(facts.len(), 1, "one fact on the being's reel");
    assert_eq!(id_of(&acts[0]), c1.act_id, "returned act_id == the stamped act");
    assert!(verdict_ok(&verify_act_chain(&acts)), "act-chain failed verify");
    assert!(verdict_ok(&verify_fact_chain(&facts)), "fact-chain failed verify");

    // Moment 2: a rename act, a distinct moment chaining off the first.
    let rename = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("field", jstr("name")), ("value", jstr("Alice-2"))])),
        ("history", jstr("0")),
    ]);
    let c2 = commit_moment(&dir, &iam_act("rename", rename), 2.0).expect("commit 2");
    assert_ne!(c2.act_id, c1.act_id, "the second act is a distinct moment");

    // Both chains grew to 2 and still verify.
    let acts2 = read_act_chain_file(&dir, "main", "0", "i-am");
    let facts2 = read_reel_file(&dir, "0", "being", "be1", None, None);
    assert_eq!(acts2.len(), 2, "two acts on the chain");
    assert_eq!(facts2.len(), 2, "two facts on the reel");
    assert!(verdict_ok(&verify_act_chain(&acts2)), "2-act chain failed verify");
    assert!(verdict_ok(&verify_fact_chain(&facts2)), "2-fact reel failed verify");

    // There is no factless act: an act with an empty deltaF is refused before it touches the chain.
    let factless = obj(vec![
        ("by", jstr("i-am")),
        ("through", jstr("i-am")),
        ("to", jstr("i-am")),
        ("story", jstr("main")),
        ("history", jstr("0")),
        ("startMessage", obj(vec![("content", jstr("nothing")), ("source", jstr("i-am"))])),
        ("deltaF", Json::Arr(vec![])),
    ]);
    assert!(
        matches!(commit_moment(&dir, &factless, 3.0), Err(CommitError::Factless)),
        "a factless act must be refused"
    );
    assert_eq!(
        read_act_chain_file(&dir, "main", "0", "i-am").len(),
        2,
        "the refused factless act left the chain untouched at 2"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  treestore commit_moment: send ONE act (opening+deltaF) -> act-chain + fact-reel stamped, both verify, sequence chains  OK (no Node)"
    );
}
