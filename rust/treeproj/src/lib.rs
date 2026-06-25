// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treeproj — the projection cache. The read side does not block on a full fold: it reads a cached
// .proj snapshot, and refolds (read reel -> fold -> save snapshot) only when the reel has advanced
// past the cached foldedSeq. Composes treestore (read the reel) + treefold (the pure fold) + the
// snapshot store. The snapshot is rebuildable from the reel, never truth — ports the folded-state
// cache fileStore.js loadSnapshot/saveSnapshot + projections.js fold orchestration back.

mod snapshot;
pub use snapshot::{folded_seq, load_snapshot, save_snapshot};
pub use treehash::{canonicalize, Json};

use std::path::Path;

/// refold: read the whole reel, fold it to the projection state, and cache it as a snapshot
/// ({state, foldedSeq}). Returns the slot written. This is the cold rebuild (unconditional save); the
/// CAS form (save_snapshot with expected_folded_seq) guards a concurrent incremental fold.
pub fn refold(root: &Path, history: &str, kind: &str, id: &str) -> std::io::Result<Json> {
    let facts = treestore::read_reel_file(root, history, kind, id, None, None);
    let folded = facts.iter().filter_map(seq_of).fold(0.0_f64, f64::max);
    let state = treefold::fold(kind, &facts);
    let slot = Json::Obj(vec![
        ("state".to_string(), state),
        ("foldedSeq".to_string(), Json::Num(folded)),
    ]);
    save_snapshot(root, history, kind, id, &slot, None)?;
    Ok(slot)
}

fn seq_of(f: &Json) -> Option<f64> {
    match f {
        Json::Obj(e) => e
            .iter()
            .find(|(k, _)| k == "seq")
            .and_then(|(_, v)| match v {
                Json::Num(n) => Some(*n),
                _ => None,
            }),
        _ => None,
    }
}
