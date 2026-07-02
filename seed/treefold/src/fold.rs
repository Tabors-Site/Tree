// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The generic fold loop, twin of foldEngine.js's hot core:
//   state = reducer.initial(); for f in seqOrderedFacts: state = reducer.reduce(state, f)
//
// Everything else in foldEngine.js (projection cache CAS, cross-cutting handlers,
// lineage file reads, name-collision deconfliction, tombstones) is I/O orchestration
// around this pure center. The reducers see only ordered facts; the ordering
// (seq, lineage union, parallel-fact dedup) is the store read's job, upstream.

use crate::reducers;
use crate::value as v;
use crate::value::Json;

/// Empty/initial state for a reel kind.
pub fn initial(kind: &str) -> Json {
    match kind {
        "library" => reducers::initial_library(),
        _ => v::empty_obj(), // being / space / matter / name start empty
    }
}

/// Apply one fact through the kind's reducer.
pub fn reduce(kind: &str, state: &Json, fact: &Json) -> Json {
    match kind {
        "being" => reducers::reduce_being(state, fact),
        "space" => reducers::reduce_space(state, fact),
        "matter" => reducers::reduce_matter(state, fact),
        // "name" is NOT a reel kind: a Name has no reel; its facts fold into the library catalog.
        "library" => reducers::reduce_library(state, fact),
        _ => state.clone(),
    }
}

/// Fold a reel from genesis: `initial()` then reduce across the facts in seq order.
/// Cold path (foldEngine.rebuild folds a whole reel from empty); delegates to `fold_from`
/// seeded with the kind's initial state so ONE reduce loop serves both the cold and the
/// catch-up paths.
pub fn fold(kind: &str, facts: &[Json]) -> Json {
    fold_from(kind, &initial(kind), facts)
}

/// Fold a TAIL onto a CACHED state — the foldEngine hot core: seed with `state`, then reduce
/// across `facts` in seq order (stable). The catch-up path passes the projection slot's state +
/// the post-marker tail; the cold path passes `initial(kind)` + the whole reel (see `fold`).
/// `facts` arrives seq-ascending from the store read, but the stable sort makes the reduce order
/// independent of caller ordering (sorting an already-sorted slice is a no-op).
pub fn fold_from(kind: &str, state: &Json, facts: &[Json]) -> Json {
    let mut ordered: Vec<&Json> = facts.iter().collect();
    // Stable sort by numeric seq, matching the store's seq-ascending read.
    ordered.sort_by(|a, b| {
        seq_of(a)
            .partial_cmp(&seq_of(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut state = state.clone();
    for f in ordered {
        state = reduce(kind, &state, f);
    }
    state
}

fn seq_of(f: &Json) -> f64 {
    match v::get(f, "seq") {
        Some(Json::Num(n)) => *n,
        _ => f64::INFINITY,
    }
}
