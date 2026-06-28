// Conformance: treeval::auth reproduces the cross-history resolution of historyResolve.js
// (resolveTargetHistory) + authorize.js's actorHistory derivation (the foreign-actor guard),
// byte-for-byte. This is the sophisticated cross-history act-signing/auth logic that must survive
// the verb collapse — so it gets its own golden vectors, produced by a faithful JS transcription.

use treehash::{canonicalize, parse as parse_json, Json};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn as_arr(v: &Json) -> &[Json] {
    match v {
        Json::Arr(a) => a.as_slice(),
        _ => &[],
    }
}
fn as_str(v: &Json) -> &str {
    match v {
        Json::Str(s) => s.as_str(),
        _ => "",
    }
}
fn opt<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match get(v, k) {
        Some(Json::Null) | None => None,
        x => x,
    }
}
/// JS `x ?? null` for a string-or-null expected value -> Option<String>.
fn want_str(v: Option<&Json>) -> Option<String> {
    match v {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

#[test]
fn cross_history_resolution_conformance_against_js() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/auth.vectors.json"))
        .expect("read auth.vectors.json");
    let doc = parse_json(&raw).expect("parse auth.vectors.json");
    let vectors = as_arr(get(&doc, "vectors").expect("vectors"));

    let mut pass = 0;
    let mut fails: Vec<String> = Vec::new();
    for v in vectors {
        let name = as_str(get(v, "name").expect("name"));
        let target = opt(v, "target");
        let moment = opt(v, "moment");
        let current = opt(v, "currentHistory");
        let args_actor = opt(v, "argsActorHistory");
        let story_domain = as_str(get(v, "storyDomain").unwrap_or(&Json::Null));

        let want_target = want_str(get(v, "wantTargetHistory"));
        let want_actor = want_str(get(v, "wantActorHistory"));

        let got_target = treeval::auth::resolve_target_history(target, moment, current);
        let got_actor = treeval::auth::resolve_actor_history(args_actor, moment, story_domain, got_target.as_deref());

        if got_target == want_target && got_actor == want_actor {
            pass += 1;
        } else {
            fails.push(format!(
                "  {name}\n    target  want {want_target:?} got {got_target:?}\n    actor   want {want_actor:?} got {got_actor:?}"
            ));
        }
    }
    println!("  treeval CROSS-HISTORY (Rust) vs historyResolve.js + authorize.js:  {}/{} byte-identical", pass, vectors.len());
    assert!(fails.is_empty(), "cross-history mismatches:\n{}", fails.join("\n"));
}

#[test]
fn authorize_decide_control_flow() {
    use treeval::auth::{authorize_decide, DecideArgs};
    let j = |s: &str| parse_json(s).expect("json");

    // (name, identity, verb, target, auditBeingId, ext_blocked, able_result, inheritation_ok, want)
    struct Case {
        name: &'static str,
        identity: Json,
        verb: &'static str,
        target: Json,
        audit: Option<&'static str>,
        ext: Option<&'static str>,
        able: Json,
        inh: bool,
        want: Json,
    }
    let cases = vec![
        Case { name: "I-Am bypass (name)", identity: j(r#"{"name":"I_AM"}"#), verb: "do", target: Json::Null, audit: None, ext: None, able: j(r#"{"ok":false}"#), inh: false, want: j(r#"{"ok":true,"actor":"I_AM"}"#) },
        Case { name: "I-Am bypass (beingId)", identity: j(r#"{"beingId":"I_AM"}"#), verb: "do", target: Json::Null, audit: None, ext: None, able: j(r#"{"ok":false}"#), inh: false, want: j(r#"{"ok":true,"actor":"I_AM"}"#) },
        Case { name: "discovery-see", identity: j(r#"{"name":"alice"}"#), verb: "see", target: j(r#"{"isDiscovery":true}"#), audit: None, ext: None, able: j(r#"{"ok":false}"#), inh: false, want: j(r#"{"ok":true,"actor":"discovery"}"#) },
        Case { name: "ext-scope blocked", identity: j(r#"{"name":"alice"}"#), verb: "do", target: Json::Null, audit: None, ext: Some("weather"), able: j(r#"{"ok":false}"#), inh: false, want: j(r#"{"ok":false,"actor":"extension-blocked","reason":"Extension \"weather\" is blocked at this position"}"#) },
        Case { name: "able grant (named able)", identity: j(r#"{"name":"alice"}"#), verb: "do", target: Json::Null, audit: None, ext: None, able: j(r#"{"ok":true,"able":"editor"}"#), inh: false, want: j(r#"{"ok":true,"actor":"editor","reason":null}"#) },
        Case { name: "able grant (no able -> permitted)", identity: j(r#"{"name":"alice"}"#), verb: "do", target: Json::Null, audit: None, ext: None, able: j(r#"{"ok":true}"#), inh: false, want: j(r#"{"ok":true,"actor":"permitted","reason":null}"#) },
        Case { name: "able grant (with reason)", identity: j(r#"{"name":"alice"}"#), verb: "do", target: Json::Null, audit: None, ext: None, able: j(r#"{"ok":true,"able":"owner","reason":"owns it"}"#), inh: false, want: j(r#"{"ok":true,"actor":"owner","reason":"owns it"}"#) },
        Case { name: "inheritation fallback grants", identity: j(r#"{"nameId":"alice"}"#), verb: "do", target: Json::Null, audit: Some("b1"), ext: None, able: j(r#"{"ok":false,"reason":"no able"}"#), inh: true, want: j(r#"{"ok":true,"actor":"alice"}"#) },
        Case { name: "deny (able false, no inheritation)", identity: j(r#"{"name":"alice"}"#), verb: "do", target: Json::Null, audit: None, ext: None, able: j(r#"{"ok":false,"reason":"no able"}"#), inh: false, want: j(r#"{"ok":false,"actor":"anonymous","reason":"no able"}"#) },
        Case { name: "inheritation skipped (verb != do)", identity: j(r#"{"nameId":"alice"}"#), verb: "see", target: Json::Null, audit: Some("b1"), ext: None, able: j(r#"{"ok":false,"reason":"nope"}"#), inh: true, want: j(r#"{"ok":false,"actor":"anonymous","reason":"nope"}"#) },
        Case { name: "inheritation skipped (no auditBeingId)", identity: j(r#"{"nameId":"alice"}"#), verb: "do", target: Json::Null, audit: None, ext: None, able: j(r#"{"ok":false,"reason":"x"}"#), inh: true, want: j(r#"{"ok":false,"actor":"anonymous","reason":"x"}"#) },
    ];

    let mut fails: Vec<String> = Vec::new();
    for c in &cases {
        let args = DecideArgs {
            identity: if matches!(c.identity, Json::Null) { None } else { Some(&c.identity) },
            verb: c.verb,
            target: if matches!(c.target, Json::Null) { None } else { Some(&c.target) },
            audit_being_id: c.audit,
            i_am: "I_AM",
            ext_blocked: c.ext,
            able_result: &c.able,
            inheritation_ok: c.inh,
        };
        let got = authorize_decide(&args);
        if canonicalize(&got) != canonicalize(&c.want) {
            fails.push(format!("  {}\n    want: {}\n    got:  {}", c.name, canonicalize(&c.want), canonicalize(&got)));
        }
    }
    println!("  treeval AUTHORIZE control flow:  {}/{} decision cases OK", cases.len() - fails.len(), cases.len());
    assert!(fails.is_empty(), "authorize decision mismatches:\n{}", fails.join("\n"));
}
