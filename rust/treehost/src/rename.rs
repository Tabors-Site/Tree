// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// rename.rs — resolve_rename_matter, the floor see-op for rename-matter.word (renameMatterHost.js
// `resolve-rename-spec`). rename-matter gives an existing matter a new name; it is a COMPOSITE (the
// actual write is a `do set-matter` leaf on field "name"). The CONTROL strand (the `name`-required
// gate + the return) is the .word; the world READ this op needs is one host see-op:
//
//   - load the target matter row, require its `spaceId` (a matter with no space can't be renamed);
//   - per-(spaceId, parentMatterId) FOLDER name-uniqueness (case-insensitive), unless `allowReplace`:
//     a sibling already holding the name refuses, but the matter's OWN current name is excluded (a
//     rename-to-self is a no-op, not a collision).
//
// It REUSES the SAME primitives the JS handler called (loadTargetRow + listMatterNamesInFolder via the
// toolkit's load_row + folder_matter_names); it reimplements nothing and lays no fact. Returns the
// resolved `{ matterId, name }` the .word binds. A HostError IS the .word's refusal.

use std::path::Path;

use treehash::Json;

use crate::being::{branch_or, target_id_of};
use crate::toolkit::{folder_matter_names, get_str, jstr, load_row, obj};
use crate::{arg, AuthCtx, HostError};

/// resolve-rename-spec(target, name, allowReplace, branch) -> { matterId, name }.
/// The .word's `If no name` gate runs FIRST (a non-empty new name), so `name` is a present string here.
pub fn resolve_rename_matter(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
    let name = arg(args, 1);
    let allow_replace = arg(args, 2);
    let branch = arg(args, 3);
    let history = branch_or(branch, history);

    let name = match name {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        _ => {
            return Err(HostError::invalid(
                "rename-matter: `name` is required and must be a non-empty string",
            ))
        }
    };

    // Load the target matter (loadTargetRow -> the folded state, with `_id`).
    let matter_id_target = target_id_of(target);
    let row = load_row(root, &history, "matter", &matter_id_target);
    let matter_id = get_str(&row, "_id").unwrap_or(&matter_id_target).to_string();

    let space_id = get_str(&row, "spaceId").filter(|s| !s.is_empty());
    if space_id.is_none() {
        return Err(HostError::invalid("rename-matter: matter has no spaceId"));
    }
    let parent_matter_id = get_str(&row, "parentMatterId").filter(|s| !s.is_empty());

    // Folder uniqueness (case-insensitive), unless allowReplace === true. The matter's OWN current name
    // is excluded (rename-to-self is a no-op).
    let replace = matches!(allow_replace, Json::Bool(true));
    if !replace {
        let existing = folder_matter_names(root, &history, space_id, parent_matter_id);
        let mut taken: std::collections::HashSet<String> =
            existing.iter().map(|n| n.to_lowercase()).collect();
        if let Some(cur) = get_str(&row, "name") {
            taken.remove(&cur.to_lowercase());
        }
        if taken.contains(&name.to_lowercase()) {
            return Err(HostError::invalid(format!(
                "rename-matter: name \"{name}\" already in use in this folder"
            )));
        }
    }

    Ok(obj(vec![("matterId", jstr(&matter_id)), ("name", jstr(name))]))
}
