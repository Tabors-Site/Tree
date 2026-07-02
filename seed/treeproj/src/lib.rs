// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treeproj — the projection cache. The read side does not block on a full fold: it reads a cached
// .proj snapshot, and refolds (read reel -> fold -> save snapshot) only when the reel has advanced
// past the cached foldedSeq. Composes treestore (read the reel) + treefold (the pure fold) + the
// snapshot store. The snapshot is rebuildable from the reel, never truth — ports the folded-state
// cache fileStore.js loadSnapshot/saveSnapshot + projections.js fold orchestration back.

mod index;
pub mod lineage;
mod snapshot;
pub use index::{
    find_by_heaven_space, find_by_name, find_by_parent, find_by_position, index_path, list_by_type,
    load_index, save_index, update_index_from_slot,
};
pub use snapshot::{folded_seq, load_snapshot, save_snapshot};
// The cross-history (lineage-inheritance) walk lives in `treeproj::lineage` ABOVE the own-history leaves
// (which stay UNCHANGED). It re-exports `list_live_histories` (the live-history enumerator) so the read
// side reaches the enumerator the cross-history queries are built on through one crate.
pub use treestore::list_live_histories;
pub use treehash::{canonicalize, Json};

use std::path::Path;

/// refold: read the whole reel, fold it to the projection state, and cache it as the FULL slot
/// ({state, foldedSeq, position, tombstoned}). Returns the slot written. This is the cold rebuild
/// (unconditional save); the CAS form (save_snapshot with expected_folded_seq) guards a concurrent
/// incremental fold. save_snapshot re-buckets the derived index off this slot.
///
/// The slot derive:
///   - `position` = the folded `state.position` (a string), else null. This is the field foldEngine
///     reads at line 271 (`state.position !== undefined ? state.position : undefined`); we carry the
///     string when present, else null.
///   - `tombstoned` = `state.qualities.dead` is present (a non-null object). THE v2 CHANGE: the JS
///     tombstones via reducer.isGone (the DELETED sentinel, matter/space only); v2 reads the cease
///     doctrine's CONSISTENT marker `qualities.dead` (being + space + matter all fold
///     `qualities.dead = {byActor}` on cease). A killed being now tombstones too. We do NOT port
///     isGone; tombstoned is derived PURELY from `state.qualities.dead != null`.
pub fn refold(root: &Path, history: &str, kind: &str, id: &str) -> std::io::Result<Json> {
    let facts = treestore::read_reel_file(root, history, kind, id, None, None);
    let folded = facts.iter().filter_map(seq_of).fold(0.0_f64, f64::max);
    let state = treefold::fold(kind, &facts);
    let position = match get(&state, "position") {
        Some(p @ Json::Str(_)) => p.clone(),
        _ => Json::Null,
    };
    let tombstoned = qualities_dead(&state);
    let slot = Json::Obj(vec![
        ("state".to_string(), state),
        ("foldedSeq".to_string(), Json::Num(folded)),
        ("position".to_string(), position),
        ("tombstoned".to_string(), Json::Bool(tombstoned)),
    ]);
    save_snapshot(root, history, kind, id, &slot, None)?;
    Ok(slot)
}

/// tombstoned = `state.qualities.dead` is present (a non-null object). The cease doctrine's ONE
/// consistent marker across being (be:kill) / space (do:delete) / matter (do:delete).
fn qualities_dead(state: &Json) -> bool {
    let qualities = match get(state, "qualities") {
        Some(q) => q,
        None => return false,
    };
    !matches!(get(qualities, "dead"), None | Some(Json::Null))
}

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
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
