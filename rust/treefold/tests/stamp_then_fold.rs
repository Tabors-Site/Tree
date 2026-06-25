// Pure-Rust WRITE HALF: Rust stamps a being's chain through treestore::seal_moment (commitMoment's
// deterministic core), writes each fact to a real reel (durable append + fsync = the stamp), reads it
// back, verifies the on-disk chain with treeverify, and FOLDS it through treefold to the projection.
// The whole read+write+verify+fold loop with NO Node in it — the complement to the read-side boot
// binary, so Rust owns the chain both ways. stamp_vectors.rs already proves the bytes equal the JS
// store's; this proves the chain Rust writes folds to the right state.

use treefold::fold;
use treestore::{
    advance_act_head_file, append_act_line, compute_act_doc, read_act_chain_file, read_act_head_file,
    read_reel_file, read_reel_head, read_reel_lineage, seal_moment, verify_act_chain, verify_fact_chain,
    write_fact_doc, write_reel_head, FactSpec, HeadAdvance, Json,
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
fn sval(v: &Json, k: &str) -> String {
    match get(v, k) {
        Some(Json::Str(s)) => s.clone(),
        _ => String::new(),
    }
}
fn nval(v: &Json, k: &str) -> f64 {
    match get(v, k) {
        Some(Json::Num(n)) => *n,
        _ => f64::NAN,
    }
}
fn verdict_ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

// Seal ONE moment (one act = one fact = one reel) onto (history "0", kind, id) and write its facts,
// reading the reel's current head each time — exactly as commitMoment threads the head per moment.
fn stamp_moment(dir: &std::path::Path, kind: &str, id: &str, spec: &Json, ord: f64) {
    let seal = seal_moment(
        &[FactSpec { history: "0", kind, id, spec }],
        Some(ord),
        |h, k, i| read_reel_head(dir, h, k, i),
    );
    assert!(!seal.fanout, "one act = one reel (no fan-out)");
    for f in &seal.facts {
        write_fact_doc(dir, &f.history, &f.kind, &f.id, &f.doc).expect("write_fact_doc");
    }
}

#[test]
fn rust_stamps_then_folds_a_being_chain() {
    let dir = std::env::temp_dir().join("treefold-stamp-then-fold");
    let _ = std::fs::remove_dir_all(&dir);

    // Moment 1 (ord 1): the I-Am births @Alice. bornOrd folds from this moment's ord.
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        (
            "params",
            obj(vec![
                ("name", jstr("Alice")),
                ("defaultAble", jstr("gardener")),
                ("homeSpace", jstr("sp1")),
            ]),
        ),
    ]);
    stamp_moment(&dir, "being", "be1", &birth, 1.0);

    // Moment 2 (ord 2): Alice moves — a do:set-being on her coord.
    let set_coord = obj(vec![
        ("through", jstr("be1")),
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        (
            "params",
            obj(vec![
                ("field", jstr("coord")),
                (
                    "value",
                    obj(vec![
                        ("x", Json::Num(3.0)),
                        ("y", Json::Num(4.0)),
                        ("z", Json::Num(1.0)),
                    ]),
                ),
            ]),
        ),
    ]);
    stamp_moment(&dir, "being", "be1", &set_coord, 2.0);

    // Read the reel Rust itself stamped.
    let facts = read_reel_file(&dir, "0", "being", "be1", None, None);
    assert_eq!(facts.len(), 2, "two facts on the reel");

    // The on-disk chain verifies (treeverify, on the bytes Rust wrote — p-links, seq, hashes).
    let verdict = verify_fact_chain(&facts);
    assert!(verdict_ok(&verdict), "Rust-stamped chain failed verify: {}", treestore::canonicalize(&verdict));

    // FOLD it through treefold — the projection Rust derives with no Node in the loop.
    let state = fold("being", &facts);
    assert_eq!(sval(&state, "name"), "Alice", "birth folded the name");
    assert_eq!(
        nval(&state, "bornOrd"),
        1.0,
        "bornOrd = the birth moment's ord (clock-free creation order)"
    );
    assert_eq!(sval(&state, "defaultAble"), "gardener", "birth folded defaultAble");
    let coord = get(&state, "coord").expect("coord present after set-being");
    assert_eq!(nval(coord, "x"), 3.0, "set-being folded coord.x");
    assert_eq!(nval(coord, "z"), 1.0, "set-being folded coord.z");

    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  treefold write-half: Rust stamp(seal_moment) -> append+fsync -> read -> verify -> FOLD  OK (no Node)"
    );
}

// Same loop, the other two aggregate kinds — so the kernel's stamp-entry is proven for every reel the
// http/ws host might be handed (being / space / matter), not just being.

#[test]
fn rust_stamps_then_folds_a_space() {
    let dir = std::env::temp_dir().join("treefold-stamp-then-fold-space");
    let _ = std::fs::remove_dir_all(&dir);

    // Moment 1 (ord 1): be1 creates the @Garden space.
    let create = obj(vec![
        ("through", jstr("be1")),
        ("verb", jstr("do")),
        ("act", jstr("create-space")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr("sp9"))])),
        (
            "params",
            obj(vec![
                ("name", jstr("Garden")),
                ("type", jstr("plot")),
                ("owner", jstr("be1")),
                ("parent", jstr("sp1")),
            ]),
        ),
    ]);
    stamp_moment(&dir, "space", "sp9", &create, 1.0);

    let facts = read_reel_file(&dir, "0", "space", "sp9", None, None);
    let verdict = verify_fact_chain(&facts);
    assert!(verdict_ok(&verdict), "space chain failed verify");
    let state = fold("space", &facts);
    assert_eq!(sval(&state, "name"), "Garden", "create-space folded the name");
    assert_eq!(sval(&state, "owner"), "be1", "create-space folded the owner");
    assert_eq!(nval(&state, "bornOrd"), 1.0, "space bornOrd = the moment's ord");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treefold write-half (space): stamp -> write -> read -> verify -> FOLD  OK (no Node)");
}

#[test]
fn rust_stamps_then_folds_a_matter() {
    let dir = std::env::temp_dir().join("treefold-stamp-then-fold-matter");
    let _ = std::fs::remove_dir_all(&dir);

    // Moment 1 (ord 1): create the @note matter with content.
    let create = obj(vec![
        ("through", jstr("be1")),
        ("verb", jstr("do")),
        ("act", jstr("create-matter")),
        ("of", obj(vec![("kind", jstr("matter")), ("id", jstr("mt9"))])),
        (
            "params",
            obj(vec![
                ("name", jstr("note")),
                ("content", jstr("hello")),
                ("type", jstr("text")),
                ("spaceId", jstr("sp1")),
            ]),
        ),
    ]);
    stamp_moment(&dir, "matter", "mt9", &create, 1.0);

    let facts = read_reel_file(&dir, "0", "matter", "mt9", None, None);
    let verdict = verify_fact_chain(&facts);
    assert!(verdict_ok(&verdict), "matter chain failed verify");
    let state = fold("matter", &facts);
    assert_eq!(sval(&state, "name"), "note", "create-matter folded the name");
    assert_eq!(sval(&state, "content"), "hello", "create-matter folded the content");
    assert_eq!(nval(&state, "bornOrd"), 1.0, "matter bornOrd = the moment's ord");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treefold write-half (matter): stamp -> write -> read -> verify -> FOLD  OK (no Node)");
}

// A FULL MOMENT writes BOTH chains: the Name's ACT on its act-log (the soul it authored) and the
// being's FACT on its reel (the stamp that act laid). This proves the kernel writes + verifies both
// halves of one moment in pure Rust — the complete "stamp a moment" the http/ws host hands off.
#[test]
fn rust_stamps_a_full_moment_act_and_fact() {
    let dir = std::env::temp_dir().join("treefold-full-moment");
    let _ = std::fs::remove_dir_all(&dir);
    let story = "main";

    // (1) The ACT — the I-Am's authored soul. compute_act_doc links it off the act-chain head; the
    //     .acthead CAS advances only if no one moved the chain (a stale author would get ChainMoved).
    let head = read_act_head_file(&dir, story, "0", "i-am");
    let opening = obj(vec![
        ("by", jstr("i-am")), // only Names act; the act-chain keys on `by`
        ("through", jstr("i-am")),
        ("to", jstr("i-am")),
        ("ibpAddress", Json::Null),
        ("activeAble", Json::Null),
        ("inReplyTo", Json::Null),
        ("parentThread", Json::Null),
        ("startMessage", obj(vec![("content", jstr("birth Alice")), ("source", jstr("i-am"))])),
        ("story", jstr(story)),
        ("history", jstr("0")),
    ]);
    let act = compute_act_doc(&opening, &head);
    append_act_line(&dir, story, "0", "i-am", &act.doc).expect("append act line");
    let adv = advance_act_head_file(&dir, story, "0", "i-am", &act.id, &head).expect("advance act head");
    assert_eq!(adv, HeadAdvance::Advanced, "a fresh act advances the chain (not a replay)");

    // (2) The FACT that act laid — @Alice's birth, on the being reel.
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("name", jstr("Alice")), ("homeSpace", jstr("sp1"))])),
    ]);
    stamp_moment(&dir, "being", "be1", &birth, 1.0);

    // (3) Read BOTH chains back off disk.
    let acts = read_act_chain_file(&dir, story, "0", "i-am");
    let facts = read_reel_file(&dir, "0", "being", "be1", None, None);
    assert_eq!(acts.len(), 1, "one act on the Name's act-chain");
    assert_eq!(facts.len(), 1, "one fact on the being's reel");

    // (4) BOTH chains verify (treeverify, on the bytes Rust wrote).
    assert!(verdict_ok(&verify_act_chain(&acts)), "act-chain failed verify");
    assert!(verdict_ok(&verify_fact_chain(&facts)), "fact-chain failed verify");

    // (5) The fact folds to the being projection — the moment's effect, derived in Rust.
    let state = fold("being", &facts);
    assert_eq!(sval(&state, "name"), "Alice", "the moment's fact folded the birth");

    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  treefold write-half (FULL MOMENT): Rust writes act-chain + fact-reel, both verify, fact folds  OK (no Node)"
    );
}

fn birth_being(name: &str) -> Json {
    obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("name", jstr(name)), ("homeSpace", jstr("sp1"))])),
    ])
}
fn rename_being(name: &str) -> Json {
    obj(vec![
        ("through", jstr("be1")),
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("field", jstr("name")), ("value", jstr(name))])),
    ])
}

// Branching — the subtle part. A branch stores only its own divergent tail; a read UNIONS the parent's
// prefix (up to the branchPoint) with the branch's tail. This proves Rust stamps a branch, the cross-fork
// chain verifies as one contiguous chain, and the lineage folds to the branched state — main untouched.
#[test]
fn rust_stamps_a_branch_and_folds_the_lineage() {
    let dir = std::env::temp_dir().join("treefold-branch-lineage");
    let _ = std::fs::remove_dir_all(&dir);

    // MAIN (history "0"): birth @Alice (seq 1), then rename (seq 2).
    stamp_moment(&dir, "being", "be1", &birth_being("Alice"), 1.0);
    stamp_moment(&dir, "being", "be1", &rename_being("Alice-main"), 2.0);

    // FORK at branchPoint 2: seed the branch's head from main's head at seq 2 (forkReel's job) — so the
    // branch's first stamp chains ACROSS the fork, off main's seq-2 fact.
    let fork_head = read_reel_head(&dir, "0", "being", "be1");
    write_reel_head(&dir, "0.1", "being", "be1", &fork_head).expect("seed branch head");

    // BRANCH (history "0.1"): a divergent rename — seq 3, p = main's seq-2 _id.
    let seal = seal_moment(
        &[FactSpec { history: "0.1", kind: "being", id: "be1", spec: &rename_being("Branch-Alice") }],
        Some(3.0),
        |h, k, i| read_reel_head(&dir, h, k, i),
    );
    for f in &seal.facts {
        write_fact_doc(&dir, &f.history, &f.kind, &f.id, &f.doc).expect("write branch fact");
    }

    // Read the LINEAGE: main owns (0, 2] = seq 1,2; the branch owns (2, inf] = seq 3.
    let mut floors = std::collections::HashMap::new();
    floors.insert("0.1".to_string(), 2.0);
    let lineage = vec!["0".to_string(), "0.1".to_string()];
    let facts = read_reel_lineage(&lineage, &floors, None, None, |h, a, u| {
        read_reel_file(&dir, h, "being", "be1", a, u)
    });
    assert_eq!(facts.len(), 3, "lineage union = main seq 1,2 + branch seq 3");

    // One contiguous chain across the fork (the branch fact's p links to main's seq-2 _id).
    assert!(verdict_ok(&verify_fact_chain(&facts)), "lineage chain failed verify");

    // Fold the lineage — the branch's rename wins over the inherited parent prefix.
    let state = fold("being", &facts);
    assert_eq!(sval(&state, "name"), "Branch-Alice", "branch override folded over the parent prefix");

    // Main alone still folds to its own tail — the branch never touched it.
    let main_only = fold("being", &read_reel_file(&dir, "0", "being", "be1", None, None));
    assert_eq!(sval(&main_only, "name"), "Alice-main", "main is unchanged by the branch");

    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  treefold write-half (BRANCH): Rust stamps a branch, lineage union verifies + folds, main intact  OK (no Node)"
    );
}
