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

use std::path::PathBuf;

use treebook::{survey_book, BookSource, Violation};
use treegenesis::plant_and_ignite;

/// the seed dir (env override or the repo's seed/).
fn seed_dir() -> PathBuf {
    match std::env::var("TREE_SEED_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d),
        _ => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed")),
    }
}

/// read a seed `.word` (or a flat file under store/), returning (label, text). The label is the path
/// relative to the seed, the catalog's provenance.
fn src(rel: &str) -> Option<BookSource> {
    let p = seed_dir().join(rel);
    match std::fs::read_to_string(&p) {
        Ok(text) => Some(BookSource { file: rel.to_string(), text }),
        Err(_) => None,
    }
}

/// THE DEPENDENCY ORDER. word.word -> the foundation (descent order, GENESIS.md) -> the op bundles ->
/// the able bundles -> genesis.word. Foundation words are listed explicitly in descent order; the op +
/// able bundles are DISCOVERED recursively (so nothing is missed), with the foundation flats excluded.
fn book_in_dependency_order() -> Vec<BookSource> {
    let mut sources = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let push = |sources: &mut Vec<BookSource>, seen: &mut std::collections::HashSet<String>, rel: &str| {
        if seen.insert(rel.to_string()) {
            if let Some(s) = src(rel) {
                sources.push(s);
            }
        }
    };

    // 1. the root + the foundation, in DESCENT order (GENESIS.md conceptWords list).
    let foundation = [
        "store/words/word.word",
        "store/words/iam.word",
        "store/words/base.word",
        "store/words/in.word",
        "store/words/out.word",
        "store/words/chain.word",
        "store/words/history.word",
        "store/words/story.word",
        "store/words/fold.word",
        "store/words/see.word",
        "store/words/do.word",
        "store/words/name.word",
        "store/words/being.word",
        "store/words/space.word",
        "store/words/matter.word",
        "store/words/weave.word",
        "store/words/be.word",
        "store/words/call.word",
        "store/words/can.word",
        "store/words/recall.word",
        "store/words/able.word",
        "store/words/flow.word",
        "store/words/verbs.word", // the verb schema (folded by wordFold)
        // control-flow words
        "store/words/if.word",
        "store/words/while.word",
        "store/words/for.word",
    ];
    for rel in foundation {
        push(&mut sources, &mut seen, rel);
    }

    // 2. the OP bundles + the ABLE bundles: every remaining .word under store/words, discovered
    //    recursively, sorted for a stable read order. The foundation flats are already `seen`.
    let words_root = seed_dir().join("store/words");
    let mut rest: Vec<String> = Vec::new();
    let mut stack = vec![words_root.clone()];
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
        push(&mut sources, &mut seen, &rel);
    }

    // 3. genesis.word - the grant sequence, read LAST (it runs over the folded vocabulary + ables).
    push(&mut sources, &mut seen, "store/genesis.word");

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
