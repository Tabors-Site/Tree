// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treehash — the content-addressed identity layer, ported from the JS seed
// (seed/past/fact/hash.js + seed/past/act/actHash.js) byte-for-byte. This is
// Tier 1 of the Rust port: the hash is the contract every reel's identity and
// every chain's integrity is defined against, so it is owned with zero
// dependencies and pinned by the same golden vectors the JS uses
// (seed/past/fact/canon.vectors.json). See tests/vectors.rs.
//
// Public surface mirrors the JS:
//   canonicalize(&Json) -> String        (hash.js canonicalize)
//   compute_hash(prev, &Json) -> String  (hash.js computeHash)
//   content_of(&Json) -> Json            (hash.js contentOf)
//   content_of_act(&Json) -> Json        (actHash.js contentOfAct)
//   fact_id / act_id                      (row/opening -> id, convenience)
//   sha256_hex(&[u8]) -> String           (the primitive)
//   parse(&str) -> Json                   (JSON in)

mod canon;
mod hash;
mod json;
mod sha256;

pub use canon::{canonicalize, to_canonical};
pub use hash::{act_id, compute_hash, content_of, content_of_act, fact_id, GENESIS_PREV};
pub use json::{parse, Json};
pub use sha256::sha256_hex;
