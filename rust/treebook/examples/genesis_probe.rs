// THE FULL CLEAN GENESIS, NODE-FREE: I plant, I read the whole book, the world is born — on a FRESH
// scratch store (NEVER store/past). Run with Node OFF the PATH:
//   PATH=/usr/bin:/bin cargo run -p treebook --example genesis_probe
//
//   1. plant_and_ignite("I") + read the WHOLE book strict (vocabulary coined + the creation sequence
//      sealed + the grants run) via treebook::full_genesis.
//   2. VERIFY the born world: the vocabulary folds, the root + heaven spaces exist, the delegates exist
//      (be:birth on their reels), the grants landed, every reel chain-verifies.

use std::path::PathBuf;

use treehash::Json;
use treestore::{read_reel_file, verify_fact_chain};
use treewordfold::{fold_word_set, resolve_word};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn gs<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}
fn ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

fn seed_dir() -> PathBuf {
    match std::env::var("TREE_SEED_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d),
        _ => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed")),
    }
}

/// The vocabulary in dependency order (the foundation flats, then every remaining op/able `.word`).
fn vocabulary() -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut push = |out: &mut Vec<String>, rel: &str| {
        if seen.insert(rel.to_string()) {
            out.push(rel.to_string());
        }
    };
    for rel in [
        "store/words/word.word", "store/words/iam.word", "store/words/base.word",
        "store/words/in.word", "store/words/out.word", "store/words/chain.word",
        "store/words/history.word", "store/words/story.word", "store/words/fold.word",
        "store/words/see.word", "store/words/do.word", "store/words/name.word",
        "store/words/being.word", "store/words/space.word", "store/words/matter.word",
        "store/words/weave.word", "store/words/be.word", "store/words/call.word",
        "store/words/can.word", "store/words/recall.word", "store/words/able.word",
        "store/words/flow.word", "store/words/verbs.word", "store/words/if.word",
        "store/words/while.word", "store/words/for.word",
    ] {
        push(&mut out, rel);
    }
    let words_root = seed_dir().join("store/words");
    let mut rest = Vec::new();
    let mut stack = vec![words_root];
    while let Some(d) = stack.pop() {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for ent in rd.flatten() {
                let p = ent.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().and_then(|e| e.to_str()) == Some("word") {
                    if let Ok(rel) = p.strip_prefix(seed_dir()) {
                        rest.push(rel.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    rest.sort();
    for rel in rest {
        push(&mut out, &rel);
    }
    out
}

fn main() {
    let dir = std::env::temp_dir().join("treebook-full-genesis");
    let _ = std::fs::remove_dir_all(&dir);

    println!("================ THE FULL CLEAN GENESIS (Node-free) ================");
    println!("fresh store: {}", dir.display());

    let born = match treebook::full_genesis(&seed_dir(), &dir, &vocabulary()) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("GENESIS REFUSED: {e}");
            std::process::exit(1);
        }
    };

    println!("\nI planted \"{}\" and read the whole book.", born.i_name);
    println!("  vocabulary coined : {} words", born.vocabulary_coined);
    println!("  spaces made       : {}", born.spaces.len());
    println!("  delegates birthed : {}", born.delegates.len());
    println!("  grants laid       : {}", born.grants_laid);

    // ── VERIFY 1: the vocabulary folds back from I's chain ──
    let set = fold_word_set(&dir, "0");
    println!("\n-- the vocabulary folds: {} words resolve from the chain", set.len());
    // the foundation concepts (from word.word's declarations) + the op/able words (coined by name).
    for w in [
        "word", "fact", "being", "space", "see", "fold",
        "create-space", "create-matter", "grant-able", "cherub", "birther", "angel", "arrival",
    ] {
        assert!(resolve_word(&dir, "0", w).is_some(), "`{w}` must fold from the chain");
    }
    assert!(resolve_word(&dir, "0", "no-such-word").is_none(), "an undeclared word does not fold");
    println!("   foundation (word/fact/being/space/see/fold) + op/able words (create-space, grant-able, cherub, angel, …) all resolve  OK");

    // ── VERIFY 2: the root + heaven spaces exist (be on their reels), and every space verifies ──
    let mut spaces_ok = 0;
    for (name, id) in &born.spaces {
        let facts = read_reel_file(&dir, "0", "space", id, None, None);
        assert!(!facts.is_empty(), "space `{name}` has a reel");
        assert_eq!(gs(&facts[0], "act"), Some("create-space"), "space `{name}` is a create-space");
        assert!(ok(&verify_fact_chain(&facts)), "space `{name}` chain verifies");
        spaces_ok += 1;
    }
    assert!(born.spaces.iter().any(|(n, _)| n == "root"), "the place root exists");
    assert!(born.spaces.iter().any(|(n, _)| n == "heaven"), "heaven exists");
    println!("-- the spaces: {spaces_ok} created + chain-verified (root + heaven among them)  OK");

    // ── VERIFY 3: the delegates exist (be:birth on their reels), every reel verifies ──
    let mut delegates_ok = 0;
    for (able, name) in &born.delegates {
        let facts = read_reel_file(&dir, "0", "being", name, None, None);
        assert!(!facts.is_empty(), "delegate `{name}` has a reel");
        assert_eq!(gs(&facts[0], "verb"), Some("be"), "delegate `{name}` first fact is a be");
        assert_eq!(gs(&facts[0], "act"), Some("birth"), "delegate `{name}` is born (be:birth)");
        assert_eq!(
            get(&facts[0], "params").and_then(|p| gs(p, "able")),
            Some(able.as_str()),
            "delegate `{name}` carries able `{able}`"
        );
        assert!(ok(&verify_fact_chain(&facts)), "delegate `{name}` chain verifies");
        delegates_ok += 1;
    }
    println!("-- the delegates: {delegates_ok} birthed + chain-verified");
    for (able, name) in &born.delegates {
        println!("     {name}  (able: {able})");
    }

    // ── VERIFY 4: the grants landed (do:grant-able facts on the delegate reels) ──
    let mut grant_facts = 0;
    for (_able, name) in &born.delegates {
        let facts = read_reel_file(&dir, "0", "being", name, None, None);
        grant_facts += facts.iter().filter(|f| gs(f, "act") == Some("grant-able")).count();
    }
    println!("\n-- the grants: {grant_facts} grant-able facts on the delegate reels (laid: {})", born.grants_laid);
    assert!(born.grants_laid > 0, "the grant flow laid grants");

    // ── VERIFY 5: I's own reel verifies (the genesis + the vocabulary coins + the creation acts) ──
    let i_reel = read_reel_file(&dir, "0", "being", "I", None, None);
    assert!(ok(&verify_fact_chain(&i_reel)), "I's reel verifies whole");
    println!("-- I's reel: {} facts, chain verifies whole  OK", i_reel.len());

    // ── BONUS: RENDER the creation story back from the chain (the inverse parser). Each created reel's
    //    first fact is a spoken creation act; re-uttered in ord order it reads as the creation story.
    //    The space + being + placement acts re-utter via treeword::render::render. ──
    let render_fact = |f: &Json| -> Option<String> {
        let mut node = match f {
            Json::Obj(e) => e.clone(),
            _ => return None,
        };
        node.retain(|(k, _)| matches!(k.as_str(), "verb" | "act" | "of" | "params" | "to"));
        node.push(("kind".to_string(), Json::Str("act".to_string())));
        node.push(("by".to_string(), Json::Str("I".to_string())));
        treeword::render::render(&Json::Obj(node))
    };
    // gather every creation act (its fact + its ord), then re-utter in ord order = the story's order.
    let mut story: Vec<(f64, String)> = Vec::new();
    let ord_of = |f: &Json| match get(f, "ord") {
        Some(Json::Num(n)) => *n,
        _ => 0.0,
    };
    // I's placement (the move on I's reel) + the genesis birth.
    for f in &i_reel {
        if matches!(gs(f, "act"), Some("move")) {
            if let Some(p) = render_fact(f) {
                story.push((ord_of(f), p));
            }
        }
    }
    for (_n, id) in &born.spaces {
        for f in read_reel_file(&dir, "0", "space", id, None, None) {
            if gs(&f, "act") == Some("create-space") {
                if let Some(p) = render_fact(&f) {
                    story.push((ord_of(&f), p));
                }
            }
        }
    }
    for (_a, name) in &born.delegates {
        for f in read_reel_file(&dir, "0", "being", name, None, None) {
            if gs(&f, "verb") == Some("be") && gs(&f, "act") == Some("birth") {
                if let Some(p) = render_fact(&f) {
                    story.push((ord_of(&f), p));
                }
            }
        }
    }
    story.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    println!("\n-- the creation story, rendered from the chain (in the order I spoke it):");
    for (_ord, prose) in &story {
        println!("   {prose}");
    }

    println!("\n================ THE WORLD IS BORN — Node-free ================");
    let _ = std::fs::remove_dir_all(&dir);
}
