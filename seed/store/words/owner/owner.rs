// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// owner.rs — resolve_owner, the floor see-op FAMILY for set-owner.word / remove-owner.word
// (ownerHost.js). Both are COMPOSITES now: each `.word` GATES the ownership authority then `do
// set-space`s the owner field (the set-space LEAF lays the fact). The host escapes are PURE READS:
//
//   - space-id-of(target)            -> the space id, from a space target or a resolved stance (.spaceId).
//   - may-set-owner(spaceId, newOwnerId, caller)
//                                    -> may the caller set this space's owner? (members.js setSpaceOwner
//                                       rule: not heaven, not already that owner, and either the caller
//                                       IS the current owner [reassign] or — for an unowned / I-owned
//                                       position — the caller is the resolved owner of the PARENT [claim]).
//   - may-remove-owner(spaceId, caller)
//                                    -> may the caller clear it? (members.js removeSpaceOwner rule: not
//                                       heaven, it HAS a non-I owner, it has a parent, and the caller is
//                                       the resolved owner of that PARENT).
//
// Each returns a scalar (a space-id string, or a bool) the `.word` binds. No fact laid; a HostError IS
// the .word's refusal (only space-id-of throws; the may-* gates return false, the .word turns that into
// its refusal). Composes load_row + resolve_root_owner (the parent-owner read); reimplements nothing.

use std::path::Path;

use treehash::Json;

use crate::being::{branch_or, target_id_of};
use crate::toolkit::{get, get_str, is_i_name, jstr, load_row, resolve_root_owner, space_owner};
use crate::{arg, AuthCtx, HostError};

/// Dispatch the ownerHost.js family on `op`. `caller` (the may-* gates) is the AuthCtx actor or the
/// explicit `caller` arg the `.word` passes.
pub fn resolve_owner(
    op: &str,
    root: &Path,
    history: &str,
    args: &[Json],
    ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let history = branch_or(&Json::Null, history);
    match op {
        "space-id-of" => space_id_of(arg(args, 0)),
        "may-set-owner" => {
            let space_id = str_arg(arg(args, 0));
            let new_owner = str_arg(arg(args, 1));
            let caller = caller_of(arg(args, 2), ctx);
            Ok(Json::Bool(may_set_owner(root, &history, &space_id, &new_owner, &caller)))
        }
        "may-remove-owner" => {
            let space_id = str_arg(arg(args, 0));
            let caller = caller_of(arg(args, 1), ctx);
            Ok(Json::Bool(may_remove_owner(root, &history, &space_id, &caller)))
        }
        other => Err(HostError::invalid(format!(
            "host: unknown owner see-op \"{other}\""
        ))),
    }
}

/// space-id-of(target) -> the space id, from a space target (id) or a resolved stance (its .spaceId).
fn space_id_of(target: &Json) -> Result<Json, HostError> {
    // A stance carries .spaceId; a space target resolves to its id.
    if get_str(target, "kind") == Some("stance") {
        return match get_str(target, "spaceId").filter(|s| !s.is_empty()) {
            Some(s) => Ok(jstr(s)),
            None => Err(HostError::space_not_found("Resolved position has no spaceId")),
        };
    }
    let id = target_id_of(target);
    if id.is_empty() {
        return Err(HostError::space_not_found("Target does not resolve to a space"));
    }
    Ok(jstr(&id))
}

/// may-set-owner: the members.js setSpaceOwner rule, as a pure read.
fn may_set_owner(root: &Path, history: &str, space_id: &str, new_owner: &str, caller: &str) -> bool {
    let space = load_row(root, history, "space", space_id);
    if matches!(space, Json::Null) || has_heaven_marker(&space) {
        return false;
    }
    let current = space_owner(&space);
    if let Some(cur) = &current {
        if cur == new_owner {
            return false; // already that owner.
        }
        if !is_i_name(cur) {
            return cur == caller; // reassign: only the current owner.
        }
    }
    // unowned / I-owned: the claim needs the PARENT's resolved owner to approve.
    match get_str(&space, "parent").filter(|s| !s.is_empty()) {
        Some(parent) => resolve_root_owner(root, parent).as_deref() == Some(caller),
        None => false, // top-level with no current owner.
    }
}

/// may-remove-owner: the members.js removeSpaceOwner rule, as a pure read.
fn may_remove_owner(root: &Path, history: &str, space_id: &str, caller: &str) -> bool {
    let space = load_row(root, history, "space", space_id);
    if matches!(space, Json::Null) || has_heaven_marker(&space) {
        return false;
    }
    match space_owner(&space) {
        Some(o) if !is_i_name(&o) => {}
        _ => return false, // no (removable) owner.
    }
    match get_str(&space, "parent").filter(|s| !s.is_empty()) {
        Some(parent) => resolve_root_owner(root, parent).as_deref() == Some(caller),
        None => false, // top-level root.
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
/// `state.heavenSpace` is a non-null marker (a heaven space refuses ownership) — the JS `space.heavenSpace`
/// truthy gate.
fn has_heaven_marker(space: &Json) -> bool {
    !matches!(get(space, "heavenSpace"), None | Some(Json::Null))
}

fn str_arg(v: &Json) -> String {
    match v {
        Json::Str(s) => s.clone(),
        _ => String::new(),
    }
}
/// The acting caller: the explicit `caller` arg (the `.word` passes $caller), else the AuthCtx actor.
fn caller_of(explicit: &Json, ctx: &AuthCtx) -> String {
    match explicit {
        Json::Str(s) if !s.is_empty() => s.clone(),
        _ => ctx.actor_being_id.clone().unwrap_or_default(),
    }
}
