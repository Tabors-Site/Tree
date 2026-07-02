// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// purge.rs — resolve_purge, the floor see-op for purge-content.word (purgeContentHost.js
// `resolve-purge`). purge-content physically deletes the bytes behind a matter's content hash. The
// CONTROL strand (the caller gate + the return) is the .word; the genuine substrate READS + the gates
// are this host see-op:
//
//   - load the matter, RESOLVE the hash (the explicit `hash` arg, else the matter's current cas ref);
//   - the AUTHOR-or-root-OWNER auth gate: the caller is the matter's `beingId` (author) OR the resolved
//     owner of the matter's ROOT space (resolveRootSpace -> getSpaceOwner);
//   - the SHARED-FATE refcount gate: other LIVE matter (any history) whose CURRENT content is this same
//     dedup'd hash. Purging blinds them — refuse (ResourceConflict) without `force`.
//
// FACT-FIRST in the JS: the physical deleteContent runs on the moment's afterSeal (the do:purge-content
// fact seals first, then the bytes go). That post-seal delete is HOST I/O (the caller's emit); the
// bridge ports the VALIDATION + the refcount READ and RETURNS the block —
// `{ matterId, hash, sharedReferents, factParams:{hash,force,referents} }`. It lays no fact; a
// HostError IS the .word's refusal. Composes load_row + is_cas_ref + find_matter_by_content_hash +
// the root-owner walk; reimplements nothing.

use std::path::Path;

use treehash::Json;

use crate::being::branch_or;
use crate::toolkit::{
    find_matter_by_content_hash, get, get_str, is_cas_ref, jstr, load_row, obj, resolve_root_owner,
};
use crate::{arg, AuthCtx, HostError};

/// resolve-purge(matterId, hash, force, caller) -> { matterId, hash, sharedReferents, factParams }.
/// `caller` is the AuthCtx actor (the .word already refused "no caller"; re-stated here for direct calls).
pub fn resolve_purge(
    root: &Path,
    history: &str,
    args: &[Json],
    ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let matter_id_arg = arg(args, 0);
    let hash_arg = arg(args, 1);
    let force_arg = arg(args, 2);
    // caller: the explicit 4th arg (the .word passes $caller) OR the AuthCtx actor.
    let caller = match arg(args, 3) {
        Json::Str(s) if !s.is_empty() => s.clone(),
        _ => ctx.actor_being_id.clone().unwrap_or_default(),
    };
    let history = branch_or(&Json::Null, history);

    let matter_id = match matter_id_arg {
        Json::Str(s) if !s.is_empty() => s.clone(),
        Json::Obj(_) => get_str(matter_id_arg, "id").unwrap_or_default().to_string(),
        _ => String::new(),
    };
    if matter_id.is_empty() {
        return Err(HostError::missing_target("purge-content: matter target required"));
    }
    if caller.is_empty() {
        return Err(HostError::unauthorized("purge-content: identity required"));
    }

    let row = load_row(root, &history, "matter", &matter_id);
    if matches!(row, Json::Null) {
        return Err(HostError::invalid("purge-content: matter not found"));
    }

    // Resolve the hash: the explicit `hash` arg (a historical version), else the matter's current cas ref.
    let content = get(&row, "content").cloned().unwrap_or(Json::Null);
    let hash = match hash_arg {
        Json::Str(s) if !s.is_empty() => s.clone(),
        _ if is_cas_ref(&content) => get_str(&content, "hash").unwrap_or("").to_string(),
        _ => String::new(),
    };
    if hash.is_empty() {
        return Err(HostError::invalid(
            "purge-content: matter has no stored content (pass `hash` for a historical version)",
        ));
    }

    // Owner gate: the matter's author, or the owner of the matter's ROOT space.
    let is_author = get_str(&row, "beingId") == Some(caller.as_str());
    let is_root_owner = match get_str(&row, "spaceId").filter(|s| !s.is_empty() && *s != "deleted") {
        Some(space_id) => resolve_root_owner(root, space_id).as_deref() == Some(caller.as_str()),
        None => false,
    };
    if !is_author && !is_root_owner {
        return Err(HostError::forbidden(
            "purge-content: only the matter author or the tree owner can purge its content",
        ));
    }

    // Shared-fate refcount: other LIVE matter (any history) on this same hash. Refuse without force.
    let forced = matches!(force_arg, Json::Bool(true))
        || matches!(force_arg, Json::Str(s) if s == "true");
    let others = find_matter_by_content_hash(root, &hash, &matter_id);
    if !others.is_empty() && !forced {
        return Err(HostError::resource_conflict(format!(
            "purge-content: {} other matter row(s) reference these same bytes (content is \
             deduplicated by hash). Pass force=true to purge anyway — their content goes dark too.",
            others.len()
        )));
    }

    let referents = others.len() as f64;
    Ok(obj(vec![
        ("matterId", jstr(&matter_id)),
        ("hash", jstr(&hash)),
        ("sharedReferents", Json::Num(referents)),
        (
            "factParams",
            obj(vec![
                ("hash", jstr(&hash)),
                ("force", Json::Bool(forced)),
                ("referents", Json::Num(referents)),
            ]),
        ),
    ]))
}
