// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// relocate.rs — resolve_move, the floor see-op for move.word (moveHost.js `resolve-source`, the move
// op's ONE host escape: the source-space READ). move.word expresses the four old param validators as
// native gates (presence / kind / finite-number / string); what stays is the multi-step projection
// READ a `see` form cannot yet shape:
//
//   - container-mode (`to` present): the DESTINATION space must EXIST (so the fact doesn't seal
//     pointing at nothing) — `loadOrFold("space", to)` -> SpaceNotFound on a miss.
//   - capture the SOURCE space: a space subject's `parent`, a matter subject's `spaceId` (or null when
//     it is the DELETED sentinel) — the live-SEE invalidation hint the move fact carries as fromSpaceId.
//   - coord-mode (`coord` present): bounds-check the coord against the CONTAINER's `size`
//     (assertCoordWithinSize — the SAME canonical math create-matter / set-matter use; THROW, never
//     clamp — a silent clamp would lie).
//
// It returns `fromSpaceId` (a space-id string, or Json::Null) — the value move.word binds as
// `$fromSpaceId` and folds into factParams. It lays NO fact; a HostError IS the .word's refusal. The
// subject kind / id come from the SAME {kind,id}/string contract the handler used. Authority is the
// verb's able-walk (the AuthCtx input), not a floor read here.

use std::path::Path;

use treehash::Json;

use crate::being::{branch_or, target_id_of};
use crate::toolkit::{assert_coord_within_size_pub, get, get_str, is_deleted, jstr, load_row, obj};
use crate::{arg, AuthCtx, HostError};

/// The four compass words a being step is spoken in (move.word: north/south/east/west). The direction
/// mode carries ONLY the word — the being's coord is the FOLD of its steps (the position reducer shifts
/// the running coord by the direction's cell offset), so nothing is computed here.
const DIRECTIONS: &[&str] = &["north", "south", "east", "west"];

/// resolve-move-being(caller, direction, branch) -> { beingId, factParams:{ direction } }.
///
/// The BEING-STEP see-op for move.word's direction mode (the WASD walk). A being moves ITSELF by
/// laying ONE do:move carrying the direction; NOTHING is computed at act time. This op only:
///   - VALIDATES the direction word (one of the four compass words) — an unknown word is the .word's
///     refusal, so a garbage step never seals.
///   - names the fact TARGET being (`caller`, the actor's own being) — a moment always proved the
///     Name's key, so the caller IS the walker.
/// It reads NO current coord and computes NO new coord: the position fold accumulates the step (a
/// re-fold on the being's next moment lands it in the new spot, purely from the reel). It lays NO
/// fact; a HostError is the .word's refusal. Returns the block move.word promotes into its do:move.
pub fn resolve_move_being(
    _root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let caller = arg(args, 0);
    let direction = arg(args, 1);
    let branch = arg(args, 2);
    let _history = branch_or(branch, history);

    let being_id = match caller {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        _ => return Err(HostError::invalid("move: a being step requires an identified actor (caller)")),
    };
    let dir = match direction {
        Json::Str(s) if DIRECTIONS.contains(&s.as_str()) => s.as_str(),
        _ => {
            return Err(HostError::invalid(
                "move: `direction` must be one of north / south / east / west",
            ))
        }
    };

    Ok(obj(vec![
        ("beingId", jstr(being_id)),
        ("factParams", obj(vec![("direction", jstr(dir))])),
    ]))
}

/// resolve-source(subject, coord, to, branch) -> fromSpaceId (a space-id string or Json::Null).
/// The bridge binds an absent coord/to to Json::Null, so the `to` / `coord` presence reads are direct.
pub fn resolve_move(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let subject = arg(args, 0);
    let coord = arg(args, 1);
    let to = arg(args, 2);
    let branch = arg(args, 3);
    let history = branch_or(branch, history);

    let kind = subject_kind(subject);
    let target_id = target_id_of(subject);

    // container-mode: the destination must exist (the JS destExists check, through the curated
    // projection layer). A present non-empty `to` is a space-id (move.word's `to` is-a-string gate ran).
    if let Some(to_id) = nonempty_str(to) {
        let dest = load_row(root, &history, "space", to_id);
        if matches!(dest, Json::Null) {
            return Err(HostError::space_not_found(format!(
                "move: destination space \"{to_id}\" not found"
            )));
        }
    }

    // capture the SOURCE space (the subject's parent for a space, its containing space for matter).
    let from_space_id: Option<String> = if kind == "space" {
        let slot = load_row(root, &history, "space", &target_id);
        if matches!(slot, Json::Null) {
            return Err(HostError::space_not_found(format!(
                "move: space \"{target_id}\" not found"
            )));
        }
        get_str(&slot, "parent").filter(|s| !s.is_empty()).map(|s| s.to_string())
    } else {
        let slot = load_row(root, &history, "matter", &target_id);
        if matches!(slot, Json::Null) {
            return Err(HostError::invalid(format!("move: matter \"{target_id}\" not found")));
        }
        // state.spaceId is the containing space, or the DELETED sentinel for a soft-deleted matter
        // (the null-check catches the sentinel: a deleted matter has no live container).
        match get(&slot, "spaceId") {
            Some(v) if !is_deleted(v) => {
                get_str(&slot, "spaceId").filter(|s| !s.is_empty()).map(|s| s.to_string())
            }
            _ => None,
        }
    };

    // coord-mode bounds: THROW out-of-bounds (no silent clamp) against the container's size. The SAME
    // canonical bounds math create-matter / set-matter use (assert_coord_within_size). x/y are finite
    // (move.word's shape gates) and z is finite-or-absent, so the helper's non-finite skip is a no-op.
    if is_plain_obj(coord) {
        if let Some(container_id) = &from_space_id {
            let container = load_row(root, &history, "space", container_id);
            let size = get(&container, "size").cloned().unwrap_or(Json::Null);
            assert_coord_within_size_pub(coord, &size, "move", "container")?;
        }
    }

    Ok(match from_space_id {
        Some(s) => jstr(&s),
        None => Json::Null,
    })
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
/// detectTargetKind over the move subject: a `{kind}` target -> its kind; a space-id without a kind is
/// ambiguous for a two-kind op (never typed here), so an absent kind reads "" (the handler's bare-
/// string ambiguity). The two real callers pass a typed {kind,id} or a string the gates already vetted.
fn subject_kind(subject: &Json) -> &str {
    get_str(subject, "kind").unwrap_or("")
}

fn nonempty_str(v: &Json) -> Option<&str> {
    match v {
        Json::Str(s) if !s.is_empty() => Some(s.as_str()),
        _ => None,
    }
}
fn is_plain_obj(v: &Json) -> bool {
    matches!(v, Json::Obj(_))
}
