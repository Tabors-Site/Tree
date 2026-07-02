// treeproj::lineage: the PROJECTION LINEAGE-INHERITANCE walk (the cross-history half of the find*
// queries), ported from seed/materials/projections.js. The own-history leaves (index.rs find_by_*) read
// ONE history's index; this layer WALKS the lineage, gates inherited rows by the per-reel branchPoint,
// and SHADOWS the inherited row with the child's own (live OR tombstoned) slot. This proves, with NO Node
// in the loop, the four cross-history semantics + the live-history enumerator:
//   (1) INHERITANCE  : a being born on main BEFORE the branch forked is visible from the branch
//                      (find_by_name / find_by_parent / find_by_position / list_by_type all inherit it);
//   (2) SHADOW       : a being DIVERGED on the branch (a rename -> an own slot) shadows the inherited
//                      row - its old name no longer resolves from the branch, its new name does, and main
//                      is untouched;
//   (3) branchPoint  : a being born on main AFTER the branch forked (no branchPoint entry -> gate 0) is
//                      NOT visible from the branch (but IS on main);
//   (4) TOMBSTONE    : a being inherited then KILLED on the branch (qualities.dead -> a tombstoned own
//                      slot) is shadowed - historyShadows reads the RAW snapshot, so a tombstone hides
//                      the parent's row (it does not resurrect on the next query);
//   (5) ENUMERATOR   : list_live_histories enumerates the branch (main "0" is the implicit no-row root).
//
// We land rows with treestore::create_history + commit_moment (the real act+fact stamp). main's reels
// fold own-history (own == lineage on main). The branch's DIVERGENT aggregates are cold-folded the way
// the JS does it (readReelBetween is lineage-aware): fork the reel, commit the divergent fact, then fold
// the LINEAGE UNION (parent prefix up to the branchPoint ++ branch tail) and save the snapshot - so the
// branch's own .proj carries the COMPLETE folded state (the inherited fields + the divergence) and the
// derived index buckets it correctly. The cross-history walk then reads those per-history snapshots.

use std::collections::HashMap;

use treeproj::lineage;
use treeproj::{list_live_histories, refold, save_snapshot, Json};
use treestore::{
    commit_moment, create_history, fork_reel_fs, lineage_and_floors, read_reel_lineage, NewHistory,
    MAIN,
};

// ── tiny Json helpers ─────────────────────────────────────────────────────────

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
fn state_name(row: &Json) -> String {
    // a matched-slot row is `{ id, state, foldedSeq, position, tombstoned }`; read state.name.
    match get(row, "state") {
        Some(st) => sval(st, "name"),
        None => String::new(),
    }
}
// the ids of an occupant/id list (find_by_parent rows / list_by_type strings), sorted.
fn ids_sorted(rows: &[Json]) -> Vec<String> {
    let mut v: Vec<String> = rows.iter().map(|r| sval(r, "id")).collect();
    v.sort();
    v
}

// ── act builders (the Word's output: ONE act carrying its fact in deltaF) ─────

// A being-birth act: be:birth @<id> with name + homeSpace (-> position) + parentBeingId, on `history`.
fn birth_being(history: &str, id: &str, name: &str) -> Json {
    let fact = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        (
            "params",
            obj(vec![
                ("name", jstr(name)),
                ("homeSpace", jstr("sp1")),
                ("parentBeingId", jstr("be0")),
            ]),
        ),
        ("history", jstr(history)),
    ]);
    iam_act(history, &format!("birth {name}"), fact)
}

// A being rename act: do:set-being field=name -> diverges the being (an own slot in `history`).
fn rename_being(history: &str, id: &str, new_name: &str) -> Json {
    let fact = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        (
            "params",
            obj(vec![("field", jstr("name")), ("value", jstr(new_name))]),
        ),
        ("history", jstr(history)),
    ]);
    iam_act(history, &format!("rename {new_name}"), fact)
}

// A being kill act: be:kill -> folds qualities.dead (a tombstoned own slot in `history`).
fn kill_being(history: &str, id: &str) -> Json {
    let fact = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("kill")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        ("params", obj(vec![])),
        ("history", jstr(history)),
    ]);
    iam_act(history, "kill", fact)
}

// Wrap a fact as the I-Am's act (the act-chain key is `by`); the act lays the single deltaF fact.
fn iam_act(history: &str, label: &str, fact: Json) -> Json {
    obj(vec![
        ("by", jstr("i-am")),
        ("through", jstr("i-am")),
        ("to", jstr("i-am")),
        ("story", jstr("main")),
        ("history", jstr(history)),
        (
            "startMessage",
            obj(vec![("content", jstr(label)), ("source", jstr("i-am"))]),
        ),
        ("deltaF", Json::Arr(vec![fact])),
    ])
}

// ── fold helpers (materialize the .proj snapshot + the derived index) ────────

// main: own-history == lineage, so the plain refold (fold the own reel) is the complete slot.
fn refold_main(dir: &std::path::Path, id: &str) {
    refold(dir, MAIN, "being", id).expect("refold main being");
}

// the branch's DIVERGENT aggregate: cold-fold the LINEAGE UNION (the JS readReelBetween is lineage-aware)
// and save the snapshot, so the branch's own .proj carries the inherited fields + the divergence. This is
// exactly the JS cold-fold landing (fold over the lineage -> initProjection); save_snapshot re-buckets
// the derived index off the resulting slot.
fn refold_lineage(dir: &std::path::Path, history: &str, id: &str) {
    let (lin, floors) = lineage_and_floors(dir, history, "being", id).expect("lineage+floors");
    let facts = read_reel_lineage(&lin, &floors, None, None, |h, after, until| {
        treestore::read_reel_file(dir, h, "being", id, after, until)
    });
    let folded_seq = facts
        .iter()
        .filter_map(|f| match get(f, "seq") {
            Some(Json::Num(n)) => Some(*n),
            _ => None,
        })
        .fold(0.0_f64, f64::max);
    let state = treefold::fold("being", &facts);
    let position = match get(&state, "position") {
        Some(p @ Json::Str(_)) => p.clone(),
        _ => Json::Null,
    };
    let tombstoned = match get(&state, "qualities").and_then(|q| get(q, "dead")) {
        Some(Json::Null) | None => false,
        Some(_) => true,
    };
    let slot = obj(vec![
        ("state", state),
        ("foldedSeq", Json::Num(folded_seq)),
        ("position", position),
        ("tombstoned", Json::Bool(tombstoned)),
    ]);
    save_snapshot(dir, history, "being", id, &slot, None).expect("save branch snapshot");
}

#[test]
fn lineage_walk_inherits_shadows_gates_and_tombstones() {
    let dir = std::env::temp_dir().join("treeproj-lineage-queries");
    let _ = std::fs::remove_dir_all(&dir);
    let mut ord = 1.0;
    let mut commit = |act: &Json| {
        commit_moment(&dir, act, ord).expect("commit_moment");
        ord += 1.0;
    };

    // ── 1. MAIN, PRE-FORK: be1 Alice, be2 Bob, be5 Eve (all born @sp1, child of be0, seq 1). ──
    commit(&birth_being(MAIN, "be1", "Alice"));
    commit(&birth_being(MAIN, "be2", "Bob"));
    commit(&birth_being(MAIN, "be5", "Eve"));
    refold_main(&dir, "be1");
    refold_main(&dir, "be2");
    refold_main(&dir, "be5");

    // ── 2. CREATE BRANCH "1" off main; branchPoint{ being:be1=1, being:be2=1, being:be5=1 }. ──
    // be1/be2/be5 existed at branch time (seq 1) -> they are INHERITABLE into "1". A being born on main
    // AFTER this (be3) has NO branchPoint entry -> gate 0 -> NOT inheritable.
    let mut bp = HashMap::new();
    bp.insert("being:be1".to_string(), 1.0);
    bp.insert("being:be2".to_string(), 1.0);
    bp.insert("being:be5".to_string(), 1.0);
    create_history(
        &dir,
        &NewHistory {
            path: "1",
            parent: None, // child of main -> parent:null (main has no row)
            branch_point: &bp,
            created_by: Some("i-am"),
            created_at: Some("2026-06-28T00:00:00.000Z"),
            label: Some("feature"),
            scope: None,
        },
    )
    .expect("create branch 1");

    // ── 3. MAIN, POST-FORK: be3 Carol (born @sp1, seq 1, AFTER the branch forked). ──
    commit(&birth_being(MAIN, "be3", "Carol"));
    refold_main(&dir, "be3");

    // ── 4. BRANCH "1" divergences (fork each inherited reel, then the divergent fact, then cold-fold
    //        the lineage union -> the branch's own .proj). ──
    // be2 -> "Bobby" (rename: an own slot in "1" that SHADOWS the inherited Bob).
    fork_reel_fs(&dir, "1", MAIN, "being", "be2", 1.0).expect("fork be2");
    commit(&rename_being("1", "be2", "Bobby"));
    refold_lineage(&dir, "1", "be2");
    // be5 -> KILLED on "1" (qualities.dead: a tombstoned own slot that SHADOWS the inherited Eve).
    fork_reel_fs(&dir, "1", MAIN, "being", "be5", 1.0).expect("fork be5");
    commit(&kill_being("1", "be5"));
    refold_lineage(&dir, "1", "be5");
    // be4 -> Dave: a being born ONLY on "1" (purely own-history; no inheritance involved).
    commit(&birth_being("1", "be4", "Dave"));
    refold(&dir, "1", "being", "be4").expect("refold branch-own be4");

    // ─────────────────────────────────────────────────────────────────────────
    // (1) INHERITANCE - be1 Alice is inherited into "1" UNSHADOWED.
    // ─────────────────────────────────────────────────────────────────────────
    let alice_on_1 = lineage::find_by_name(&dir, "1", "being", "Alice", &obj(vec![]))
        .expect("walk ok")
        .expect("Alice inherited into branch 1");
    assert_eq!(sval(&alice_on_1, "id"), "be1", "find_by_name('1','Alice') -> the inherited main be1");
    assert_eq!(state_name(&alice_on_1), "Alice", "the inherited row carries main's folded state");
    // and on main she is found own-history.
    assert_eq!(
        sval(
            &lineage::find_by_name(&dir, MAIN, "being", "Alice", &obj(vec![]))
                .expect("ok")
                .expect("Alice on main"),
            "id"
        ),
        "be1",
        "find_by_name('0','Alice') -> be1 (own-history on main)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // (2) SHADOW - be2 diverged to "Bobby" on "1" shadows the inherited "Bob".
    // ─────────────────────────────────────────────────────────────────────────
    // "Bob" no longer resolves from "1" (the inherited row is shadowed by "1"'s own be2 slot, and the
    // local name index holds "Bobby", not "Bob").
    assert!(
        lineage::find_by_name(&dir, "1", "being", "Bob", &obj(vec![]))
            .expect("ok")
            .is_none(),
        "the inherited 'Bob' is SHADOWED by the branch's diverged be2 (renamed Bobby)"
    );
    // "Bobby" resolves to "1"'s own be2.
    let bobby = lineage::find_by_name(&dir, "1", "being", "Bobby", &obj(vec![]))
        .expect("ok")
        .expect("Bobby on branch 1");
    assert_eq!(sval(&bobby, "id"), "be2", "find_by_name('1','Bobby') -> the branch's own be2");
    assert_eq!(state_name(&bobby), "Bobby", "the branch slot carries the diverged name");
    // MAIN is untouched: "Bob" still resolves there, "Bobby" does not.
    assert_eq!(
        sval(
            &lineage::find_by_name(&dir, MAIN, "being", "Bob", &obj(vec![]))
                .expect("ok")
                .expect("Bob on main"),
            "id"
        ),
        "be2",
        "main still resolves 'Bob' -> be2 (the divergence is the branch's, not main's)"
    );
    assert!(
        lineage::find_by_name(&dir, MAIN, "being", "Bobby", &obj(vec![]))
            .expect("ok")
            .is_none(),
        "'Bobby' does not exist on main (the rename is branch-local)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // (3) branchPoint GATE - be3 Carol, born on main AFTER the fork, is NOT visible from "1".
    // ─────────────────────────────────────────────────────────────────────────
    assert!(
        lineage::find_by_name(&dir, "1", "being", "Carol", &obj(vec![]))
            .expect("ok")
            .is_none(),
        "Carol (born on main AFTER the branch forked, no branchPoint entry) is NOT visible from '1'"
    );
    // but Carol IS on main.
    assert_eq!(
        sval(
            &lineage::find_by_name(&dir, MAIN, "being", "Carol", &obj(vec![]))
                .expect("ok")
                .expect("Carol on main"),
            "id"
        ),
        "be3",
        "Carol resolves on main (own-history)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // (4) TOMBSTONE - be5 Eve inherited then KILLED on "1" is shadowed (does not resurrect).
    // ─────────────────────────────────────────────────────────────────────────
    assert!(
        lineage::find_by_name(&dir, "1", "being", "Eve", &obj(vec![]))
            .expect("ok")
            .is_none(),
        "Eve, killed on '1' (tombstoned own slot), is SHADOWED - the inherited row does NOT resurrect"
    );
    // Eve is alive on main (the kill was branch-local).
    assert_eq!(
        sval(
            &lineage::find_by_name(&dir, MAIN, "being", "Eve", &obj(vec![]))
                .expect("ok")
                .expect("Eve on main"),
            "id"
        ),
        "be5",
        "Eve still lives on main (the kill is the branch's)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // CROSS-CHECK the other three walks (parent / position / list_by_type) carry the SAME view.
    // ─────────────────────────────────────────────────────────────────────────
    // find_by_parent("1", be0): the children of be0 VISIBLE from "1" =
    //   be1 (inherited, unshadowed) + be2 (branch's own, diverged) + be4 (branch-own).
    //   NOT be5 (tombstoned -> shadowed), NOT be3 (post-fork -> gated).
    let children_1 = lineage::find_by_parent(&dir, "1", "be0").expect("parent walk");
    assert_eq!(
        ids_sorted(&children_1),
        vec!["be1", "be2", "be4"],
        "find_by_parent('1',be0): inherited be1 + diverged be2 + own be4 (be5 tombstoned, be3 gated)"
    );
    // on MAIN: be1, be2, be3, be5 (all four live there; be4 is branch-only).
    let children_main = lineage::find_by_parent(&dir, MAIN, "be0").expect("parent walk main");
    assert_eq!(
        ids_sorted(&children_main),
        vec!["be1", "be2", "be3", "be5"],
        "find_by_parent('0',be0): all four main beings (be4 is branch-only)"
    );

    // find_by_position("1", sp1): same membership (every being homed @sp1) - own ++ MAIN-visible, gated +
    // shadowed (the JS findByPosition unions own + MAIN directly).
    let here_1 = lineage::find_by_position(&dir, "1", "sp1").expect("position walk");
    assert_eq!(
        ids_sorted(&here_1),
        vec!["be1", "be2", "be4"],
        "find_by_position('1',sp1): inherited be1 + diverged be2 + own be4 (be5 tombstoned, be3 gated)"
    );
    let here_main = lineage::find_by_position(&dir, MAIN, "sp1").expect("position walk main");
    assert_eq!(
        ids_sorted(&here_main),
        vec!["be1", "be2", "be3", "be5"],
        "find_by_position('0',sp1): all four main beings"
    );

    // list_by_type("1", being): the catalog VISIBLE from "1" (same gating/shadowing).
    let mut beings_1 = lineage::list_by_type(&dir, "1", "being").expect("list walk");
    beings_1.sort();
    assert_eq!(
        beings_1,
        vec!["be1", "be2", "be4"],
        "list_by_type('1',being): inherited be1 + diverged be2 + own be4 (be5 tombstoned, be3 gated)"
    );
    let mut beings_main = lineage::list_by_type(&dir, MAIN, "being").expect("list walk main");
    beings_main.sort();
    assert_eq!(
        beings_main,
        vec!["be1", "be2", "be3", "be5"],
        "list_by_type('0',being): all four main beings"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // (5) ENUMERATOR - list_live_histories enumerates the branch (main is the implicit no-row root).
    // ─────────────────────────────────────────────────────────────────────────
    let live = list_live_histories(&dir);
    assert_eq!(
        live,
        vec!["1".to_string()],
        "list_live_histories enumerates the branch row; main '0' is the implicit no-row root"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  treeproj::lineage: cross-history walk - INHERIT (be1 Alice) + SHADOW (be2 Bobby) + branchPoint \
         GATE (be3 Carol invisible) + TOMBSTONE shadow (be5 Eve killed) across find_by_name/parent/position/\
         list_by_type; list_live_histories enumerates the branch  OK (no Node)"
    );
}

#[test]
fn list_live_histories_excludes_deleted_and_sorts_ascending() {
    // The enumerator filters `deleted !== true` and sorts by path ascending, off the _index.json the JS
    // FileCollection.find reads (Object.values), exactly as histories.listLiveHistories does.
    let dir = std::env::temp_dir().join("treeproj-lineage-live");
    let _ = std::fs::remove_dir_all(&dir);

    let empty = HashMap::new();
    // create three branches OUT OF ASCENDING ORDER to prove the sort.
    for path in ["1b", "1a", "1"] {
        create_history(
            &dir,
            &NewHistory {
                path,
                parent: if path == "1" { None } else { Some("1") },
                branch_point: &empty,
                created_by: None,
                created_at: Some("2026-06-28T00:00:00.000Z"),
                label: None,
                scope: None,
            },
        )
        .expect("create");
    }
    // a fourth, then soft-DELETE it (write the row with deleted:true via write_history_row).
    create_history(
        &dir,
        &NewHistory {
            path: "2",
            parent: None,
            branch_point: &empty,
            created_by: None,
            created_at: Some("2026-06-28T00:00:00.000Z"),
            label: None,
            scope: None,
        },
    )
    .expect("create 2");
    let deleted_row = obj(vec![
        ("_id", jstr("2")),
        ("path", jstr("2")),
        ("parent", Json::Null),
        ("branchPoint", obj(vec![])),
        ("deleted", Json::Bool(true)),
    ]);
    treestore::write_history_row(&dir, "2", &deleted_row).expect("overwrite 2 as deleted");

    let live = list_live_histories(&dir);
    assert_eq!(
        live,
        vec!["1".to_string(), "1a".to_string(), "1b".to_string()],
        "list_live_histories: ascending paths, the soft-deleted '2' excluded"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeproj::lineage: list_live_histories filters deleted + sorts ascending  OK");
}
