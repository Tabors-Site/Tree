// The two primitives, over the spine, in pure Rust: a being ACTs (speaks a Word → authorized →
// stamped), and a being takes a MOMENT (perceives → read+verify+fold), both gated by the same
// authorize. And the duals: a stranger with no grant is denied the act AND the moment.

use treehash::{parse as pj, Json};
use treeibp::{act, moment, Outcome};
use treestore::{compute_fact_doc, read_reel_head, write_fact_doc, Head};

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
fn ok_true(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

/// The injected able-spec resolver (foldAbleNoun's job on the JS side; a plain fn here so it's Copy
/// and can be handed to act/moment repeatedly). "builder" can create spaces and see anywhere.
fn builder_spec_of(name: &str) -> Option<Json> {
    if name == "builder" {
        Some(pj(r#"{"canDo":["make"],"canSee":["*"],"reach":["/**"]}"#).unwrap())
    } else {
        None
    }
}

#[test]
fn ibp_act_then_moment() {
    let dir = std::env::temp_dir().join("treeos-ibp-pipe-test");
    let _ = std::fs::remove_dir_all(&dir);

    // grant "builder" to being b1 — a real fact on b1's reel
    let grant = pj(r#"{"through":"b1","verb":"do","act":"set-being","by":"b1","of":{"kind":"being","id":"b1"},"params":{"field":"qualities.ablesGranted","value":[{"able":"builder","anchorSpaceId":"root"}],"merge":false}}"#).unwrap();
    let st = compute_fact_doc("0", &grant, &Head::genesis(), None);
    write_fact_doc(&dir, "0", "being", "b1", &st.doc).expect("grant");

    let b1 = pj(r#"{"beingId":"b1","nameId":"builder-being"}"#).unwrap();
    let stranger = pj(r#"{"beingId":"b2","nameId":"stranger"}"#).unwrap();

    // ACT — b1 speaks "I make garden." → authorized → stamped on the chain
    let out = act("I make garden.", &b1, &dir, "0", builder_spec_of, None, None);
    assert_eq!(out.len(), 1, "one act in the Word");
    match &out[0] {
        Outcome::Authorized(fact) => assert_eq!(get_str(fact, "act"), Some("make"), "the act stamped"),
        Outcome::Denied(r) => panic!("expected authorized, got denied: {r}"),
    }

    // ACT — a stranger with no grant is DENIED; nothing stamped
    let out2 = act("I make garden.", &stranger, &dir, "0", builder_spec_of, None, None);
    assert!(matches!(out2[0], Outcome::Denied(_)), "stranger denied the act");

    // MOMENT — b1 perceives the garden it just made (gated by see; read + verify + fold)
    let m = moment(&b1, "space", "garden", &dir, "0", builder_spec_of);
    assert!(ok_true(&m), "b1 perceives garden");
    assert!(ok_true(get(&m, "verify").expect("verify")), "the perceived reel verifies");

    // MOMENT — the stranger can't even see → denied
    let m2 = moment(&stranger, "space", "garden", &dir, "0", builder_spec_of);
    assert!(!ok_true(&m2), "stranger cannot perceive");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: ACT (authorized + denied) + MOMENT (perceive + denied) — the two primitives over the spine  OK");
}

fn no_spec(_: &str) -> Option<Json> {
    None
}
fn ranger_spec_of(name: &str) -> Option<Json> {
    if name == "ranger" {
        Some(pj(r#"{"canDo":["*"]}"#).unwrap()) // no reach -> base (host-descendant) only
    } else {
        None
    }
}

#[test]
fn ibp_owner_and_reach_from_space_tree() {
    let dir = std::env::temp_dir().join("treeos-ibp-tree-test");
    let _ = std::fs::remove_dir_all(&dir);
    let append = |kind: &str, id: &str, spec: &Json| {
        let head = read_reel_head(&dir, "0", kind, id);
        let st = compute_fact_doc("0", spec, &head, None);
        write_fact_doc(&dir, "0", kind, id, &st.doc).expect("append");
    };
    // garden is a child of root, owned by b1
    append("space", "garden", &pj(r#"{"through":"sys","verb":"do","act":"set-space","by":"sys","of":{"kind":"space","id":"garden"},"params":{"field":"parent","value":"root"}}"#).unwrap());
    append("space", "garden", &pj(r#"{"through":"sys","verb":"do","act":"set-space","by":"sys","of":{"kind":"space","id":"garden"},"params":{"field":"owner","value":"b1"}}"#).unwrap());
    // b2 holds "ranger" hosted at root (no reach -> relies on the host-descendant base)
    append("being", "b2", &pj(r#"{"through":"b2","verb":"do","act":"set-being","by":"b2","of":{"kind":"being","id":"b2"},"params":{"field":"qualities.ablesGranted","value":[{"able":"ranger","anchorSpaceId":"root"}],"merge":false}}"#).unwrap());

    let b1 = pj(r#"{"beingId":"b1","nameId":"b1-name"}"#).unwrap();
    let b2 = pj(r#"{"beingId":"b2","nameId":"b2-name"}"#).unwrap();
    let b3 = pj(r#"{"beingId":"b3","nameId":"b3-name"}"#).unwrap();

    // OWNER: b1 owns garden -> authorized with NO able (nearest-claim-wins, resolved from the tree)
    let v1 = treeibp::authorize("do", Some("set-space"), Some("garden"), None, &b1, &dir, "0", no_spec);
    assert!(ok_true(&v1), "owner b1 authorized");
    assert_eq!(get_str(&v1, "actor"), Some("owner"));

    // REACH BASE: b2's ranger is hosted at root; garden is below root in the REAL folded tree -> base covers
    let v2 = treeibp::authorize("do", Some("set-space"), Some("garden"), None, &b2, &dir, "0", ranger_spec_of);
    assert!(ok_true(&v2), "b2 authorized via ranger reach-base over the space tree");
    assert_eq!(get_str(&v2, "actor"), Some("ranger"));

    // NEITHER: b3 has no owner claim and no grant -> denied
    let v3 = treeibp::authorize("do", Some("set-space"), Some("garden"), None, &b3, &dir, "0", no_spec);
    assert!(!ok_true(&v3), "b3 denied");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: owner-claim + reach-base resolved from the REAL folded space tree — owner / able / deny  OK");
}

fn as_arr(v: &Json) -> &[Json] {
    match v {
        Json::Arr(a) => a.as_slice(),
        _ => &[],
    }
}

#[test]
fn ibp_flow_control_flow_all_shapes() {
    let no_host = |_n: &str, _a: &[Json]| false;

    // IF — gold > 100 ? smile : frown
    let ir = treeword::parse("When it is noon:\n  If the gold is greater than 100:\n    the merchant smiles, and it becomes day.\n  Otherwise:\n    the merchant frowns, and it becomes day.");
    let if_body = as_arr(get(&ir[0], "effects").expect("effects")).to_vec();
    let mut hi = pj(r#"{"state":{"gold":150},"bindings":{}}"#).unwrap();
    assert_eq!(get_str(&treeibp::run_body(&if_body, &mut hi, &no_host)[0], "act"), Some("smile"));
    let mut lo = pj(r#"{"state":{"gold":50},"bindings":{}}"#).unwrap();
    assert_eq!(get_str(&treeibp::run_body(&if_body, &mut lo, &no_host)[0], "act"), Some("frown"));

    // WHILE — loops until a body act's `sets` falsifies the cond (terminates via state-threading)
    let while_body = pj(r#"[{"kind":"while","cond":{"test":{"op":"equals","path":"phase","value":"go"}},"body":[{"kind":"act","verb":"do","act":"step","by":"X","sets":{"phase":"stop"}}]}]"#).unwrap();
    let mut wctx = pj(r#"{"state":{"phase":"go"},"bindings":{}}"#).unwrap();
    let wout = treeibp::run_body(as_arr(&while_body), &mut wctx, &no_host);
    assert_eq!(wout.len(), 1, "while ran exactly once then the cond went false");
    assert_eq!(get_str(&wout[0], "act"), Some("step"));

    // FOR-EACH — one act per item, the loop binding threaded
    let fe = treeword::parse("When it is dusk:\n  For each guest in the guests:\n    the host greets the guest.");
    let fe_body = as_arr(get(&fe[0], "effects").expect("effects")).to_vec();
    let mut fctx = pj(r#"{"bindings":{"guests":["a","b","c"]},"state":{}}"#).unwrap();
    let fout = treeibp::run_body(&fe_body, &mut fctx, &no_host);
    assert_eq!(fout.len(), 3, "three guests -> three greets");
    assert!(fout.iter().all(|s| get_str(s, "act") == Some("greet")));

    // MATCH — the labelled case, else the default
    let m = treeword::parse("When it is night:\n  Match the mood:\n    For happy:\n      the owl hoots, and it becomes night.\n    Otherwise:\n      the owl sleeps, and it becomes night.");
    let m_body = as_arr(get(&m[0], "effects").expect("effects")).to_vec();
    let mut happy = pj(r#"{"bindings":{"mood":"happy"},"state":{}}"#).unwrap();
    assert_eq!(get_str(&treeibp::run_body(&m_body, &mut happy, &no_host)[0], "act"), Some("hoot"));
    let mut sad = pj(r#"{"bindings":{"mood":"sad"},"state":{}}"#).unwrap();
    assert_eq!(get_str(&treeibp::run_body(&m_body, &mut sad, &no_host)[0], "act"), Some("sleep"));

    println!("  treeibp: FLOW control-flow — if / while(terminates) / for-each / match, state+bindings threaded  OK");
}

#[test]
fn ibp_act_runs_a_flow_word() {
    let dir = std::env::temp_dir().join("treeos-ibp-runflow-test");
    let _ = std::fs::remove_dir_all(&dir);
    let no_spec = |_n: &str| None;

    // act() on a FLOW Word: the declaration is skipped, the flow's effect targets a declared space,
    // run as I (bypass) -> authorized -> stamped. (One entry, `act`, handles acts AND flows.)
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();
    let out = treeibp::act("A garden is a space.\nWhen it is noon:\n  the gardener waters the garden.", &i, &dir, "0", no_spec, None, None);
    assert_eq!(out.len(), 1, "one targeted flow effect stamped");
    match &out[0] {
        Outcome::Authorized(fact) => assert_eq!(get_str(fact, "act"), Some("water"), "the flow's act stamped"),
        Outcome::Denied(r) => panic!("flow effect denied: {r}"),
    }
    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: act runs a FLOW Word — effect authorized (I) + stamped  OK");
}

#[test]
fn ibp_moment_seal_writes_act_then_fact() {
    // the act/fact doctrine: a moment is an ACT (writes the act-log) AND a FACT (the stamp after) —
    // NOT facts-only. Run "I make garden." as I (bypass) and assert BOTH chains were written.
    let dir = std::env::temp_dir().join("treeos-ibp-moment-test");
    let _ = std::fs::remove_dir_all(&dir);
    let no_spec = |_n: &str| None;
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();

    let out = treeibp::act("I make garden.", &i, &dir, "0", no_spec, None, None);
    assert!(matches!(out[0], Outcome::Authorized(_)), "authorized");

    // the FACT stamped on (space, garden) + verifies — the fact carries the act content (make)
    let facts = treestore::read_reel_file(&dir, "0", "space", "garden", None, None);
    assert_eq!(facts.len(), 1, "the fact stamped");
    assert_eq!(get_str(&facts[0], "act"), Some("make"), "the fact carries the op");
    assert!(ok_true(&treestore::verify_fact_chain(&facts)), "fact-chain verifies");

    // the ACT wrote to the act-log (story localhost, history 0, being I) + verifies — the moment is
    // act+fact: the act is the moment-OPENING ({by, story, history}); the op rides the fact in deltaF.
    let acts = treestore::read_act_chain_file(&dir, "localhost", "0", "I");
    assert_eq!(acts.len(), 1, "the ACT wrote (act-log present, not facts-only)");
    assert_eq!(get_str(&acts[0], "by"), Some("I"), "the act-log records the actor (the moment-opening)");
    assert!(ok_true(&treestore::verify_act_chain(&acts)), "act-chain verifies");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: moment-seal — the ACT writes (act-log) AND the FACT stamps; both chains verify  OK");
}

#[test]
fn ibp_multi_act_bindings_propagate() {
    // two acts: #1 creates "home" and binds it as h; #2 targets $h — run_body threads the binding
    let acts = [
        pj(r#"{"kind":"act","verb":"do","act":"make","by":"I","of":{"kind":"space","id":"home"},"bind":"h"}"#).unwrap(),
        pj(r#"{"kind":"act","verb":"do","act":"set-space","by":"I","of":{"kind":"space","ref":"$h"},"params":{"field":"owner","value":"b1"}}"#).unwrap(),
    ];
    let mut ctx = pj(r#"{"identity":{"nameId":"I"},"bindings":{},"state":{},"beings":{}}"#).unwrap();
    let no_host = |_n: &str, _a: &[Json]| false;
    let specs = treeibp::run_body(&acts, &mut ctx, &no_host);
    assert_eq!(specs.len(), 2);
    // act 2's target resolved to act 1's binding ($h -> home)
    assert_eq!(get_str(get(&specs[1], "of").expect("of"), "id"), Some("home"), "$h propagated to home");
    assert_eq!(get_str(&specs[1], "act"), Some("set-space"));
    println!("  treeibp: run_body — bindings propagate ($h from act 1 resolves act 2's target)  OK");
}

#[test]
fn ibp_fold_able_spec_authorizes() {
    let dir = std::env::temp_dir().join("treeos-ibp-foldable-test");
    let _ = std::fs::remove_dir_all(&dir);
    // grant "scribe" to b1 (hosted at root)
    let grant = pj(r#"{"through":"b1","verb":"do","act":"set-being","by":"b1","of":{"kind":"being","id":"b1"},"params":{"field":"qualities.ablesGranted","value":[{"able":"scribe","anchorSpaceId":"root"}],"merge":false}}"#).unwrap();
    let st = compute_fact_doc("0", &grant, &Head::genesis(), None);
    write_fact_doc(&dir, "0", "being", "b1", &st.doc).expect("grant");

    // the resolver folds the REAL able .word files (foldAbleNoun, in Rust) — no Node
    let ables = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed/store/words/ables"));
    let scribe = treeibp::fold_word_able("scribe", ables).expect("scribe.word folds");
    assert_eq!(get_str(&scribe, "name"), Some("scribe"));
    let spec_of = |name: &str| treeibp::fold_word_able(name, ables);
    let b1 = pj(r#"{"beingId":"b1","nameId":"scribe-being"}"#).unwrap();

    // scribe CAN see "ables" at its host (root) -> authorized via the folded spec
    let v = treeibp::authorize("see", Some("ables"), Some("root"), None, &b1, &dir, "0", &spec_of);
    assert!(ok_true(&v), "scribe authorized to see:ables (from the folded scribe.word)");
    assert_eq!(get_str(&v, "actor"), Some("scribe"));

    // scribe has no canDo -> do:make is denied
    let v2 = treeibp::authorize("do", Some("make"), Some("root"), None, &b1, &dir, "0", &spec_of);
    assert!(!ok_true(&v2), "scribe denied do:make (not in its can-set)");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: foldAbleNoun in Rust — scribe.word folded -> canSee; authorizes see:ables, denies do  OK");
}

#[test]
fn ibp_inheritation_authorizes_do_on_being() {
    // The being-tree downward-authority axis (inheritation.js hasAuthorityOver): authority over a
    // being comes from OWNING it (or any ancestor), or holding a live inheritation POINT at it (or
    // any ancestor) — NOT from a space able. A child inherits coverage with nothing stored: the walk
    // from the child passes through the ancestor's anchor. This is what wires authorize's inheritation_ok.
    let dir = std::env::temp_dir().join("treeos-ibp-inherit-test");
    let _ = std::fs::remove_dir_all(&dir);
    let append = |id: &str, spec: &Json| {
        let head = read_reel_head(&dir, "0", "being", id);
        let st = compute_fact_doc("0", spec, &head, None);
        write_fact_doc(&dir, "0", "being", id, &st.doc).expect("append");
    };
    // kid is owned by the Name "boss" (trueName); grandkid sits UNDER kid (parentBeingId), owns nothing.
    append("kid", &pj(r#"{"verb":"be","act":"birth","by":"sys","of":{"kind":"being","id":"kid"},"params":{"trueName":"boss"}}"#).unwrap());
    append("grandkid", &pj(r#"{"verb":"be","act":"birth","by":"sys","of":{"kind":"being","id":"grandkid"},"params":{"parentBeingId":"kid"}}"#).unwrap());

    // OWNER coverage — direct, and inherited DOWN the tree via the walk up
    assert!(treeibp::has_authority_over(&dir, "0", "boss", "kid"), "owner covers the being it owns");
    assert!(treeibp::has_authority_over(&dir, "0", "boss", "grandkid"), "owner covers the subtree (walk up to kid)");
    assert!(!treeibp::has_authority_over(&dir, "0", "stranger", "grandkid"), "a stranger is not covered");
    assert!(treeibp::has_authority_over(&dir, "0", "I", "grandkid"), "I is universal authority on its story");

    // INHERITATION POINT — grant "deputy" a live point at kid -> deputy covers kid AND grandkid
    append("kid", &pj(r#"{"verb":"do","act":"grant-inheritation","by":"boss","of":{"kind":"being","id":"kid"},"params":{"name":"deputy"}}"#).unwrap());
    assert!(treeibp::has_authority_over(&dir, "0", "deputy", "grandkid"), "a live point covers the subtree below it");
    // revoke it (latest of the two by chain seq wins) -> deputy no longer covered
    append("kid", &pj(r#"{"verb":"do","act":"revoke-inheritation","by":"boss","of":{"kind":"being","id":"kid"},"params":{"name":"deputy"}}"#).unwrap());
    assert!(!treeibp::has_authority_over(&dir, "0", "deputy", "grandkid"), "revoke (later seq) drops the coverage");

    // INTEGRATION through authorize — a DO on grandkid by boss (NO able) authorizes via inheritation_ok
    let boss = pj(r#"{"beingId":"boss-being","nameId":"boss"}"#).unwrap();
    let v = treeibp::authorize("do", Some("set-being"), Some("grandkid"), Some("grandkid"), &boss, &dir, "0", no_spec);
    assert!(ok_true(&v), "boss authorized on grandkid via the being-tree (inheritation_ok)");
    assert_eq!(get_str(&v, "actor"), Some("boss"), "the authorizing actor is the Name");
    // a stranger with no able + no being-tree authority -> denied
    let stranger = pj(r#"{"beingId":"s-being","nameId":"stranger"}"#).unwrap();
    let v2 = treeibp::authorize("do", Some("set-being"), Some("grandkid"), Some("grandkid"), &stranger, &dir, "0", no_spec);
    assert!(!ok_true(&v2), "stranger denied — no able, no authority over the being");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: hasAuthorityOver — owner + live point cover the being-subtree (walk up); authorize wires inheritation_ok  OK");
}

#[test]
fn ibp_act_signs_with_story_key() {
    // The signing seam END-TO-END through act(): an INJECTED story-key signer lands the act ed25519-
    // SIGNED via commit_moment_signed. We read the act back, rebuild the act-sig payload from the STORED
    // act + its committed fact id, and prove it verifies against the story public key (by="I" is not a
    // key-id, so it routes to the story pubkey path). treeibp itself stays crypto-free — the closure is
    // the caller's, exactly as the binary holds the key when a being acts (it authenticated at moment).
    let dir = std::env::temp_dir().join("treeos-ibp-sign-test");
    let _ = std::fs::remove_dir_all(&dir);
    let no_spec = |_n: &str| None;

    // a throwaway story seed (bytes 0..31) stands in for the custodial .story/story.key.
    let seed: [u8; 32] = std::array::from_fn(|i| i as u8);
    let story_pub = treesign::keypair_from_seed(&seed).raw_pub;
    let sign = move |opening: &Json, fids: &[String]| -> Json {
        let payload = treesign::build_act_sig_payload(opening, fids);
        let value = treesign::sign_value(&seed, &payload);
        pj(&format!(r#"{{"alg":"ed25519","by":"I","value":"{value}"}}"#)).unwrap()
    };

    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();
    let out = treeibp::act("I make garden.", &i, &dir, "0", no_spec, None, Some(&sign as &dyn Fn(&Json, &[String]) -> Json));
    let fact = match &out[0] {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("signed act denied: {r}"),
    };
    let fact_id = get_str(fact, "_id").expect("fact _id").to_string();

    // the act on the chain carries the sig, by I
    let acts = treestore::read_act_chain_file(&dir, "localhost", "0", "I");
    assert_eq!(acts.len(), 1, "one signed act on the chain");
    let sig = get(&acts[0], "sig").expect("the act line carries a sig");
    assert_eq!(get_str(sig, "by"), Some("I"), "signed as I (the story)");
    let sig_value = get_str(sig, "value").expect("sig.value present");

    // REBUILD the payload from the STORED act + its committed factId, verify against the story pubkey.
    let payload = treesign::build_act_sig_payload(&acts[0], &[fact_id]);
    let payload_json = treesign::canonicalize(&payload);
    assert!(
        treesign::verify_with_pubkey(&story_pub, &payload_json, sig_value),
        "the Rust-signed act must verify against the story public key"
    );
    // a tamper anywhere in the signed payload (here: the story) must fail.
    let tampered = payload_json.replace("\"story\":\"localhost\"", "\"story\":\"evil\"");
    assert!(
        !treesign::verify_with_pubkey(&story_pub, &tampered, sig_value),
        "a tampered payload must NOT verify"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: act() signs via the injected story key — the act lands ed25519-signed + verifies against the story pubkey  OK");
}

fn num(v: &Json, k: &str) -> f64 {
    match get(v, k) {
        Some(Json::Num(n)) => *n,
        _ => f64::NAN,
    }
}

#[test]
fn ibp_act_stamps_global_ord_and_basis() {
    // the act stamps a REAL global ord on the fact (the first allocation in a fresh store = 1, not the
    // old per-reel stand-in), and records the perceive `basis` on the act-log line (non-digest).
    let dir = std::env::temp_dir().join("treeos-ibp-ord-basis");
    let _ = std::fs::remove_dir_all(&dir);
    let no_spec = |_n: &str| None;
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();

    let out = treeibp::act("I make garden.", &i, &dir, "0", no_spec, Some(7.0), None);
    let fact = match &out[0] {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("denied: {r}"),
    };
    assert_eq!(num(fact, "ord"), 1.0, "the fact stamped the first GLOBAL ord (fresh store)");

    let acts = treestore::read_act_chain_file(&dir, "localhost", "0", "I");
    assert_eq!(num(&acts[0], "basis"), 7.0, "the act records the perceive basis it was decided against");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: act stamps a real global ord on the fact + the perceive basis on the act  OK");
}

#[test]
fn ibp_moment_returns_world_ord() {
    // the moment returns the world's "now" (the global ord) at perception — 0 before anything happens,
    // then it advances as acts land. This is the ord a being carries as its next act's basis.
    let dir = std::env::temp_dir().join("treeos-ibp-moment-ord");
    let _ = std::fs::remove_dir_all(&dir);
    let no_spec = |_n: &str| None;
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();

    let m0 = treeibp::moment(&i, "space", "garden", &dir, "0", no_spec);
    assert_eq!(num(&m0, "ord"), 0.0, "the world starts at ord 0");

    let _ = treeibp::act("I make garden.", &i, &dir, "0", no_spec, None, None);
    let m1 = treeibp::moment(&i, "space", "garden", &dir, "0", no_spec);
    assert!(ok_true(&m1), "I perceives garden");
    assert_eq!(num(&m1, "ord"), 1.0, "the moment reads the world's now after one act landed (1)");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: moment returns the world's now (the global ord) at perception  OK");
}

#[test]
fn ibp_concurrent_acts_same_reel_no_drop() {
    // The per-reel STRIPE LOCK under heavy contention: many NAMES writing the SAME reel at once must ALL
    // land (the bare reel write would false-replay-drop a same-seq collision). N threads each make
    // on "garden" as a DIFFERENT name (so the act-chains don't contend) → all N facts land, the chain
    // verifies, and every fact carries a DISTINCT global ord.
    const N: usize = 12;
    let dir = std::env::temp_dir().join("treeos-ibp-concurrent");
    let _ = std::fs::remove_dir_all(&dir);

    // grant each writer b{n} the "builder" able (canDo make, reach /**, anchored at root)
    let append = |kind: &str, id: &str, spec: &Json| {
        let head = read_reel_head(&dir, "0", kind, id);
        let st = compute_fact_doc("0", spec, &head, None);
        write_fact_doc(&dir, "0", kind, id, &st.doc).expect("append");
    };
    for n in 0..N {
        let g = format!(
            r#"{{"verb":"do","act":"set-being","by":"b{n}","of":{{"kind":"being","id":"b{n}"}},"params":{{"field":"qualities.ablesGranted","value":[{{"able":"builder","anchorSpaceId":"root"}}],"merge":false}}}}"#
        );
        append("being", &format!("b{n}"), &pj(&g).unwrap());
    }

    let dir_ref: &std::path::Path = &dir;
    std::thread::scope(|s| {
        let handles: Vec<_> = (0..N)
            .map(|n| {
                s.spawn(move || {
                    let actor = pj(&format!(r#"{{"beingId":"b{n}","nameId":"name{n}"}}"#)).unwrap();
                    treeibp::act("I make garden.", &actor, dir_ref, "0", builder_spec_of, None, None)
                })
            })
            .collect();
        for h in handles {
            let r = h.join().unwrap();
            assert!(matches!(r.first(), Some(Outcome::Authorized(_))), "each concurrent writer authorized + sealed");
        }
    });

    let facts = treestore::read_reel_file(&dir, "0", "space", "garden", None, None);
    assert_eq!(facts.len(), N, "all {N} concurrent same-reel writers landed (the stripe lock killed the false-replay drop)");
    assert!(ok_true(&treestore::verify_fact_chain(&facts)), "the concurrently-built reel chain verifies");
    let mut ords: Vec<f64> = facts
        .iter()
        .filter_map(|f| match get(f, "ord") {
            Some(Json::Num(n)) => Some(*n),
            _ => None,
        })
        .collect();
    ords.sort_by(f64::total_cmp);
    ords.dedup();
    assert_eq!(ords.len(), N, "every fact got a DISTINCT global ord");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeibp: {N} names write one reel at once — all land, chain verifies, distinct ords (the stripe lock)  OK");
}
