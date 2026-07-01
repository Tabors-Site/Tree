// being_ownership.rs — the "you are not I" security floor. A Name may act ONLY through beings it OWNS
// (trueName) or that are delegated to it. It may NOT borrow another's being (e.g. a manager delegate).
// A beingless Name is @arrival and can do nothing but be born. Enforced SERVER-SIDE (gate_act).

use treehash::parse as pj;
use treeos_lib::ibp::handle_wire_conn;

fn is_unauthorized(reply: &str) -> bool {
    let r = pj(reply).unwrap();
    let code = |v: &treehash::Json, k: &str| match v {
        treehash::Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x.clone()),
        _ => None,
    };
    matches!(code(&r, "status"), Some(treehash::Json::Str(s)) if s == "error")
        && matches!(code(&r, "error").and_then(|e| code(&e, "code")), Some(treehash::Json::Str(s)) if s == "UNAUTHORIZED")
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
fn a_name_cannot_act_through_a_being_it_does_not_own() {
    let src = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../store/past"));
    if !src.exists() {
        eprintln!("skip: no ../../store/past");
        return;
    }
    let root = std::env::temp_dir().join(format!("treeos-own-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    copy_dir(src, &root);

    let seed = [21u8; 32];
    let name_id = treesign::keypair_from_seed(&seed).name_id;
    let conn = 55522u64;

    // authenticate alice
    let mreq = format!(r#"{{"verb":"moment","address":"/","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}}}}"#);
    let sig = treesign::sign_moment_proof(&seed, &name_id, &pj(&mreq).unwrap());
    let signed = format!(
        r#"{{"verb":"moment","address":"/","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}},"proof":{{"alg":"ed25519","by":"{name_id}","value":"{sig}"}}}}"#
    );
    handle_wire_conn(&signed, &root, conn);

    // alice tries to DRIVE @story-manager (a delegate being she does NOT own) and move it → REJECTED.
    let story_manager = "58ec00b339d3cb1f85824ee5409a9405202364940477eb8c749d3b6c4ca05856";
    let steal = format!(
        r#"{{"verb":"act","word":"move north.","history":"0","actor":{{"beingId":"{story_manager}","nameId":"{name_id}","name":"alice"}}}}"#
    );
    let r = handle_wire_conn(&steal, &root, conn);
    eprintln!("\n  drive @story-manager (not owned) -> {}\n", if is_unauthorized(&r) { "UNAUTHORIZED (blocked ✓)" } else { &r });
    assert!(is_unauthorized(&r), "a Name must NOT act through a being it does not own: {r}");

    // but alice CAN birth + act through her OWN being (control).
    let mine = format!(r#"{{"verb":"act","word":"I am Tabor.","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}}}}"#);
    assert!(!is_unauthorized(&handle_wire_conn(&mine, &root, conn)), "a Name CAN birth its own being");

    treeos_lib::live::forget_conn(conn);
    let _ = std::fs::remove_dir_all(&root);
}
