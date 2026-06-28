// treegenesis end-to-end: plant a fresh Story's genesis into a temp store with NO Node, then prove the
// WHOLE contract over the determinism spine:
//   FOLD      - the planted reels fold via treefold: the library names catalog materializes the I-name
//               (parentNameId=null, keyEnc=story-key), and the being projection materializes the
//               parentless root being (parentBeingId=null - THE genesis marker).
//   VERIFY    - both chains verify via treeverify, anchored at GENESIS_PREV: the fact-reels (library +
//               being) AND the I-name's act-chain are whole from the chain root.
//   SIGNATURE - BOTH genesis acts' sigs verify via treesign::verify_act_sig against the STORY pubkey
//               (the "i-am" path: the literal "i-am" is not a pubkey id, so it routes to the raw story
//               key), rebuilt from the STORED act + its committed fact ids - exactly verifyActSig's path.
//   CLOCK-FREE- the acts + both facts carry NO wall-clock (`at`/`date`); the PURE sig payload carries no
//               `time`. Order is `ord`/`seq`/`p` only (the time-purge).
//
// GENESIS = TWO SEPARATE ONE-WORD MOMENTS (project_spacebar_moments: one word = one fact = one moment).
// "I" (name:declare on the library reel) and "am" (be:birth on the being reel) are TWO acts and TWO Words,
// so the I's act-chain holds TWO acts in order and each reel holds exactly fact #0 at p = GENESIS_PREV.
// There is NO fusion (the old "lone exemption" was a DRIFT, now removed): the Spacebar Law holds at
// genesis with no exemption.

use treefold::fold;
use treegenesis::{
    load_or_mint_i_key, plant_genesis, GenesisError, Planted, I_NAME_DEFAULT, I_NAME_RENAMED,
};
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

/// Plant a genesis under `i_name` into a fresh temp dir and return (dir, planted, story_pub).
fn plant(tag: &str, i_name: &str, story_domain: &str) -> (std::path::PathBuf, Planted, [u8; 32]) {
    let dir = std::env::temp_dir().join(format!("treegenesis-{tag}"));
    let _ = std::fs::remove_dir_all(&dir);
    // Mint the I key (the story key) under the store's own .story dir. First boot -> minted + written.
    let key = load_or_mint_i_key(&dir.join(".story")).expect("mint the I key");
    assert!(key.minted, "first boot mints the story key");
    let planted = plant_genesis(&dir, story_domain, i_name, &key, None).expect("plant genesis");
    (dir, planted, key.raw_pub)
}

/// THE FULL CONTRACT on a default ("i-am") genesis: TWO moments, fold + verify + both sigs + parentless +
/// clock-free.
#[test]
fn plants_folds_verifies_and_signs_genesis() {
    let story_domain = "localhost";
    let (dir, planted, story_pub) = plant("full", I_NAME_DEFAULT, story_domain);

    assert_eq!(planted.i_name, "i-am", "default I-name is i-am");
    assert_eq!(planted.being_id, "i-am", "the I-Am's id IS the I-name");
    assert_eq!(planted.story_domain, story_domain);
    assert_ne!(planted.name_act_id, planted.being_act_id, "two distinct genesis acts");

    // ── FOLD: the library reel folds to the names catalog with the I-name declared ──
    let lib_facts = read_reel_file(&dir, "0", "library", story_domain, None, None);
    assert_eq!(lib_facts.len(), 1, "exactly fact #0 on the library reel");
    // MOMENT 1's Word: the library fact records name:declare ("I").
    assert_eq!(
        fact_verb_act(&lib_facts[0]),
        Some(("name".to_string(), "declare".to_string())),
        "MOMENT 1 = \"I\" = name:declare on the library reel"
    );
    let lib_state = fold("library", &lib_facts);
    // names[<i_name>] exists with the genesis spec.
    let parent_name = dig(&lib_state, &["names", "i-am", "parentNameId"]);
    assert!(
        matches!(parent_name, Some(Json::Null)),
        "the I Name is the root name (parentNameId=null): {}",
        canon(&lib_state)
    );
    assert_eq!(
        dig(&lib_state, &["names", "i-am", "identity", "keyEnc"]).and_then(|v| match v {
            Json::Str(s) => Some(s.as_str()),
            _ => None,
        }),
        Some("story-key"),
        "the I Name signs with the story key"
    );
    assert!(
        matches!(dig(&lib_state, &["names", "i-am", "privateKeyEnc"]), Some(Json::Null)),
        "the root Name stores no private key (story-key signer)"
    );

    // ── FOLD: the being reel folds to the parentless root being ──
    let be_facts = read_reel_file(&dir, "0", "being", "i-am", None, None);
    assert_eq!(be_facts.len(), 1, "exactly fact #0 on the being reel");
    // MOMENT 2's Word: the being fact records be:birth ("am").
    assert_eq!(
        fact_verb_act(&be_facts[0]),
        Some(("be".to_string(), "birth".to_string())),
        "MOMENT 2 = \"am\" = be:birth on the being reel"
    );
    let be_state = fold("being", &be_facts);
    // **THE GENESIS MARKER**: parentBeingId is null.
    assert!(
        matches!(get(&be_state, "parentBeingId"), Some(Json::Null)),
        "the genesis being is parentless (parentBeingId=null): {}",
        canon(&be_state)
    );
    assert_eq!(sget(&be_state, "name").as_deref(), Some("i-am"), "the being carries the I-name");
    assert_eq!(sget(&be_state, "trueName").as_deref(), Some("i-am"), "trueName = the I Name");
    assert!(
        matches!(get(&be_state, "homeSpace"), Some(Json::Null)),
        "born with homeSpace=null (heaven does not exist yet)"
    );

    // ── VERIFY: both fact-reels + the act-chain are whole from GENESIS_PREV ──
    let lib_v = verify_fact_chain(&lib_facts);
    assert!(verdict_ok(&lib_v), "library fact-chain verifies: {}", canon(&lib_v));
    let be_v = verify_fact_chain(&be_facts);
    assert!(verdict_ok(&be_v), "being fact-chain verifies: {}", canon(&be_v));
    // each reel's fact #0 chains from GENESIS_PREV (p == 64 zeros, seq 1).
    assert_eq!(sget(&lib_facts[0], "p").as_deref(), Some(GENESIS_PREV), "library fact #0 p = GENESIS_PREV");
    assert_eq!(sget(&be_facts[0], "p").as_deref(), Some(GENESIS_PREV), "being fact #0 p = GENESIS_PREV");

    // ── TWO MOMENTS: the I's act-chain holds TWO acts in order (name:declare then be:birth) ──
    let acts = read_act_chain_file(&dir, story_domain, "0", "i-am");
    assert_eq!(acts.len(), 2, "TWO genesis acts on the I-name's act-chain (one word = one moment)");
    let name_act = &acts[0];
    let being_act = &acts[1];
    // MOMENT 1 = "I" = name:declare, chained from GENESIS_PREV.
    assert_eq!(id_of(name_act), planted.name_act_id, "act #0 IS the returned name_act_id");
    assert_eq!(sget(name_act, "p").as_deref(), Some(GENESIS_PREV), "the I act chains from GENESIS_PREV");
    // MOMENT 2 = "am" = be:birth, chained off MOMENT 1's act id (the chain advanced).
    assert_eq!(id_of(being_act), planted.being_act_id, "act #1 IS the returned being_act_id");
    assert_eq!(
        sget(being_act, "p").as_deref(),
        Some(planted.name_act_id.as_str()),
        "the be:birth act chains off the name:declare act (the I's act-chain, in order)"
    );
    let act_v = verify_act_chain(&acts);
    assert!(verdict_ok(&act_v), "the two-act act-chain verifies: {}", canon(&act_v));

    // ── SIGNATURE: BOTH genesis acts' sigs verify via treesign::verify_act_sig (the story-pubkey path) ──
    // MOMENT 1 = name:declare, sig over the library fact id.
    let name_sig = get(name_act, "sig").expect("the name:declare act carries a sig");
    assert_eq!(sget(name_sig, "alg").as_deref(), Some("ed25519"));
    assert_eq!(sget(name_sig, "by").as_deref(), Some("i-am"), "signed by i-am (the story signer)");
    let name_sig_value = sget(name_sig, "value").expect("name sig.value present");
    let name_fact_ids = vec![planted.library_fact_id.clone()];
    // "i-am" is NOT a pubkey id -> the by-name path cannot resolve a key; the STORY pubkey path must.
    assert!(
        !treesign::verify_act_sig_by_name("i-am", name_act, &name_fact_ids, &name_sig_value),
        "i-am is not a pubkey id (no by-name verify)"
    );
    assert!(
        treesign::verify_act_sig(&story_pub, name_act, &name_fact_ids, &name_sig_value),
        "the name:declare act verifies against the STORY pubkey (the i-am path)"
    );
    // a wrong key fails; a tampered fact-id set fails.
    assert!(!treesign::verify_act_sig(&[0u8; 32], name_act, &name_fact_ids, &name_sig_value), "wrong key fails");
    let tampered = vec!["deadbeef".to_string()];
    assert!(
        !treesign::verify_act_sig(&story_pub, name_act, &tampered, &name_sig_value),
        "a tampered factId set must NOT verify (name)"
    );

    // MOMENT 2 = be:birth, sig over the being fact id.
    let being_sig = get(being_act, "sig").expect("the be:birth act carries a sig");
    assert_eq!(sget(being_sig, "alg").as_deref(), Some("ed25519"));
    assert_eq!(sget(being_sig, "by").as_deref(), Some("i-am"), "signed by i-am (the story signer)");
    let being_sig_value = sget(being_sig, "value").expect("being sig.value present");
    let being_fact_ids = vec![planted.being_fact_id.clone()];
    assert!(
        treesign::verify_act_sig(&story_pub, being_act, &being_fact_ids, &being_sig_value),
        "the be:birth act verifies against the STORY pubkey (the i-am path)"
    );
    assert!(!treesign::verify_act_sig(&[0u8; 32], being_act, &being_fact_ids, &being_sig_value), "wrong key fails");
    // the two acts' sigs are distinct (each commits to its own p + factId).
    assert_ne!(name_sig_value, being_sig_value, "each moment carries its own distinct signature");
    // CROSS-BIND: each act's sig names ITS OWN moment's fact, so swapping the fact ids must NOT verify.
    // This proves MOMENT 1's act laid the library (name:declare) fact and MOMENT 2's act laid the being
    // (be:birth) fact - the two moments are bound to their own Words.
    assert!(
        !treesign::verify_act_sig(&story_pub, name_act, &being_fact_ids, &name_sig_value),
        "the name:declare act does NOT verify against the be:birth fact id"
    );
    assert!(
        !treesign::verify_act_sig(&story_pub, being_act, &name_fact_ids, &being_sig_value),
        "the be:birth act does NOT verify against the name:declare fact id"
    );

    // ── CLOCK-FREE: no `at`/`date` anywhere on either act or fact; no `time` in either sig payload ──
    for (label, doc) in [
        ("name act", name_act),
        ("being act", being_act),
        ("library fact", &lib_facts[0]),
        ("being fact", &be_facts[0]),
    ] {
        assert!(get(doc, "at").is_none(), "{label} carries no wall-clock `at`");
        assert!(get(doc, "date").is_none(), "{label} carries no `date`");
        let c = canon(doc);
        assert!(!c.contains("\"at\":"), "{label} has no `at` field anywhere: {c}");
        assert!(!c.contains("\"date\":"), "{label} has no `date` field anywhere: {c}");
    }
    for (label, act, fids) in [
        ("name", name_act, &name_fact_ids),
        ("being", being_act, &being_fact_ids),
    ] {
        let payload_json = treesign::canonicalize(&treesign::build_act_sig_payload(act, fids));
        assert!(!payload_json.contains("time"), "the PURE {label} sig payload carries no `time`: {payload_json}");
    }
    // each act carries the clock-free `ord` (the append ordinal, NOT a wall-clock): 0 then 1.
    assert!(matches!(get(name_act, "ord"), Some(Json::Num(_))), "the name act rides a clock-free `ord`");
    assert!(matches!(get(being_act, "ord"), Some(Json::Num(_))), "the being act rides a clock-free `ord`");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treegenesis: plant -> TWO moments fold + verify + both sigs (story pubkey) + parentless + clock-free  OK");
}

/// THE I-IMMUTABILITY GUARD: a second plant onto the same store is refused (AlreadyPlanted) and leaves
/// the committed genesis untouched - genesis facts are never overwritten (project_iam_genesis_immutable).
#[test]
fn re_plant_is_refused_and_genesis_is_immutable() {
    let story_domain = "localhost";
    let (dir, planted, _pub) = plant("immutable", I_NAME_DEFAULT, story_domain);

    // capture the committed bytes of fact #0 on both reels + BOTH acts.
    let lib0 = canon(&read_reel_file(&dir, "0", "library", story_domain, None, None)[0]);
    let be0 = canon(&read_reel_file(&dir, "0", "being", "i-am", None, None)[0]);
    let acts0: Vec<String> = read_act_chain_file(&dir, story_domain, "0", "i-am").iter().map(canon).collect();
    assert_eq!(acts0.len(), 2, "two genesis acts committed");

    // a SECOND plant (same key) must refuse - the being reel is not empty.
    let key = load_or_mint_i_key(&dir.join(".story")).expect("reload the I key");
    assert!(!key.minted, "the key was already on disk (loaded, not re-minted)");
    let again = plant_genesis(&dir, story_domain, I_NAME_DEFAULT, &key, None);
    assert!(
        matches!(again, Err(GenesisError::AlreadyPlanted)),
        "a second plant is refused (AlreadyPlanted)"
    );

    // and the committed genesis is byte-for-byte unchanged (never overwritten).
    assert_eq!(read_reel_file(&dir, "0", "library", story_domain, None, None).len(), 1, "still one library fact");
    assert_eq!(read_reel_file(&dir, "0", "being", "i-am", None, None).len(), 1, "still one being fact");
    assert_eq!(canon(&read_reel_file(&dir, "0", "library", story_domain, None, None)[0]), lib0, "library fact #0 unchanged");
    assert_eq!(canon(&read_reel_file(&dir, "0", "being", "i-am", None, None)[0]), be0, "being fact #0 unchanged");
    let acts_now: Vec<String> = read_act_chain_file(&dir, story_domain, "0", "i-am").iter().map(canon).collect();
    assert_eq!(acts_now, acts0, "both genesis acts unchanged");
    // the planted ids are stable (the first plant's truth stands).
    let chain = read_act_chain_file(&dir, story_domain, "0", "i-am");
    assert_eq!(id_of(&chain[0]), planted.name_act_id);
    assert_eq!(id_of(&chain[1]), planted.being_act_id);

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treegenesis: re-plant refused + genesis immutable (two acts)  OK");
}

/// THE I-NAME FORK is real: planting under "I" (the renamed identity) folds + verifies + signs exactly
/// the same TWO-moment shape, with the being id / names key / sig.by all = "I" instead of "i-am". This
/// proves the I-name is parameterized end-to-end (not hardcoded), the FORK the default leaves at "i-am".
#[test]
fn plants_under_the_renamed_i_name() {
    let story_domain = "treeos.ai";
    let (dir, planted, story_pub) = plant("renamed", I_NAME_RENAMED, story_domain);

    assert_eq!(planted.i_name, "I", "planted under the renamed I-name");
    assert_eq!(planted.being_id, "I", "the being id IS the renamed I-name");

    // the library catalog keys by "I" now.
    let lib_facts = read_reel_file(&dir, "0", "library", story_domain, None, None);
    let lib_state = fold("library", &lib_facts);
    assert!(
        dig(&lib_state, &["names", "I"]).is_some(),
        "the names catalog keys by the renamed I-name: {}",
        canon(&lib_state)
    );
    assert!(
        matches!(dig(&lib_state, &["names", "I", "parentNameId"]), Some(Json::Null)),
        "still the root name under the rename"
    );

    // the being folds parentless under "I"; its fact records be:birth.
    let be_facts = read_reel_file(&dir, "0", "being", "I", None, None);
    assert_eq!(
        fact_verb_act(&be_facts[0]),
        Some(("be".to_string(), "birth".to_string())),
        "MOMENT 2 = be:birth under the rename"
    );
    let be_state = fold("being", &be_facts);
    assert!(matches!(get(&be_state, "parentBeingId"), Some(Json::Null)), "parentless under the rename");
    assert_eq!(sget(&be_state, "trueName").as_deref(), Some("I"), "trueName = I");
    // MOMENT 1's Word under the rename: the library fact records name:declare.
    assert_eq!(
        fact_verb_act(&lib_facts[0]),
        Some(("name".to_string(), "declare".to_string())),
        "MOMENT 1 = name:declare under the rename"
    );

    // TWO acts under "I", in order; both sigs by "I" verify against the story pubkey (the story signer,
    // whatever the name string is - the rename does not change the key, only the on-disk label).
    let acts = read_act_chain_file(&dir, story_domain, "0", "I");
    assert_eq!(acts.len(), 2, "two genesis acts under the renamed I-name");
    let name_act = &acts[0];
    let being_act = &acts[1];
    assert_eq!(sget(name_act, "p").as_deref(), Some(GENESIS_PREV), "the I act chains from GENESIS_PREV under the rename");
    assert_eq!(sget(being_act, "p").as_deref(), Some(planted.name_act_id.as_str()), "be:birth chains off name:declare");

    let name_sig_value = sget(get(name_act, "sig").unwrap(), "value").unwrap();
    let being_sig_value = sget(get(being_act, "sig").unwrap(), "value").unwrap();
    assert_eq!(sget(get(name_act, "sig").unwrap(), "by").as_deref(), Some("I"), "name sig by the renamed name");
    assert_eq!(sget(get(being_act, "sig").unwrap(), "by").as_deref(), Some("I"), "being sig by the renamed name");
    assert!(
        treesign::verify_act_sig(&story_pub, name_act, &[planted.library_fact_id.clone()], &name_sig_value),
        "the renamed-I name:declare act verifies against the story pubkey"
    );
    assert!(
        treesign::verify_act_sig(&story_pub, being_act, &[planted.being_fact_id.clone()], &being_sig_value),
        "the renamed-I be:birth act verifies against the story pubkey"
    );
    assert!(verdict_ok(&verify_act_chain(&acts)), "the renamed two-act act-chain verifies");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treegenesis: I-name fork (plant under \"I\") TWO moments fold + verify + both sigs  OK");
}
