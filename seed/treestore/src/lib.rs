// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treestore — Tier 4: the append-only store + the stamp (where acts turn into facts).
//
// Ports the determinism-bearing core of seed/past/fileStore.js:
//   - the STAMP (stamp.rs): computeFactDoc — an act's spec + the reel head → the fully-identified
//     fact doc (seq, p, _id) — and the reel-line format `JSON.stringify(doc) + "\n"`,
//   - the reel READ (reel.rs): readReel (seq-range) + readReelLineage (branch union),
//   - the storage FLOOR (store.rs): the .head pointer + writeFactDoc — a real std::fs reel writer
//     (durable append + fsync, idempotent by per-reel seq),
//   - the ACT-LOG (act_log.rs): the per-Name act chain — compute_act_doc (act_id + the link),
//     append, the .acthead compare-and-set, read; the souls the stamper rasterizes into facts,
//   - the moment SEAL (commit.rs): commitMoment's pure orchestration — thread the per-reel heads,
//     stamp + ord each fact, enforce one act = one fact = one reel.
//
// The caches/queries layered ON the reels (the .proj snapshots, the inverted indexes, the act index,
// CAS content store, the cross-aggregate enumerators) are rebuildable projections, not the floor — a
// later phase. This crate is the irreducible truth layer: an ordered log of stamps stored as one.

mod act_log;
mod commit;
mod history;
mod moment;
mod ord;
mod recover;
mod reel;
mod stamp;
mod store;
mod util;

pub use act_log::{
    act_line, advance_act_head, advance_act_head_file, append_act_line, compute_act_doc,
    read_act_chain, read_act_chain_file, read_act_head_file, ActChainMoved, ActStamped,
    AdvanceError, HeadAdvance,
};
pub use commit::{seal_moment, FactSpec, Seal, SealedFact};
pub use history::{
    branch_point, create_history, fork_reel, fork_reel_fs, is_main, lineage_and_floors,
    list_live_histories, load_history, reel_floors, resolve_history_lineage, write_history_row,
    HistoryError, NewHistory, MAIN,
};
pub use moment::{commit_moment, commit_moment_signed, CommitError, Committed};
pub use ord::{moment_order, next_ord, read_ord};
pub use recover::{
    recover_act_before_commit, recover_reel_before_commit, walked_act_head, walked_reel_head,
};
pub use reel::{lineage_ranges, parse_reel, read_reel, read_reel_lineage};
pub use stamp::{compute_fact_doc, fact_line, Head, Stamped, GENESIS_PREV};
pub use store::{read_reel_file, read_reel_head, write_fact_doc, write_reel_head, FactWrite};

pub use treehash::{act_id, canonicalize, content_of_act, parse, stringify, Json};
pub use treeverify::{verify_act_chain, verify_fact_chain};
