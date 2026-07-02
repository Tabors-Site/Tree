// THE SURVEY (GENESIS FIX increment 2): read the WHOLE genesis book through the guarded reader in
// COLLECT-ALL mode on a FRESH, Node-free scratch store, and print the COMPLETE CATALOG of broken words.
//
//   1. plant_and_ignite("I") on a fresh scratch store (NEVER the repo's store/past).
//   2. enumerate the genesis book in DEPENDENCY ORDER (word.word -> the foundation -> the op bundles ->
//      the able bundles -> genesis.word -> any remaining .word), reading the REAL seed artifacts.
//   3. survey_book: read every statement in collect-all mode, cataloging each guard violation /
//      parse-failure and CONTINUING past it, so every broken word surfaces in one pass.
//   4. print the catalog: CLEAN vs BROKEN tally, every broken word grouped (run-ons / missing-logic /
//      unparsed / denied), and the distinct missing host-op handlers (the treehost resolvers to build).
//
// NODE-FREE: the whole pipeline is pure Rust over the determinism spine. Run with:
//   cargo run -p treebook --example survey_genesis


use treebook::{survey_book, BookSource, Violation};
use treegenesis::plant_and_ignite;

/// THE DEPENDENCY ORDER — the store's own book (treeseed::vocabulary reads book/index.word), then
/// genesis.word last (it runs over the folded vocabulary + ables). The old hardcoded path arrays are
/// dead: the index IS the order.
fn book_in_dependency_order() -> Vec<BookSource> {
    let mut sources: Vec<BookSource> = treeseed::vocabulary()
        .into_iter()
        .filter_map(|rel| treeseed::word(&rel).map(|text| BookSource { file: rel, text }))
        .collect();
    if let Some(text) = treeseed::book("genesis.word") {
        sources.push(BookSource { file: "book/genesis.word".to_string(), text });
    }
    sources
}

fn main() {
    // 1. a FRESH scratch store, NEVER the repo's store/past.
    let dir = std::env::temp_dir().join("treebook-survey-genesis");
    let _ = std::fs::remove_dir_all(&dir);
    let story_domain = "localhost";
    let (planted, _key) = plant_and_ignite(&dir, story_domain).expect("ignite genesis on the fresh store");
    assert_eq!(planted.i_name, "I", "genesis plants the I-being as \"I\"");

    // 2. enumerate the book in dependency order.
    let book = book_in_dependency_order();

    // 3. the survey: collect-all read.
    let survey = survey_book(&book);

    // 4. THE CATALOG.
    println!("================ THE GENESIS BOOK SURVEY (collect-all, Node-free) ================");
    println!("scratch store: {}", dir.display());
    println!("sources read : {} .word files (dependency order)", book.len());
    println!();
    println!("TOTAL words read : {}", survey.total);
    println!("  CLEAN (one act, logic present): {}", survey.clean);
    println!("  BROKEN                         : {}", survey.broken_count());
    println!();

    let run_ons = survey.run_ons();
    let missing = survey.missing_logic();
    let unparsed = survey.unparsed();
    let denied = survey.denied();

    println!("---------------- GROUP: RUN-ONS (GUARD 1: word laid > 1 fact) [{}] ----------------", run_ons.len());
    for e in &run_ons {
        if let Violation::RunOn { facts, crammed } = &e.violation {
            println!("  [{}:{}] `{}`  ({} facts: {})", e.file, e.line, e.word, facts, crammed.join(", "));
            println!("        statement: {}", e.statement);
            println!("        fix: {}", e.violation.suggested_fix());
        }
    }
    if run_ons.is_empty() {
        println!("  (none)");
    }
    println!();

    println!("---------------- GROUP: MISSING-LOGIC (GUARD 2: unregistered host see-op) [{}] ----------------", missing.len());
    for e in &missing {
        if let Violation::MissingLogic { op } = &e.violation {
            println!("  [{}:{}] `{}`  -> unresolved see-op `{}`", e.file, e.line, e.word, op);
            println!("        statement: {}", e.statement);
            println!("        fix: {}", e.violation.suggested_fix());
        }
    }
    if missing.is_empty() {
        println!("  (none)");
    }
    println!();

    println!("---------------- GROUP: UNPARSED (treeword read no IR) [{}] ----------------", unparsed.len());
    for e in &unparsed {
        if let Violation::Unparsed { detail } = &e.violation {
            println!("  [{}:{}] `{}`  -> {}", e.file, e.line, e.word, detail);
        }
    }
    if unparsed.is_empty() {
        println!("  (none)");
    }
    println!();

    if !denied.is_empty() {
        println!("---------------- GROUP: DENIED (the runner refused the act) [{}] ----------------", denied.len());
        for e in &denied {
            if let Violation::Denied { reason } = &e.violation {
                println!("  [{}:{}] `{}`  -> {}", e.file, e.line, e.word, reason);
            }
        }
        println!();
    }

    println!("---------------- THE MISSING HOST-OP HANDLERS (treehost resolvers still to build) ----------------");
    let handlers = survey.missing_handlers();
    if handlers.is_empty() {
        println!("  (none - every host see-op the book reaches is registered)");
    } else {
        for op in &handlers {
            // how many words reach this op (the demand).
            let count = survey
                .missing_logic()
                .iter()
                .filter(|e| matches!(&e.violation, Violation::MissingLogic { op: o } if o == op))
                .count();
            println!("  `{}`  (reached by {} word(s))", op, count);
        }
    }
    println!();
    println!("================ END SURVEY ================");

    let _ = std::fs::remove_dir_all(&dir);
}
