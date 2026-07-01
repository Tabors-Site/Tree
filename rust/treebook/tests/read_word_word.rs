// THE GUARDED BOOK-READER, END TO END, NODE-FREE, on a FRESH SCRATCH store (never the repo's store/past):
//   1. the razor-thin host turtle plants genesis: the Name "I" + the being "Am" (NOT the legacy
//      "i-am" artifact) - the two genesis moments, the minimal ignition seed.
//   2. I READS word.word through the guarded reader: each statement one act, the foundation declare-word
//      (do:coin concept) facts land on the being Am's reel (signed by I, through Am).
//   3. the foundation FOLDS back from the chain (treewordfold reads Am's reel and resolves the declared
//      words) - the vocabulary is the FOLD of chain facts, not a code table.
//   4. the chains VERIFY (treeverify walks the p-links on Am's reel from GENESIS_PREV).
//   5. BOTH guards demonstrably THROW on crafted bad words: GUARD 1 on a run-on (a word laying 2 facts),
//      GUARD 2 on a word naming an unregistered see-op.
//
// NO Node, NO subprocess: the whole pipeline (genesis + reading + folding + verifying) is pure Rust over
// the determinism spine. The store is a per-test temp dir, removed at the end.

use std::path::{Path, PathBuf};

use treebook::{read_book_plain, BookError};
use treegenesis::plant_and_ignite;
use treehash::Json;
use treestore::{read_reel_file, verify_fact_chain};
use treewordfold::{fold_word_set, resolve_word};

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
fn verdict_ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

/// a fresh, empty scratch store dir (NEVER the repo's store/past).
fn fresh_store(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("treebook-{tag}"));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// the root book - read off the seed (the genuine artifact), or `$TREE_SEED_DIR`.
fn word_word() -> String {
    let seed = match std::env::var("TREE_SEED_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d),
        _ => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed")),
    };
    let p = seed.join("store/words/word.word");
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

/// THE FOUNDATION: plant "I", read word.word through the guards, fold + verify on the fresh "I" store.
#[test]
fn i_reads_word_word_and_the_foundation_folds() {
    let dir = fresh_store("foundation");
    let story_domain = "localhost";

    // 1. the razor-thin turtle: mint the Name I + plant the two genesis moments (Name "I" + being "Am").
    let (planted, key) = plant_and_ignite(&dir, story_domain).expect("ignite genesis");
    assert_eq!(planted.i_name, "I", "the Name is \"I\" (the signer), never the legacy \"i-am\"");
    assert_eq!(planted.being_id, "Am", "the first being is \"Am\" (the name-being split)");

    // the being Am's reel currently holds ONLY the genesis be:birth (one fact) before reading the book.
    let before = read_reel_file(&dir, "0", "being", "Am", None, None);
    assert_eq!(before.len(), 1, "only the genesis be:birth on Am's reel before reading the book");
    assert_eq!(
        (get_str(&before[0], "verb"), get_str(&before[0], "act")),
        (Some("be"), Some("birth")),
        "the genesis fact is be:birth"
    );

    // sign the book's coins with the story key (I authoring its own vocabulary), as treeos signs.
    let seed = key.seed;
    let sign = move |opening: &Json, fids: &[String]| -> Json {
        let payload = treesign::build_act_sig_payload(opening, fids);
        let value = treesign::sign_value(&seed, &payload);
        Json::Obj(vec![
            ("alg".to_string(), Json::Str("ed25519".to_string())),
            ("by".to_string(), Json::Str("I".to_string())),
            ("value".to_string(), Json::Str(value)),
        ])
    };
    let sign_ref: &dyn Fn(&Json, &[String]) -> Json = &sign;

    // 2. I READS word.word through the guarded reader. word.word is pure concept declarations (no host
    //    see-op escapes), so the read lays one concept coin per statement - with the story-key signer.
    let book = word_word();
    let read = treebook::read_book(&book, &dir, "0", Some(sign_ref)).expect("I reads word.word");
    assert!(read.facts_laid >= 5, "word.word laid its foundation declarations (got {})", read.facts_laid);
    // every read word laid EXACTLY one fact (GUARD 1 held throughout) - none was inert here (all decls).
    assert!(
        read.words.iter().all(|w| w.fact_id.is_some()),
        "each foundation statement laid its one declare-word fact"
    );

    // Am's reel now carries the genesis be:birth + one coin per statement read.
    let after = read_reel_file(&dir, "0", "being", "Am", None, None);
    assert_eq!(
        after.len(),
        before.len() + read.facts_laid,
        "the reel grew by exactly one fact per read word (one word = one act)"
    );

    // 3. THE FOUNDATION FOLDS from the chain: treewordfold reads the being Am's reel and resolves the declared
    //    foundation words (the vocabulary is the FOLD of the coin facts, not a code table).
    let set = fold_word_set(&dir, "0");
    assert_eq!(
        set.len(),
        read.facts_laid,
        "every declare-word folds back to a word in the set"
    );
    // the root structural concepts word.word declares resolve (their subjects: word / fact / …).
    let word_desc = resolve_word(&dir, "0", "word").expect("`word` resolves from the fold");
    assert_eq!(
        get_str(&word_desc.binding, "kind"),
        Some("concept"),
        "a foundation declaration folds as a concept word"
    );
    assert!(resolve_word(&dir, "0", "fact").is_some(), "`fact` resolves from the fold");
    // an undeclared word resolves to None (no code default - purely the fold).
    assert!(resolve_word(&dir, "0", "no-such-foundation-word").is_none());

    // 4. THE CHAIN VERIFIES: Am's reel walks whole from GENESIS_PREV (the genesis fact + every coin).
    let v = verify_fact_chain(&after);
    assert!(verdict_ok(&v), "Am's reel verifies after reading the book: {}", treestore::canonicalize(&v));

    // NODE-FREE: nothing in this test shelled out; the whole pipeline is Rust over the spine.
    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  treebook: planted \"I\" + read word.word ({} foundation words) -> folds + verifies, Node-free  OK",
        read.facts_laid
    );
}

/// GUARD 1 FIRES: a RUN-ON word (one Word that lays TWO facts) is refused BEFORE any write, naming it +
/// the crammed acts. The parser collapses run-together prose to one act node, so a genuine run-on is a
/// Word the reader lowered to several acting deeds; we drive that path directly via `lay_word_specs` with
/// TWO coin specs as ONE Word - exactly how the reader treats a statement that lowered to two deeds. The
/// guard must refuse it as a run-on, and NOTHING must land on the reel (the refusal precedes the write).
#[test]
fn guard_1_refuses_a_run_on_word() {
    let dir = fresh_store("guard1");
    let story_domain = "localhost";
    let (_planted, _key) = plant_and_ignite(&dir, story_domain).expect("ignite");

    // the vocabulary reel is the being "Am"; the coins are signed by the Name "I", through the being "Am".
    let am_being = treebook::AM_BEING;
    let i_name = treebook::I_NAME;
    let before = read_reel_file(&dir, "0", "being", am_being, None, None).len();

    // ONE Word that crams TWO acting deeds (two coin facts) - the run-on the Spacebar Law refuses.
    let coin = |w: &str| -> Json {
        Json::Obj(vec![
            ("verb".to_string(), Json::Str("do".to_string())),
            ("act".to_string(), Json::Str("coin".to_string())),
            ("by".to_string(), Json::Str(i_name.to_string())),
            ("through".to_string(), Json::Str(am_being.to_string())),
            (
                "of".to_string(),
                Json::Obj(vec![
                    ("kind".to_string(), Json::Str("being".to_string())),
                    ("id".to_string(), Json::Str(am_being.to_string())),
                ]),
            ),
            (
                "params".to_string(),
                Json::Obj(vec![("word".to_string(), Json::Str(w.to_string()))]),
            ),
        ])
    };
    let crammed_word = vec![coin("alpha"), coin("beta")];
    let res = treebook::lay_word_specs("alpha and beta crammed in one word", &crammed_word, &dir, "0", None);
    match res {
        Err(BookError::RunOn { word, facts, crammed }) => {
            assert_eq!(facts, 2, "the run-on crammed 2 acts");
            assert!(word.contains("crammed"), "the offending word is named: {word}");
            assert_eq!(crammed, vec!["do:coin".to_string(), "do:coin".to_string()], "the crammed acts are listed");
            println!("  treebook GUARD 1: run-on refused -> {}", BookError::RunOn { word, facts, crammed });
        }
        other => panic!("GUARD 1 must refuse the run-on, got {other:?}"),
    }
    // the refusal precedes any write - the reel is unchanged (no half-applied run-on).
    let after = read_reel_file(&dir, "0", "being", am_being, None, None).len();
    assert_eq!(after, before, "a refused run-on lays NO fact (the guard precedes the write)");

    // a SINGLE coin word (one deed) is NOT a run-on - it lays its one fact.
    let one = vec![coin("gamma")];
    let ok = treebook::lay_word_specs("a single coin word", &one, &dir, "0", None).expect("one word lays one fact");
    assert!(ok.fact_id.is_some(), "the single word laid exactly one fact");
    assert_eq!(
        read_reel_file(&dir, "0", "being", am_being, None, None).len(),
        before + 1,
        "exactly one fact landed for the single word"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// GUARD 2 FIRES: a word whose `see <op>` escape names an UNREGISTERED host see-op is refused, naming the
/// word + the op. Registry = identification (we ask treehost::Resolvers, no declared table).
#[test]
fn guard_2_refuses_a_word_with_missing_logic() {
    let dir = fresh_store("guard2");
    let story_domain = "localhost";
    let (_planted, _key) = plant_and_ignite(&dir, story_domain).expect("ignite");

    // a word reaching a host see-op no resolver is registered for - its logic is missing.
    let missing = "see resolve-no-such-host-op($x) as y.";
    match read_book_plain(missing, &dir, "0") {
        Err(BookError::MissingLogic { word, op }) => {
            assert_eq!(op, "resolve-no-such-host-op", "the unregistered op is named");
            assert!(word.contains("resolve-no-such-host-op"), "the word is named: {word}");
            println!("  treebook GUARD 2: missing-logic refused -> {}", BookError::MissingLogic { word, op });
        }
        other => panic!("GUARD 2 must refuse the missing-logic word, got {other:?}"),
    }

    // a word reaching a REGISTERED see-op is NOT refused by GUARD 2 (it is host-reserved AND logic'd).
    // (resolve-set-being-spec is registered; the reader passes GUARD 2 - the act itself may then refuse
    // on substrate, which is a Denied, not a guard.) We assert GUARD 2 does NOT fire for it.
    let registered = "see resolve-set-being-spec($x) as y.";
    let r = read_book_plain(registered, &dir, "0");
    assert!(
        !matches!(r, Err(BookError::MissingLogic { .. })),
        "GUARD 2 must NOT fire for a registered see-op (it is logic'd): {r:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// NEVER the repo store: a guard against ever pointing the reader at store/past.
#[test]
fn the_store_is_a_fresh_scratch_dir() {
    let dir = fresh_store("scratch-check");
    assert!(dir.starts_with(std::env::temp_dir()), "the scratch store lives under the temp dir");
    assert_ne!(
        dir,
        Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../store/past")),
        "never the repo's store/past"
    );
}
