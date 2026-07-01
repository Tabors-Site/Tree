// first_being_birth.rs — a new NAME births its first being. Proves "I" = the Name's facet: the being is
// the Name's OWN (trueName = the Name), the be:birth is attributed to the Name (by), and it's authorized
// WITHOUT a grant (a Name is the I of its own beings, like genesis I→Am). Drives the real signed gate.

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
fn a_new_name_births_its_own_first_being() {
    let src = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../store/past"));
    if !src.exists() {
        eprintln!("skip: no ../../store/past");
        return;
    }
    let root = std::env::temp_dir().join(format!("treeos-first-birth-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    copy_dir(src, &root);

    let seed = [42u8; 32];
    let name_id = treesign::keypair_from_seed(&seed).name_id;
    let conn = 55599u64;

    // 1. alice OPENS a moment (signed) → authenticates.
    let mreq = format!(r#"{{"verb":"moment","address":"/","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}}}}"#);
    let sig = treesign::sign_moment_proof(&seed, &name_id, &pj(&mreq).unwrap());
    let signed = format!(
        r#"{{"verb":"moment","address":"/","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}},"proof":{{"alg":"ed25519","by":"{name_id}","value":"{sig}"}}}}"#
    );
    handle_wire_conn(&signed, &root, conn);
    assert!(treeos_lib::live::is_authenticated(conn, &name_id), "alice's signed moment authenticates");

    // helper: alice says a Word, returns the sealed fact (or panics with the denial).
    let birth = |label: &str| -> Json {
        let act = format!(r#"{{"verb":"act","word":"I am Tabor.","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}}}}"#);
        let rv = pj(&handle_wire_conn(&act, &root, conn)).unwrap();
        get(&rv, "results")
            .and_then(|r| if let Json::Arr(a) = r { a.first().cloned() } else { None })
            .and_then(|o| get(&o, "fact").cloned())
            .unwrap_or_else(|| panic!("{label}: no fact: {}", get(&rv, "results").map(treehash::stringify).unwrap_or_default()))
    };

    // 2. alice says "I am Tabor." — "I" is HER facet, so she births her OWN being (create).
    let f = birth("first I am Tabor");
    let by = sstr(&f, "by");
    let true_name = get(&f, "params").and_then(|p| get(p, "trueName")).map(treehash::stringify).unwrap_or_default();
    let being = get(&f, "of").map(|o| sstr(o, "id")).unwrap_or_default();
    eprintln!("\n  1st: be:{}  of={being}  by={by}  trueName={true_name}", sstr(&f, "act"));
    assert_eq!(sstr(&f, "act"), "birth", "first 'I am Tabor' births");
    assert_eq!(by, name_id, "attributed to alice's Name (by = alice)");
    assert!(true_name.contains(&name_id), "the being expresses alice's Name (trueName): {true_name}");
    assert!(being.starts_with("tabor-"), "per-Name derived being id, not the literal name: {being}");

    // 3. alice says "I am Tabor." AGAIN — the being exists, so this CONNECTS (switch), not re-birth.
    let f2 = birth("second I am Tabor");
    eprintln!("  2nd: be:{}  of={}\n", sstr(&f2, "act"), get(&f2, "of").map(|o| sstr(o, "id")).unwrap_or_default());
    assert_eq!(sstr(&f2, "act"), "connect", "second 'I am Tabor' connects to the existing being (create-or-switch)");
    assert_eq!(get(&f2, "of").map(|o| sstr(o, "id")).unwrap_or_default(), being, "connects to the SAME per-Name being");

    treeos_lib::live::forget_conn(conn);
    let _ = std::fs::remove_dir_all(&root);
}
