// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// inheritation.rs — resolve_inheritation, the floor see-op for grant-inheritation.word /
// revoke-inheritation.word (inheritationHost.js `resolve-inheritation`). A Name with authority over a
// being-tree position hands ANOTHER Name authority over that position and its whole subtree (downward
// delegation, without ownership). The CONTROL strand (the `name`-required gate + the return) is the
// .word; the substrate READS + the authority gate are this host see-op:
//
//   - resolve the ACTING Name (the granter/revoker) — the AuthCtx actor (ctx.identity.nameId in JS; I
//     for the seed paths). Absent -> Unauthorized.
//   - grant ONLY: the granted Name must be a DECLARED, non-BANISHED Name on this story (you can't hand
//     a point to a typo or a banished Name). revoke removes regardless (a never-granted point is a no-op).
//   - BOTH modes: hasAuthorityOver(actingName, position) — authority to grant/revoke AT a position is
//     authority OVER it. I always passes.
//
// Returns `{ position, factParams:{name}, grantedBy|revokedBy }` — factParams is the EXACT fact shape
// the dispatcher stamps ({ name } — the granted Name), position is the fact TARGET (the position
// being's reel), grantedBy/revokedBy ride the RESULT (the grantor is the fact's own signer, NOT in
// factParams). It lays no fact; a HostError IS the .word's refusal. Composes the toolkit's name catalog
// (declared / banished) + has_authority_over; reimplements nothing.

use std::path::Path;

use treehash::Json;

use crate::being::branch_or;
use crate::toolkit::{get_str, has_authority_over, jstr, name_banished, name_declared, obj};
use crate::{arg, AuthCtx, HostError};

/// resolve-inheritation(name, position, mode) -> { position, factParams:{name}, grantedBy|revokedBy }.
/// The .word's `If no name` gate runs FIRST (name present). `mode` is "grant" or "revoke".
pub fn resolve_inheritation(
    root: &Path,
    history: &str,
    args: &[Json],
    ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let name = arg(args, 0);
    let position = arg(args, 1);
    let mode = match arg(args, 2) {
        Json::Str(s) => s.as_str(),
        _ => "grant",
    };
    let is_revoke = mode == "revoke";
    let op_name = if is_revoke { "revoke-inheritation" } else { "grant-inheritation" };
    let history = branch_or(&Json::Null, history);

    // The acting Name (the granter/revoker): the AuthCtx actor (the JS ctx.identity.nameId / I).
    let acting_name = ctx.actor_being_id.clone().filter(|s| !s.is_empty());
    let acting_name = match acting_name {
        Some(n) => n,
        None => {
            return Err(HostError::unauthorized(format!(
                "{op_name} requires an identified acting Name"
            )))
        }
    };

    // The granted Name (trimmed, non-empty).
    let granted_name = match name {
        Json::Str(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            let what = if is_revoke {
                "the Name whose point to remove"
            } else {
                "the Name to grant authority to"
            };
            return Err(HostError::invalid(format!(
                "{op_name} requires params.name ({what})"
            )));
        }
    };

    let pos = match position {
        Json::Str(s) if !s.is_empty() => s.clone(),
        Json::Obj(_) => get_str(position, "id").unwrap_or_default().to_string(),
        _ => String::new(),
    };
    if pos.is_empty() {
        return Err(HostError::invalid(format!(
            "{op_name} requires a being-tree position (target.kind='being')"
        )));
    }

    // grant only: the granted Name must be a declared, non-banished Name on this story.
    if !is_revoke {
        if !name_declared(root, &granted_name) {
            return Err(HostError::invalid(format!(
                "grant-inheritation: \"{}…\" is not a declared Name on this story.",
                short(&granted_name, 12)
            )));
        }
        if name_banished(root, &granted_name) {
            return Err(HostError::forbidden(format!(
                "grant-inheritation: \"{}…\" is banished.",
                short(&granted_name, 12)
            )));
        }
    }

    // Authority to grant/revoke AT a position is authority OVER it (defense-in-depth re-check; I passes).
    if !has_authority_over(root, &history, &acting_name, &pos) {
        return Err(HostError::forbidden(format!(
            "{op_name}: acting Name has no authority over this being-tree position"
        )));
    }

    let by_key = if is_revoke { "revokedBy" } else { "grantedBy" };
    Ok(obj(vec![
        ("position", jstr(&pos)),
        ("factParams", obj(vec![("name", jstr(&granted_name))])),
        (by_key, jstr(&acting_name)),
    ]))
}

/// The JS `name.slice(0, n)` (the truncated Name in the refusal text). Char-boundary safe.
fn short(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
