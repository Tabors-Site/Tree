// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treeproj::lineage - the PROJECTION LINEAGE-INHERITANCE walk, ported from the JS facade
// `seed/materials/projections.js` (the cross-history half of the find* queries). The own-history
// leaves in `index.rs` (find_by_name / find_by_position / find_by_parent / list_by_type) read a SINGLE
// history's inverted index; this layer sits ABOVE them and makes the read side CROSS-HISTORY:
//   - it WALKS the lineage (the parent chain, recursively to main, exactly as the JS recurses into
//     `historyRow?.parent || MAIN`);
//   - it gates an inherited row by the per-reel branchPoint (a parent's row is visible in a child only
//     up to the branchPoint - a row created on the ancestor AFTER the child forked is invisible);
//   - it SHADOWS: a child's OWN slot (live OR tombstoned) for an id wins over the inherited row (a
//     rename / tombstone / divergent fold here means this history's view is authoritative);
//   - heaven spaces route to main (one projection per story, not per history).
//
// THE JS SEMANTICS THIS MIRRORS (projections.js, locked with Tabor 2026-06-03/04):
//   * "Main is just-another-history with no parent." On MAIN every query is the own-history leaf; there
//     is nothing to inherit. So the cross-history wrappers short-circuit to the leaf when history==MAIN.
//   * `historyShadows(history, type, id)` = `loadSnapshot(history, type, id) != null` - ANY own slot
//     (live OR tombstoned) shadows the inherited row. (index.rs's find* hide a TOMBSTONED slot from a
//     find; the shadow check reads the RAW snapshot, so a tombstone still shadows - the divergence is
//     "I deleted it here," which must NOT resurrect the parent's row.)
//   * the branchPoint gate is `bp && bp > 0` - `getBranchPoint(history,type,id)` returns null for main
//     (never the gated history here), 0 when the reel had no facts at branch time (invisible: the
//     aggregate did not exist when the child forked), else the divergence seq (visible).
//   * the recursion gates at EACH unwind step against the CURRENT frame's history - `#1a1` inherits a
//     main row only if the row is visible at `#1a1`'s branchPoint AND at `#1a`'s AND at `#1`'s, with a
//     shadow at any level cutting it off. The recursive shape reproduces this exactly.
//
// SHAPES: this layer composes ON the index.rs leaves and returns their shapes unchanged -
//   find_by_name      -> `{ id, ...slot }`            (the matched slot, id merged)
//   find_by_position  -> `[{ kind, id, ...slot }]`    (occupants across kinds)
//   find_by_parent    -> `[{ kind, id, ...slot }]`    (children of a being)
//   list_by_type      -> `[id]`                       (the live ids of the kind)
// The lineage walk reads each candidate's `id` to apply the shadow + branchPoint gates, then UNIONS the
// visible inherited rows BEFORE the own rows (`[...inheritedVisible, ...here]`, the JS order). The rows
// are the SAME rows, gated + shadowed the SAME way, in the SAME order as the JS projections.js walk.

use std::path::Path;

use treehash::Json;
use treestore::{branch_point, is_main, load_history, HistoryError, MAIN};

use crate::index;
use crate::snapshot::load_snapshot;

/// The errors the lineage walk can surface. A corrupt registry lineage (a row missing partway up the
/// parent chain) is the JS `BRANCH_NOT_FOUND`; we propagate it rather than silently falling back to main
/// (the JS `resolveHistoryLineage` / `getBranchPoint` throw IbpError on it). Map at the FFI boundary.
pub type LineageError = HistoryError;

// ── small Json readers ────────────────────────────────────────────────────────

fn obj_get<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).map(|(_, x)| x),
        _ => None,
    }
}

/// The `id` field of an occupant / matched-slot row (find* merge it in). Empty when absent.
fn row_id(row: &Json) -> &str {
    match obj_get(row, "id") {
        Some(Json::Str(s)) => s,
        _ => "",
    }
}

/// The row's `parent` path as the JS reads it for the recursion (`historyRow?.parent || MAIN`): the
/// parent string, or MAIN when the row is absent / has a null/empty/absent parent (main's children carry
/// `parent: null`; main itself has no row). Mirrors `findByName`'s `historyRow?.parent || MAIN`.
fn parent_or_main(root: &Path, history: &str) -> String {
    match load_history(root, history) {
        Some(row) => match obj_get(&row, "parent") {
            // JS `historyRow.parent || MAIN`: only a non-empty string survives the `||`.
            Some(Json::Str(s)) if !s.is_empty() => s.clone(),
            _ => MAIN.to_string(),
        },
        None => MAIN.to_string(),
    }
}

// ── the two gate predicates (the shadow + the branchPoint) ───────────────────

/// historyShadows(history, type, id): TRUE when `history` holds ANY own slot (live OR tombstoned) for
/// this (kind, id) - its view of the aggregate is authoritative, so an inherited row must NOT leak
/// through. Reads the RAW snapshot (NOT a find), so a tombstone shadows too. (projections.js
/// `historyShadows` = `loadSnapshot(history, type, id) != null`.)
fn history_shadows(root: &Path, history: &str, kind: &str, id: &str) -> bool {
    load_snapshot(root, history, kind, id).is_some()
}

/// The branchPoint gate, `bp && bp > 0` (projections.js): an inherited row is visible in `history` only
/// when the aggregate existed when `history` forked. `branch_point` returns None for main (never gated
/// here), Some(0) for "no facts at branch time" (NOT visible), Some(seq>0) for a real divergence point
/// (visible). A corrupt lineage (missing row) propagates as the JS BRANCH_NOT_FOUND.
fn predates_fork(
    root: &Path,
    history: &str,
    kind: &str,
    id: &str,
) -> Result<bool, LineageError> {
    Ok(matches!(branch_point(root, history, kind, id)?, Some(v) if v > 0.0))
}

// ── find_by_name (cross-history, the recursive name walk) ────────────────────

/// findByName(type, name, history): the aggregate matching `name` in `history`'s EFFECTIVE view, or None.
///
/// History-local first (the own-history leaf - works for main too, "main is just-another-history"). On a
/// hit, return it. On main, a miss is None (nothing to inherit). Otherwise recurse into the PARENT
/// history (`row.parent || MAIN`, to main through the full lineage so nested histories inherit through
/// their whole chain), and an inherited match is visible here ONLY when:
///   * it predates THIS history's fork (`branchPoint > 0`) - a name bound on the ancestor AFTER the fork
///     is invisible here; AND
///   * this history holds no divergent slot for that id (`!historyShadows`) - a rename / tombstone /
///     divergent fold here shadows the inherited name (and since the local name query above didn't match
///     it, the inherited name does not resolve here either).
/// The returned slot carries the ANCESTOR's `history` value (the JS returns `inherited` verbatim) - the
/// row is the same row the leaf produced; the walk just decides whether it is visible.
pub fn find_by_name(
    root: &Path,
    history: &str,
    kind: &str,
    name: &str,
    scope: &Json,
) -> Result<Option<Json>, LineageError> {
    if name.is_empty() {
        return Ok(None);
    }
    // History-local match first.
    if let Some(slot) = index::find_by_name(root, history, kind, name, scope) {
        return Ok(Some(slot));
    }
    if is_main(history) {
        return Ok(None);
    }
    // Lazy fall-through to the PARENT history, recursing to main.
    let parent = parent_or_main(root, history);
    let inherited = match find_by_name(root, &parent, kind, name, scope)? {
        Some(row) => row,
        None => return Ok(None),
    };
    let id = row_id(&inherited).to_string();
    // branchPoint gate THEN the divergence shadow, both keyed to THIS frame's history (matching the JS
    // unwind: each level re-gates against its own history).
    if !predates_fork(root, history, kind, &id)? {
        return Ok(None);
    }
    if history_shadows(root, history, kind, &id) {
        return Ok(None);
    }
    Ok(Some(inherited))
}

// ── find_by_position (cross-history; own ++ MAIN-only, NOT recursive) ────────

/// findByPosition(spaceId, history): the occupants at a space in `history`'s effective view, as
/// `[{ kind, id, ...slot }]`.
///
/// NOTE THE ASYMMETRY WITH THE OTHER WALKS: the JS `findByPosition` does NOT recurse the parent chain -
/// it unions the history's OWN occupants with MAIN's occupants directly (`findByPosition(spaceId,
/// MAIN)`), each gated by the shadow + branchPoint. (A nested history's position view inherits straight
/// from main, not through intermediate ancestors, in the JS; we mirror that exactly.) Visible-from-main
/// rows come first, then the own rows (`[...mainVisible, ...here]`).
pub fn find_by_position(
    root: &Path,
    history: &str,
    space_id: &str,
) -> Result<Vec<Json>, LineageError> {
    if space_id.is_empty() {
        return Ok(Vec::new());
    }
    let here = index::find_by_position(root, history, space_id);
    if is_main(history) {
        return Ok(here);
    }
    let main_occupants = index::find_by_position(root, MAIN, space_id);
    let mut out: Vec<Json> = Vec::new();
    for o in main_occupants {
        let kind = occupant_kind(&o);
        let id = row_id(&o).to_string();
        if history_shadows(root, history, &kind, &id) {
            continue;
        }
        if predates_fork(root, history, &kind, &id)? {
            out.push(o);
        }
    }
    out.extend(here);
    Ok(out)
}

/// The `kind` an occupant row tags (find_by_position / find_by_parent merge `{ kind, id, ...slot }`).
fn occupant_kind(row: &Json) -> String {
    match obj_get(row, "kind") {
        Some(Json::Str(s)) => s.clone(),
        _ => String::new(),
    }
}

// ── find_by_parent (cross-history, the recursive being-children walk) ────────

/// findByParent(beingId, history): the being-children of `beingId` (by parentBeingId) in `history`'s
/// effective view, as `[{ kind, id, ...slot }]` (kind always "being").
///
/// Recursive into the parent chain (same model as find_by_name), so nested histories see the full
/// lineage. At each level an inherited child is visible only when it predates this history's fork
/// (branchPoint gate) AND this history holds no divergent slot for it (shadow). Visible inherited
/// children come first, then the own children (`[...inheritedVisible, ...here]`).
pub fn find_by_parent(
    root: &Path,
    history: &str,
    being_id: &str,
) -> Result<Vec<Json>, LineageError> {
    if being_id.is_empty() {
        return Ok(Vec::new());
    }
    let here = index::find_by_parent(root, history, being_id, "being");
    if is_main(history) {
        return Ok(here);
    }
    let parent = parent_or_main(root, history);
    let inherited_children = find_by_parent(root, &parent, being_id)?;
    let mut out: Vec<Json> = Vec::new();
    for o in inherited_children {
        let id = row_id(&o).to_string();
        if history_shadows(root, history, "being", &id) {
            continue;
        }
        if predates_fork(root, history, "being", &id)? {
            out.push(o);
        }
    }
    out.extend(here);
    Ok(out)
}

// ── list_by_type (cross-history, the recursive catalog walk) ─────────────────

/// listByType(type, history): the live ids of `type` in `history`'s effective view, as `[id]`.
///
/// Recursive into the parent chain (same model as find_by_name / find_by_parent), so nested histories
/// see their full lineage with per-level branchPoint gating + divergence shadowing. An inherited id is
/// kept only when it predates this history's fork AND is not shadowed by an own slot. Visible inherited
/// ids come first, then the own ids (`[...inheritedVisible, ...here]`). The JS materializes occupant rows
/// then maps back; we keep the id strings (the index.rs `list_by_type` shape) - the same membership +
/// order, just the lighter id projection the Rust read side already returns.
pub fn list_by_type(
    root: &Path,
    history: &str,
    kind: &str,
) -> Result<Vec<String>, LineageError> {
    let here = index::list_by_type(root, history, kind);
    if is_main(history) {
        return Ok(here);
    }
    let parent = parent_or_main(root, history);
    let inherited_all = list_by_type(root, &parent, kind)?;
    let mut out: Vec<String> = Vec::new();
    for id in inherited_all {
        if history_shadows(root, history, kind, &id) {
            continue;
        }
        if predates_fork(root, history, kind, &id)? {
            out.push(id);
        }
    }
    out.extend(here);
    Ok(out)
}
