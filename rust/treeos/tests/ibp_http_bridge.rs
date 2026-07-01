// ibp_http_bridge.rs — the HTTP↔IBPA bridge, end to end. A GET opens a moment (name+password unlocked
// server-side), the returned token rides a POST act, the token is SINGLE-USE (a moment is spent by its
// act), a bare POST is refused ("no open moment"), and a being holds only ONE open moment (a second
// opener is refused, 409). Runs from the repo root so declare_name finds .story/story.key + ables fold.

use treehash::{parse as pj, Json};
use treeos_lib::wire::Request;
use treeos_lib::{act, ibp_http};

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
/// Standard base64 (for the Basic-auth header the bridge decodes).
fn b64(s: &str) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let d = s.as_bytes();
    let mut out = String::new();
    for c in d.chunks(3) {
        let n = ((c[0] as u32) << 16) | ((*c.get(1).unwrap_or(&0) as u32) << 8) | *c.get(2).unwrap_or(&0) as u32;
        out.push(A[((n >> 18) & 63) as usize] as char);
        out.push(A[((n >> 12) & 63) as usize] as char);
        out.push(if c.len() > 1 { A[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if c.len() > 2 { A[(n & 63) as usize] as char } else { '=' });
    }
    out
}
fn req(method: &str, path: &str, headers: Vec<(&str, String)>, body: &[u8]) -> Request {
    Request {
        method: method.to_string(),
        path: path.to_string(),
        body: body.to_vec(),
        ws_key: None,
        headers: headers.into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
    }
}

#[test]
fn http_bridge_open_moment_then_act() {
    let repo = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let src = repo.join("store/past");
    if !src.exists() {
        eprintln!("skip: no store/past");
        return;
    }
    // from the repo root: declare_name signs with .story/story.key; ables fold from seed/store/words.
    std::env::set_current_dir(repo).unwrap();
    let root = std::env::temp_dir().join(format!("treeos-bridge-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    copy_dir(&src, &root);

    // FIXTURE: register a fresh Name "Zed" with a known password in the library (the Model-B blob).
    let seed = [123u8; 32];
    let name_id = treesign::keypair_from_seed(&seed).name_id;
    let pem = treesign::seed_to_pkcs8_pem(&seed);
    let blob = treesign::encrypt_with_password(&pem, "hunter2").expect("encrypt the key");
    let spec = Json::Obj(vec![
        ("name".to_string(), Json::Str("Zed".to_string())),
        ("privateKeyEnc".to_string(), Json::Str(blob)),
    ]);
    let declared = act::declare_name("name-declare", &name_id, "Zed", &spec, &root, "localhost");
    assert!(
        declared.iter().map(act::outcome_json).all(|j| matches!(get(&j, "ok"), Some(Json::Bool(true)))),
        "declared Zed: {:?}",
        declared.iter().map(|o| treehash::stringify(&act::outcome_json(o))).collect::<Vec<_>>()
    );

    // 1) GET /ibp/  Basic Zed:hunter2 → the story unlocks the key server-side, signs the proof, opens a
    //    moment, and returns a single-use token.
    let g = ibp_http::get_moment(&req("GET", "/ibp/", vec![("authorization", format!("Basic {}", b64("Zed:hunter2")))], b""), &root);
    assert_eq!(g.0, "200 OK", "GET opened a moment: {}", g.2);
    let token = sstr(&pj(&g.2).unwrap(), "moment");
    assert!(!token.is_empty(), "GET returned a moment token: {}", g.2);
    eprintln!("\n  GET /ibp/  → 200, moment token {}…", &token[..8.min(token.len())]);

    // 2) POST /ibp  X-Moment:<token>  body = one Word → the act rides the open moment.
    let p = ibp_http::post_act(&req("POST", "/ibp", vec![("x-moment", token.clone())], b"I am Tabor."), &root);
    assert_eq!(p.0, "200 OK", "the Word rode the open moment: {}", p.2);
    let being = get(&pj(&p.2).unwrap(), "results")
        .and_then(|r| if let Json::Arr(a) = r { a.first().cloned() } else { None })
        .and_then(|o| get(&o, "fact").and_then(|f| get(f, "of").map(|of| sstr(of, "id"))))
        .filter(|b| !b.is_empty())
        .expect("the act sealed a be:birth");
    eprintln!("  POST /ibp 'I am Tabor.' → 200, born {being}");

    // 3) SINGLE-USE: the same token again → the moment was spent, so the "no open moment" warning.
    let p2 = ibp_http::post_act(&req("POST", "/ibp", vec![("x-moment", token)], b"w"), &root);
    assert_eq!(p2.0, "401 Unauthorized", "a spent token is refused: {}", p2.2);
    assert!(p2.2.contains("no open moment"), "the warning: {}", p2.2);
    eprintln!("  POST again (spent token) → 401 no open moment");

    // 4) a bare POST with no token → the same warning.
    let p3 = ibp_http::post_act(&req("POST", "/ibp", vec![], b"w"), &root);
    assert_eq!(p3.0, "401 Unauthorized", "a POST with no moment is refused: {}", p3.2);

    // 5) ONE BEING, ONE OPEN MOMENT: lock the being's moment on conn A (a WS conn), then a GET embodying
    //    that being is refused (409) — a being cannot be present twice, in the SHARED gate.
    let conn_a = 700123u64;
    let mreq = format!(r#"{{"verb":"moment","address":"/","history":"0","actor":{{"beingId":"{being}","nameId":"{name_id}","name":"Zed"}}}}"#);
    let sig = treesign::sign_moment_proof(&seed, &name_id, &pj(&mreq).unwrap());
    let signed = format!(r#"{{"verb":"moment","address":"/","history":"0","actor":{{"beingId":"{being}","nameId":"{name_id}","name":"Zed"}},"proof":{{"alg":"ed25519","by":"{name_id}","value":"{sig}"}}}}"#);
    treeos_lib::ibp::handle_wire_conn(&signed, &root, conn_a); // conn A now holds the being's open moment
    let g2 = ibp_http::get_moment(
        &req("GET", "/ibp/", vec![("authorization", format!("Basic {}", b64("Zed:hunter2"))), ("x-being", being.clone())], b""),
        &root,
    );
    assert_eq!(g2.0, "409 Conflict", "a second opener of the being's moment is refused: {}", g2.2);
    assert!(g2.2.contains("already has an open moment"), "the conflict message: {}", g2.2);
    eprintln!("  GET embodying a busy being → 409 one being, one moment\n");
    treeos_lib::live::forget_conn(conn_a);

    let _ = std::fs::remove_dir_all(&root);
}
