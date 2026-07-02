// THE FULL CLEAN GENESIS, NODE-FREE, as a test: I plant, I read the whole book, the world is born — on
// a FRESH scratch store (NEVER store/past). The whole pipeline is pure Rust over the determinism spine:
// no Node, no subprocess. Asserts the born world: the vocabulary folds, the root + heaven spaces exist,
// the faithful delegate roster is birthed, the grants land, every reel chain-verifies, and the creation
// acts render back to the prose I spoke (the inverse parser round-trips the chain).

use treebook::full_genesis;
use treehash::Json;
use treestore::{read_reel_file, verify_fact_chain};
use treewordfold::resolve_word;

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

/// The faithful delegate roster (seedDelegates.js SEED_DELEGATES), able-name -> born proper Name.
const ROSTER: &[(&str, &str)] = &[
    ("arrival", "Arrival"),
    ("public", "Public"),
    ("cherub", "Cherub"),
    ("birther", "Birther"),
    ("able-manager", "Able-manager"),
    ("able-finder", "Able-finder"),
    ("flow-composer", "Flow-composer"),
    ("llm-assigner", "Llm-assigner"),
    ("story-manager", "Story-manager"),
    ("history-manager", "History-manager"),
    ("federation-manager", "Federation-manager"),
    ("http-server", "Http-server"),
    ("websocket-pool", "Websocket-pool"),
];

#[test]
fn i_reads_the_whole_book_and_the_world_is_born() {
    // a FRESH scratch store, NEVER the repo's store/past.
    let dir = std::env::temp_dir().join("treebook-full-genesis-test");
    let _ = std::fs::remove_dir_all(&dir);
    assert!(dir.starts_with(std::env::temp_dir()), "the scratch store lives under temp");

    // PLANT "I" + READ THE WHOLE BOOK (vocabulary coined, creation sealed, grants run) — Node-free.
    let born = full_genesis(&dir).expect("the world is born");
    assert_eq!(born.i_name, "I", "genesis plants the I-being as \"I\"");
    assert!(born.vocabulary_coined > 400, "the vocabulary coined ({})", born.vocabulary_coined);

    // 1. THE VOCABULARY FOLDS from I's chain (the fold, not a code table).
    for w in [
        "word", "fact", "being", "space", "see", "fold", // foundation concepts (word.word)
        "create-space", "create-matter", "grant-able", "cherub", "birther", "angel", "arrival", // op/able words
    ] {
        assert!(resolve_word(&dir, "0", w).is_some(), "`{w}` folds from the chain");
    }
    assert!(resolve_word(&dir, "0", "no-such-word").is_none(), "an undeclared word does not fold");

    // 2. THE SPACES exist + every space reel verifies; root + heaven are among them.
    assert!(born.spaces.len() >= 15, "the heaven tree's spaces ({})", born.spaces.len());
    for (name, id) in &born.spaces {
        let facts = read_reel_file(&dir, "0", "space", id, None, None);
        assert!(!facts.is_empty(), "space `{name}` has a reel");
        assert_eq!(gs(&facts[0], "act"), Some("create-space"), "space `{name}` is a create-space");
        assert!(ok(&verify_fact_chain(&facts)), "space `{name}` chain verifies");
    }
    assert!(born.spaces.iter().any(|(n, _)| n == "root"), "the place root exists");
    assert!(born.spaces.iter().any(|(n, _)| n == "heaven"), "heaven exists");

    // 3. THE FAITHFUL DELEGATE ROSTER is birthed — BARE births (Tabor: "the first am is just being birth
    //    thats it"): each `I am <Name> in <space>` lays JUST be:birth + homeSpace, an EMPTY being. The able
    //    is NOT crammed into birth (that would be the fat-birth drift); it is GRANTED by a word in
    //    genesis.word (step 4). Every reel verifies.
    assert_eq!(born.delegates.len(), ROSTER.len(), "the full roster is birthed");
    for (able, name) in ROSTER {
        assert!(
            born.delegates.iter().any(|(a, n)| a == able && n == name),
            "delegate `{name}` (able `{able}`) is in the born roster"
        );
        let facts = read_reel_file(&dir, "0", "being", name, None, None);
        assert!(!facts.is_empty(), "delegate `{name}` has a reel");
        assert_eq!(gs(&facts[0], "verb"), Some("be"), "delegate `{name}` first fact is a be");
        assert_eq!(gs(&facts[0], "act"), Some("birth"), "delegate `{name}` is born (be:birth)");
        // BARE birth: no able at birth (able is `I am a <role>` / a grant, never `I am <Name>`).
        assert!(
            get(&facts[0], "params").and_then(|p| gs(p, "able")).is_none(),
            "delegate `{name}` birth is BARE — no able at birth (granted by a word, step 4)"
        );
        assert!(ok(&verify_fact_chain(&facts)), "delegate `{name}` chain verifies");
    }

    // 4. THE ABLES ARE SAID IN THE BIRTHS — the delegate reels carry do:grant-able facts laid by each
    //    birth's trailing able-clauses (the old `do grant-able` flow is RETIRED; the word IS the grant).
    //    Every delegate but @public carries its OWN able (`arrival`->Arrival, `cherub`->Cherub, …). The
    //    old flow laid nothing now, so born.grants_laid is 0.
    assert_eq!(born.grants_laid, 0, "the old grant flow is retired (ables are said in the births)");
    let mut grant_facts = 0;
    for (able, name) in &born.delegates {
        let facts = read_reel_file(&dir, "0", "being", name, None, None);
        grant_facts += facts.iter().filter(|f| gs(f, "act") == Some("grant-able")).count();
        if name.as_str() != "Public" {
            assert!(
                facts.iter().any(|f| gs(f, "act") == Some("grant-able")
                    && get(f, "params").and_then(|p| gs(p, "able")) == Some(able.as_str())),
                "delegate `{name}` is SAID its own able `{able}` (a birth clause, not a grant flow)"
            );
        }
    }
    assert!(grant_facts > 0, "the said ables landed as grant-able facts on the delegate reels ({grant_facts})");

    // 5. I's OWN reel verifies whole (the genesis + the vocabulary coins + I's creation acts).
    let i_reel = read_reel_file(&dir, "0", "being", "I", None, None);
    assert!(ok(&verify_fact_chain(&i_reel)), "I's reel verifies whole");

    // 6. THE CREATION STORY round-trips: each creation act renders back to the prose I spoke.
    let render = |f: &Json| -> Option<String> {
        let mut node = match f {
            Json::Obj(e) => e.clone(),
            _ => return None,
        };
        node.retain(|(k, _)| matches!(k.as_str(), "verb" | "act" | "of" | "params" | "to"));
        node.push(("kind".to_string(), Json::Str("act".to_string())));
        node.push(("by".to_string(), Json::Str("I".to_string())));
        treeword::render::render(&Json::Obj(node))
    };
    let heaven_id = born.spaces.iter().find(|(n, _)| n == "heaven").map(|(_, id)| id.clone()).unwrap();
    let heaven = read_reel_file(&dir, "0", "space", &heaven_id, None, None);
    let made_heaven = heaven.iter().find(|f| gs(f, "act") == Some("create-space")).unwrap();
    assert_eq!(render(made_heaven).as_deref(), Some("I make heaven."), "heaven re-utters as I spoke it");
    let cherub = read_reel_file(&dir, "0", "being", "Cherub", None, None);
    let made_cherub = cherub.iter().find(|f| gs(f, "act") == Some("birth")).unwrap();
    // Cherub is born word-driven `I am Cherub in root` (bare birth + home) — re-utters to the be:birth form.
    assert_eq!(render(made_cherub).as_deref(), Some("I am Cherub in root."), "Cherub re-utters as I spoke it");

    // NODE-FREE: nothing here shelled out; the whole genesis is Rust over the spine.
    let _ = std::fs::remove_dir_all(&dir);
}
