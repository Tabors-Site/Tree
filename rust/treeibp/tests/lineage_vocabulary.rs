// THE LINEAGE VOCABULARY FOLD — the being-tree IS the vocabulary tree. A being's live vocabulary is the
// UNION fold of its MOTHER LINEAGE (Am the root base up through every mother to the being). This test
// verifies the four LOCKED distinctions:
//
//   1. ACCUMULATE not supersede — coin "flower" then "tree" -> BOTH resolvable (union, no drop). The
//      vocabulary reducer is UNION, NOT the state fold's latest-wins.
//   2. DEPRECATION (do:retire) — a retire on "flower" shadows it (unresolvable), but the coin STAYS on
//      the chain; a re-coin re-enables it.
//   3. Am BASE UNIVERSAL + SHADOWABLE — every being resolves Am's base word; a descendant can coin the
//      SAME name to shadow/specialize it, and Am's base coin remains on the chain.
//
// (LINEAGE INHERITANCE — a child resolves a parent's coin, a non-descendant does not — is verified in
// do_makes_do.rs.) Every coin is laid THROUGH THE STAMPER (act_via_fold_bound). Node-free.

use std::path::Path;

use treehash::{parse as pj, Json};
use treeibp::{act_via_fold_bound, Outcome};
use treestore::{read_reel_file, read_reel_head, seal_moment, write_fact_doc, FactSpec};
use treewordfold::resolve_lineage_word;

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

/// Lay ONE do:coin or do:retire for `word` on `on_being`'s OWN reel, through the stamper. `act` is
/// "coin" or "retire". A retire carries only the word (no binding). Returns the fact.
fn word_act(dir: &Path, actor: &Json, on_being: &str, act: &str, word: &str) -> Outcome {
    let body = if act == "coin" {
        format!(
            "do coin on the being {on_being} with {{ word: \"{word}\", ownerExtension: \"seed\", \
             binding: {{ kind: \"op\", word: {{ noun: \"being\" }} }} }}."
        )
    } else {
        format!("do retire on the being {on_being} with {{ word: \"{word}\" }}.")
    };
    let no_spec = |_: &str| None;
    let no_op_file = |_: &str, _: Option<&str>| -> Option<String> { None };
    let anchor = obj(vec![(on_being, jstr(on_being))]);
    let mut out = act_via_fold_bound(&body, actor, dir, "0", no_spec, &no_op_file, &anchor, None, None);
    assert_eq!(out.len(), 1, "one word -> one fact ({act} {word})");
    out.pop().unwrap()
}

fn authorized(o: Outcome) -> Json {
    match o {
        Outcome::Authorized(f) => f,
        Outcome::Denied(r) => panic!("denied: {r}"),
    }
}

#[test]
fn accumulate_not_supersede() {
    let dir = std::env::temp_dir().join("treeos-vocab-accumulate");
    let _ = std::fs::remove_dir_all(&dir);
    plant_being(&dir, "Am", None, 1.0);
    plant_being(&dir, "Botanist", Some("Am"), 2.0);
    treeproj::refold(&dir, "0", "being", "Botanist").expect("refold");
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();

    // coin "flower" then LATER "tree" — the union must keep BOTH (no supersession across words).
    let _ = authorized(word_act(&dir, &i, "Botanist", "coin", "flower"));
    let _ = authorized(word_act(&dir, &i, "Botanist", "coin", "tree"));

    assert!(resolve_lineage_word(&dir, "0", "Botanist", "flower").is_some(), "flower stays resolvable (union)");
    assert!(resolve_lineage_word(&dir, "0", "Botanist", "tree").is_some(), "tree resolvable — coining it did NOT drop flower");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  ACCUMULATE: coin flower then tree -> BOTH resolvable (union, no drop)  OK");
}

#[test]
fn retire_shadows_but_stays_on_chain_and_recoin_reenables() {
    let dir = std::env::temp_dir().join("treeos-vocab-retire");
    let _ = std::fs::remove_dir_all(&dir);
    plant_being(&dir, "Am", None, 1.0);
    plant_being(&dir, "Botanist", Some("Am"), 2.0);
    treeproj::refold(&dir, "0", "being", "Botanist").expect("refold");
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();

    let _ = authorized(word_act(&dir, &i, "Botanist", "coin", "flower"));
    assert!(resolve_lineage_word(&dir, "0", "Botanist", "flower").is_some(), "flower resolvable after the coin");

    // do:retire SHADOWS flower in the live projection...
    let retire_fact = authorized(word_act(&dir, &i, "Botanist", "retire", "flower"));
    assert_eq!(get_str(&retire_fact, "act"), Some("retire"), "a do:retire");
    assert!(
        resolve_lineage_word(&dir, "0", "Botanist", "flower").is_none(),
        "flower is shadowed (unresolvable) after the retire"
    );

    // ...but the coin STILL EXISTS on the chain (retire shadows the PROJECTION, never removes the coin).
    let facts = read_reel_file(&dir, "0", "being", "Botanist", None, None);
    assert!(
        facts.iter().any(|f| get_str(f, "act") == Some("coin")
            && get(f, "params").and_then(|p| get_str(p, "word")) == Some("flower")),
        "the original do:coin for flower is STILL on the chain (historically real)"
    );

    // a RE-COIN re-enables it.
    let _ = authorized(word_act(&dir, &i, "Botanist", "coin", "flower"));
    assert!(
        resolve_lineage_word(&dir, "0", "Botanist", "flower").is_some(),
        "a re-coin RE-ENABLES flower"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  DEPRECATION: retire shadows flower (unresolvable) but the coin stays on the chain; a re-coin re-enables  OK");
}

#[test]
fn am_base_universal_and_shadowable() {
    let dir = std::env::temp_dir().join("treeos-vocab-am-base");
    let _ = std::fs::remove_dir_all(&dir);
    plant_being(&dir, "Am", None, 1.0);
    plant_being(&dir, "Child", Some("Am"), 2.0);
    plant_being(&dir, "Other", Some("Am"), 3.0);
    treeproj::refold(&dir, "0", "being", "Child").expect("refold child");
    treeproj::refold(&dir, "0", "being", "Other").expect("refold other");
    let i = pj(r#"{"beingId":"I","nameId":"I"}"#).unwrap();

    // Am coins a BASE word "seed" (the universal vocabulary, on Am's root reel).
    let am_base = authorized(word_act(&dir, &i, "Am", "coin", "seed"));
    assert_eq!(
        get(&am_base, "of").and_then(|o| get_str(o, "id")),
        Some("Am"),
        "Am's base coin landed on Am's reel"
    );

    // EVERY being resolves Am's base (Am folds FIRST, the root).
    assert!(resolve_lineage_word(&dir, "0", "Child", "seed").is_some(), "Child resolves Am's base word");
    assert!(resolve_lineage_word(&dir, "0", "Other", "seed").is_some(), "Other resolves Am's base word");
    assert!(resolve_lineage_word(&dir, "0", "Am", "seed").is_some(), "Am itself resolves its base word");

    // A DESCENDANT coins the SAME name to SHADOW/specialize it. The noun differs so we can prove which
    // coin the projection resolves to (Child's specialization vs Am's base).
    let shadow_body = "do coin on the being Child with { word: \"seed\", ownerExtension: \"seed\", \
                       binding: { kind: \"op\", word: { noun: \"space\" } } }.";
    let no_spec = |_: &str| None;
    let no_op_file = |_: &str, _: Option<&str>| -> Option<String> { None };
    let anchor = obj(vec![("Child", jstr("Child"))]);
    let out = act_via_fold_bound(shadow_body, &i, &dir, "0", no_spec, &no_op_file, &anchor, None, None);
    let _ = authorized(out.into_iter().next().unwrap());

    // Child now resolves ITS specialization (noun "space"), while Am's base coin STAYS on Am's chain.
    let child_seed = resolve_lineage_word(&dir, "0", "Child", "seed").expect("Child still resolves `seed`");
    assert_eq!(
        child_seed.noun.as_deref(),
        Some("space"),
        "Child's OWN coin SHADOWS Am's base for `seed` (closer-to-you wins per key)"
    );
    // Other (a sibling that did NOT shadow) still resolves Am's BASE noun.
    let other_seed = resolve_lineage_word(&dir, "0", "Other", "seed").expect("Other resolves the base `seed`");
    assert_eq!(other_seed.noun.as_deref(), Some("being"), "Other still sees Am's UNSHADOWED base");
    // Am's base coin remains on Am's chain (undeleteable, shared).
    assert!(
        read_reel_file(&dir, "0", "being", "Am", None, None).iter().any(|f| {
            get_str(f, "act") == Some("coin")
                && get(f, "params").and_then(|p| get_str(p, "word")) == Some("seed")
        }),
        "Am's base coin for `seed` remains on Am's chain (the shadow never touched it)"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  Am BASE: universal (every being resolves it) + shadowable (a descendant specializes the same name; Am's base stays on the chain)  OK");
}
