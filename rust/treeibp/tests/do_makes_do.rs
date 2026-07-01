// DO-MAKES-DO, END-TO-END: a being MINTS a word live, and a LATER act resolves + runs it. A being
// speaks a `do coin` Word through THE ONE PATH (act_via_fold); it lands ONE do:coin fact on the being
// Am's PUBLIC reel (of:{kind:"being", id:"Am"}, by the Name, through Am). `treewordfold` folds Am's
// reel FRESH per act (resolve_word reads the chain each call, not boot-only), so the very NEXT act
// resolves the just-coined word and runs it. The coin is laid THROUGH THE STAMPER (the same seal
// every act uses) — never hand-built. Node-free.

use std::path::Path;

use treehash::{parse as pj, Json};
use treeibp::{act_via_fold, act_via_fold_bound, Outcome};
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
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
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

/// Plant the being "Am" (the public vocabulary reel every being folds) with a birth fact so its reel
/// exists for the coin to land on.
fn plant_am(dir: &Path) {
    let birth = obj(vec![
        ("through", jstr("I")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("Am"))])),
        ("params", obj(vec![("name", jstr("Am"))])),
    ]);
    stamp(dir, "being", "Am", &birth, 1.0);
}

#[test]
fn a_being_mints_a_word_live_and_a_later_act_runs_it() {
    let dir = std::env::temp_dir().join("treeos-do-makes-do");
    let _ = std::fs::remove_dir_all(&dir);
    plant_am(&dir);

    let no_spec = |_: &str| None;
    // the actor is I (the story custodial Name) — authorize bypasses, and I hasAuthorityOver Am (the
    // bootstrap axiom), so the coin lands. (A delegate with the coin able is the same seal path.)
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();

    // BEFORE: "greet" is unbound — the fold resolves nothing.
    assert!(
        treewordfold::resolve_word(&dir, "0", "greet").is_none(),
        "greet is unbound before the coin"
    );

    // ── THE LIVE COIN: a being speaks `do coin on the being Am with { ... }` (a word-minting act) ──
    // The binding declares "greet" a kind:"op" word (a runnable word), noun "being". This is the SAME
    // do:coin declare-word shape treewordfold folds — laid through the stamper (act_via_fold), never
    // hand-built.
    let coin_word = concat!(
        "do coin on the being Am with { ",
        "word: \"greet\", ownerExtension: \"seed\", ",
        "binding: { kind: \"op\", word: { noun: \"being\" } } }."
    );
    let no_op_file = |_: &str, _: Option<&str>| -> Option<String> { None };
    // seed the "Am" world-anchor (the vocabulary reel every being knows of) so `the being Am` resolves
    // — the SAME anchor-binding seam genesis threads for known beings. The wire seeds this universal
    // anchor for a coin act.
    let am_anchor = obj(vec![("Am", jstr("Am"))]);
    let coined = act_via_fold_bound(coin_word, &i, &dir, "0", no_spec, &no_op_file, &am_anchor, None, None);
    assert_eq!(coined.len(), 1, "the coin is one act -> one fact");
    let coin_fact = match &coined[0] {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("the coin was denied: {r}"),
    };
    assert_eq!(get_str(coin_fact, "verb"), Some("do"), "a do:coin");
    assert_eq!(get_str(coin_fact, "act"), Some("coin"), "a do:coin");
    assert_eq!(
        get(coin_fact, "of").and_then(|o| get_str(o, "id")),
        Some("Am"),
        "the coin landed on the being Am's PUBLIC reel"
    );
    assert_eq!(
        get(coin_fact, "params").and_then(|p| get_str(p, "word")),
        Some("greet"),
        "the coin declares the word `greet`"
    );

    // the coin fact is really on Am's reel + the chain verifies.
    let am_facts = read_reel_file(&dir, "0", "being", "Am", None, None);
    assert!(
        am_facts.iter().any(|f| get_str(f, "act") == Some("coin")
            && get(f, "params").and_then(|p| get_str(p, "word")) == Some("greet")),
        "the do:coin for `greet` is on Am's reel"
    );

    // ── LIVE FOLD: the very next resolution reads the chain FRESH and sees `greet` (not boot-only) ──
    let desc = treewordfold::resolve_word(&dir, "0", "greet").expect("greet resolves from the live fold");
    assert!(desc.is_op(), "greet folded as a kind:op word (a runnable word)");
    assert_eq!(desc.noun.as_deref(), Some("being"), "the binding's noun folded through");

    // ── A SUBSEQUENT ACT RESOLVES + RUNS the new word. `do greet` now expands (op_word_via_fold =
    // the fold says "op" && the host loads the body). Supply greet's body via `file_of` — a tiny op
    // that authors a do:greet fact on the caller's being. The point: the runner reaches the word ONLY
    // because the live coin declared it; a code change was never needed. ──
    let greet_body = concat!(
        "When a being greets:\n",
        "  see resolve-set-being-spec(target, field, value, merge, branch) as spec.\n",
        "  Return beingId: $spec.beingId, factParams: $spec.factParams.\n",
    )
    .to_string();
    // greet targets the caller's being via a set-being under the hood (a real runnable body). We plant
    // a being `Speaker` for greet to write on, and run `do greet` on it.
    let speaker_birth = obj(vec![
        ("through", jstr("I")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("Speaker"))])),
        ("params", obj(vec![("name", jstr("Speaker"))])),
    ]);
    stamp(&dir, "being", "Speaker", &speaker_birth, 5.0);
    treeproj::refold(&dir, "0", "being", "Speaker").expect("refold speaker");

    let greet_file = move |op: &str, _noun: Option<&str>| -> Option<String> {
        match op {
            "greet" => Some(greet_body.clone()),
            _ => None,
        }
    };
    let run = act_via_fold(
        "do greet on the being Speaker with { field: \"qualities.mood.state\", value: \"cheerful\" }.",
        &i,
        &dir,
        "0",
        no_spec,
        &greet_file,
        None,
        None,
    );
    assert_eq!(run.len(), 1, "the just-minted word ran and laid its fact");
    let greet_fact = match &run[0] {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("running the minted word was denied: {r}"),
    };
    // the minted word RAN through the one-path (its body's see-op resolved a set-being on Speaker).
    assert_eq!(get_str(greet_fact, "act"), Some("set-being"), "the minted word's body ran and laid its fact");
    assert_eq!(
        get(greet_fact, "of").and_then(|o| get_str(o, "id")),
        Some("Speaker"),
        "the minted word wrote on Speaker (it resolved + ran, purely from the live coin)"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  DO-MAKES-DO: a being coins `greet` live on Am's reel -> the next act resolves + runs it  OK");
}
