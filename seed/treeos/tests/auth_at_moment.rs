// AUTH-AT-MOMENT — the open moment IS the session. A Name opens a moment by PROVING its key at the
// moment (a signature by the Name's key over the moment's identity); once proven, its ACTS RIDE that
// open moment without re-checking the key. This drives the REAL wire dispatch (ibp::handle_wire_conn)
// with a per-connection conn id (the session key), so it exercises the exact gate the WS lane runs.
//
// NO Node anywhere: treesign signs the proof, the edge verifies it, live.rs holds the ephemeral session.
// Clock-free: the session keys on the conn, never a wall-clock.

use treehash::{parse as pj, Json};
use treeos_lib::ibp::handle_wire_conn;

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

/// True when the reply is an IBP error with the UNAUTHORIZED code (the moment/act was rejected).
fn is_unauthorized(reply: &str) -> bool {
    let r = pj(reply).unwrap();
    get(&r, "status").and_then(|s| if let Json::Str(s) = s { Some(s.as_str()) } else { None }) == Some("error")
        && get(&r, "error").and_then(|e| get_str(e, "code")) == Some("UNAUTHORIZED")
}

/// True when the reply is a moment view (the moment opened — NOT an error envelope).
fn is_moment_view(reply: &str) -> bool {
    let r = pj(reply).unwrap();
    get(&r, "verb").and_then(|v| if let Json::Str(v) = v { Some(v.as_str()) } else { None }) == Some("moment")
}

#[test]
fn moment_with_valid_proof_opens_and_authenticates_acts_ride_it() {
    let root = std::env::temp_dir().join("treeos-auth-at-moment-test");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();

    // A being = a key. Its id IS its public key (the id-derivation rule).
    let seed = [7u8; 32];
    let kp = treesign::keypair_from_seed(&seed);
    let name_id = kp.name_id.clone();

    // The moment request the portal sends: perceive this being's reel AS this being.
    let moment_req = format!(
        r#"{{"verb":"moment","kind":"being","id":"{name_id}","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}}}}"#
    );

    // The conn is the session key (one per WS connection). Reuse a fixed conn for this connection.
    let conn = 90001u64;

    // 1. A moment with NO proof is REJECTED (you cannot open a Name's moment without its key).
    let no_proof = handle_wire_conn(&moment_req, &root, conn);
    assert!(is_unauthorized(&no_proof), "a moment with no key-proof is rejected: {no_proof}");

    // 2. A moment with an INVALID proof (wrong key signs it) is REJECTED.
    let wrong_seed = [8u8; 32];
    let req_json = pj(&moment_req).unwrap();
    let bad_sig = treesign::sign_moment_proof(&wrong_seed, &name_id, &req_json);
    let bad_moment = format!(
        r#"{{"verb":"moment","kind":"being","id":"{name_id}","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}},"proof":{{"alg":"ed25519","by":"{name_id}","value":"{bad_sig}"}}}}"#
    );
    let bad = handle_wire_conn(&bad_moment, &root, conn);
    assert!(is_unauthorized(&bad), "a moment signed by the wrong key is rejected: {bad}");

    // 3. An ACT before any open moment is REJECTED (no open authenticated moment for the actor).
    let act_req = format!(
        r#"{{"verb":"act","word":"I am alice.","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}}}}"#
    );
    let act_before = handle_wire_conn(&act_req, &root, conn);
    assert!(is_unauthorized(&act_before), "an act with no open moment is rejected: {act_before}");

    // 4. A moment with a VALID proof OPENS + AUTHENTICATES (recorded in the session registry).
    let good_sig = treesign::sign_moment_proof(&seed, &name_id, &req_json);
    let good_moment = format!(
        r#"{{"verb":"moment","kind":"being","id":"{name_id}","history":"0","actor":{{"nameId":"{name_id}","name":"alice"}},"proof":{{"alg":"ed25519","by":"{name_id}","value":"{good_sig}"}}}}"#
    );
    let opened = handle_wire_conn(&good_moment, &root, conn);
    assert!(is_moment_view(&opened), "a valid-proof moment opens (a moment view, not an error): {opened}");
    assert!(treeos_lib::live::is_authenticated(conn, &name_id), "the open moment recorded the session");

    // 5. NOW the act RIDES the open moment — it passes the SESSION gate (no per-act key check). The act
    //    may still be DENIED by permission/seal downstream, but it is NOT UNAUTHORIZED (the auth gate
    //    passed). The auth gate is the moment, not a per-act login.
    let act_after = handle_wire_conn(&act_req, &root, conn);
    assert!(!is_unauthorized(&act_after), "an act on an open authenticated moment passes the auth gate: {act_after}");

    // 6. A DIFFERENT connection (no open moment for this Name) still cannot act — the session is
    //    per-connection, ephemeral, and dies with the socket.
    let other_conn = 90002u64;
    let act_other = handle_wire_conn(&act_req, &root, other_conn);
    assert!(is_unauthorized(&act_other), "another connection has no open moment -> its act is rejected: {act_other}");

    // 7. The session is ephemeral: closing the socket forgets it (NO chain write).
    treeos_lib::live::forget_conn(conn);
    assert!(!treeos_lib::live::is_authenticated(conn, &name_id), "socket close drops the in-memory session");

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_being_with_a_password_needs_the_extra_gate_but_a_passwordless_one_does_not() {
    let root = std::env::temp_dir().join("treeos-auth-being-password-test");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();

    let seed = [11u8; 32];
    let kp = treesign::keypair_from_seed(&seed);
    let name_id = kp.name_id.clone();

    // SEED a being reel whose folded state carries a PASSWORD (a stored hash): one be:birth being fact
    // whose spec sets `password`. The being id IS the Name id (the id-derivation rule). This is the
    // OPTIONAL extra gate. Most beings carry no password; this one does.
    let pw_hash = treesign::hash_password("hunter2").unwrap();
    let shard = &name_id[..2];
    let dir = root.join("reels").join("0").join("being").join(shard);
    std::fs::create_dir_all(&dir).unwrap();
    let birth = format!(
        r#"{{"_id":"f1","seq":1,"ord":1,"verb":"be","act":"birth","of":{{"kind":"being","id":"{name_id}"}},"params":{{"name":"vault","password":"{pw_hash}"}}}}"#
    );
    std::fs::write(dir.join(format!("{name_id}.reel")), format!("{birth}\n")).unwrap();

    let moment_req =
        format!(r#"{{"verb":"moment","kind":"being","id":"{name_id}","history":"0","actor":{{"nameId":"{name_id}","name":"vault"}}}}"#);
    let req_json = pj(&moment_req).unwrap();
    let sig = treesign::sign_moment_proof(&seed, &name_id, &req_json);
    let conn = 92001u64;

    // A KEY-PROVEN moment WITHOUT the being's password is REJECTED. The key passed, but the inner door
    // (the being's optional password) did not open.
    let no_pw = format!(
        r#"{{"verb":"moment","kind":"being","id":"{name_id}","history":"0","actor":{{"nameId":"{name_id}","name":"vault"}},"proof":{{"value":"{sig}"}}}}"#
    );
    let r = handle_wire_conn(&no_pw, &root, conn);
    assert!(is_unauthorized(&r), "a password-protected being needs its password even with a valid key: {r}");
    assert!(!treeos_lib::live::is_authenticated(conn, &name_id), "the rejected moment opened no session");

    // The SAME moment WITH the correct password opens + authenticates. The proof payload ignores the
    // `password` field (it is not part of the moment identity), so the same signature still verifies.
    let with_pw = format!(
        r#"{{"verb":"moment","kind":"being","id":"{name_id}","history":"0","actor":{{"nameId":"{name_id}","name":"vault"}},"password":"hunter2","proof":{{"value":"{sig}"}}}}"#
    );
    let ok = handle_wire_conn(&with_pw, &root, conn);
    assert!(is_moment_view(&ok), "the right being-password opens the moment: {ok}");
    assert!(treeos_lib::live::is_authenticated(conn, &name_id), "the extra gate passed -> the session is open");

    // A WRONG password is rejected.
    let other_conn = 92002u64;
    let wrong_pw = format!(
        r#"{{"verb":"moment","kind":"being","id":"{name_id}","history":"0","actor":{{"nameId":"{name_id}","name":"vault"}},"password":"nope","proof":{{"value":"{sig}"}}}}"#
    );
    let w = handle_wire_conn(&wrong_pw, &root, other_conn);
    assert!(is_unauthorized(&w), "a wrong being-password is rejected: {w}");

    treeos_lib::live::forget_conn(conn);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn i_the_story_needs_no_moment_proof() {
    let root = std::env::temp_dir().join("treeos-auth-i-story-test");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();

    // I's moment carries NO proof — the custodial story key is the edge's, verified at the signer, not
    // a per-moment proof. The moment is NOT rejected (the genesis/loop path is unaffected).
    let conn = 91001u64;
    let i_moment = r#"{"verb":"moment","kind":"being","id":"I","history":"0","actor":{"beingId":"I","name":"I"}}"#;
    let reply = handle_wire_conn(i_moment, &root, conn);
    assert!(!is_unauthorized(&reply), "I's moment is never rejected for a missing key-proof: {reply}");

    let _ = std::fs::remove_dir_all(&root);
}
