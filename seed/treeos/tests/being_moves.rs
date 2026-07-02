// being_moves.rs — a Name births a being, embodies it, and WALKS: `w` / `move north.` lay a do:move on
// the being's reel; the being's coord is the FOLD of its steps. Proves the WASD chord parses, the
// self-move is authorized (you control your own body), and the position fold accumulates the step.

use treehash::{parse as pj, Json};
use treeos_lib::ibp::handle_wire_conn;

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn sstr(v: &Json, k: &str) -> String {
    match get(v, k) {
        Some(Json::Str(s)) => s.clone(),
        _ => String::new(),
    }
}
fn copy_dir(src: &std::path::Path, dst: &std::path::Path) {
    std::fs::create_dir_all(dst).unwrap();
    for e in std::fs::read_dir(src).unwrap() {
        let e = e.unwrap();
        let to = dst.join(e.file_name());
        if e.file_type().unwrap().is_dir() {
            copy_dir(&e.path(), &to);
        } else {
            let _ = std::fs::copy(e.path(), &to);
        }
    }
}

#[test]
fn a_being_walks_by_word() {
    let src = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../store/past"));
    if !src.exists() {
        eprintln!("skip: no ../../store/past");
        return;
    }
    let root = std::env::temp_dir().join(format!("treeos-walk-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    copy_dir(src, &root);

    let seed = [77u8; 32];
    let name_id = treesign::keypair_from_seed(&seed).name_id;
    let conn = 55511u64;

    // authenticate alice
    let mreq = format!(r#"{{"verb":"moment","address":"/","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}}}}"#);
    let sig = treesign::sign_moment_proof(&seed, &name_id, &pj(&mreq).unwrap());
    let signed = format!(
        r#"{{"verb":"moment","address":"/","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}},"proof":{{"alg":"ed25519","by":"{name_id}","value":"{sig}"}}}}"#
    );
    handle_wire_conn(&signed, &root, conn);

    // birth Tabor, capture the being id
    let act = format!(r#"{{"verb":"act","word":"I am Tabor.","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}}}}"#);
    let rv = pj(&handle_wire_conn(&act, &root, conn)).unwrap();
    let being = get(&rv, "results")
        .and_then(|r| if let Json::Arr(a) = r { a.first().cloned() } else { None })
        .and_then(|o| get(&o, "fact").and_then(|f| get(f, "of").map(|of| sstr(of, "id"))))
        .expect("birth sealed");
    let bfact = get(&rv, "results").and_then(|r| if let Json::Arr(a) = r { a.first().cloned() } else { None }).and_then(|o| get(&o, "fact").cloned()).unwrap();
    let bcoord = get(&bfact, "params").and_then(|p| get(p, "coord")).cloned().expect("birth carries a derived coord");
    let bx = get(&bcoord, "x").and_then(|x| if let Json::Num(n) = x { Some(*n) } else { None }).unwrap();
    let by = get(&bcoord, "y").and_then(|y| if let Json::Num(n) = y { Some(*n) } else { None }).unwrap();
    eprintln!("\n  born: {being}  at derived coord ({bx},{by})");

    // walk: alice, embodied as Tabor, says "w" (north) then "move east."
    let walk = |word: &str| -> Json {
        let a = format!(
            r#"{{"verb":"act","word":"{word}","history":"0","actor":{{"beingId":"{being}","nameId":"{name_id}","name":"alice"}}}}"#
        );
        pj(&handle_wire_conn(&a, &root, conn)).unwrap()
    };
    for w in ["w", "move east."] {
        let r = walk(w);
        let res = get(&r, "results").and_then(|x| if let Json::Arr(a) = x { a.first().cloned() } else { None });
        let out = match res.as_ref().and_then(|o| get(o, "fact")) {
            Some(f) => format!("do:{} dir={}", sstr(f, "act"), get(f, "params").and_then(|p| get(p, "direction")).map(treehash::stringify).unwrap_or_default()),
            None => format!("no fact: {}", get(&r, "results").map(treehash::stringify).unwrap_or_default()),
        };
        eprintln!("  {w:12} -> {out}");
        assert!(res.and_then(|o| get(&o, "fact").cloned()).map_or(false, |f| sstr(&f, "act") == "move"), "'{w}' should lay a do:move");
    }
    // the being's coord is the FOLD of its steps: born at {50,50}, north → y-1 = 49, east → x+1 = 51.
    // read the place as the custodial I (a plain read — no key-proof needed).
    let scene = pj(&handle_wire_conn(
        r#"{"verb":"moment","address":"/","history":"0","actor":{"beingId":"I","name":"I"}}"#,
        &root,
        90099,
    ))
    .unwrap();
    let sv = get(&scene, "view").expect("scene view");
    let coord = get(sv, "beings")
        .and_then(|b| if let Json::Arr(a) = b { a.iter().find(|n| sstr(n, "id") == being).cloned() } else { None })
        .and_then(|n| get(&n, "coord").cloned());
    eprintln!("  Tabor coord after N,E = {}\n", coord.as_ref().map(treehash::stringify).unwrap_or_else(|| "<not in scene>".into()));
    let c = coord.expect("Tabor is in the scene at its folded coord");
    // moved north (y-1) then east (x+1) from the DERIVED birth spot — the fold accumulated the steps.
    assert_eq!(get(&c, "x").and_then(|x| if let Json::Num(n) = x { Some(*n) } else { None }), Some(bx + 1.0), "east → x+1");
    assert_eq!(get(&c, "y").and_then(|y| if let Json::Num(n) = y { Some(*n) } else { None }), Some(by - 1.0), "north → y-1");
    treeos_lib::live::forget_conn(conn);
    let _ = std::fs::remove_dir_all(&root);
}
