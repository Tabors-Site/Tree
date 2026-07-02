// DO-MAKES-DO, END-TO-END, ON THE LINEAGE: a being MINTS a word live ON ITS OWN REEL, and a LATER act
// resolves + runs it — through the MOTHER-LINEAGE vocabulary fold. The being-tree IS the vocabulary
// tree: a being's live vocabulary is the UNION fold of Am (the root base) up through every mother to the
// being. A coin lands on the ACTOR's OWN being reel (its own vocabulary); its descendants inherit it by
// folding back through it; a non-descendant does NOT see it. The coin is laid THROUGH THE STAMPER (the
// same seal every act uses) — never hand-built. Node-free.

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

/// Plant a being with an optional `parentBeingId` (the mother — the vocabulary-lineage edge). Am (the
/// root vocabulary being) has no mother; a descendant carries its mother in the birth params so the fold
/// walks up to it.
fn plant_being(dir: &Path, id: &str, parent: Option<&str>, ord: f64) {
    let mut params = vec![("name", jstr(id))];
    if let Some(p) = parent {
        params.push(("parentBeingId", jstr(p)));
    }
    let birth = obj(vec![
        ("through", jstr("I")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        ("params", obj(params)),
    ]);
    stamp(dir, "being", id, &birth, ord);
}

/// Lay ONE do:coin for `word` on `on_being`'s OWN reel, through the stamper (act_via_fold_bound). The
/// binding declares it a kind:"op" word, noun "being" — the SAME do:coin declare-word shape the lineage
/// fold reads. Returns the coin fact.
fn coin_on(dir: &Path, actor: &Json, on_being: &str, word: &str) -> Outcome {
    let coin_word = format!(
        "do coin on the being {on_being} with {{ word: \"{word}\", ownerExtension: \"seed\", \
         binding: {{ kind: \"op\", word: {{ noun: \"being\" }} }} }}."
    );
    let no_spec = |_: &str| None;
    let no_op_file = |_: &str, _: Option<&str>| -> Option<String> { None };
    // seed the target being as a world-anchor so `the being <on_being>` resolves (the same anchor seam
    // genesis threads for known beings).
    let anchor = obj(vec![(on_being, jstr(on_being))]);
    let mut out = act_via_fold_bound(&coin_word, actor, dir, "0", no_spec, &no_op_file, &anchor, None, None);
    assert_eq!(out.len(), 1, "the coin is one act -> one fact");
    out.pop().unwrap()
}

#[test]
fn a_being_mints_a_word_live_on_its_own_reel_and_the_lineage_resolves_it() {
    let dir = std::env::temp_dir().join("treeos-do-makes-do");
    let _ = std::fs::remove_dir_all(&dir);

    // The MOTHER LINEAGE (the vocabulary tree):
    //   Am (root base) -> Gardener -> Speaker (a descendant of Gardener)
    //   Am (root base) -> Stranger (a SIBLING of Gardener, NOT a descendant)
    plant_being(&dir, "Am", None, 1.0);
    plant_being(&dir, "Gardener", Some("Am"), 2.0);
    plant_being(&dir, "Speaker", Some("Gardener"), 3.0);
    plant_being(&dir, "Stranger", Some("Am"), 4.0);
    treeproj::refold(&dir, "0", "being", "Gardener").expect("refold gardener");
    treeproj::refold(&dir, "0", "being", "Speaker").expect("refold speaker");
    treeproj::refold(&dir, "0", "being", "Stranger").expect("refold stranger");

    // the actor is I (the story custodial Name) — authorize bypasses, and I hasAuthorityOver every
    // being (the bootstrap axiom), so the coin lands. (A delegate with the coin able is the same seal.)
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();

    // BEFORE: "greet" is unbound in every lineage.
    assert!(
        treewordfold::resolve_lineage_word(&dir, "0", "Gardener", "greet").is_none(),
        "greet is unbound before the coin"
    );

    // ── THE LIVE COIN lands on the ACTOR's OWN being reel (Gardener), not Am. ──
    let coin = coin_on(&dir, &i, "Gardener", "greet");
    let coin_fact = match &coin {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("the coin was denied: {r}"),
    };
    assert_eq!(get_str(coin_fact, "act"), Some("coin"), "a do:coin");
    assert_eq!(
        get(coin_fact, "of").and_then(|o| get_str(o, "id")),
        Some("Gardener"),
        "the coin landed on the ACTOR's OWN being reel (Gardener), not Am"
    );
    assert_eq!(
        get(coin_fact, "params").and_then(|p| get_str(p, "word")),
        Some("greet"),
        "the coin declares the word `greet`"
    );
    // the coin fact is really on Gardener's reel (not Am's).
    assert!(
        read_reel_file(&dir, "0", "being", "Gardener", None, None).iter().any(|f| {
            get_str(f, "act") == Some("coin")
                && get(f, "params").and_then(|p| get_str(p, "word")) == Some("greet")
        }),
        "the do:coin for `greet` is on Gardener's OWN reel"
    );

    // ── LINEAGE INHERITANCE: Gardener (the coiner) + Speaker (its descendant, folds THROUGH Gardener)
    //    both resolve `greet`; Stranger (a sibling, NOT a descendant) does NOT. ──
    assert!(
        treewordfold::resolve_lineage_word(&dir, "0", "Gardener", "greet").is_some(),
        "the coiner (Gardener) resolves its own live coin"
    );
    let inherited = treewordfold::resolve_lineage_word(&dir, "0", "Speaker", "greet")
        .expect("a DESCENDANT (Speaker) inherits `greet` by folding through its mother Gardener");
    assert!(inherited.is_op(), "greet folded as a kind:op word through the mother lineage");
    assert_eq!(inherited.noun.as_deref(), Some("being"), "the binding's noun folded through the lineage");
    assert!(
        treewordfold::resolve_lineage_word(&dir, "0", "Stranger", "greet").is_none(),
        "a NON-descendant (Stranger, Gardener's sibling) does NOT resolve Gardener's private coin"
    );

    // ── A SUBSEQUENT ACT by the DESCENDANT resolves + runs the inherited word. `do greet` expands
    //    because the mother-lineage fold says "op" && the host loads the body. The point: the runner
    //    reaches the word ONLY because the ancestor coined it and the child folds back through her. ──
    let greet_body = concat!(
        "When a being greets:\n",
        "  see resolve-set-being-spec(target, field, value, merge, branch) as spec.\n",
        "  Return beingId: $spec.beingId, factParams: $spec.factParams.\n",
    )
    .to_string();
    let greet_file = move |op: &str, _noun: Option<&str>| -> Option<String> {
        match op {
            "greet" => Some(greet_body.clone()),
            _ => None,
        }
    };
    // Speaker (the descendant) speaks the inherited word onto ITS OWN being.
    let speaker = pj(r#"{"beingId":"Speaker","nameId":"I"}"#).unwrap();
    let no_spec = |_: &str| None;
    let run = act_via_fold(
        "do greet on the being Speaker with { field: \"qualities.mood.state\", value: \"cheerful\" }.",
        &speaker,
        &dir,
        "0",
        no_spec,
        &greet_file,
        None,
        None,
    );
    assert_eq!(run.len(), 1, "the inherited word ran and laid its fact");
    let greet_fact = match &run[0] {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("running the inherited word was denied: {r}"),
    };
    assert_eq!(get_str(greet_fact, "act"), Some("set-being"), "the inherited word's body ran and laid its fact");
    assert_eq!(
        get(greet_fact, "of").and_then(|o| get_str(o, "id")),
        Some("Speaker"),
        "the inherited word wrote on Speaker (it resolved through the mother lineage + ran)"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  DO-MAKES-DO (lineage): Gardener coins `greet` on its OWN reel -> Speaker (descendant) inherits + runs it; Stranger (non-descendant) does not  OK");
}
