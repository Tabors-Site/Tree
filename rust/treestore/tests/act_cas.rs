// The .acthead compare-and-set — the chain-fork protection. The interop test drives the happy advance;
// this one proves all three outcomes, pure and on the real filesystem: a clean advance, an idempotent
// settled replay (head already IS the act), and a refusal when a STALE author's expected-prev no longer
// matches the moved head (ACT_CHAIN_MOVED — the chain cannot fork).

use treestore::{
    advance_act_head, advance_act_head_file, append_act_line, compute_act_doc, read_act_head_file,
    AdvanceError, HeadAdvance, Json, GENESIS_PREV,
};

fn opening(to: &str) -> Json {
    Json::Obj(vec![
        ("through".to_string(), Json::Str("be1".to_string())),
        ("to".to_string(), Json::Str(to.to_string())),
        ("story".to_string(), Json::Str("st".to_string())),
        ("history".to_string(), Json::Str("0".to_string())),
    ])
}

#[test]
fn act_head_compare_and_set() {
    // ── pure CAS, all three outcomes ────────────────────────────────────────
    assert_eq!(advance_act_head(GENESIS_PREV, GENESIS_PREV, "aaa"), Ok(HeadAdvance::Advanced));
    assert_eq!(advance_act_head("aaa", "aaa", "aaa"), Ok(HeadAdvance::Replayed)); // head already IS the act
    assert!(advance_act_head("bbb", "aaa", "ccc").is_err()); // chain moved under a stale author

    // ── on disk: advance, replay, refuse ────────────────────────────────────
    let dir = std::env::temp_dir().join("treestore-cas-test");
    let _ = std::fs::remove_dir_all(&dir);
    let (s, h, by) = ("st", "0", "nmX");

    let a1 = compute_act_doc(&opening("be1"), GENESIS_PREV);
    append_act_line(&dir, s, h, by, &a1.doc).expect("append act 1");
    assert_eq!(
        advance_act_head_file(&dir, s, h, by, &a1.id, GENESIS_PREV).expect("advance"),
        HeadAdvance::Advanced,
    );
    assert_eq!(read_act_head_file(&dir, s, h, by), a1.id, ".acthead moved to the new act");

    // settled replay: advancing the same id again is a no-op
    assert_eq!(
        advance_act_head_file(&dir, s, h, by, &a1.id, GENESIS_PREV).expect("replay"),
        HeadAdvance::Replayed,
    );

    // a stale author whose expect_prev is still GENESIS (but the head is now a1) is REFUSED
    let a2 = compute_act_doc(&opening("be2"), &a1.id);
    match advance_act_head_file(&dir, s, h, by, &a2.id, GENESIS_PREV) {
        Err(AdvanceError::ChainMoved) => {}
        other => panic!("stale author should get ACT_CHAIN_MOVED, got {other:?}"),
    }
    // the head did not move (the fork was refused)
    assert_eq!(read_act_head_file(&dir, s, h, by), a1.id, "refused advance must not move the head");

    // the rightful next author (expect_prev = a1) advances fine
    append_act_line(&dir, s, h, by, &a2.doc).expect("append act 2");
    assert_eq!(
        advance_act_head_file(&dir, s, h, by, &a2.id, &a1.id).expect("advance 2"),
        HeadAdvance::Advanced,
    );
    assert_eq!(read_act_head_file(&dir, s, h, by), a2.id);

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treestore .acthead CAS: advance / settled-replay / ACT_CHAIN_MOVED refusal  OK");
}
