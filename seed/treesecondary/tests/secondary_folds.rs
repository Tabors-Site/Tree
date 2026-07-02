// treesecondary: drive each SECONDARY-projection PURE FOLD with the right facts
// and assert the projection updates correctly, BYTE-COMPATIBLE with the JS
// projStore rows. The expected JSON strings here were generated from the live
// projStore.js applyUpdate/_insertUpsert (see the trace in the port notes); each
// test asserts the Rust row stringifies to the same image (treehash::stringify
// is insertion-order, like JSON.stringify), so a drift in key order or a stray
// field fails loud.
//
//   inbox    : a `call` fact opens the row; the answering act evicts it.
//   threads  : a `call` fact bumps lastAct/ord + participants; a seal bumps ord.
//   position : a do:set-being:coord fact upserts (seq-guarded); unset deletes.

use treesecondary::{
    inbox_evict, inbox_open, position_fold_coord, position_row_id, priority_rank_of, thread_root,
    threads_fold_call, threads_note_act_seal, Json, PositionOp,
};

// ── tiny JSON builders for fact fixtures ─────────────────────────────────────
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn jnum(n: f64) -> Json {
    Json::Num(n)
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn of_being(id: &str) -> Json {
    obj(vec![("kind", jstr("being")), ("id", jstr(id))])
}
/// The exact byte image (treehash::stringify == JSON.stringify, insertion order).
fn img(v: &Json) -> String {
    treesecondary::stringify(v)
}

// ════════════════════════════════ INBOX ═════════════════════════════════════

#[test]
fn inbox_opens_on_a_call_fact() {
    // A fat call: of = recipient (right stance), through = summoner, params carry
    // the correlation + payload. of.id = "be2" is the reel it lands on.
    let fact = obj(vec![
        ("verb", jstr("call")),
        ("through", jstr("be1")),
        ("of", of_being("be2")),
        ("history", jstr("0")),
        ("ord", jnum(5.0)),
        ("date", Json::Null),
        (
            "params",
            obj(vec![
                ("correlation", jstr("corr1")),
                ("content", jstr("hi")),
                ("priority", jstr("HUMAN")),
            ]),
        ),
    ]);
    let row = inbox_open(&fact).expect("a call fact opens an inbox row");

    // priorityRank folds from the enum: HUMAN -> 1.
    assert_eq!(priority_rank_of("HUMAN"), 1);

    // Byte image: _id first, then $set keys in literal order; sender/activeAble/
    // intent/inReplyTo/inboxSpaceId default null; orientation -> "forward";
    // rootCorrelation falls back to the correlation; ord 5; sentAt null.
    let expected = r#"{"_id":"corr1","recipient":"be2","summoner":"be1","sender":null,"content":"hi","activeAble":null,"intent":null,"priority":"HUMAN","priorityRank":1,"orientation":"forward","rootCorrelation":"corr1","inReplyTo":null,"inboxSpaceId":null,"ord":5,"sentAt":null,"history":"0"}"#;
    assert_eq!(img(&row), expected, "inbox row must be byte-compatible");
}

#[test]
fn inbox_defaults_priority_interactive_and_drops_undefined_attachments() {
    // No priority -> INTERACTIVE (rank 3); no attachments -> the field is DROPPED
    // (JS `params.attachments || undefined`, JSON.stringify drops undefined).
    let fact = obj(vec![
        ("verb", jstr("call")),
        ("through", jstr("be1")),
        ("of", of_being("be2")),
        ("history", jstr("0")),
        ("ord", jnum(7.0)),
        ("date", Json::Null),
        ("params", obj(vec![("correlation", jstr("corr2"))])),
    ]);
    let row = inbox_open(&fact).unwrap();
    let expected = r#"{"_id":"corr2","recipient":"be2","summoner":"be1","sender":null,"content":null,"activeAble":null,"intent":null,"priority":"INTERACTIVE","priorityRank":3,"orientation":"forward","rootCorrelation":"corr2","inReplyTo":null,"inboxSpaceId":null,"ord":7,"sentAt":null,"history":"0"}"#;
    assert_eq!(img(&row), expected);
    // No "attachments" key at all.
    assert!(!img(&row).contains("attachments"));
}

#[test]
fn inbox_keeps_attachments_when_present_in_position() {
    // attachments present -> emitted, AFTER content/activeAble, BEFORE intent
    // (the JS $set literal order).
    let attach = Json::Arr(vec![jstr("a1")]);
    let fact = obj(vec![
        ("verb", jstr("call")),
        ("through", jstr("be1")),
        ("of", of_being("be2")),
        ("history", jstr("0")),
        ("ord", jnum(1.0)),
        ("date", Json::Null),
        (
            "params",
            obj(vec![
                ("correlation", jstr("c3")),
                ("attachments", attach),
            ]),
        ),
    ]);
    let row = inbox_open(&fact).unwrap();
    let expected = r#"{"_id":"c3","recipient":"be2","summoner":"be1","sender":null,"content":null,"activeAble":null,"attachments":["a1"],"intent":null,"priority":"INTERACTIVE","priorityRank":3,"orientation":"forward","rootCorrelation":"c3","inReplyTo":null,"inboxSpaceId":null,"ord":1,"sentAt":null,"history":"0"}"#;
    assert_eq!(img(&row), expected);
}

#[test]
fn inbox_ord_falls_back_to_params_ord_then_null() {
    // No fact.ord -> params.ord (the moment-less writer threads it there).
    let fact = obj(vec![
        ("verb", jstr("call")),
        ("through", jstr("be1")),
        ("of", of_being("be2")),
        ("history", jstr("0")),
        (
            "params",
            obj(vec![("correlation", jstr("c4")), ("ord", jnum(42.0))]),
        ),
    ]);
    let row = inbox_open(&fact).unwrap();
    assert!(img(&row).contains(r#""ord":42"#));
}

#[test]
fn inbox_skips_non_call_and_missing_inputs() {
    // Not a call -> None.
    let not_call = obj(vec![
        ("verb", jstr("do")),
        ("of", of_being("be2")),
        ("history", jstr("0")),
        ("params", obj(vec![("correlation", jstr("x"))])),
    ]);
    assert!(inbox_open(&not_call).is_none());

    // call but no correlation -> None.
    let no_corr = obj(vec![
        ("verb", jstr("call")),
        ("of", of_being("be2")),
        ("history", jstr("0")),
        ("params", obj(vec![])),
    ]);
    assert!(inbox_open(&no_corr).is_none());

    // call, correlation, but of is not a being -> None (no recipient reel).
    let no_recipient = obj(vec![
        ("verb", jstr("call")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr("sp1"))])),
        ("history", jstr("0")),
        ("params", obj(vec![("correlation", jstr("x"))])),
    ]);
    assert!(inbox_open(&no_recipient).is_none());

    // call, correlation, recipient, but NO history -> None (assertHistory invariant).
    let no_history = obj(vec![
        ("verb", jstr("call")),
        ("of", of_being("be2")),
        ("params", obj(vec![("correlation", jstr("x"))])),
    ]);
    assert!(inbox_open(&no_history).is_none());
}

#[test]
fn inbox_evicts_on_the_answering_act() {
    // closeInboxOnAnswer(correlation) -> the _id to delete; empty -> None.
    assert_eq!(inbox_evict("corr1"), Some("corr1".to_string()));
    assert_eq!(inbox_evict(""), None);
}

// ════════════════════════════════ THREADS ═══════════════════════════════════

#[test]
fn threads_opens_and_bumps_on_a_call_fact() {
    // First touch: insert. participants = [through, of.id]; startedAt/createdAt
    // seeded (null witness); ord 5; no parentThread.
    let fact = obj(vec![
        ("verb", jstr("call")),
        ("through", jstr("be1")),
        ("of", of_being("be2")),
        ("ord", jnum(5.0)),
        ("date", Json::Null),
        (
            "params",
            obj(vec![("rootCorrelation", jstr("root1")), ("correlation", jstr("corr1"))]),
        ),
    ]);
    assert_eq!(thread_root(&fact), Some("root1".to_string()));
    let row = threads_fold_call(None, &fact).expect("a call opens a thread row");
    let expected = r#"{"_id":"root1","ord":5,"lastAct":null,"updatedAt":null,"startedAt":null,"createdAt":null,"participants":["be1","be2"]}"#;
    assert_eq!(img(&row), expected, "thread row must be byte-compatible on insert");
}

#[test]
fn threads_root_falls_back_to_correlation() {
    // No rootCorrelation -> use correlation as the root key.
    let fact = obj(vec![
        ("verb", jstr("call")),
        ("through", jstr("be1")),
        ("of", of_being("be2")),
        ("ord", jnum(1.0)),
        ("date", Json::Null),
        ("params", obj(vec![("correlation", jstr("loneCorr"))])),
    ]);
    assert_eq!(thread_root(&fact), Some("loneCorr".to_string()));
    let row = threads_fold_call(None, &fact).unwrap();
    assert!(img(&row).starts_with(r#"{"_id":"loneCorr","#));
}

#[test]
fn threads_second_touch_bumps_lastact_and_extends_participants() {
    // A later call on the same root: ord/lastAct/updatedAt overwrite in place;
    // startedAt/createdAt stay (insert-only); a new participant is appended.
    let first = obj(vec![
        ("verb", jstr("call")),
        ("through", jstr("be1")),
        ("of", of_being("be2")),
        ("ord", jnum(5.0)),
        ("date", Json::Null),
        ("params", obj(vec![("rootCorrelation", jstr("root1"))])),
    ]);
    let row1 = threads_fold_call(None, &first).unwrap();

    let second = obj(vec![
        ("verb", jstr("call")),
        ("through", jstr("be3")),
        ("of", of_being("be2")),
        ("ord", jnum(9.0)),
        ("date", Json::Null),
        ("params", obj(vec![("rootCorrelation", jstr("root1"))])),
    ]);
    let row2 = threads_fold_call(Some(&row1), &second).expect("second touch updates");
    // ord bumped to 9; be3 appended (be2 already present); startedAt/createdAt kept.
    let expected = r#"{"_id":"root1","ord":9,"lastAct":null,"updatedAt":null,"startedAt":null,"createdAt":null,"participants":["be1","be2","be3"]}"#;
    assert_eq!(img(&row2), expected);
}

#[test]
fn threads_records_parent_thread_when_present() {
    let fact = obj(vec![
        ("verb", jstr("call")),
        ("through", jstr("be1")),
        ("of", of_being("be2")),
        ("ord", jnum(2.0)),
        ("date", Json::Null),
        (
            "params",
            obj(vec![
                ("rootCorrelation", jstr("childRoot")),
                ("parentThread", jstr("parentRoot")),
            ]),
        ),
    ]);
    let row = threads_fold_call(None, &fact).unwrap();
    // parentThread sits between $set (updatedAt) and $setOnInsert (startedAt).
    let expected = r#"{"_id":"childRoot","ord":2,"lastAct":null,"updatedAt":null,"parentThread":"parentRoot","startedAt":null,"createdAt":null,"participants":["be1","be2"]}"#;
    assert_eq!(img(&row), expected);
}

#[test]
fn threads_note_act_seal_bumps_ord() {
    // Seed a row, then a seal carrying ord 12 + a witness bumps ord; lastAct/
    // updatedAt take the inert witness; the rest is untouched.
    let row = obj(vec![
        ("_id", jstr("root1")),
        ("ord", jnum(5.0)),
        ("lastAct", Json::Null),
        ("updatedAt", Json::Null),
        ("startedAt", Json::Null),
        ("createdAt", Json::Null),
        ("participants", Json::Arr(vec![jstr("be1")])),
    ]);
    let bumped = threads_note_act_seal(Some(&row), &jnum(12.0), &jstr("2026-06-28T00:00:00Z"))
        .expect("seal with ord+at bumps");
    let expected = r#"{"_id":"root1","ord":12,"lastAct":"2026-06-28T00:00:00Z","updatedAt":"2026-06-28T00:00:00Z","startedAt":null,"createdAt":null,"participants":["be1"]}"#;
    assert_eq!(img(&bumped), expected);

    // ord only (no at): bumps ord, leaves lastAct/updatedAt.
    let ord_only = threads_note_act_seal(Some(&row), &jnum(20.0), &Json::Null).unwrap();
    assert!(img(&ord_only).contains(r#""ord":20"#));
    assert!(img(&ord_only).contains(r#""lastAct":null"#));

    // Neither ord nor at -> None (empty $set, the JS short-circuit).
    assert!(threads_note_act_seal(Some(&row), &Json::Null, &Json::Null).is_none());

    // Missing prior row -> None (no upsert on a seal).
    assert!(threads_note_act_seal(None, &jnum(1.0), &Json::Null).is_none());
}

// ════════════════════════════════ POSITION ══════════════════════════════════

#[test]
fn position_row_id_is_being_colon_space() {
    assert_eq!(position_row_id("be2", "sp1"), "be2:sp1");
}

#[test]
fn position_folds_a_coord_move() {
    // do:set-being field=coord value={x,y,z} on be2's reel, seq 3; spaceId
    // resolved (by the caller) to sp1.
    let fact = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", of_being("be2")),
        ("seq", jnum(3.0)),
        ("date", Json::Null),
        (
            "params",
            obj(vec![
                ("field", jstr("coord")),
                (
                    "value",
                    obj(vec![("x", jnum(1.0)), ("y", jnum(2.0)), ("z", jnum(4.0))]),
                ),
            ]),
        ),
    ]);
    match position_fold_coord(None, &fact, "sp1") {
        PositionOp::Upsert(row) => {
            // z appended AFTER updatedAt (the JS conditional-z order).
            let expected = r#"{"_id":"be2:sp1","beingId":"be2","spaceId":"sp1","x":1,"y":2,"lastMoveSeq":3,"updatedAt":null,"z":4}"#;
            assert_eq!(img(&row), expected, "position row must be byte-compatible");
        }
        other => panic!("expected Upsert, got {other:?}"),
    }
}

#[test]
fn position_omits_z_when_absent() {
    let fact = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", of_being("be2")),
        ("seq", jnum(1.0)),
        ("date", Json::Null),
        (
            "params",
            obj(vec![
                ("field", jstr("coord")),
                ("value", obj(vec![("x", jnum(0.0)), ("y", jnum(0.0))])),
            ]),
        ),
    ]);
    match position_fold_coord(None, &fact, "sp1") {
        PositionOp::Upsert(row) => {
            let expected = r#"{"_id":"be2:sp1","beingId":"be2","spaceId":"sp1","x":0,"y":0,"lastMoveSeq":1,"updatedAt":null}"#;
            assert_eq!(img(&row), expected);
            assert!(!img(&row).contains(r#""z""#));
        }
        other => panic!("expected Upsert, got {other:?}"),
    }
}

#[test]
fn position_seq_guard_rejects_a_stale_fact() {
    // A prior row at lastMoveSeq 10; a fact at seq 3 is stale -> NoOp.
    let prior = obj(vec![
        ("_id", jstr("be2:sp1")),
        ("beingId", jstr("be2")),
        ("spaceId", jstr("sp1")),
        ("x", jnum(9.0)),
        ("y", jnum(9.0)),
        ("lastMoveSeq", jnum(10.0)),
        ("updatedAt", Json::Null),
    ]);
    let stale = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", of_being("be2")),
        ("seq", jnum(3.0)),
        ("date", Json::Null),
        (
            "params",
            obj(vec![
                ("field", jstr("coord")),
                ("value", obj(vec![("x", jnum(1.0)), ("y", jnum(2.0))])),
            ]),
        ),
    ]);
    assert!(matches!(
        position_fold_coord(Some(&prior), &stale, "sp1"),
        PositionOp::NoOp
    ));

    // A newer fact (seq 11 > 10) passes.
    let fresh = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", of_being("be2")),
        ("seq", jnum(11.0)),
        ("date", Json::Null),
        (
            "params",
            obj(vec![
                ("field", jstr("coord")),
                ("value", obj(vec![("x", jnum(5.0)), ("y", jnum(6.0))])),
            ]),
        ),
    ]);
    assert!(matches!(
        position_fold_coord(Some(&prior), &fresh, "sp1"),
        PositionOp::Upsert(_)
    ));
}

#[test]
fn position_unset_deletes_the_beings_rows() {
    // value null -> DeleteForBeing(beingId), regardless of spaceId resolution.
    let fact = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", of_being("be2")),
        ("seq", jnum(4.0)),
        (
            "params",
            obj(vec![("field", jstr("coord")), ("value", Json::Null)]),
        ),
    ]);
    match position_fold_coord(None, &fact, "") {
        PositionOp::DeleteForBeing(id) => assert_eq!(id, "be2"),
        other => panic!("expected DeleteForBeing, got {other:?}"),
    }
}

#[test]
fn position_noops_on_wrong_verb_field_or_unresolved_space() {
    // Not set-being.
    let wrong_verb = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-space")),
        ("of", of_being("be2")),
        ("seq", jnum(1.0)),
        ("params", obj(vec![("field", jstr("coord")), ("value", obj(vec![("x", jnum(1.0)), ("y", jnum(2.0))]))])),
    ]);
    assert!(matches!(position_fold_coord(None, &wrong_verb, "sp1"), PositionOp::NoOp));

    // Field is not coord.
    let wrong_field = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", of_being("be2")),
        ("seq", jnum(1.0)),
        ("params", obj(vec![("field", jstr("name")), ("value", jstr("Bob"))])),
    ]);
    assert!(matches!(position_fold_coord(None, &wrong_field, "sp1"), PositionOp::NoOp));

    // Coord value present but spaceId UNRESOLVED ("") -> NoOp (the JS !spaceId return).
    let no_space = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", of_being("be2")),
        ("seq", jnum(1.0)),
        ("params", obj(vec![("field", jstr("coord")), ("value", obj(vec![("x", jnum(1.0)), ("y", jnum(2.0))]))])),
    ]);
    assert!(matches!(position_fold_coord(None, &no_space, ""), PositionOp::NoOp));

    // Non-finite coord (x missing) -> NoOp.
    let bad_coord = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", of_being("be2")),
        ("seq", jnum(1.0)),
        ("params", obj(vec![("field", jstr("coord")), ("value", obj(vec![("y", jnum(2.0))]))])),
    ]);
    assert!(matches!(position_fold_coord(None, &bad_coord, "sp1"), PositionOp::NoOp));
}
