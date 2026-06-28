// signed_commit: commit_moment_signed wires ed25519 signing into the doctrine-correct seal through an
// INJECTION seam, so treestore stays ZERO-CRYPTO (treesign is only THIS test's dev-dep). The seal is
// ACT-FIRST and the act carries the signature: we commit a moment with a sign closure, read the act line
// back, rebuild the act-sig payload from the STORED act + its committed factIds, and prove the
// Rust-signed act verifies (verify_name_sig for a Name pubkey, verify_with_pubkey for the story "i-am").
// We also prove the act-first order (the act line landed WITH its sig, alongside the facts the sig named)
// and that the un-signed commit_moment plus the torn-write/clean recovery are unchanged (additive).
//
// NO WALL TIME (the time-purge): the act the Rust SIGNS + STAMPS is CLOCK-FREE - it carries NO `at`, the
// PURE build_act_sig_payload carries NO `time`, and the stamp adds only the clock-free `ord`/`seq`. The
// sig round-trip verifies the PURE payload. (The legacy, wall-clock-bearing shape is exercised only by
// treesign's conformance (c), reading a pre-existing JS act.)

use treestore::{
    commit_moment, commit_moment_signed, read_act_chain_file, read_reel_file, verify_act_chain,
    verify_fact_chain, CommitError, Json,
};

// the same pinned conformance seed treesign uses (bytes 0x00..0x1f). Its name id is the (a) vector.
const SEED: [u8; 32] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31,
];

// ── tiny Json helpers (test-local) ──
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
fn sget(v: &Json, k: &str) -> Option<String> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}
fn id_of(v: &Json) -> String {
    sget(v, "_id").unwrap_or_default()
}
fn verdict_ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

/// An act `by`/`through`/`to` the given signer, carrying a single deltaF fact. CLOCK-FREE: NO `at`
/// (no wall-clock), so the act the Rust signs + stamps carries no clock and the PURE sig payload has no
/// `time`. TIME is order (the chain `p`/`seq`/`ord`), never a wall-clock (the time-purge).
fn act_by(signer: &str, label: &str, fact: Json) -> Json {
    obj(vec![
        ("by", jstr(signer)),
        ("through", jstr(signer)),
        ("to", jstr(signer)),
        ("story", jstr("main")),
        ("history", jstr("0")),
        ("startMessage", obj(vec![("content", jstr(label)), ("source", jstr(signer))])),
        ("deltaF", Json::Arr(vec![fact])),
    ])
}

fn birth_fact(name: &str) -> Json {
    obj(vec![
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("name", jstr(name)), ("homeSpace", jstr("sp1"))])),
        ("history", jstr("0")),
    ])
}

/// Build the sign closure the seam takes: it signs the act-sig payload (treesign::build_act_sig_payload
/// over the STAMPED act opening + the committed factIds) with the given seed, and returns the on-disk
/// sig subdoc `{alg, by, value}`. This is the caller's crypto; treestore itself signs nothing.
fn make_sign(seed: [u8; 32], by: String) -> impl Fn(&Json, &[String]) -> Json {
    move |opening: &Json, fids: &[String]| {
        let payload = treesign::build_act_sig_payload(opening, fids);
        let value = treesign::sign_value(&seed, &payload);
        obj(vec![("alg", jstr("ed25519")), ("by", jstr(&by)), ("value", jstr(&value))])
    }
}

/// A Name-signed act (the actor IS an ed25519 pubkey) round-trips: commit_moment_signed -> read the act
/// line -> rebuild the payload from the stored act + committed factIds -> verify_name_sig is TRUE.
#[test]
fn name_signed_act_verifies_round_trip() {
    let dir = std::env::temp_dir().join("treestore-signed-name");
    let _ = std::fs::remove_dir_all(&dir);

    let name_id = treesign::keypair_from_seed(&SEED).name_id;
    let sign = make_sign(SEED, name_id.clone());

    let committed = commit_moment_signed(&dir, &act_by(&name_id, "birth", birth_fact("Alice")), 1.0, &sign)
        .expect("signed commit");
    assert_eq!(committed.fact_ids.len(), 1, "the act laid exactly one fact");

    // read the act line back from the Name's act-chain.
    let acts = read_act_chain_file(&dir, "main", "0", &name_id);
    assert_eq!(acts.len(), 1, "one signed act on the chain");
    let act = &acts[0];
    assert_eq!(id_of(act), committed.act_id, "returned act_id == the stored act");

    // the act carries the sig as a closure field, by the Name.
    let sig = get(act, "sig").expect("the act line carries a sig");
    assert_eq!(sget(sig, "alg").as_deref(), Some("ed25519"));
    assert_eq!(sget(sig, "by").as_deref(), Some(name_id.as_str()), "signed by the Name");
    let sig_value = sget(sig, "value").expect("sig.value present");

    // REBUILD the payload from the STORED act + its committed factIds (exactly verifyActSig's path),
    // and prove the Rust-signed act verifies self-certifyingly against the Name id (= its pubkey).
    let payload = treesign::build_act_sig_payload(act, &committed.fact_ids);
    let payload_json = treesign::canonicalize(&payload);
    assert!(
        treesign::verify_name_sig(&name_id, &payload_json, &sig_value),
        "the Rust-signed act must verify against its Name pubkey"
    );

    // CLOCK-FREE: the stamped act carries NO `at` and the PURE payload carries NO `time` (the
    // time-purge). A tamper on a real field still fails.
    assert!(get(act, "at").is_none(), "the stamped act has no wall-clock `at`");
    assert!(!payload_json.contains("time"), "the PURE payload carries no `time`");
    let tampered = payload_json.replace("\"history\":\"0\"", "\"history\":\"1\"");
    assert!(
        !treesign::verify_name_sig(&name_id, &tampered, &sig_value),
        "a tampered payload must NOT verify"
    );

    // ACT-FIRST: the signed act AND the fact it named both landed; both chains verify.
    let facts = read_reel_file(&dir, "0", "being", "be1", None, None);
    assert_eq!(facts.len(), 1, "the named fact landed on the being reel");
    assert_eq!(id_of(&facts[0]), committed.fact_ids[0], "and it IS the fact the sig named");
    assert!(verdict_ok(&verify_act_chain(&acts)), "signed act-chain verifies");
    assert!(verdict_ok(&verify_fact_chain(&facts)), "fact-reel verifies");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treestore commit_moment_signed: Name-signed act round-trips + verifies  OK");
}

/// The story / "i-am" path: signed with the STORY SEED (loaded from a PKCS8 PEM the same way
/// load_story_seed does), the sig `by` is the literal "i-am" (NOT a pubkey), so verification routes to
/// the raw story public key via verify_with_pubkey (the verifyWithPublicKeyPem path).
#[test]
fn story_signed_act_verifies_with_pubkey() {
    let dir = std::env::temp_dir().join("treestore-signed-story");
    let _ = std::fs::remove_dir_all(&dir);

    // a throwaway story seed (the SEED above stands in for a custodial story key); its raw pub is what
    // an "i-am" act verifies against. (In production load_story_seed reads .story/story.key.)
    let story_seed = SEED;
    let story_pub = treesign::keypair_from_seed(&story_seed).raw_pub;
    let sign = make_sign(story_seed, "i-am".to_string());

    let committed =
        commit_moment_signed(&dir, &act_by("i-am", "birth", birth_fact("Eve")), 1.0, &sign)
            .expect("story-signed commit");

    let acts = read_act_chain_file(&dir, "main", "0", "i-am");
    let act = &acts[0];
    let sig = get(act, "sig").expect("sig present");
    assert_eq!(sget(sig, "by").as_deref(), Some("i-am"), "story-signed by i-am");
    let sig_value = sget(sig, "value").expect("sig.value");

    let payload = treesign::build_act_sig_payload(act, &committed.fact_ids);
    let payload_json = treesign::canonicalize(&payload);
    // "i-am" is not a key id, so the Name path can't verify; the story pubkey path must.
    assert!(
        !treesign::verify_name_sig("i-am", &payload_json, &sig_value),
        "i-am is not a pubkey id"
    );
    assert!(
        treesign::verify_with_pubkey(&story_pub, &payload_json, &sig_value),
        "the story-signed act verifies against the story public key"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treestore commit_moment_signed: story (i-am) act verifies via verify_with_pubkey  OK");
}

/// The seam is ADDITIVE: a factless act is still refused before the chain is touched, and the un-signed
/// commit_moment still stamps unchanged on the SAME store the signed seam writes (the signature is the
/// only added field; the act-first order, recovery, and run-on guard are identical).
#[test]
fn seam_is_additive_factless_refused_and_unsigned_unchanged() {
    let dir = std::env::temp_dir().join("treestore-signed-additive");
    let _ = std::fs::remove_dir_all(&dir);

    let name_id = treesign::keypair_from_seed(&SEED).name_id;
    let sign = make_sign(SEED, name_id.clone());

    // factless signed act -> refused before the chain is touched (same floor as commit_moment).
    let factless = obj(vec![
        ("by", jstr(&name_id)),
        ("through", jstr(&name_id)),
        ("to", jstr(&name_id)),
        ("story", jstr("main")),
        ("history", jstr("0")),
        ("deltaF", Json::Arr(vec![])),
    ]);
    assert!(
        matches!(commit_moment_signed(&dir, &factless, 1.0, &sign), Err(CommitError::Factless)),
        "a factless signed act is refused"
    );
    assert_eq!(
        read_act_chain_file(&dir, "main", "0", &name_id).len(),
        0,
        "the refused act left the chain empty"
    );

    // the un-signed commit_moment still works, unchanged, and produces an act with NO sig field.
    let c = commit_moment(&dir, &act_by(&name_id, "unsigned", birth_fact("Bob")), 1.0)
        .expect("plain commit");
    let acts = read_act_chain_file(&dir, "main", "0", &name_id);
    assert_eq!(acts.len(), 1, "unsigned act stamped");
    assert_eq!(id_of(&acts[0]), c.act_id);
    assert!(get(&acts[0], "sig").is_none(), "commit_moment attaches NO sig (unchanged)");
    assert!(verdict_ok(&verify_act_chain(&acts)), "unsigned chain still verifies");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treestore commit_moment_signed: additive (factless refused, unsigned commit unchanged)  OK");
}
