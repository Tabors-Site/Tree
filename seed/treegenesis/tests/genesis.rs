// treegenesis end-to-end: plant a fresh Story's genesis EGG into a temp store with NO Node, then prove
// the WHOLE contract over the determinism spine:
//   FOLD      - the planted library reel folds via treefold: the names catalog materializes the I-name
//               (parentNameId=null, keyEnc=story-key). The being reel is EMPTY (Am is not egg-born).
//   VERIFY    - the library fact-reel AND the I-name's act-chain verify via treeverify, anchored at
//               GENESIS_PREV: both are whole from the chain root.
//   SIGNATURE - the egg act's sig verifies via treesign::verify_act_sig against the STORY pubkey (the
//               "I" path: the literal "I" is not a pubkey id, so it routes to the raw story key),
//               rebuilt from the STORED act + its committed fact id - exactly verifyActSig's path.
//   CLOCK-FREE- the act + fact carry NO wall-clock (`at`/`date`); the PURE sig payload carries no `time`.
//               Order is `ord`/`seq`/`p` only (the time-purge).
//
// THE EGG = ONE ONE-WORD MOMENT (project_spacebar_moments: one word = one fact = one moment). The egg
// lays only "I" (name:declare on the library reel) - the signer coming to be, one act on the I-name's
// act-chain, the library reel's fact #0 at p = GENESIS_PREV. The being "Am" is NOT born here: it is the
// FIRST WORD I read from the book (an EMPTY being the words build out - see treebook::full_genesis).

use treefold::fold;
use treegenesis::{load_or_mint_i_key, plant_genesis, GenesisError, Planted};
use treestore::{
    read_act_chain_file, read_reel_file, verify_act_chain, verify_fact_chain, Json, GENESIS_PREV,
};

// ── tiny read-only Json helpers (test-local) ──
fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn sget(v: &Json, k: &str) -> Option<String> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}
/// Reach a nested key path (e.g. names -> <i_name> -> parentNameId).
fn dig<'a>(v: &'a Json, path: &[&str]) -> Option<&'a Json> {
    let mut cur = v;
    for k in path {
        cur = get(cur, k)?;
    }
    Some(cur)
}
fn id_of(v: &Json) -> String {
    sget(v, "_id").unwrap_or_default()
}
fn verdict_ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}
/// The verb:act a fact records (the Word the moment laid). commit_moment_signed
/// STRIPS deltaF off the stored act (the act_id is the opening alone; the fact is
/// the act's OUTPUT, written to its reel), so a moment's Word is read off the
/// FACT on its reel, not off the stored act row.
fn fact_verb_act(fact: &Json) -> Option<(String, String)> {
    Some((sget(fact, "verb")?, sget(fact, "act")?))
}
/// The canonical JSON of a value - used to scan the WHOLE doc (every nested field) for a forbidden
/// wall-clock substring, so a clock hidden in params/spec/sig is caught too.
fn canon(v: &Json) -> String {
    treestore::canonicalize(v)
}

/// Plant a genesis egg (the I-name is always "I") into a fresh temp dir and return (dir, planted, story_pub).
fn plant(tag: &str, story_domain: &str) -> (std::path::PathBuf, Planted, [u8; 32]) {
    let dir = std::env::temp_dir().join(format!("treegenesis-{tag}"));
    let _ = std::fs::remove_dir_all(&dir);
    // Mint the I key (the story key) under the store's own .story dir. First boot -> minted + written.
    let key = load_or_mint_i_key(&dir.join(".story")).expect("mint the I key");
    assert!(key.minted, "first boot mints the story key");
    let planted = plant_genesis(&dir, story_domain, &key).expect("plant genesis egg");
    (dir, planted, key.raw_pub)
}

/// THE FULL CONTRACT on a default ("I") genesis egg: ONE moment, fold + verify + sig + root-name +
/// clock-free, and the being reel EMPTY (Am is the book's first word, not egg-born).
#[test]
fn plants_folds_verifies_and_signs_genesis() {
    let story_domain = "localhost";
    let (dir, planted, story_pub) = plant("full", story_domain);

    assert_eq!(planted.i_name, "I", "the Name is I (the signer)");
    assert_eq!(planted.being_id, "Am", "the first being's id IS \"Am\" (the book will birth it)");
    assert_eq!(planted.story_domain, story_domain);

    // ── FOLD: the library reel folds to the names catalog with the I-name declared ──
    let lib_facts = read_reel_file(&dir, "0", "library", story_domain, None, None);
    assert_eq!(lib_facts.len(), 1, "exactly fact #0 on the library reel");
    // THE EGG'S Word: the library fact records name:declare ("I").
    assert_eq!(
        fact_verb_act(&lib_facts[0]),
        Some(("name".to_string(), "declare".to_string())),
        "the egg = \"I\" = name:declare on the library reel"
    );
    let lib_state = fold("library", &lib_facts);
    // names[<i_name>] exists with the genesis spec.
    let parent_name = dig(&lib_state, &["names", "I", "parentNameId"]);
    assert!(
        matches!(parent_name, Some(Json::Null)),
        "the I Name is the root name (parentNameId=null): {}",
        canon(&lib_state)
    );
    assert_eq!(
        dig(&lib_state, &["names", "I", "identity", "keyEnc"]).and_then(|v| match v {
            Json::Str(s) => Some(s.as_str()),
            _ => None,
        }),
        Some("story-key"),
        "the I Name signs with the story key"
    );
    assert!(
        matches!(dig(&lib_state, &["names", "I", "privateKeyEnc"]), Some(Json::Null)),
        "the root Name stores no private key (story-key signer)"
    );

    // ── THE BEING "Am" IS NOT EGG-BORN: its reel is EMPTY (the book's first word births it) ──
    let be_facts = read_reel_file(&dir, "0", "being", "Am", None, None);
    assert_eq!(be_facts.len(), 0, "the being reel is empty after the egg (Am is the book's first word)");

    // ── VERIFY: the library fact-reel + the act-chain are whole from GENESIS_PREV ──
    let lib_v = verify_fact_chain(&lib_facts);
    assert!(verdict_ok(&lib_v), "library fact-chain verifies: {}", canon(&lib_v));
    // the reel's fact #0 chains from GENESIS_PREV (p == 64 zeros, seq 1).
    assert_eq!(sget(&lib_facts[0], "p").as_deref(), Some(GENESIS_PREV), "library fact #0 p = GENESIS_PREV");

    // ── ONE MOMENT: the I's act-chain holds exactly ONE act (name:declare) from GENESIS_PREV ──
    let acts = read_act_chain_file(&dir, story_domain, "0", "I");
    assert_eq!(acts.len(), 1, "ONE genesis egg act on the I-name's act-chain (one word = one moment)");
    let name_act = &acts[0];
    assert_eq!(id_of(name_act), planted.name_act_id, "act #0 IS the returned name_act_id");
    assert_eq!(sget(name_act, "p").as_deref(), Some(GENESIS_PREV), "the I act chains from GENESIS_PREV");
    let act_v = verify_act_chain(&acts);
    assert!(verdict_ok(&act_v), "the one-act act-chain verifies: {}", canon(&act_v));

    // ── SIGNATURE: the egg act's sig verifies via treesign::verify_act_sig (the story-pubkey path) ──
    let name_sig = get(name_act, "sig").expect("the name:declare act carries a sig");
    assert_eq!(sget(name_sig, "alg").as_deref(), Some("ed25519"));
    assert_eq!(sget(name_sig, "by").as_deref(), Some("I"), "signed by I (the story signer)");
    let name_sig_value = sget(name_sig, "value").expect("name sig.value present");
    let name_fact_ids = vec![planted.library_fact_id.clone()];
    // "I" is NOT a pubkey id -> the by-name path cannot resolve a key; the STORY pubkey path must.
    assert!(
        !treesign::verify_act_sig_by_name("I", name_act, &name_fact_ids, &name_sig_value),
        "I is not a pubkey id (no by-name verify)"
    );
    assert!(
        treesign::verify_act_sig(&story_pub, name_act, &name_fact_ids, &name_sig_value),
        "the name:declare act verifies against the STORY pubkey (the I path)"
    );
    // a wrong key fails; a tampered fact-id set fails.
    assert!(!treesign::verify_act_sig(&[0u8; 32], name_act, &name_fact_ids, &name_sig_value), "wrong key fails");
    let tampered = vec!["deadbeef".to_string()];
    assert!(
        !treesign::verify_act_sig(&story_pub, name_act, &tampered, &name_sig_value),
        "a tampered factId set must NOT verify"
    );

    // ── CLOCK-FREE: no `at`/`date` anywhere on the act or fact; no `time` in the sig payload ──
    for (label, doc) in [("name act", name_act), ("library fact", &lib_facts[0])] {
        assert!(get(doc, "at").is_none(), "{label} carries no wall-clock `at`");
        assert!(get(doc, "date").is_none(), "{label} carries no `date`");
        let c = canon(doc);
        assert!(!c.contains("\"at\":"), "{label} has no `at` field anywhere: {c}");
        assert!(!c.contains("\"date\":"), "{label} has no `date` field anywhere: {c}");
    }
    let payload_json = treesign::canonicalize(&treesign::build_act_sig_payload(name_act, &name_fact_ids));
    assert!(!payload_json.contains("time"), "the PURE sig payload carries no `time`: {payload_json}");
    // the act carries the clock-free `ord` (the append ordinal, NOT a wall-clock).
    assert!(matches!(get(name_act, "ord"), Some(Json::Num(_))), "the egg act rides a clock-free `ord`");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treegenesis: plant egg -> ONE moment folds + verifies + sig (story pubkey) + root-name + clock-free  OK");
}

/// THE NAME-ONCE GUARD: a second plant onto the same store is refused (AlreadyPlanted) and leaves the
/// committed egg untouched - the Name is declared once, genesis facts are never overwritten
/// (project_iam_genesis_immutable).
#[test]
fn re_plant_is_refused_and_genesis_is_immutable() {
    let story_domain = "localhost";
    let (dir, planted, _pub) = plant("immutable", story_domain);

    // capture the committed bytes of fact #0 on the library reel + the egg act.
    let lib0 = canon(&read_reel_file(&dir, "0", "library", story_domain, None, None)[0]);
    let acts0: Vec<String> = read_act_chain_file(&dir, story_domain, "0", "I").iter().map(canon).collect();
    assert_eq!(acts0.len(), 1, "one genesis egg act committed");

    // a SECOND plant (same key) must refuse - the library reel is not empty.
    let key = load_or_mint_i_key(&dir.join(".story")).expect("reload the I key");
    assert!(!key.minted, "the key was already on disk (loaded, not re-minted)");
    let again = plant_genesis(&dir, story_domain, &key);
    assert!(
        matches!(again, Err(GenesisError::AlreadyPlanted)),
        "a second plant is refused (AlreadyPlanted)"
    );

    // and the committed egg is byte-for-byte unchanged (never overwritten).
    assert_eq!(read_reel_file(&dir, "0", "library", story_domain, None, None).len(), 1, "still one library fact");
    assert_eq!(canon(&read_reel_file(&dir, "0", "library", story_domain, None, None)[0]), lib0, "library fact #0 unchanged");
    let acts_now: Vec<String> = read_act_chain_file(&dir, story_domain, "0", "I").iter().map(canon).collect();
    assert_eq!(acts_now, acts0, "the genesis egg act unchanged");
    // the planted id is stable (the first plant's truth stands).
    let chain = read_act_chain_file(&dir, story_domain, "0", "I");
    assert_eq!(id_of(&chain[0]), planted.name_act_id);

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treegenesis: re-plant refused + genesis egg immutable (one act)  OK");
}
