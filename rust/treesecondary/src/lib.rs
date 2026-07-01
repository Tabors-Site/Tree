// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treesecondary - the PURE FOLD of the three SECONDARY cross-cutting projections
// (the views that span reels, ported from seed/past/projections/*). The primary
// reel reducers live in treefold; these fold the SAME facts into cross-reel
// index rows. Each is fact -> row state, byte-compatible with the JS projStore
// rows (treehash::stringify is insertion-order, like JSON.stringify, so the
// builders push keys in the exact JS order). See tests/secondary_folds.rs.
//
//   inbox    - one row per OPEN summon, keyed by params.correlation. A `call`
//              fact opens the row; the answering act's seal evicts it.
//   threads  - one row per LIVE coordination root, keyed by rootCorrelation. A
//              `call` fact bumps the order key + participants; an act seal bumps
//              the order key. (The one wholly-pure projection of the three.)
//   position - one row per (beingId, spaceId): the being's {x,y,z} COORD in that
//              space. A `do:set-being` field=coord fact upserts it (seq-guarded);
//              an unset deletes the being's rows. NOT treeproj's `position` facet
//              (that keys spaceId -> occupant ids off state.position; this keys
//              the COORDINATE). Distinct projection, ported here.
//
// THE FOLD MOVES; THE I/O WIRING STAYS. Each module flags exactly which inputs
// are NOT in the fact (the inbox answered-guard + quoted-word reel/name reads;
// the position space resolution) - those live cross-reel reads stay in JS, which
// supplies the resolved inputs and applies the row op. The fold here is pure.

mod inbox;
mod position;
mod threads;
mod value;

pub use inbox::{inbox_evict, inbox_open, inbox_open_quoted_word, is_call, priority_rank_of};
pub use position::{direction_offset, position_fold_coord, position_fold_move, position_row_id, PositionOp};
pub use threads::{thread_root, threads_fold_call, threads_note_act_seal};
pub use value::Json;

// Re-export the Tier-1 primitives tests use (canonicalize for order-independent
// row comparison; stringify for the exact byte image; parse to read fixtures).
pub use treehash::{canonicalize, parse, stringify};
