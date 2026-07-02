// Branching, end-to-end on the real filesystem (the reel-level half of the history/branch registry,
// ported from the JS history layer). Creates a branch off main at a per-reel branchPoint, lands facts
// on main AND the branch, and proves:
//   (1) read_reel_lineage UNIONS main[..=branchPoint] ++ branch[branchPoint+1..] correctly;
//   (2) the branch's FIRST fact chains its `p` ACROSS the fork to the parent's fact at branchPoint;
//   (3) resolve_history_lineage returns the chain to main; branch_point reads the floor;
//   (4) verify_fact_chain on the UNIONED lineage is INTACT across the fork;
//   (5) the ACT-chain peer — confirmed it does NOT fork (acts carry no seq; the per-history act-logs
//       are unioned at read time by ord), so the branch's first act starts at GENESIS_PREV on its own
//       empty .acthead and BOTH per-history act-chains verify independently;
//   (6) a clean / no-branch case stays byte-identical (a history with no facts at branch time floors
//       at 0, and the registry row + the main reel are unchanged).
// No JS — this proves the Rust branch registry + reel fork stand on their own, byte-compatible with the
// JS storage (the row JSON is the EXACT createHistory bytes; the .head fork is a normal reel head).

use std::collections::HashMap;

use treestore::{
    branch_point, commit_moment, create_history, fork_reel_fs, is_main, lineage_and_floors,
    read_act_chain_file, read_reel_file, read_reel_lineage, resolve_history_lineage,
    verify_act_chain, verify_fact_chain, Json, NewHistory, MAIN,
};

// ── tiny Json helpers ────────────────────────────────────────────────────────

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
fn sget(v: &Json, k: &str) -> String {
    match get(v, k) {
        Some(Json::Str(s)) => s.clone(),
        _ => String::new(),
    }
}
fn nget(v: &Json, k: &str) -> f64 {
    match get(v, k) {
        Some(Json::Num(n)) => *n,
        _ => f64::NAN,
    }
}
fn verdict_ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

// An I-Am-authored act whose single deltaF fact does `op`/`val` on @be1 in `history`. (The Word would
// compute all of this; commit_moment stamps the act on the act-chain and the fact on be1's reel.)
fn set_being_act(history: &str, ord_label: &str, value: &str) -> Json {
    let fact = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("field", jstr("n")), ("value", jstr(value))])),
        ("history", jstr(history)),
    ]);
    obj(vec![
        ("by", jstr("i-am")),
        ("through", jstr("i-am")),
        ("to", jstr("i-am")),
        ("story", jstr("main")),
        ("history", jstr(history)),
        ("startMessage", obj(vec![("content", jstr(ord_label)), ("source", jstr("i-am"))])),
        ("deltaF", Json::Arr(vec![fact])),
    ])
}

// The fs-bound per-history reader read_reel_lineage takes: (history, after, until) -> facts off disk.
fn fs_reader(root: &std::path::Path) -> impl Fn(&str, Option<f64>, Option<f64>) -> Vec<Json> + '_ {
    move |history: &str, after: Option<f64>, until: Option<f64>| {
        read_reel_file(root, history, "being", "be1", after, until)
    }
}

#[test]
fn branch_off_main_unions_chains_and_links_across_the_fork() {
    let dir = std::env::temp_dir().join("treestore-branching-fork");
    let _ = std::fs::remove_dir_all(&dir);

    // ── 1. Land THREE facts on MAIN's be1 reel (seq 1,2,3) via real commits. ──
    let mut ord = 1.0;
    for (i, v) in ["m1", "m2", "m3"].iter().enumerate() {
        let c = commit_moment(&dir, &set_being_act(MAIN, &format!("main {}", i + 1), v), ord)
            .expect("commit main");
        assert_eq!(c.fact_ids.len(), 1);
        ord += 1.0;
    }
    let main_facts = read_reel_file(&dir, MAIN, "being", "be1", None, None);
    assert_eq!(main_facts.len(), 3, "main has 3 facts");
    assert!(verdict_ok(&verify_fact_chain(&main_facts)), "main chain verifies");
    // The parent fact AT the branchPoint (seq 2) — the cross-fork anchor the branch's first fact links to.
    let branch_pt = 2.0_f64;
    let parent_tip_id = sget(&main_facts[1], "_id"); // seq 2 is index 1
    assert_eq!(nget(&main_facts[1], "seq"), branch_pt, "main[1] is seq 2");

    // ── 2. CREATE the branch "1" off main at branchPoint{ being:be1 = 2 }. ──
    // The registry row records parent + the per-reel floor; the row JSON is byte-identical to the JS.
    let mut bp = HashMap::new();
    bp.insert("being:be1".to_string(), branch_pt);
    let new_h = NewHistory {
        path: "1",
        parent: None, // child of main -> parent:null (main has no row), exactly as createBranch stores it
        branch_point: &bp,
        created_by: Some("i-am"),
        created_at: Some("2026-06-28T00:00:00.000Z"),
        label: Some("feature"),
        scope: None,
    };
    create_history(&dir, &new_h).expect("create_history");

    // (3a) resolve_history_lineage returns the chain to main.
    let lineage = resolve_history_lineage(&dir, "1").expect("lineage");
    assert_eq!(lineage, vec!["0".to_string(), "1".to_string()], "lineage main -> branch");
    assert!(is_main(&lineage[0]) && !is_main(&lineage[1]));

    // (3b) branch_point reads the floor for this reel; main floors at None (its reel starts at 1).
    assert_eq!(branch_point(&dir, "1", "being", "be1").unwrap(), Some(2.0), "branch floor = 2");
    assert_eq!(branch_point(&dir, MAIN, "being", "be1").unwrap(), None, "main has no branchPoint");
    // A reel the branch has no branchPoint entry for floors at 0 (no facts at branch time).
    assert_eq!(branch_point(&dir, "1", "space", "spX").unwrap(), Some(0.0), "absent reel floors at 0");

    // ── 3. FORK the branch's reel head from the parent fact at branchPoint. ──
    // Seeds .head = {head: 2, headHash: <main seq-2 _id>}, so the branch's first append gets seq 3 with
    // p = that tip — the cross-fork link falls out of a NORMAL commit, no special write path.
    let forked = fork_reel_fs(&dir, "1", MAIN, "being", "be1", branch_pt).expect("fork_reel");
    assert_eq!(forked.head, 2.0, "branch head seeded at branchPoint seq");
    assert_eq!(forked.head_hash, parent_tip_id, "branch head root = parent fact @ branchPoint");
    // Idempotent: a second fork is a no-op (head already exists, never regresses).
    let again = fork_reel_fs(&dir, "1", MAIN, "being", "be1", branch_pt).expect("fork again");
    assert_eq!(again, forked, "second fork is a no-op");

    // ── 4. Land TWO divergent facts on the BRANCH (seq 3,4) via real commits. ──
    // commit_moment reads the (seeded) branch head, so the first branch fact gets seq 3, p = parent tip.
    for (i, v) in ["b1", "b2"].iter().enumerate() {
        let c = commit_moment(&dir, &set_being_act("1", &format!("branch {}", i + 1), v), ord)
            .expect("commit branch");
        assert_eq!(c.fact_ids.len(), 1);
        ord += 1.0;
    }
    let branch_own = read_reel_file(&dir, "1", "being", "be1", None, None);
    assert_eq!(branch_own.len(), 2, "branch holds only its 2 divergent facts (not a copy of main)");
    assert_eq!(nget(&branch_own[0], "seq"), 3.0, "branch's first fact is seq 3 (branchPoint+1)");

    // (2) the branch's FIRST fact chains its `p` ACROSS the fork to the parent's fact at branchPoint.
    assert_eq!(
        sget(&branch_own[0], "p"),
        parent_tip_id,
        "the branch's first fact's p == the parent's fact at branchPoint (CROSS-FORK LINK)"
    );

    // ── (1) read_reel_lineage UNIONS main[..=2] ++ branch[3..] ──
    let (lin, floors) = lineage_and_floors(&dir, "1", "being", "be1").expect("lineage+floors");
    assert_eq!(floors.get("0"), Some(&0.0), "main floors at 0");
    assert_eq!(floors.get("1"), Some(&2.0), "branch floors at 2");
    let unioned = read_reel_lineage(&lin, &floors, None, None, fs_reader(&dir));
    // main seq 1,2 (owned (0,2]) ++ branch seq 3,4 (owned (2, inf]) = 4 contiguous facts.
    assert_eq!(unioned.len(), 4, "union = main[1,2] ++ branch[3,4]");
    let seqs: Vec<f64> = unioned.iter().map(|f| nget(f, "seq")).collect();
    assert_eq!(seqs, vec![1.0, 2.0, 3.0, 4.0], "union is seq-contiguous across the fork");
    // The union takes main's seq 1,2 (NOT main's seq 3 — that is past the branchPoint, the branch's world).
    let values: Vec<String> = unioned.iter().map(|f| sget(get(f, "params").unwrap(), "value")).collect();
    assert_eq!(values, vec!["m1", "m2", "b1", "b2"], "main prefix up to branchPoint, then branch tail");

    // ── (4) verify_fact_chain on the UNIONED lineage is INTACT across the fork ──
    let verdict = verify_fact_chain(&unioned);
    assert!(
        verdict_ok(&verdict),
        "the unioned cross-fork chain failed verify: {:?}",
        get(&verdict, "reason")
    );

    // ── (5) the ACT-chain peer: it does NOT fork. Acts carry no seq; the per-history act-logs are
    // independent chains unioned at read time by ord. main's act-log has 3 acts, the branch's has 2,
    // each starting fresh from GENESIS_PREV on its own .acthead — both verify independently. ──
    let main_acts = read_act_chain_file(&dir, "main", MAIN, "i-am");
    let branch_acts = read_act_chain_file(&dir, "main", "1", "i-am");
    assert_eq!(main_acts.len(), 3, "main act-log: 3 acts");
    assert_eq!(branch_acts.len(), 2, "branch act-log: 2 acts (its own chain, not forked)");
    assert!(verdict_ok(&verify_act_chain(&main_acts)), "main act-chain verifies");
    assert!(verdict_ok(&verify_act_chain(&branch_acts)), "branch act-chain verifies");
    // The branch's first act starts at genesis on its OWN empty .acthead (no cross-fork act link).
    assert_eq!(
        sget(&branch_acts[0], "p"),
        "0000000000000000000000000000000000000000000000000000000000000000",
        "the branch's first act's p is GENESIS_PREV (the act-chain does not fork)"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  treestore branching: create branch -> fork reel head -> divergent commits -> union + cross-fork p + verify intact; act-chains independent  OK (no Node)"
    );
}

#[test]
fn clean_no_branch_case_stays_byte_identical() {
    // A Story with NO branch: main's reel is read through the SAME lineage machinery (lineage ["0"],
    // floors {"0":0}) and must be byte-identical to the plain own-history read. And a branch row with no
    // facts at branch time floors every reel at 0 — the no-divergence case.
    let dir = std::env::temp_dir().join("treestore-branching-clean");
    let _ = std::fs::remove_dir_all(&dir);

    // Land 2 facts on main.
    for (i, v) in ["a", "b"].iter().enumerate() {
        commit_moment(&dir, &set_being_act(MAIN, &format!("m{}", i + 1), v), (i + 1) as f64)
            .expect("commit");
    }

    // On main, lineage_and_floors is (["0"], {"0":0}) and the union collapses to the own-reel read.
    let (lin, floors) = lineage_and_floors(&dir, MAIN, "being", "be1").expect("main lineage");
    assert_eq!(lin, vec!["0".to_string()], "main lineage is just main");
    assert_eq!(floors.get("0"), Some(&0.0));
    let via_lineage = read_reel_lineage(&lin, &floors, None, None, fs_reader(&dir));
    let plain = read_reel_file(&dir, MAIN, "being", "be1", None, None);
    // BYTE-IDENTICAL: the lineage read of clean main == the plain own-history read, fact for fact.
    assert_eq!(via_lineage.len(), plain.len(), "same count");
    for (a, b) in via_lineage.iter().zip(plain.iter()) {
        assert_eq!(treestore::stringify(a), treestore::stringify(b), "byte-identical fact");
    }
    assert!(verdict_ok(&verify_fact_chain(&via_lineage)), "clean main verifies via lineage");

    // A branch created with an EMPTY branchPoint (no facts at branch time) floors at 0: its first fact
    // would be seq 1 (forkReel seeds head 0 -> p = GENESIS_PREV), the from-scratch case.
    let empty_bp = HashMap::new();
    let h2 = NewHistory {
        path: "1",
        parent: None,
        branch_point: &empty_bp,
        created_by: None,
        created_at: Some("2026-06-28T00:00:00.000Z"),
        label: None,
        scope: None,
    };
    create_history(&dir, &h2).expect("create empty-bp history");
    assert_eq!(branch_point(&dir, "1", "being", "be1").unwrap(), Some(0.0), "empty branchPoint floors at 0");
    let forked = fork_reel_fs(&dir, "1", MAIN, "being", "be1", 0.0).expect("fork at 0");
    assert_eq!(forked.head, 0.0, "fork at 0 seeds head 0");
    assert_eq!(
        forked.head_hash, "0000000000000000000000000000000000000000000000000000000000000000",
        "fork at 0 -> p = GENESIS_PREV (no parent fact to link)"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treestore branching: clean/no-branch read byte-identical + empty-branchPoint floors at 0  OK");
}

#[test]
fn deep_lineage_resolves_and_floors_stack() {
    // A 3-deep lineage 0 -> 1 -> 1a: resolve_history_lineage walks both parents to main, and the floors
    // map carries each history's own branchPoint for the reel. (verifyReel/foldEngine build exactly this.)
    let dir = std::env::temp_dir().join("treestore-branching-deep");
    let _ = std::fs::remove_dir_all(&dir);

    let mut bp1 = HashMap::new();
    bp1.insert("being:be1".to_string(), 2.0);
    create_history(
        &dir,
        &NewHistory {
            path: "1",
            parent: None, // child of main
            branch_point: &bp1,
            created_by: None,
            created_at: Some("2026-06-28T00:00:00.000Z"),
            label: None,
            scope: None,
        },
    )
    .expect("create 1");

    let mut bp1a = HashMap::new();
    bp1a.insert("being:be1".to_string(), 5.0);
    create_history(
        &dir,
        &NewHistory {
            path: "1a",
            parent: Some("1"), // child of 1
            branch_point: &bp1a,
            created_by: None,
            created_at: Some("2026-06-28T00:00:00.000Z"),
            label: None,
            scope: None,
        },
    )
    .expect("create 1a");

    let lineage = resolve_history_lineage(&dir, "1a").expect("deep lineage");
    assert_eq!(
        lineage,
        vec!["0".to_string(), "1".to_string(), "1a".to_string()],
        "deep lineage 0 -> 1 -> 1a"
    );
    let (_lin, floors) = lineage_and_floors(&dir, "1a", "being", "be1").expect("deep floors");
    assert_eq!(floors.get("0"), Some(&0.0), "main floors 0");
    assert_eq!(floors.get("1"), Some(&2.0), "1 floors at its branchPoint 2");
    assert_eq!(floors.get("1a"), Some(&5.0), "1a floors at its branchPoint 5");

    // A MISSING row partway up is a loud corrupted-lineage error (the JS throws BRANCH_NOT_FOUND).
    let missing = resolve_history_lineage(&dir, "9");
    assert!(missing.is_err(), "an unknown history resolves to an error, not a silent main fallback");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treestore branching: deep lineage resolves + floors stack per ancestor; missing row is loud  OK");
}
