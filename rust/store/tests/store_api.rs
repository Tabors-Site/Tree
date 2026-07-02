// THE STORE API — the book index is total+exact, the lookups land, the engine can boot from the
// embedded store alone (no seed/ checkout).

#[test]
fn the_book_reads_and_the_store_has_no_drift() {
    let vocab = treeseed::vocabulary();
    assert_eq!(vocab.len(), 92, "the genesis book reads the whole coined vocabulary");
    assert_eq!(vocab[0], "words/word.word", "word.word is read first (the self-grounding root)");
    assert_eq!(vocab[1], "words/iam.word", "iam.word second (the sayer — births Am)");
    assert!(vocab.iter().any(|r| r == "words/ables/cherub.word"), "the able cherub is read");
    assert!(vocab.iter().any(|r| r == "words/cherub/cherub.word"), "the cherub op word is read");
    // every indexed word has a body.
    for rel in &vocab {
        assert!(treeseed::word(rel).is_some(), "{rel} has an embedded body");
    }
    treeseed::assert_no_drift().expect("the store and the book agree");
}

#[test]
fn the_lookups_land() {
    // a concept flat, an op word, an able-spec, a materials op (noun bundle), the dir-name fallback.
    assert!(treeseed::word("words/word.word").unwrap().contains("A word is a word"));
    assert!(treeseed::op_word("kill", None).is_some(), "cherub's kill by coined name");
    assert!(treeseed::able_word("cherub").unwrap().contains("A cherub is an able"));
    assert!(treeseed::op_word("set-being", Some("being")).is_some(), "materials op via its noun bundle");
    assert!(treeseed::op_word("create-space", None).is_some(), "create.word coins as its dir (until M1C)");
    assert!(treeseed::op_word("no-such-op", None).is_none());
    // the genesis book words.
    for b in ["index.word", "genesis.word", "genesis-spaces.word", "genesis-delegates.word", "genesis-home.word"] {
        assert!(treeseed::book(b).is_some(), "book/{b} embedded");
    }
}
