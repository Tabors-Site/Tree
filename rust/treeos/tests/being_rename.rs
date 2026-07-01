// being_rename.rs — "My name is X" renames the CURRENT being. A self do:set-being on `name`, authorized
// because you name yourself; the fold sets the being's name.

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
fn my_name_is_renames_the_current_being() {
    let src = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../store/past"));
    if !src.exists() {
        eprintln!("skip: no ../../store/past");
        return;
    }
    let root = std::env::temp_dir().join(format!("treeos-rename-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    copy_dir(src, &root);

    let seed = [88u8; 32];
    let name_id = treesign::keypair_from_seed(&seed).name_id;
    let conn = 55533u64;

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
        .expect("birth");

    // embodied as Tabor, rename yourself
    let rn = format!(
        r#"{{"verb":"act","word":"My name is Taborgreat.","history":"0","actor":{{"beingId":"{being}","nameId":"{name_id}","name":"alice"}}}}"#
    );
    let r = pj(&handle_wire_conn(&rn, &root, conn)).unwrap();
    let f = get(&r, "results").and_then(|x| if let Json::Arr(a) = x { a.first().cloned() } else { None }).and_then(|o| get(&o, "fact").cloned())
        .unwrap_or_else(|| panic!("rename denied: {}", get(&r, "results").map(treehash::stringify).unwrap_or_default()));
    eprintln!("\n  rename fact: do:{} field={} value={}\n", sstr(&f, "act"), get(&f, "params").and_then(|p| get(p, "field")).map(treehash::stringify).unwrap_or_default(), get(&f, "params").and_then(|p| get(p, "value")).map(treehash::stringify).unwrap_or_default());
    assert_eq!(sstr(&f, "act"), "set-being", "a self set-being");
    assert_eq!(get(&f, "params").and_then(|p| get(p, "field")).and_then(|x| if let Json::Str(s) = x { Some(s.clone()) } else { None }).as_deref(), Some("name"));
    assert_eq!(get(&f, "params").and_then(|p| get(p, "value")).and_then(|x| if let Json::Str(s) = x { Some(s.clone()) } else { None }).as_deref(), Some("Taborgreat"));

    // the fold shows the new name
    let scene = pj(&handle_wire_conn(r#"{"verb":"moment","address":"/","history":"0","actor":{"beingId":"I","name":"I"}}"#, &root, 90077)).unwrap();
    let renamed = get(&scene, "view").and_then(|v| get(v, "beings")).and_then(|b| if let Json::Arr(a) = b { a.iter().any(|n| sstr(n, "id") == being && sstr(n, "name") == "Taborgreat").into() } else { None }).unwrap_or(false);
    assert!(renamed, "the being folds to its new name 'Taborgreat'");

    treeos_lib::live::forget_conn(conn);
    let _ = std::fs::remove_dir_all(&root);
}
