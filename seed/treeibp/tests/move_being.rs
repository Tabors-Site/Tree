// MOVE, END-TO-END: a being walks. A formed compass Word ("move north.") runs through THE ONE PATH
// (act_via_fold -> op_word_via_fold expands the composite "move" -> move.word's direction branch ->
// resolve-move-being validates the step -> the Return lays ONE do:move on the WALKER's own reel). The
// being's coord is then the FOLD of those steps: treefold's being reducer shifts the running coord by
// the direction's cell offset (north = y-1, south = y+1, east = x+1, west = x-1). Nothing is computed
// at act time — send the Word, a do:move fact lands, and the being's NEXT fold is already in the new
// spot, purely from the reel changing. The whole cycle is here: act (the move Word, a composite
// invocation) -> the fact lands -> the refold is the new moment. Node-free.

use std::path::Path;

use treehash::{parse as pj, Json};
use treeibp::{act_via_fold, ran_as_moments, Outcome};
use treestore::{read_reel_file, read_reel_head, seal_moment, write_fact_doc, FactSpec};

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
fn get_num(v: &Json, k: &str) -> Option<f64> {
    match get(v, k) {
        Some(Json::Num(n)) => Some(*n),
        _ => None,
    }
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

fn seed_dir() -> std::path::PathBuf {
    match std::env::var("TREE_SEED_DIR") {
        Ok(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed")),
    }
}
fn store_word(rel: &str) -> String {
    let p = seed_dir().join("store/words").join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

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

/// Plant a being at a known coord (birth: name + homeSpace + position + coord + trueName), then refold.
/// `true_name` = the Name that OWNS this being, so that Name hasAuthorityOver it (the being moves itself).
fn plant_being_at(dir: &Path, id: &str, name: &str, true_name: &str, home: &str, coord: (f64, f64), ord: f64) {
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        (
            "params",
            obj(vec![
                ("name", jstr(name)),
                ("trueName", jstr(true_name)),
                ("homeSpace", jstr(home)),
                ("position", jstr(home)),
                ("coord", obj(vec![("x", Json::Num(coord.0)), ("y", Json::Num(coord.1))])),
            ]),
        ),
    ]);
    stamp(dir, "being", id, &birth, ord);
    treeproj::refold(dir, "0", "being", id).expect("refold being");
}

fn plant_space(dir: &Path, id: &str, name: &str, parent: &str, ord: f64) {
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("do")),
        ("act", jstr("makespace")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr(id))])),
        ("params", obj(vec![("name", jstr(name)), ("parent", jstr(parent))])),
    ]);
    stamp(dir, "space", id, &birth, ord);
    treeproj::refold(dir, "0", "space", id).expect("refold space");
}

/// COIN "move" as a kind:op word on Am's reel so `op_word_via_fold` resolves it (the fold says "op";
/// the `file_of` closure supplies the body off disk). The noun is "being" (the step targets a being);
/// move.word AUTHORS its own factTarget, so the noun is advisory.
fn coin_op(dir: &Path, op: &str, noun: &str, ord: f64) {
    let coin = obj(vec![
        ("through", jstr("Am")),
        ("by", jstr("I")),
        ("verb", jstr("do")),
        ("act", jstr("coin")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("Am"))])),
        (
            "params",
            obj(vec![
                ("word", jstr(op)),
                ("ownerExtension", jstr("seed")),
                ("binding", obj(vec![("kind", jstr("op")), ("word", obj(vec![("noun", jstr(noun))]))])),
            ]),
        ),
    ]);
    stamp(dir, "being", "Am", &coin, ord);
}

/// The being's FOLDED coord (the authoritative render coord treefold builds, resolve.rs::coord_of reads).
fn folded_coord(dir: &Path, id: &str) -> Option<(f64, f64)> {
    let facts = read_reel_file(dir, "0", "being", id, None, None);
    let state = treefold::fold("being", &facts);
    let c = get(&state, "coord")?;
    Some((get_num(c, "x")?, get_num(c, "y")?))
}

#[test]
fn move_word_walks_the_being_end_to_end() {
    let dir = std::env::temp_dir().join("treeos-move-being-e2e");
    let _ = std::fs::remove_dir_all(&dir);

    // a room + a walker standing at (5, 5), owned by its own Name "WalkerName". "move" is coined
    // kind:op; its body is the seed move.word.
    plant_space(&dir, "grove", "grove", "", 1.0);
    plant_being_at(&dir, "walker", "Walker", "WalkerName", "grove", (5.0, 5.0), 2.0);
    coin_op(&dir, "move", "being", 3.0);

    let move_word = store_word("move/move.word");
    let file_of = move |op: &str, _noun: Option<&str>| -> Option<String> {
        match op {
            "move" => Some(move_word.clone()),
            _ => None,
        }
    };
    let no_spec = |_: &str| None;
    // the actor is the WALKER itself: beingId "walker", signed by its own Name "WalkerName" (which
    // trueName-owns it, so authorize's inheritation axis passes — a being moves ITSELF). The do:move
    // targets `$caller` = "walker".
    let i = pj(r#"{"beingId":"walker","nameId":"WalkerName"}"#).unwrap();

    assert_eq!(folded_coord(&dir, "walker"), Some((5.0, 5.0)), "the walker starts at (5,5)");

    // ── the moment/act cycle: send a formed "move north." Word (the W key's compass word) ──
    let out = act_via_fold("move north.", &i, &dir, "0", no_spec, &file_of, None, None);
    assert!(ran_as_moments(&out), "the composite move ran as N moments (no fused word-fact)");
    assert_eq!(out.len(), 1, "one step -> one do:move fact (the atomic move)");
    let fact = match &out[0] {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("the move was denied (expansion/auth failed): {r}"),
    };
    assert_eq!(get_str(fact, "verb"), Some("do"), "the fact is a do");
    assert_eq!(get_str(fact, "act"), Some("move"), "the fact is a do:move");
    assert_eq!(
        get(fact, "of").and_then(|o| get_str(o, "id")),
        Some("walker"),
        "the do:move landed on the WALKER's own reel (self-target via $caller)"
    );
    assert_eq!(
        get(fact, "params").and_then(|p| get_str(p, "direction")),
        Some("north"),
        "the do:move carries the direction (nothing computed at act time)"
    );

    // the do:move fact is really on the reel + the chain verifies (a moment, its own chain link).
    let facts = read_reel_file(&dir, "0", "being", "walker", None, None);
    let moves: Vec<&Json> = facts.iter().filter(|f| get_str(f, "act") == Some("move")).collect();
    assert_eq!(moves.len(), 1, "exactly one do:move on the walker's reel");
    assert!(
        matches!(get(&treestore::verify_fact_chain(&facts), "ok"), Some(Json::Bool(true))),
        "the walker's reel chain verifies after the move"
    );

    // ── the REFOLD is the new moment: the coord fell north by one (y 5 -> 4), purely from the fold ──
    assert_eq!(
        folded_coord(&dir, "walker"),
        Some((5.0, 4.0)),
        "north = y falls by one: the being's re-folded coord is the new spot"
    );

    // ── ACCUMULATION across ALL FOUR compass words the portal sends (W/S/A/D). The offset convention
    //    (documented for the portal): north = (0,-1) [y falls], south = (0,+1) [y rises], east = (+1,0)
    //    [x rises], west = (-1,0) [x falls]. ──
    for dir_word in ["move east.", "move east.", "move south.", "move west."] {
        let o = act_via_fold(dir_word, &i, &dir, "0", no_spec, &file_of, None, None);
        assert!(matches!(o[0], Outcome::Authorized(_)), "{dir_word} authorized");
    }
    // start (5,5) -> N (5,4) -> E (6,4) -> E (7,4) -> S (7,5) -> W (6,5)
    assert_eq!(
        folded_coord(&dir, "walker"),
        Some((6.0, 5.0)),
        "the coord is the FOLD of the five steps (N,E,E,S,W accumulated), no act-time computation"
    );
    // five do:move facts total (one per step).
    let facts = read_reel_file(&dir, "0", "being", "walker", None, None);
    let n_moves = facts.iter().filter(|f| get_str(f, "act") == Some("move")).count();
    assert_eq!(n_moves, 5, "five steps -> five do:move facts on the reel");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  MOVE e2e: 'move north.' -> composite expands -> do:move lands -> the refold walks the being  OK");
}

/// The position PROJECTION (treesecondary) folds the SAME do:move facts into its (beingId,spaceId)
/// coord index by accumulating the direction step — the parallel coord index the portal's scene reads.
#[test]
fn position_projection_accumulates_the_step() {
    use treesecondary::{position_fold_move, PositionOp};

    let mk = |seq: f64, dir: &str| {
        obj(vec![
            ("verb", jstr("do")),
            ("act", jstr("move")),
            ("of", obj(vec![("kind", jstr("being")), ("id", jstr("walker"))])),
            ("params", obj(vec![("direction", jstr(dir))])),
            ("seq", Json::Num(seq)),
        ])
    };
    // first step, no prior row: origin (0,0) + north (y-1) -> (0,-1).
    let row = match position_fold_move(None, &mk(1.0, "north"), "grove") {
        PositionOp::Upsert(r) => r,
        other => panic!("first step should upsert, got {other:?}"),
    };
    assert_eq!(get_num(&row, "x"), Some(0.0));
    assert_eq!(get_num(&row, "y"), Some(-1.0));

    // second step accumulates onto the prior row: (0,-1) + east (x+1) -> (1,-1).
    let row2 = match position_fold_move(Some(&row), &mk(2.0, "east"), "grove") {
        PositionOp::Upsert(r) => r,
        other => panic!("second step should upsert, got {other:?}"),
    };
    assert_eq!(get_num(&row2, "x"), Some(1.0));
    assert_eq!(get_num(&row2, "y"), Some(-1.0));

    // seq-guard: a stale re-fold (seq <= lastMoveSeq) is a NoOp (no double-count).
    assert!(matches!(position_fold_move(Some(&row2), &mk(2.0, "west"), "grove"), PositionOp::NoOp));

    println!("  MOVE position projection: do:move steps accumulate into the coord index (seq-guarded)  OK");
}
