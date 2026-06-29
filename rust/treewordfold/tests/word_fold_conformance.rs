// The WORD-FOLD reads the GENUINE on-disk genesis vocabulary (the declare-word do:coin facts I laid on
// its being reel) and folds it to the live word-set. This proves the vocabulary is the FOLD of chain
// facts, not a code table: a word resolves because its coin fact exists, and is NOT one of a hardcoded
// set. No mocks — it reads the repo's `store/past` directly.

use std::path::PathBuf;
use treewordfold::{fold_word_set, resolve_word};

/// the repo's on-disk store root (where the I being reel + its declare-word facts live).
fn store_root() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../store/past"))
}

#[test]
fn folds_the_genesis_vocabulary_from_chain() {
    let root = store_root();
    let set = fold_word_set(&root, "0");
    assert!(
        set.len() > 100,
        "the genesis fold should declare the whole seed vocabulary (got {})",
        set.len()
    );

    // the 4 the OLD hardcoded fold_op_word match knew — they MUST still resolve, now FROM the fold.
    for op in ["set-being", "set-space", "end-space", "set-matter"] {
        let d = resolve_word(&root, "0", op).unwrap_or_else(|| panic!("{op} unresolved from the fold"));
        assert!(d.is_op(), "{op} is a kind:op word");
    }

    // set-being's descriptor carries what the JS binding.word held — driven by the chain, not code.
    let sb = resolve_word(&root, "0", "set-being").unwrap();
    assert_eq!(sb.noun.as_deref(), Some("being"), "set-being targets the being noun");
    assert_eq!(sb.id_from.as_deref(), Some("beingId"), "set-being idFrom beingId");
    assert_eq!(sb.fact_action_or_name(), "set-being", "set-being's auto-fact act");

    // a NON-hardcoded op (never in the old match) resolves PURELY from the fold — the keystone claim.
    for op in ["set-owner", "create-matter", "end-matter", "rename-matter"] {
        let d = resolve_word(&root, "0", op).unwrap_or_else(|| panic!("{op} unresolved from the fold"));
        assert!(d.is_op(), "{op} resolves as an op word from the chain, not a hardcoded list");
    }

    // a concept word (kind:"concept", e.g. "chain") folds too but is NOT an op — the runner grounds it
    // in the engine, never as a `.word` body.
    if let Some(c) = resolve_word(&root, "0", "chain") {
        assert!(!c.is_op(), "a concept word is not an op");
    }

    // an undeclared word resolves to None (no code default).
    assert!(resolve_word(&root, "0", "no-such-word-xyzzy").is_none());

    println!("  treewordfold: folded {} words from chain; set-being + set-owner + create-matter resolve FROM the fold  OK", set.len());
}
