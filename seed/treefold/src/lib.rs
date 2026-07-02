// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treefold — Tier 2 of the Rust port: the fold engine. The per-kind reducers
// (being / space / matter / name / library) + the 12 shared apply* helpers +
// the pure fold loop, ported from seed/materials/*/reducer.js +
// reducerHelpers.js. Folded state is compared via treehash::canonicalize so the
// proof is order-independent and reuses the Tier-1 wire format. See
// tests/fold_vectors.rs (golden reels generated from the live JS).

mod fold;
mod reducers;
mod value;

pub use fold::{fold, fold_from, initial, reduce};
pub use reducers::is_gone_matter;
pub use value::Json;

// Re-export the Tier-1 primitives integration tests need (canonicalize for
// order-independent state comparison; parse to read the golden reels).
pub use treehash::{canonicalize, parse};
