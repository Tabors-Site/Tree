// The HOST SEE-OP SEAM, END-TO-END: a materials `.word` (set-being / makespace) runs through
// treeibp's `run_op_word` -> `run_body_host` hits its `see resolve-X(args) as bind` node -> treehost's
// HostResolver resolves the substrate spec against the REAL on-disk store -> the `Return` terminator
// synthesizes the do-fact -> it AUTHORIZES + STAMPS on the right reel. The KEYSTONE: the `.word` files
// that were word-sole-but-inert (run_body skipped their `see` node) now execute genuinely.
//
// Rows are planted the SAME way treehost's resolver tests do - stamp a reel (treestore) then refold it
// into a .proj snapshot (treeproj, which builds the inverted name index the collision gate reads) - so
// the resolver's find/fold reads see the genuine store. No mocks. Each test asserts BOTH halves: the
// happy-path fact lands correctly, AND a gate (name-collision / coord-out-of-bounds) REFUSES with its
// reason (a clean Denied, never a panic).

use std::path::Path;

use treehash::{parse as pj, Json};
use treeibp::{act_via_fold, ran_as_moments, run_op_word, Outcome};
use treestore::{read_reel_head, seal_moment, write_fact_doc, FactSpec};

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
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn no_spec(_: &str) -> Option<Json> {
    None
}

/// The seed dir: `$TREE_SEED_DIR` if set (a relocated checkout), else `<crate>/../../seed` (the tree).
fn seed_dir() -> std::path::PathBuf {
    match std::env::var("TREE_SEED_DIR") {
        Ok(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed")),
    }
}
/// The seed materials `.word` files (the genuine artifacts, read off disk - no inlined copies).
fn materials_word(rel: &str) -> String {
    let p = seed_dir().join("materials").join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

/// Stamp one fact (act WRAPS fact via seal_moment) onto a reel + write it (the proven plant pattern).
fn stamp(dir: &Path, kind: &str, id: &str, spec: &Json, ord: f64) {
    let seal = seal_moment(
        &[FactSpec { history: "0", kind, id, spec }],
        Some(ord),
        |h, k, i| read_reel_head(dir, h, k, i),
    );
    for f in &seal.facts {
        write_fact_doc(dir, &f.history, &f.kind, &f.id, &f.doc).expect("write_fact_doc");
    }
}

/// Plant a being (birth: name + homeSpace + optional position) then refold (builds the name index).
fn plant_being(dir: &Path, id: &str, name: &str, home: &str, position: Option<&str>, ord: f64) {
    let mut params = vec![("name", jstr(name)), ("homeSpace", jstr(home))];
    if let Some(p) = position {
        params.push(("position", jstr(p)));
    }
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        ("params", obj(params)),
    ]);
    stamp(dir, "being", id, &birth, ord);
    treeproj::refold(dir, "0", "being", id).expect("refold being");
}

/// COIN one op-word on the being Am's reel - a `do:coin` with `binding:{ kind:"op", word:{ noun } }`, the
/// declare-word shape `treewordfold::fold_word_set` folds. The name-being split (project_name_being_
/// refactor): the vocabulary reel is the being "Am" (signed by the Name "I", through the being "Am"), so
/// the fold reads Am's reel. This is how an op enters the fold so `act_via_fold` resolves it
/// (`op_word_via_fold` = `resolve_word(...).is_op()` && `file_of(op)`). The body itself is supplied to
/// `act_via_fold` by the `file_of` closure keyed on the op name.
fn coin_op(dir: &Path, op: &str, noun: &str, ord: f64) {
    let coin = obj(vec![
        ("through", jstr("Am")), // acted through the being Am (the vocabulary vehicle)
        ("by", jstr("I")),       // the Name I signs
        ("verb", jstr("do")),
        ("act", jstr("coin")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("Am"))])),
        (
            "params",
            obj(vec![
                ("word", jstr(op)),
                ("ownerExtension", jstr("seed")),
                (
                    "binding",
                    obj(vec![("kind", jstr("op")), ("word", obj(vec![("noun", jstr(noun))]))]),
                ),
            ]),
        ),
    ]);
    stamp(dir, "being", "Am", &coin, ord); // the vocabulary reel is the being Am
}

/// Plant a space (makespace: name + parent + optional size) then refold.
fn plant_space(dir: &Path, id: &str, name: &str, parent: &str, size: Option<Json>, ord: f64) {
    let mut params = vec![("name", jstr(name)), ("parent", jstr(parent))];
    if let Some(s) = size {
        params.push(("size", s));
    }
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("do")),
        ("act", jstr("makespace")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr(id))])),
        ("params", obj(params)),
    ]);
    stamp(dir, "space", id, &birth, ord);
    treeproj::refold(dir, "0", "space", id).expect("refold space");
}

// ── set-being: the host see-op resolves a field write, the fact stamps; the name gate refuses ────────
#[test]
fn host_seam_set_being_end_to_end_and_name_gate() {
    let dir = std::env::temp_dir().join("treeos-ibp-hostseam-setbeing");
    let _ = std::fs::remove_dir_all(&dir);

    // a root space + two beings: Alice (b1) and Bob (b2). Alice OWNS the name "Alice".
    plant_space(&dir, "root", "root", "", None, 1.0);
    plant_being(&dir, "b1", "Alice", "root", None, 2.0);
    plant_being(&dir, "b2", "Bob", "root", None, 3.0);

    let word = materials_word("being/set-being.word");
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap(); // run as I -> authorize bypasses; the test
                                                            // exercises the SEE -> resolve -> stamp path.

    // HAPPY PATH - set b2's defaultAble to "scribe": the body's `see resolve-set-being-spec` resolves
    // the { beingId, factParams } block, the Return synthesizes the do:set-being fact, it stamps on b2.
    let trigger = obj(vec![
        ("target", obj(vec![("kind", jstr("being")), ("id", jstr("b2"))])),
        ("field", jstr("defaultAble")),
        ("value", jstr("scribe")),
    ]);
    let out = run_op_word(&word, &i, &trigger, &dir, "0", no_spec, None, None);
    assert_eq!(out.len(), 1, "one do-fact from the materials word");
    let fact = match &out[0] {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("set-being end-to-end denied (the seam did not run): {r}"),
    };
    assert_eq!(get_str(fact, "verb"), Some("do"), "a do fact");
    assert_eq!(get_str(fact, "act"), Some("set-being"), "the op the see-op fed the Return");
    assert_eq!(
        get_str(get(fact, "of").expect("of"), "id"),
        Some("b2"),
        "stamped on b2's reel (idFrom beingId)"
    );
    let params = get(fact, "params").expect("params");
    assert_eq!(get_str(params, "field"), Some("defaultAble"), "the field rode through factParams");
    assert_eq!(get_str(params, "value"), Some("scribe"), "the value rode through factParams");

    // the fact really landed on b2's reel + the chain verifies
    let b2_facts = treestore::read_reel_file(&dir, "0", "being", "b2", None, None);
    assert!(
        b2_facts.iter().any(|f| get_str(f, "act") == Some("set-being")),
        "the set-being fact is on b2's reel"
    );
    assert!(
        matches!(get(&treestore::verify_fact_chain(&b2_facts), "ok"), Some(Json::Bool(true))),
        "b2's reel chain verifies after the host-seam write"
    );

    // GATE - try to RENAME b2 to "Alice" (already held by b1): the resolver's name_unique sees the
    // index and THROWS NameTaken; run_body_host surfaces it as the `.word`'s refusal (a clean Denied).
    let collide = obj(vec![
        ("target", obj(vec![("kind", jstr("being")), ("id", jstr("b2"))])),
        ("field", jstr("name")),
        ("value", jstr("Alice")),
    ]);
    let denied = run_op_word(&word, &i, &collide, &dir, "0", no_spec, None, None);
    assert_eq!(denied.len(), 1, "the refusal is a single outcome");
    match &denied[0] {
        Outcome::Denied(reason) => {
            assert!(
                reason.contains("already taken") && reason.contains("Alice"),
                "the refusal carries the name-collision reason, got: {reason}"
            );
        }
        Outcome::Authorized(_) => panic!("a name collision must REFUSE, not stamp"),
    }
    // and nothing new stamped on b2 (the refusal laid no fact)
    let after = treestore::read_reel_file(&dir, "0", "being", "b2", None, None);
    assert!(
        !after.iter().any(|f| get(f, "params").and_then(|p| get_str(p, "value")) == Some("Alice")),
        "the refused rename laid NO fact"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: HOST SEAM end-to-end - set-being.word resolves via treehost + STAMPS; the name-collision gate REFUSES  OK");
}

// ── makespace: the birth see-op enriches the spec, the fact stamps; the coord/size gate refuses ───
#[test]
fn host_seam_create_space_end_to_end_and_size_gate() {
    let dir = std::env::temp_dir().join("treeos-ibp-hostseam-createspace");
    let _ = std::fs::remove_dir_all(&dir);

    plant_space(&dir, "root", "root", "", Some(obj(vec![("x", Json::Num(100.0)), ("y", Json::Num(100.0))])), 1.0);
    plant_being(&dir, "maker", "Maker", "root", Some("root"), 2.0);

    // the op word lives in THE rust store now (words/space/makespace.word — the M1C rename; the
    // seed/ tree is a dead reference corpus and keeps the old create-space layout).
    let word = treeseed::op_word("makespace", Some("space")).expect("makespace.word in the store");
    // run AS the maker being (a real caller - makespace's resolver requires an identified actor);
    // run the authorize as I-less is fine because we attribute through the maker but authorize via I?
    // No: makespace authorize needs a grant. To keep this test on the SEE-OP seam (not re-test the
    // able-walk), grant nothing and run as I so authorize bypasses - but create's resolver still needs
    // a caller, which we pass in the trigger params (beingId), and AuthCtx.i_am supplies "I".
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();

    // HAPPY PATH - bring a space "garden" into root: resolve-birth-space validates name/size + mints a
    // spaceId, the Return synthesizes the do:makespace fact (params = the enriched spec), it stamps.
    let trigger = obj(vec![
        ("target", obj(vec![("kind", jstr("space")), ("id", jstr("root"))])),
        ("targetKind", jstr("space")),
        ("params", obj(vec![("name", jstr("garden")), ("parent", jstr("root"))])),
    ]);
    let out = run_op_word(&word, &i, &trigger, &dir, "0", no_spec, None, None);
    assert_eq!(out.len(), 1, "one do:makespace fact");
    let fact = match &out[0] {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("makespace end-to-end denied (the seam did not run): {r}"),
    };
    assert_eq!(get_str(fact, "act"), Some("makespace"), "the makespace op (renamed from create-space, M1C)");
    assert_eq!(get_str(get(fact, "of").expect("of"), "kind"), Some("space"), "targets a space reel");
    let new_id = get_str(get(fact, "of").expect("of"), "id").expect("a minted spaceId");
    assert!(!new_id.is_empty(), "the birth see-op minted a spaceId");
    let params = get(fact, "params").expect("params");
    assert_eq!(get_str(params, "name"), Some("garden"), "the enriched spec carries the name");
    assert_eq!(get_str(params, "parent"), Some("root"), "the enriched spec carries the parent");

    // the fact landed on the minted space's reel
    let sp_facts = treestore::read_reel_file(&dir, "0", "space", new_id, None, None);
    assert!(
        sp_facts.iter().any(|f| get_str(f, "act") == Some("makespace")),
        "the makespace fact is on the new space's reel"
    );

    // GATE - bring a space with an OVERSIZE axis (size.x beyond the seed cap): the birth resolver's
    // assert_valid_space_size THROWS; the seam surfaces it as a clean Denied (never a panic).
    let oversize = obj(vec![
        ("target", obj(vec![("kind", jstr("space")), ("id", jstr("root"))])),
        ("targetKind", jstr("space")),
        ("params", obj(vec![
            ("name", jstr("toobig")),
            ("parent", jstr("root")),
            ("size", obj(vec![("x", Json::Num(9_999_999.0)), ("y", Json::Num(1.0))])),
        ])),
    ]);
    let denied = run_op_word(&word, &i, &oversize, &dir, "0", no_spec, None, None);
    match denied.first() {
        Some(Outcome::Denied(reason)) => {
            assert!(!reason.is_empty(), "the size refusal carries a reason: {reason}");
            println!("    makespace size gate refused with: {reason}");
        }
        Some(Outcome::Authorized(_)) => panic!("an oversize space must REFUSE (a clean Denied), not stamp"),
        None => panic!("an oversize space must produce a refusal outcome, got none"),
    }

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: HOST SEAM end-to-end - create.word resolves the birth spec via treehost + STAMPS; the size gate REFUSES  OK");
}

// ── COMPOSITE = N MOMENTS (recursive composite-by-reference) ─────────────────────────────────────────
// A composite word runs as N MOMENTS: each deed opens its OWN moment, lays its ONE fact, seals on its
// own chain link. A deed that NAMES another op-word re-reads that word's `.word` and re-facts it,
// RECURSIVELY — set-owner.word's `do set-space` is the canonical nest. This drives a 2-deed composite
// whose body is two `do set-space` deeds on DIFFERENT space reels, plus a deeper nest (a composite that
// calls a composite), via `act_via_fold` with the ops DECLARED on the chain (do:coin, kind:"op") and
// their bodies loaded through the `file_of` seam (the real fold-backed op resolution - set-space is the
// genuine seed .word). The proof: N SEPARATE facts land (one per deed, each on its own reel,
// chain-verified), NOT one fused fact — and the top-level word lays NO fact of its own (`ran_as_moments`).
#[test]
fn composite_runs_as_n_separate_moments() {
    let dir = std::env::temp_dir().join("treeos-ibp-composite-nmoments");
    let _ = std::fs::remove_dir_all(&dir);

    // two sibling spaces under root (distinct reels, so N facts land on N reels).
    plant_space(&dir, "root", "root", "", None, 1.0);
    plant_space(&dir, "alpha", "alpha", "root", None, 2.0);
    plant_space(&dir, "beta", "beta", "root", None, 3.0);

    // the op-word bodies the fold would resolve. `set-two` is a COMPOSITE: its body names `set-space`
    // twice (two nested op-deeds → two moments). `set-space` is the real seed `.word` (its own host
    // see-op runs per nested deed). A second composite `set-deep` calls `set-two` — a composite calling
    // a composite, to prove the recursion goes all the way down.
    let set_two = concat!(
        "When a being marks two spaces:\n",
        "  do set-space on the space alpha with { field: \"qualities.mark.a\", value: \"one\" }.\n",
        "  do set-space on the space beta with { field: \"qualities.mark.b\", value: \"two\" }.\n",
    )
    .to_string();
    let set_space = materials_word("space/set-space.word");
    // DECLARE the ops on the chain (do:coin, kind:"op") so the fold resolves them, then supply their
    // bodies via `file_of` - the REAL `act_via_fold` seam (`op_word_via_fold` = fold says "op" && the
    // host loads the body). `set-two`'s noun is irrelevant (it synthesizes no fact of its own); set-space
    // targets a space.
    coin_op(&dir, "set-two", "space", 10.0);
    coin_op(&dir, "set-space", "space", 11.0);
    let file_of = move |op: &str, _noun: Option<&str>| -> Option<String> {
        match op {
            "set-two" => Some(set_two.clone()),
            "set-space" => Some(set_space.clone()),
            _ => None,
        }
    };

    // run the composite `set-two` AS I (authorize bypasses; the test exercises the N-moments expansion).
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();
    let word = "do set-two on the space root with {}.";
    let no_spec = |_: &str| None;
    let out = act_via_fold(word, &i, &dir, "0", no_spec, &file_of, None, None);

    // N = 2 outcomes, both authorized, the word itself lays no fact of its own.
    assert!(ran_as_moments(&out), "the composite ran as N moments (no auto-stamp of the word itself)");
    assert_eq!(out.len(), 2, "two deeds → two outcomes, NOT one fused fact");
    let facts: Vec<&Json> = out
        .iter()
        .map(|o| match o {
            Outcome::Authorized(f) => f,
            Outcome::Denied(r) => panic!("a composite deed was denied (expansion failed): {r}"),
        })
        .collect();
    // each is a do:set-space, on a DISTINCT reel, with a DISTINCT _id (no fusion).
    for f in &facts {
        assert_eq!(get_str(f, "act"), Some("set-space"), "each deed is its own set-space fact");
    }
    let reel = |f: &Json| get_str(get(f, "of").unwrap(), "id").unwrap().to_string();
    assert_ne!(reel(facts[0]), reel(facts[1]), "the two facts land on DIFFERENT reels");
    assert_ne!(get_str(facts[0], "_id"), get_str(facts[1], "_id"), "two distinct facts, not one fused");
    let reels: std::collections::HashSet<String> = facts.iter().map(|f| reel(f)).collect();
    assert_eq!(reels, ["alpha".to_string(), "beta".to_string()].into_iter().collect());

    // each fact really landed on its reel AND that reel's chain still verifies (separate moments, each
    // its own chain link off the space's birth).
    for (id, field) in [("alpha", "qualities.mark.a"), ("beta", "qualities.mark.b")] {
        let rf = treestore::read_reel_file(&dir, "0", "space", id, None, None);
        assert!(
            rf.iter().any(|f| get_str(f, "act") == Some("set-space")
                && get(f, "params").and_then(|p| get_str(p, "field")) == Some(field)),
            "the {field} set-space fact is on {id}'s reel"
        );
        assert!(
            matches!(get(&treestore::verify_fact_chain(&rf), "ok"), Some(Json::Bool(true))),
            "{id}'s reel chain verifies after the composite's moment"
        );
    }

    // RECURSION: a composite that calls a composite (set-deep → set-two → set-space×2) still expands all
    // the way down to the same 2 leaf moments. Fresh store so the count is clean.
    let dir2 = std::env::temp_dir().join("treeos-ibp-composite-deep");
    let _ = std::fs::remove_dir_all(&dir2);
    plant_space(&dir2, "root", "root", "", None, 1.0);
    plant_space(&dir2, "alpha", "alpha", "root", None, 2.0);
    plant_space(&dir2, "beta", "beta", "root", None, 3.0);
    let set_two2 = concat!(
        "When a being marks two spaces:\n",
        "  do set-space on the space alpha with { field: \"qualities.mark.a\", value: \"one\" }.\n",
        "  do set-space on the space beta with { field: \"qualities.mark.b\", value: \"two\" }.\n",
    )
    .to_string();
    let set_deep = "When a being marks deeply:\n  do set-two on the space root with {}.\n".to_string();
    let set_space2 = materials_word("space/set-space.word");
    // declare the three ops on dir2's chain, then supply their bodies via `file_of` (the real seam).
    coin_op(&dir2, "set-deep", "space", 10.0);
    coin_op(&dir2, "set-two", "space", 11.0);
    coin_op(&dir2, "set-space", "space", 12.0);
    let deep_file_of = move |op: &str, _noun: Option<&str>| -> Option<String> {
        match op {
            "set-deep" => Some(set_deep.clone()),
            "set-two" => Some(set_two2.clone()),
            "set-space" => Some(set_space2.clone()),
            _ => None,
        }
    };
    let deep_out = act_via_fold(
        "do set-deep on the space root with {}.",
        &i,
        &dir2,
        "0",
        |_: &str| None,
        &deep_file_of,
        None,
        None,
    );
    assert_eq!(deep_out.len(), 2, "a composite calling a composite expands to the same 2 leaf moments");
    assert!(deep_out.iter().all(|o| matches!(o, Outcome::Authorized(_))), "all leaf deeds authorized");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&dir2);
    println!("  treeibp: COMPOSITE = N MOMENTS - a 2-deed composite (and a composite-of-composite) lays 2 SEPARATE chain-verified facts on 2 reels, none fused; ran_as_moments holds  OK");
}
