// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// toolkit.rs — the COMMON substrate read + validation primitives the *Host.js resolver bodies REUSE.
// Each function ports ONE JS helper the hosts called, composing the past-engine crates (treeproj
// refold/find, treefold fold, treecas existence, treehash canonicalize/sha256) — it reimplements
// none of the find/fold/cas math, exactly as the JS hosts reimplemented none of loadTargetRow /
// findByName / assertCoordInBounds / hasContent.
//
//   load_row          loadTargetRow + loadOrFold: fold a (kind, id) reel into its row state.
//   name_unique       findByName (cross-history): is `name` free in `kind`'s per-history scope?
//   coord_in_bounds   assertCoordInBounds / assertMatterCoordInBounds: clamp a coord against the
//                     containing Space.size (THROW out-of-bounds; the chain stays honest).
//   cas_exists        hasContent: do the CAS bytes for this hash live in the store?
//   is_deleted        the DELETED sentinel ("deleted") check (soft-delete marker on parent/spaceId).
//   matter_content_id matterContentId: the content-addressed matter ROW id (sha256 of the birth spec).
//
// Plus the small Json readers the resolvers share. The DELETED sentinel value is "deleted", the SAME
// string heavenSpaces.js exports — the reducers fold parent/spaceId to it on a soft-delete.

use std::path::Path;

use treehash::{canonicalize, sha256_hex, Json};

use crate::HostError;

// ── the DELETED sentinel (heavenSpaces.js `export const DELETED = "deleted"`) ─────────────────────
/// Placed in `parent` and (for matter) `spaceId`/`beingId` when a space/matter is soft-deleted.
pub const DELETED: &str = "deleted";

/// True when a value IS the DELETED sentinel string.
pub fn is_deleted(v: &Json) -> bool {
    matches!(v, Json::Str(s) if s == DELETED)
}

// ── small Json readers (the resolvers + the toolkit share these) ──────────────────────────────────
pub fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
pub fn get_str<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}
pub fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
pub fn obj(fields: Vec<(&str, Json)>) -> Json {
    Json::Obj(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
/// JS `typeof v === "string" && v.length` — a non-empty string.
pub fn is_nonempty_str(v: &Json) -> bool {
    matches!(v, Json::Str(s) if !s.is_empty())
}
/// JS `typeof v === "object" && !Array.isArray(v)` (callers gate null first) — a plain object.
pub fn is_plain_object(v: &Json) -> bool {
    matches!(v, Json::Obj(_))
}
/// JS Number.isFinite over a Json number.
fn is_finite_num(v: &Json) -> Option<f64> {
    match v {
        Json::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

// ── load_row (loadTargetRow + loadOrFold) ──────────────────────────────────────────────────────────
/// Fold a (kind, id) reel into its row STATE — the JS `loadTargetRow(target, kind, ...)` which bottoms
/// out in `loadOrFold(kind, id, history)` (lineage cold-fold). We compose treeproj::refold (read the
/// reel through treestore, fold it through treefold, cache the .proj snapshot) and hand back the folded
/// `state` object. Returns `Json::Null` when the aggregate has NO facts on this history's reel (the JS
/// `loadOrFold` -> null for a never-touched aggregate). The state carries `_id` set to `id`, mirroring
/// the JS row's `_id` field the hosts read (`String(row._id)`).
///
/// (refold caches the snapshot; a hot path could later read load_snapshot first — the resolvers fold
/// fresh each call, the byte-correct read. The fold is pure, so two callers see the same row.)
pub fn load_row(root: &Path, history: &str, kind: &str, id: &str) -> Json {
    let facts = treestore::read_reel_file(root, history, kind, id, None, None);
    if facts.is_empty() {
        return Json::Null;
    }
    let state = treefold::fold(kind, &facts);
    // The reducers fold an empty object for a kind with no state-bearing facts; treat that as absent
    // too (the JS `loadOrFold` returns null when `Object.keys(state).length === 0`).
    if matches!(&state, Json::Obj(e) if e.is_empty()) {
        return Json::Null;
    }
    // Attach `_id` (the JS row shape carries it; the hosts read `String(row._id)`).
    match state {
        Json::Obj(mut e) => {
            e.retain(|(k, _)| k != "_id");
            e.push(("_id".to_string(), jstr(id)));
            Json::Obj(e)
        }
        other => other,
    }
}

// ── name_unique (findByName, cross-history) ─────────────────────────────────────────────────────────
/// Is `name` FREE for `kind` in `history`'s effective view? Ports the hosts' name-uniqueness gate
/// (`findByName(kind, value, history)` then `existing && String(existing.id) !== ownId`). Composes
/// treeproj::lineage::find_by_name (the cross-history walk: own-history index, then the branchPoint-
/// gated, shadow-respecting parent walk — the SAME inherited-name semantics the JS facade has).
///
/// `scope` carries the optional disambiguating fields a SCOPED kind keys on (space -> `parent`,
/// matter -> `spaceId` + `parentMatterId`); pass `Json::Null` (or an empty object) for a bare-name
/// being lookup. `exclude_id` is the row being renamed (its own name is not a collision) — pass the
/// being/space id for a set-name, or `None` at birth (no self yet).
///
/// Returns Ok(true) when free, Ok(false) when taken by a DIFFERENT id. A corrupt registry lineage
/// (a row missing partway up the parent chain) surfaces as HostError::Lineage (the JS BRANCH_NOT_FOUND).
pub fn name_unique(
    root: &Path,
    history: &str,
    kind: &str,
    name: &str,
    scope: &Json,
    exclude_id: Option<&str>,
) -> Result<bool, HostError> {
    if name.is_empty() {
        return Ok(true); // an empty name never collides (the JS `if (!name) return null`)
    }
    let scope_obj = match scope {
        Json::Obj(_) => scope.clone(),
        _ => Json::Obj(Vec::new()),
    };
    let existing = treeproj::lineage::find_by_name(root, history, kind, name, &scope_obj)
        .map_err(|e| HostError::lineage(format!("{e:?}")))?;
    match existing {
        None => Ok(true),
        Some(row) => {
            let id = get_str(&row, "id").unwrap_or("");
            // taken by a different aggregate => not unique; taken by myself => still free for me.
            Ok(Some(id) == exclude_id)
        }
    }
}

// ── coord_in_bounds (assertCoordInBounds / assertMatterCoordInBounds) ──────────────────────────────
/// The per-axis bounds CHECK against an already-resolved `size`, the ONE place the cell-vs-position
/// math lives (coordBounds.js assertCoordWithinSize). Two-way:
///   - an INTEGER coord is a 0-indexed CELL  -> valid [0, trunc(size)-1];
///   - a FLOAT coord is a continuous POSITION -> valid [0, size) (size - EPSILON upper edge).
/// Non-finite axes are skipped (callers gate shape upstream). `op` / `noun` label the refusal.
/// f64::EPSILON is the Rust twin of JS Number.EPSILON (both = 2^-52).
fn assert_coord_within_size(
    coord: &Json,
    size: &Json,
    op: &str,
    noun: &str,
) -> Result<(), HostError> {
    if matches!(size, Json::Null) {
        return Ok(());
    }
    for a in ["x", "y", "z"] {
        let v = match get(coord, a).and_then(is_finite_num) {
            Some(v) => v,
            None => continue, // non-finite / absent axis: skip (callers gate shape)
        };
        let cap = match get(size, a) {
            Some(Json::Num(n)) if *n > 0.0 => *n,
            _ => continue, // no positive cap on this axis -> unbounded
        };
        let high = if v.fract() == 0.0 {
            cap.trunc() - 1.0
        } else {
            cap - f64::EPSILON
        };
        if v < 0.0 || v > high {
            return Err(HostError::coord_out_of_bounds(op, a, v, high, noun));
        }
    }
    Ok(())
}

/// Public wrapper: bounds-check an ALREADY-resolved finite-axis coord object against a `size` object.
/// set-space's coord branch uses this directly (it builds the finite `out` itself, then bounds-checks
/// against the PARENT's size). `noun` labels the refusal ("the parent space").
pub fn assert_coord_within_size_pub(
    coord: &Json,
    size: &Json,
    op: &str,
    noun: &str,
) -> Result<(), HostError> {
    assert_coord_within_size(coord, size, op, noun)
}

/// Validate a being's coord write against its CONTAINING space size (being/ops.js
/// assertCoordInBounds): the space is `beingDoc.position || beingDoc.homeSpace`. A present-but-non-
/// finite axis is dropped (the being path's looser shape gate — it filters to finite-only BEFORE the
/// size check), an out-of-bounds finite axis THROWS. No space / no size -> any coord passes.
pub fn being_coord_in_bounds(
    root: &Path,
    history: &str,
    being_doc: &Json,
    raw: &Json,
) -> Result<(), HostError> {
    // Filter to the finite axes (the JS builds `out` finite-only, then size-checks `out`).
    let mut out: Vec<(String, Json)> = Vec::new();
    for a in ["x", "y", "z"] {
        if let Some(v) = get(raw, a).and_then(is_finite_num) {
            out.push((a.to_string(), Json::Num(v)));
        }
    }
    if out.is_empty() {
        return Ok(()); // nothing finite to check
    }
    let space_id = get_str(being_doc, "position")
        .filter(|s| !s.is_empty())
        .or_else(|| get_str(being_doc, "homeSpace").filter(|s| !s.is_empty()));
    let space_id = match space_id {
        Some(s) => s,
        None => return Ok(()), // no containing space -> nothing to enforce
    };
    let size = load_space_size(root, history, space_id);
    assert_coord_within_size(&Json::Obj(out), &size, "set-being", "space")
}

/// Validate a matter's coord write against its space size (coordBounds.js assertMatterCoordInBounds):
/// a present-but-non-finite axis is REFUSED (the stricter matter shape gate — a named-but-garbage axis
/// is the clamp-lie in another coat), an absent axis is a legit partial update (skip), an out-of-bounds
/// finite axis THROWS. `space_id` deleted / absent / no size -> the finite axes pass.
pub fn matter_coord_in_bounds(
    root: &Path,
    history: &str,
    space_id: Option<&str>,
    raw: &Json,
) -> Result<(), HostError> {
    let mut out: Vec<(String, Json)> = Vec::new();
    for a in ["x", "y", "z"] {
        let v = match get(raw, a) {
            None | Some(Json::Null) => continue, // axis not provided -> a legit partial update
            Some(v) => v,
        };
        match is_finite_num(v) {
            Some(n) => out.push((a.to_string(), Json::Num(n))),
            None => {
                // present-but-garbage: refuse rather than silently drop (the clamp-lie).
                return Err(HostError::invalid(format!(
                    "set-matter: coord.{a}={} must be a finite number",
                    canonicalize(v)
                )));
            }
        }
    }
    if out.is_empty() {
        return Ok(());
    }
    let space_id = match space_id.filter(|s| !s.is_empty() && *s != DELETED) {
        Some(s) => s,
        None => return Ok(()), // no space / deleted -> the finite axes pass (out is already validated)
    };
    let size = load_space_size(root, history, space_id);
    assert_coord_within_size(&Json::Obj(out), &size, "set-matter", "space")
}

/// Fold a space's reel and read its `size` field (the bound coord_in_bounds checks against), or
/// `Json::Null` when the space has no facts or no size. The JS `loadOrFold("space", id, history)`
/// then `slot.state?.size`.
pub fn load_space_size(root: &Path, history: &str, space_id: &str) -> Json {
    let row = load_row(root, history, "space", space_id);
    match get(&row, "size") {
        Some(s) => s.clone(),
        None => Json::Null,
    }
}

// ── cas_exists (contentStore.js hasContent) ─────────────────────────────────────────────────────────
/// Do the CAS bytes for `hash` live in the store? Ports the hosts' `hasContent(value.hash)` gate (a
/// fact must never reference bytes absent from the store). Composes treecas::has_content (the sharded
/// cas/<hash[0..2]>/<hash> existence check). A malformed hash (not /^[0-9a-f]{64}$/) returns false —
/// the JS `assertHash` throws, but to the gate "no such content" is the same refusal (the caller maps
/// it to the unknown-content-hash error).
pub fn cas_exists(root: &Path, hash: &str) -> bool {
    matches!(treecas::has_content(root, hash), Ok(true))
}

/// Is this value a canonical cas content ref `{ kind:"cas", hash:<64-hex> }`? (contentStore.js isCasRef.)
pub fn is_cas_ref(v: &Json) -> bool {
    matches!(get(v, "kind"), Some(Json::Str(s)) if s == "cas")
        && matches!(get(v, "hash"), Some(Json::Str(h)) if is_content_hash(h))
}

/// /^[0-9a-f]{64}$/ — the content-hash shape (contentStore.js isContentHash).
fn is_content_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

// ── matter_content_id (matterId.js matterContentId) ─────────────────────────────────────────────────
/// The content-addressed matter ROW id: sha256 of the canonicalized birth IDENTITY (matterId.js). Only
/// the identity-defining fields enter the hash (the self is never inside its own hash — the same
/// self-reference-free recipe facts use). Byte-identical to the JS: same field set, same defaults
/// (`type` -> "generic", `qualities` -> {}), same canonical JSON (treehash::canonicalize == the JS
/// canonicalize), same sha256-hex.
pub fn matter_content_id(spec: &Json) -> String {
    let pick = |k: &str, default: Json| get(spec, k).cloned().unwrap_or(default);
    let identity = obj(vec![
        ("spaceId", nullish(spec, "spaceId")),
        ("parentMatterId", nullish(spec, "parentMatterId")),
        ("name", nullish(spec, "name")),
        ("type", string_or(pick("type", Json::Null), "generic")),
        ("content", nullish(spec, "content")),
        ("coord", nullish(spec, "coord")),
        ("beingId", nullish(spec, "beingId")),
        ("qualities", object_or(pick("qualities", Json::Null))),
    ]);
    sha256_hex(canonicalize(&identity).as_bytes())
}

// ── being_content_id (beingId.js beingContentId) ────────────────────────────────────────────────────
/// The content-addressed being ROW id: sha256 of the canonicalized BIRTH IDENTITY (beingId.js). A being
/// is not "content" the way matter is — almost everything about it is mutable after birth (set-being /
/// be:rename rewrite the row) — so the id is NOT the live attributes; it is the IMMUTABLE BIRTH EVENT.
/// Only four fields enter the hash, the SAME self-reference-free recipe matter_content_id uses (the self
/// is never inside its own hash). Byte-identical to the JS: same field set + order
/// (parentBeingId, name, homeHistory, bornAt), same `?? null` defaults, same treehash::canonicalize, same
/// sha256-hex. `bornAt` (the be:birth act id) is what makes each birth UNIQUE — a being is a distinct
/// presence per birth, so the birth moment enters the hash (matter dedups identical content to one row;
/// a being does not).
pub fn being_content_id(spec: &Json) -> String {
    let identity = obj(vec![
        ("parentBeingId", nullish(spec, "parentBeingId")),
        ("name", nullish(spec, "name")),
        ("homeHistory", nullish(spec, "homeHistory")),
        ("bornAt", nullish(spec, "bornAt")),
    ]);
    sha256_hex(canonicalize(&identity).as_bytes())
}

/// JS `spec.k ?? null` — present (non-null) value, else Json::Null. (`??` keeps `false`/`0`/`""`.)
fn nullish(spec: &Json, k: &str) -> Json {
    match get(spec, k) {
        Some(Json::Null) | None => Json::Null,
        Some(v) => v.clone(),
    }
}
/// JS `v ?? default` for a string default (`type: spec.type ?? "generic"`).
fn string_or(v: Json, default: &str) -> Json {
    match v {
        Json::Null => jstr(default),
        other => other,
    }
}
/// JS `v ?? {}` (`qualities: spec.qualities ?? {}`).
fn object_or(v: Json) -> Json {
    match v {
        Json::Null => Json::Obj(Vec::new()),
        other => other,
    }
}

// ── the Name catalog (loadProjection("name", ...) -> the library names entry) ────────────────────────
// A Name has NO reel of its own: its identity facts (declare / banish / connect / ...) fold into the
// LIBRARY catalog (`library.names[nameId]`), story-global on history "0" (the SAME redirect
// projections.js `loadNameSlot` makes — fold the library, read `state.names[nameId]`). The bridge
// composes treestore (read the library reel) + treefold (fold "library") and reads the entry. There is
// one library reel per story, keyed by the story domain; the bridge discovers it on disk (the resolvers
// carry no domain), folding ALL library reels into one names view (a store holds one story's library).

/// The story-domain ids of the `library` reels present on history "0" (one per story; normally one).
/// Discovered from `reels/0/library/<shard>/<id>.reel` on disk so the bridge needs no domain input.
fn library_reel_ids(root: &Path) -> Vec<String> {
    let mut ids = Vec::new();
    let lib_dir = root.join("reels").join("0").join("library");
    let shards = match std::fs::read_dir(&lib_dir) {
        Ok(d) => d,
        Err(_) => return ids,
    };
    for shard in shards.flatten() {
        if let Ok(reels) = std::fs::read_dir(shard.path()) {
            for r in reels.flatten() {
                if let Some(name) = r.file_name().to_str() {
                    if let Some(id) = name.strip_suffix(".reel") {
                        ids.push(id.to_string());
                    }
                }
            }
        }
    }
    ids
}

/// The folded `names` catalog (union across the store's library reels — normally one), as a Json obj.
/// `library.names[nameId]` is each Name's identity entry (declare/banish folded). Empty when no library.
fn library_names(root: &Path) -> Json {
    let mut names: Vec<(String, Json)> = Vec::new();
    for domain in library_reel_ids(root) {
        let facts = treestore::read_reel_file(root, "0", "library", &domain, None, None);
        if facts.is_empty() {
            continue;
        }
        let state = treefold::fold("library", &facts);
        if let Some(Json::Obj(entries)) = get(&state, "names") {
            for (k, v) in entries {
                match names.iter_mut().find(|(kk, _)| kk == k) {
                    Some(slot) => slot.1 = v.clone(),
                    None => names.push((k.clone(), v.clone())),
                }
            }
        }
    }
    Json::Obj(names)
}

/// The catalog entry for `name_id` (`library.names[nameId]`), or `Json::Null` when the Name is not
/// declared on this story. The peer of `loadProjection("name", id)` `slot.state`.
pub fn load_name_entry(root: &Path, name_id: &str) -> Json {
    let names = library_names(root);
    get(&names, name_id).cloned().unwrap_or(Json::Null)
}

/// Is `name_id` a DECLARED Name on this story (an entry exists in the library catalog)? The grant-
/// inheritation / truename "is a declared Name" gate (`nameSlot?.state` truthy). I is always declared
/// (the story root). (name/registry.js: "i-am" / "I" are the literal root id.)
pub fn name_declared(root: &Path, name_id: &str) -> bool {
    if is_i_name(name_id) {
        return true;
    }
    !matches!(load_name_entry(root, name_id), Json::Null)
}

/// Is `name_id` BANISHED (the catalog entry's `closed` is true)? The grant-inheritation / truename
/// "is banished" gate (closure.js isNameBanished: `slot.state.closed`). I is NEVER banished (it would
/// brick the story — the JS short-circuits).
pub fn name_banished(root: &Path, name_id: &str) -> bool {
    if name_id.is_empty() || is_i_name(name_id) {
        return false;
    }
    matches!(get(&load_name_entry(root, name_id), "closed"), Some(Json::Bool(true)))
}

/// The genesis I-name set (seedBeings.js `I = "i-am"`; the universal-authority root). The JS gates key
/// on `name === I || name === "i-am" || name === "I"`.
pub fn is_i_name(name_id: &str) -> bool {
    name_id == "i-am" || name_id == "I"
}

// ── has_authority_over (inheritation.js hasAuthorityOver) ────────────────────────────────────────────
// The being-tree carries DOWNWARD authority: a Name has authority over a position when it OWNS
// (trueName) or holds a live INHERITATION POINT (latest grant-vs-revoke by seq) at the position OR any
// ancestor on the walk up to the root (via parentBeingId). I covers everything. The bridge composes
// treestore (the grant/revoke facts on the POSITION being's reel — they ride `of.id = position`) +
// load_row (the folded parentBeingId / trueName per node). The point facts are read on the act's
// history reel (the own-history read the JS `livePointsAt` itself falls back to when called without a
// resolved lineage; the cross-history lineage union is the deferred refinement).

const MAX_TREE_DEPTH: usize = 256; // the JS cycle/runaway guard for the upward walk.

/// Does `name_id` have authority over the being at `position`? I -> always; owner of the being or any
/// ancestor -> yes; a live inheritation point at the being or any ancestor -> yes; else no. Mirrors
/// inheritation.js hasAuthorityOver (short-circuits on the first covering anchor).
pub fn has_authority_over(root: &Path, history: &str, name_id: &str, position: &str) -> bool {
    if name_id.is_empty() || position.is_empty() {
        return false;
    }
    if is_i_name(name_id) {
        return true; // I: universal authority on its own story.
    }
    let mut id = position.to_string();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for _ in 0..MAX_TREE_DEPTH {
        if id.is_empty() || seen.contains(&id) {
            break;
        }
        seen.insert(id.clone());
        let row = load_row(root, history, "being", &id);
        if matches!(row, Json::Null) {
            break;
        }
        // ownership anchor: this node's trueName.
        if get_str(&row, "trueName") == Some(name_id) {
            return true;
        }
        // delegation anchor: a live inheritation point naming `name_id` at this node.
        if live_point_at(root, history, &id, name_id) {
            return true;
        }
        id = match get_str(&row, "parentBeingId").filter(|s| !s.is_empty()) {
            Some(p) => p.to_string(),
            None => break,
        };
    }
    false
}

/// Is there a LIVE inheritation point for `name_id` at EXACTLY this being-tree position? Live = the
/// latest `grant-inheritation` naming it outranks (by seq) the latest `revoke-inheritation` naming it
/// (the attach/detach latest-of-two pattern, ordered by chain seq never the clock). Both facts ride the
/// POSITION being's reel (`of.id = position`), carrying the granted Name in `params.name`.
fn live_point_at(root: &Path, history: &str, position: &str, name_id: &str) -> bool {
    let facts = treestore::read_reel_file(root, history, "being", position, None, None);
    let mut last_grant: Option<f64> = None;
    let mut last_revoke: Option<f64> = None;
    for f in &facts {
        let act = get_str(f, "act").unwrap_or("");
        if act != "grant-inheritation" && act != "revoke-inheritation" {
            continue;
        }
        if get_str(f, "verb") != Some("do") {
            continue;
        }
        let named = get(f, "params").and_then(|p| get_str(p, "name")).unwrap_or("");
        if named != name_id {
            continue;
        }
        let seq = match get(f, "seq") {
            Some(Json::Num(n)) => *n,
            _ => continue,
        };
        if act == "grant-inheritation" {
            last_grant = Some(last_grant.map_or(seq, |g| g.max(seq)));
        } else {
            last_revoke = Some(last_revoke.map_or(seq, |r| r.max(seq)));
        }
    }
    match (last_grant, last_revoke) {
        (Some(g), Some(r)) => g > r,
        (Some(_), None) => true,
        _ => false,
    }
}

// ── find_matter_by_content_hash (projections.js findMatterByContentHash) ─────────────────────────────
/// Other LIVE matter (any live history) whose CURRENT folded `content` is the cas ref with this `hash`,
/// excluding `exclude_id` — the purge shared-fate refcount (dedup means identical bytes are ONE blob;
/// purging blinds every referent). Returns `[(matterId, history)]`. Composes treeproj::list_by_type
/// (the live ids per history) + load_row (the folded content) over the live-history set
/// (treestore::list_live_histories), the file-native peer of `Projection.find({content.hash})`.
pub fn find_matter_by_content_hash(
    root: &Path,
    hash: &str,
    exclude_id: &str,
) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    if hash.is_empty() {
        return out;
    }
    let mut histories = treestore::list_live_histories(root);
    if !histories.iter().any(|h| h == "0") {
        histories.push("0".to_string()); // main is always live (it may have no History row).
    }
    for h in histories {
        for id in treeproj::list_by_type(root, &h, "matter") {
            if id == exclude_id {
                continue;
            }
            let row = load_row(root, &h, "matter", &id);
            if matches!(row, Json::Null) {
                continue;
            }
            if let Some(content) = get(&row, "content") {
                if is_cas_ref(content) && get_str(content, "hash") == Some(hash) {
                    out.push((id, h.clone()));
                }
            }
        }
    }
    out
}

/// findByName for a being/space (cross-history), returning the matched id or None. The cherub kill /
/// truename `resolve-target-being` read (the same find_by_name the JS branch called). `scope` is empty
/// for a bare-name being lookup.
pub fn find_name_id(root: &Path, history: &str, kind: &str, name: &str) -> Option<String> {
    let scope = Json::Obj(Vec::new());
    match treeproj::lineage::find_by_name(root, history, kind, name, &scope) {
        Ok(Some(row)) => get_str(&row, "id").map(|s| s.to_string()),
        _ => None,
    }
}

// ── the space owner reads (members.js getSpaceOwner + spaces.js resolveRootSpace) ───────────────────
/// getSpaceOwner: a space row's `owner` as a non-empty string, else None.
pub fn space_owner(space: &Json) -> Option<String> {
    get_str(space, "owner").filter(|s| !s.is_empty()).map(|s| s.to_string())
}

/// The owner of a space's ROOT (spaces.js resolveRootSpace): walk the parent chain on history "0"
/// (where ownership lives) until a space carries a NON-I owner; that owner is the tree owner. The
/// `source` heaven space + the reality root `/` (heavenSpace "space-root") are valid owner-bearing
/// roots; any OTHER heaven boundary -> None (the JS throw collapses to "no owner" for the bridge's
/// read). Returns None when the tree is owned only by I up to a real boundary / top-level. The owner
/// gates (purge-content's root-owner, set/remove-owner's parent-owner) share this.
pub fn resolve_root_owner(root: &Path, space_id: &str) -> Option<String> {
    let mut id = space_id.to_string();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    loop {
        if id.is_empty() || seen.contains(&id) {
            return None;
        }
        seen.insert(id.clone());
        let space = load_row(root, "0", "space", &id);
        if matches!(space, Json::Null) {
            return None;
        }
        if get_str(&space, "heavenSpace") == Some("source") {
            return space_owner(&space); // the source root is its own boundary.
        }
        if let Some(owner) = space_owner(&space) {
            if !is_i_name(&owner) {
                return Some(owner); // a real owner ends the walk.
            }
        }
        match get_str(&space, "parent").filter(|s| !s.is_empty() && *s != DELETED) {
            Some(parent) => {
                let parent_space = load_row(root, "0", "space", parent);
                if let Some(h) = get_str(&parent_space, "heavenSpace") {
                    if h == "source" || h == "space-root" {
                        return space_owner(&parent_space);
                    }
                    return None; // a true heaven boundary -> no owner.
                }
                id = parent.to_string();
            }
            None => return None, // top-level with no owner.
        }
    }
}

// ── story_root_id (sprout.js getSpaceRootId) ─────────────────────────────────────────────────────────
/// The STORY ROOT space id — the reality root `/` (the heaven space `heavenSpace === "space-root"`).
/// The JS keeps `getSpaceRootId()` in process memory (planted at genesis); the bridge discovers it on
/// disk by folding history-"0" space reels and finding the one whose `heavenSpace` is "space-root". The
/// world-signal write lands on this space's qualities.world.<ns>.<key>. Returns None when not planted
/// (the `.word` refuses INTERNAL on absence).
pub fn story_root_id(root: &Path) -> Option<String> {
    for id in treeproj::list_by_type(root, "0", "space") {
        let row = load_row(root, "0", "space", &id);
        if get_str(&row, "heavenSpace") == Some("space-root") {
            return Some(id);
        }
    }
    None
}

// ── heaven-space discovery (projections.js findByHeavenSpace, on-disk) ───────────────────────────────
/// The id of the heaven space whose `heavenSpace` marker is `kind` (e.g. "histories" / "ables"), or
/// None when it is not planted. Heaven NEVER branches, so heaven spaces live on MAIN ("0") only (the JS
/// findHeavenSpace pins to "0"); the bridge discovers it on disk by folding the history-"0" space reels
/// (the SAME index-free scan story_root_id makes), staying independent of the maintained heavenSpace
/// index. This is the peer of `findByHeavenSpace(kind, "0")` / `findPointersSpaceId()`.
pub fn heaven_space_id(root: &Path, kind: &str) -> Option<String> {
    for id in treeproj::list_by_type(root, "0", "space") {
        let row = load_row(root, "0", "space", &id);
        if get_str(&row, "heavenSpace") == Some(kind) {
            return Some(id);
        }
    }
    None
}

/// The folded `qualities` object of the heaven space whose marker is `kind`, paired with its id, or
/// None when the space is not planted. Composes heaven_space_id + load_row, reading the heaven space's
/// state directly (the JS readPointers reads `proj.state.qualities`). Returns `(id, qualities)` where
/// `qualities` is the folded object (Json::Null when the space has no qualities namespace).
pub fn heaven_space_qualities(root: &Path, kind: &str) -> Option<(String, Json)> {
    let id = heaven_space_id(root, kind)?;
    let row = load_row(root, "0", "space", &id);
    let quals = get(&row, "qualities").cloned().unwrap_or(Json::Null);
    Some((id, quals))
}

/// The live matter NAMES in one (space, parentMatter) FOLDER (projections.js listMatterNamesInFolder):
/// scan the history's live matter ids (cross-history), keep those whose folded (spaceId, parentMatterId)
/// matches. Composes treeproj::list_by_type + load_row. The rename-matter uniqueness gate + the
/// makematter generated-name floor share this scan.
pub fn folder_matter_names(
    root: &Path,
    history: &str,
    space_id: Option<&str>,
    parent_matter_id: Option<&str>,
) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    let want_space = space_id.unwrap_or("");
    let want_parent = parent_matter_id.unwrap_or("");
    for id in treeproj::list_by_type(root, history, "matter") {
        let row = load_row(root, history, "matter", &id);
        if matches!(row, Json::Null) {
            continue;
        }
        if get_str(&row, "spaceId").unwrap_or("") != want_space {
            continue;
        }
        if get_str(&row, "parentMatterId").unwrap_or("") != want_parent {
            continue;
        }
        if let Some(name) = get_str(&row, "name") {
            out.insert(name.to_string());
        }
    }
    out
}
