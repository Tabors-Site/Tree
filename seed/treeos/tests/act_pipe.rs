// The ACT DRIVER — a real authorized act, end-to-end in pure Rust, with the REAL gate:
//
//   parse (treeword) → AUTHORIZE (treeval: able_walk + authorize_decide, grants FOLDED from the
//   chain via treefold) → rasterize (treeval) → stamp (treestore) → verify (treeverify)
//
// and the dual: an act with no granting able is DENIED and never stamped. This is the seed
// authorizing itself — the act primitive (authorize + rasterize + fold + stamp) over the spine, no
// Node. The able SPEC is provided here (its PRODUCTION, foldAbleNoun, is the JS side's port in
// flight); the GRANT, though, is real — stamped onto b1's reel and folded back out.

use treefold::fold;
use treehash::{parse as pj, Json};
use treestore::{compute_fact_doc, read_reel_file, verify_fact_chain, write_fact_doc, Head};
use treeval::able::{able_walk, Grant, PermitReq, WalkArgs};
use treeval::auth::{authorize_decide, DecideArgs};

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
fn as_arr(v: &Json) -> &[Json] {
    match v {
        Json::Arr(a) => a.as_slice(),
        _ => &[],
    }
}
fn ok_true(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

/// Fold a being's reel off disk and read its granted ables (qualities.ablesGranted).
fn fold_grants(dir: &std::path::Path, history: &str, being_id: &str) -> Json {
    let facts = read_reel_file(dir, history, "being", being_id, None, None);
    let state = fold("being", &facts);
    get(&state, "qualities")
        .and_then(|q| get(q, "ablesGranted"))
        .cloned()
        .unwrap_or(Json::Arr(vec![]))
}

/// The gate: run a parsed act through the REAL authorize decision for `identity`, given that
/// identity's folded grants + the (provided) able spec. Returns the {ok, actor, reason} verdict.
fn authorize_act(act: &Json, identity: &Json, grants_json: &Json, able_spec: &Json, target_space: &str) -> Json {
    let grant_structs: Vec<Grant> = as_arr(grants_json)
        .iter()
        .map(|g| Grant {
            able: get_str(g, "able").unwrap_or(""),
            anchor_space_id: get_str(g, "anchorSpaceId"),
            spec: able_spec, // getAbleSpecForGrant(grant) — provided here
            host_space_id: get_str(g, "anchorSpaceId"),
            base_covered: true, // spaceIsAtOrBelow(target, host) — true for this demo
        })
        .collect();
    let verb = get_str(act, "verb").unwrap_or("");
    let req = PermitReq {
        action: get_str(act, "act"),
        intent: None,
        operation: None,
        see_op: None,
        target_being: None,
    };
    let able_result = able_walk(&WalkArgs {
        identity: Some(identity),
        verb,
        owner_claim: None,
        grants: &grant_structs,
        target_space: Some(target_space),
        target_path: None,
        req,
    });
    authorize_decide(&DecideArgs {
        identity: Some(identity),
        verb,
        target: None,
        audit_being_id: None,
        ext_blocked: None,
        able_result: &able_result,
        inheritation_ok: false,
    })
}

#[test]
fn authorized_act_stamps_and_denied_act_does_not() {
    let dir = std::env::temp_dir().join("treeos-act-pipe-test");
    let _ = std::fs::remove_dir_all(&dir);

    // 1. GRANT the "builder" able to being b1 — stamped onto b1's reel (a real fact on the chain).
    let grant_spec = pj(r#"{"through":"b1","verb":"do","act":"set-being","by":"b1","of":{"kind":"being","id":"b1"},"params":{"field":"qualities.ablesGranted","value":[{"able":"builder","anchorSpaceId":"root"}],"merge":false}}"#).unwrap();
    let stamped = compute_fact_doc("0", &grant_spec, &Head::genesis(), None);
    write_fact_doc(&dir, "0", "being", "b1", &stamped.doc).expect("write grant");

    // 2. FOLD b1's grants back out of the chain (treefold) — not provided, derived.
    let grants = fold_grants(&dir, "0", "b1");
    assert_eq!(as_arr(&grants).len(), 1, "the grant folded onto b1's qualities.ablesGranted");
    assert_eq!(get_str(&as_arr(&grants)[0], "able"), Some("builder"));

    // 3. the builder able's spec (its foldAbleNoun production is the JS side's port; provided here).
    let builder_spec = pj(r#"{"canDo":["make"],"reach":["/**"]}"#).unwrap();
    let b1 = pj(r#"{"beingId":"b1","nameId":"builder-being"}"#).unwrap();
    let ctx = pj(r#"{"identity":{"beingId":"b1","nameId":"builder-being"},"bindings":{},"state":{},"beings":{}}"#).unwrap();

    // 4. AUTHORIZED PATH — "I make garden." -> do:make; builder permits it.
    let ir = treeword::parse("I make garden.");
    let act = &ir[0];
    let decision = authorize_act(act, &b1, &grants, &builder_spec, "garden");
    assert!(ok_true(&decision), "b1 (holding builder) is authorized to make");
    assert_eq!(get_str(&decision, "actor"), Some("builder"), "the granting able is the actor");

    // authorized -> rasterize -> stamp -> verify
    let spec = treeval::rasterize_emit(act, &ctx, None);
    let of = get(&spec, "of").expect("of");
    let (kind, id) = (get_str(of, "kind").unwrap(), get_str(of, "id").unwrap());
    let st = compute_fact_doc("0", &spec, &Head::genesis(), None);
    write_fact_doc(&dir, "0", kind, id, &st.doc).expect("write act fact");
    let facts = read_reel_file(&dir, "0", kind, id, None, None);
    assert_eq!(facts.len(), 1, "the authorized act landed on its reel");
    assert!(ok_true(&verify_fact_chain(&facts)), "the authorized act's chain verifies");

    // 5. DENIED PATH — a stranger with no grant cannot make; nothing is stamped.
    let stranger = pj(r#"{"beingId":"b2","nameId":"stranger"}"#).unwrap();
    let denial = authorize_act(act, &stranger, &Json::Arr(vec![]), &builder_spec, "garden");
    assert!(!ok_true(&denial), "the stranger is denied");
    assert_eq!(get_str(&denial, "actor"), Some("anonymous"));

    let _ = std::fs::remove_dir_all(&dir);
    println!("  ACT DRIVER (pure Rust): grant folded from chain -> authorize -> rasterize -> stamp -> verify  OK  (builder authorized, stranger denied)");
}
