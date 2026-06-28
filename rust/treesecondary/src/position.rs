// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// PositionProjection (the COORD index) - the PURE FOLD of
// seed/past/projections/position/positionProjectionFold.js. One row per
// (beingId, spaceId): "who is at this space, where" -> {x, y, z?, lastMoveSeq}.
//
//   do:set-being with params.field === "coord"
//       value = {x,y,z?} -> upsert the row at (beingId, spaceId) with the coord
//                           and lastMoveSeq = fact.seq, SEQ-GUARDED (a re-folded
//                           stale fact, seq <= lastMoveSeq, is a no-op).
//       value = null/undefined -> "unset coord": delete EVERY row for this being
//                           (deleteMany {beingId}).
//
// NOT the same projection as treeproj's `position` FACET. treeproj/index.rs
// `position` keys spaceId -> [occupant ids] off `state.position` (which space a
// being is IN). THIS projection keys (beingId,spaceId) -> the being's {x,y,z}
// COORDINATE within that space. Distinct shapes, distinct purposes; this is NOT
// covered by treeproj and is ported here.
//
// What is PURE here (and lives in this crate):
//   position_row_id(beingId, spaceId)        : the composite "_id".
//   position_fold_coord(prior, fact, spaceId): a do:set-being:coord fact + the
//       resolved spaceId -> the PositionOp (Upsert(row) | DeleteForBeing(beingId)
//       | NoOp). Seq-guard applied purely against `prior`.
//
// What is NOT a pure fact-fold (stays in JS, flagged here, NOT ported):
//   - SPACE RESOLUTION. The fact carries only the being's reel (of.id); the JS
//     resolves WHICH space the coord belongs in by reading the being's CURRENT
//     `position` (`loadOrFold("being", beingId, history)` -> slot.position). That
//     is a live slot read, not in the fact. The caller resolves spaceId and
//     hands it here. (treeproj exposes this as the folded `state.position`, so a
//     caller can fold the being's reel and read it.)
//   - the afterPositionUpdate HOOK fan (a notify on real change) is I/O, stays JS.
//
// PURE / clock-free: `lastMoveSeq` (the fact's per-reel seq) is the truth-order;
// `updatedAt` (fact.date or null) is an inert display witness, never sorted.

use crate::value as v;
use crate::value::{Json, RowBuilder};

/// The PositionProjection write a coord fact resolves to. (Json carries no
/// PartialEq; tests compare the Upsert row via canonicalize/stringify.)
#[derive(Debug)]
pub enum PositionOp {
    /// Upsert this row at its `_id` (beingId:spaceId). The seq-guard already
    /// passed (the fact is newer than the prior row, or there was no prior row).
    Upsert(Json),
    /// "unset coord" (value null/undefined): delete EVERY PositionProjection row
    /// for this being (the JS deleteMany {beingId}). Carries the beingId.
    DeleteForBeing(String),
    /// Nothing to do: not a coord fact, malformed coord, missing inputs, OR the
    /// seq-guard rejected a stale fact.
    NoOp,
}

/// positionRowId(beingId, spaceId) = `"<beingId>:<spaceId>"`. Single-source so
/// the fold and any reader build the same composite key.
pub fn position_row_id(being_id: &str, space_id: &str) -> String {
    format!("{being_id}:{space_id}")
}

/// position_fold_coord: handleSetBeingCoord as a PURE
/// (prior_row, fact, space_id) -> PositionOp.
///
/// `prior` is the existing PositionProjection row at (beingId, spaceId), or None.
/// `space_id` is the resolved space (see module docs - the caller resolves it).
/// Pass an empty `space_id` ("") to mean "unresolved": the coord-set path then
/// NoOps (mirroring the JS `if (!spaceId) return`), while the unset path still
/// deletes (it never needs a space).
///
/// Gates mirrored from the JS, in order:
///   - verb === "do" && act === "set-being"      else NoOp
///   - params.field === "coord"                  else NoOp
///   - of.kind === "being" && of.id present      else NoOp
///   - typeof fact.seq === "number"              else NoOp
///   - value null/undefined -> DeleteForBeing(beingId)
///   - value an object (not array) with finite x AND finite y  else NoOp
///   - spaceId resolved (non-empty)              else NoOp
///   - SEQ-GUARD: fact.seq > prior.lastMoveSeq (or no prior)  else NoOp
pub fn position_fold_coord(prior: Option<&Json>, fact: &Json, space_id: &str) -> PositionOp {
    if v::str_of(fact, "verb") != Some("do") || v::str_of(fact, "act") != Some("set-being") {
        return PositionOp::NoOp;
    }
    let params = v::params(fact);
    if v::str_of(&params, "field") != Some("coord") {
        return PositionOp::NoOp;
    }
    let being_id = match v::of_ref(fact) {
        Some((kind, id)) if kind == "being" => id,
        _ => return PositionOp::NoOp,
    };
    let seq = match v::num_of(fact, "seq") {
        Some(n) => n,
        None => return PositionOp::NoOp,
    };

    let value = v::get(&params, "value");
    // Null/undefined -> unset (delete every row for this being).
    match value {
        None | Some(Json::Null) => return PositionOp::DeleteForBeing(being_id),
        _ => {}
    }
    let value = value.unwrap();
    // Must be a plain object (not an array) with finite x and y.
    if !matches!(value, Json::Obj(_)) {
        return PositionOp::NoOp;
    }
    let x = match v::get(value, "x") {
        Some(j) if v::is_finite_num(j) => j.clone(),
        _ => return PositionOp::NoOp,
    };
    let y = match v::get(value, "y") {
        Some(j) if v::is_finite_num(j) => j.clone(),
        _ => return PositionOp::NoOp,
    };

    // spaceId must be resolved (the JS `if (!spaceId) return`).
    if space_id.is_empty() {
        return PositionOp::NoOp;
    }

    // SEQ-GUARD: advance only when this fact is newer than the prior row's
    // lastMoveSeq. No prior row (or one with no lastMoveSeq) passes; a stale
    // re-fold (seq <= lastMoveSeq) NoOps.
    if let Some(prior) = prior {
        if let Some(last) = v::num_of(prior, "lastMoveSeq") {
            if !(seq > last) {
                return PositionOp::NoOp;
            }
        }
    }

    let id = position_row_id(&being_id, space_id);
    // INERT display witness only: fact.date (kept as-is), or null. Never a clock.
    let updated = v::nullish(v::get(fact, "date"), Json::Null);
    // z only when finite (the JS `if (Number.isFinite(value.z)) $set.z = ...`),
    // appended AFTER updatedAt to match the JS $set build order.
    let z = match v::get(value, "z") {
        Some(j) if v::is_finite_num(j) => Some(j.clone()),
        _ => None,
    };

    let row = RowBuilder::new()
        .put("_id", Json::Str(id))
        .put("beingId", Json::Str(being_id))
        .put("spaceId", Json::Str(space_id.to_string()))
        .put("x", x)
        .put("y", y)
        .put("lastMoveSeq", Json::Num(seq))
        .put("updatedAt", updated)
        .put_opt("z", z)
        .build();
    PositionOp::Upsert(row)
}
