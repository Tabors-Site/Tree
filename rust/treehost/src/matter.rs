// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// matter.rs — the two matter host see-ops, ported native:
//
//   resolve-set-matter-spec  (setMatterHost.js): load the matter row, route on `field`, run the reads
//       that can't be native Word (CAS-content existence via isCasRef + hasContent, the DELETED-
//       sentinel comparisons for spaceId/beingId, COORD-BOUNDS against the matter's space size), and
//       return { matterId, factParams } — the canonical do:set-matter fact shape.
//   resolve-birth-spec       (matterHost.js resolveBirthSpec): parent-matter spaceId inheritance, the
//       matter-TYPE-registry gate (getMatterType + typeAllowsContentKind + typeAllowsMime, which THROW
//       on a bad type/kind/mime), the unique-name floor, the coord-bounds clamp, and the content-
//       addressed row id (matterContentId). Returns { enrichedSpec, matterId, spaceId, parentMatterId }.
//
// Each lays NO fact; a HostError IS the .word's refusal. Byte-compatible with the JS host's block.

use std::path::Path;

use treehash::Json;

use crate::being::{branch_or, js_typeof, target_id_of};
use crate::toolkit::{
    cas_exists, folder_matter_names, get, get_str, is_cas_ref, is_deleted, is_nonempty_str,
    is_plain_object, jstr, load_row, matter_coord_in_bounds, matter_content_id, obj,
};
use crate::{arg, AuthCtx, HostError};

const RESERVED_SET_META_NS: &[&str] = &[]; // empty today; kept for symmetry with space/being

// ── the matter TYPE registry (types.js — the four seed basic types + the executable ones) ───────────
/// A seed matter type's content-kind + mime allowlist. The JS registry resolves from the word-fold;
/// the bridge carries the SEED basic set (the kernel-bound floor types.js ships). An extension type
/// (`ext:name`) is unknown to the bridge -> the type gate refuses (the JS resolves it from the fold,
/// the deferred refinement); the SHAPE of the gate is what create-matter needs.
struct MatterType {
    name: &'static str,
    content_kinds: &'static [&'static str],
    mime_types: Option<&'static [&'static str]>,
}

const SEED_TYPES: &[MatterType] = &[
    MatterType { name: "generic", content_kinds: &["text", "none"], mime_types: None },
    MatterType { name: "file", content_kinds: &["binary", "text"], mime_types: None },
    MatterType { name: "http", content_kinds: &["none"], mime_types: None },
    MatterType {
        name: "model",
        content_kinds: &["binary"],
        mime_types: Some(&["model/gltf-binary", "model/gltf+json", "application/octet-stream"]),
    },
    MatterType { name: "source", content_kinds: &["text", "binary", "none"], mime_types: None },
    MatterType { name: "ibpa", content_kinds: &["none"], mime_types: None },
    MatterType { name: "connection", content_kinds: &["none"], mime_types: None },
    MatterType { name: "wasm", content_kinds: &["binary"], mime_types: Some(&["application/wasm"]) },
    MatterType { name: "js", content_kinds: &["text"], mime_types: None },
];

fn get_matter_type(name: &str) -> Option<&'static MatterType> {
    SEED_TYPES.iter().find(|t| t.name == name)
}
/// Is `name` a KNOWN seed matter type? (the JS `getMatterType(name)` truthiness gate, shared by
/// model.rs's `resolve-model-block` forMatterType check — the SAME deferral create-matter makes for
/// an `ext:<type>` unknown to the bridge.)
pub(crate) fn type_known(name: &str) -> bool {
    get_matter_type(name).is_some()
}
/// typeAllowsContentKind: may matter of this type carry this kind of content?
fn type_allows_content_kind(t: &MatterType, kind: &str) -> bool {
    t.content_kinds.contains(&kind)
}
/// typeAllowsMime: does the type's mime allowlist (if any) admit this mimeType? (exact or `pre/*`.)
fn type_allows_mime(t: &MatterType, mime: Option<&str>) -> bool {
    let list = match t.mime_types {
        None => return true, // no allowlist -> anything
        Some(l) if l.is_empty() => return true,
        Some(l) => l,
    };
    let bare = match mime {
        Some(m) if !m.is_empty() => m.split(';').next().unwrap_or("").trim().to_lowercase(),
        _ => return false,
    };
    for pat in list {
        let p = pat.to_lowercase();
        if p == bare {
            return true;
        }
        if let Some(prefix) = p.strip_suffix("/*") {
            if bare.starts_with(&format!("{prefix}/")) {
                return true;
            }
        }
    }
    false
}

// ── resolve-set-matter-spec ─────────────────────────────────────────────────────────────────────────
/// resolve-set-matter-spec(target, field, value, merge, branch) -> { matterId, factParams }.
pub fn resolve_set_matter_spec(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
    let field = arg(args, 1);
    let value = arg(args, 2);
    let merge = arg(args, 3);
    let branch = arg(args, 4);

    let field = match field {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        _ => return Err(HostError::invalid("set-matter: `field` is required")),
    };
    let history = branch_or(branch, history);
    let matter_id_target = target_id_of(target);
    let row = load_row(root, &history, "matter", &matter_id_target);
    let matter_id = get_str(&row, "_id").unwrap_or(&matter_id_target).to_string();

    let block = |extra: Vec<(&str, Json)>| -> Json {
        let mut fp: Vec<(&str, Json)> = vec![("field", jstr(field))];
        if !extra.iter().any(|(k, _)| *k == "value") {
            fp.push(("value", value.clone()));
        }
        for (k, v) in extra {
            fp.push((k, v));
        }
        if !matches!(merge, Json::Null) {
            fp.push(("merge", merge.clone()));
        }
        obj(vec![("matterId", jstr(&matter_id)), ("factParams", obj(fp))])
    };

    // ── qualities paths ────────────────────────────────────
    if let Some(rest) = field.strip_prefix("qualities.") {
        let namespace = rest.split('.').next().unwrap_or("");
        if RESERVED_SET_META_NS.contains(&namespace) {
            return Err(HostError::invalid(format!(
                "set-matter: qualities namespace \"{namespace}\" is not writable through set-matter; it has a dedicated verb."
            )));
        }
        if !rest.contains('.') && !matches!(value, Json::Null) && !is_plain_object(value) && !matches!(value, Json::Arr(_)) {
            return Err(HostError::invalid(
                "set-matter: qualities-namespace value must be an object",
            ));
        }
        return Ok(block(vec![]));
    }

    // ── schema-field writes ────────────────────────────────
    match field {
        "name" => {
            if !is_nonempty_str(value) {
                return Err(HostError::invalid(
                    "set-matter: `value` must be a string for field=name",
                ));
            }
            Ok(block(vec![]))
        }
        // content: a CAS ref the caller already put into the store, or null. The host verifies the hash
        // actually lives in the store so a fact never references missing bytes.
        "content" => {
            if matches!(value, Json::Null) {
                return Ok(block(vec![]));
            }
            if !is_cas_ref(value) {
                return Err(HostError::invalid(
                    "set-matter: content value must be a CAS ref ({kind:\"cas\", hash, ...}) or null",
                ));
            }
            let hash = get_str(value, "hash").unwrap_or("");
            if !cas_exists(root, hash) {
                return Err(HostError::unknown_content("set-matter", hash));
            }
            Ok(block(vec![]))
        }
        // spaceId: a bare space-id (transfer) or the DELETED sentinel (soft-delete).
        "spaceId" => {
            if is_deleted(value) {
                return Ok(block(vec![]));
            }
            if !is_nonempty_str(value) {
                return Err(HostError::invalid(format!(
                    "set-matter: spaceId must be a space id string or the DELETED sentinel . got {}",
                    js_typeof(value)
                )));
            }
            Ok(block(vec![]))
        }
        // beingId: ONLY the DELETED sentinel through set-matter (the creator is fixed at birth).
        "beingId" => {
            if is_deleted(value) {
                return Ok(block(vec![]));
            }
            Err(HostError::invalid(
                "set-matter: beingId only accepts the DELETED sentinel through set-matter; the creator is fixed at birth",
            ))
        }
        // coord: `{x,y,z?}` checked against Space.size (THROW out-of-bounds). The recorded fact carries
        // the caller's ORIGINAL value.
        "coord" => {
            if matches!(value, Json::Null) {
                return Ok(block(vec![("value", Json::Null)]));
            }
            if !is_plain_object(value) {
                return Err(HostError::invalid(
                    "set-matter: `coord` value must be an object {x,y,z?} or null",
                ));
            }
            let space_id = get_str(&row, "spaceId");
            matter_coord_in_bounds(root, &history, space_id, value)?;
            Ok(block(vec![]))
        }
        other => Err(HostError::invalid(format!(
            "set-matter: unknown field \"{other}\". Supported: name, content, spaceId, beingId, coord, qualities.<namespace>[.<innerKey>]"
        ))),
    }
}

// ── resolve-birth-spec (create-matter) ──────────────────────────────────────────────────────────────
/// resolve-birth-spec(target, targetKind, params, caller, branch) -> { enrichedSpec, matterId, spaceId,
/// parentMatterId }. The substrate compute matterHost.js ran: parent-matter spaceId inheritance, the
/// type-registry gate (THROW on unknown type / disallowed content-kind / disallowed mime), the name
/// floor, the coord-bounds clamp, and the content-addressed matterId mint. Content is NOT put into the
/// CAS here (that is the caller's host I/O); a `{kind:"cas"}` ref is verified to EXIST.
pub fn resolve_create_matter(
    root: &Path,
    history: &str,
    args: &[Json],
    ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
    let target_kind = arg(args, 1);
    let params = arg(args, 2);
    let branch = arg(args, 4);
    let history = branch_or(branch, history);

    let caller = ctx
        .actor_being_id
        .clone()
        .or_else(|| get_str(params, "beingId").map(|s| s.to_string()));
    let caller = match caller {
        Some(c) if !c.is_empty() => c,
        _ => {
            return Err(HostError::unauthorized(
                "create-matter requires an identified actor",
            ))
        }
    };

    let kind = match target_kind {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        _ => detect_target_kind(target),
    };

    // parentMatterId: a matter target IS the parent; else explicit spec.parentMatterId.
    let parent_matter_id = if kind == "matter" {
        let id = target_id_of(target);
        if id.is_empty() { None } else { Some(id) }
    } else {
        get_str(params, "parentMatterId").map(|s| s.to_string())
    };

    // spaceId: a space target IS the space; a matter target inherits its parent's space (gated load);
    // else explicit spec.spaceId.
    let mut space_id: Option<String> = if kind == "space" {
        let id = target_id_of(target);
        if id.is_empty() { None } else { Some(id) }
    } else {
        get_str(params, "spaceId").map(|s| s.to_string())
    };
    if space_id.is_none() {
        if let Some(pmid) = &parent_matter_id {
            let parent_row = load_row(root, &history, "matter", pmid);
            space_id = get_str(&parent_row, "spaceId").map(|s| s.to_string());
        }
    }

    let raw_content = get(params, "content").cloned().unwrap_or(Json::Null);

    // Matter TYPE: explicit when given, else CLASSIFIED from the content's signals (the bridge's
    // classifier floor: text -> generic, a cas ref -> file, a url ref -> http, else generic). The
    // registry gate below still enforces the result.
    let explicit_type = match get(params, "type") {
        Some(Json::Str(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    };
    let matter_type = explicit_type.unwrap_or_else(|| classify_matter(&raw_content, params));

    let type_def = match get_matter_type(&matter_type) {
        Some(t) => t,
        None => return Err(HostError::unknown_type(&matter_type)),
    };

    // Content through the type gate, shape-driven (the JS putContent/hasContent + kind/mime checks).
    // Strings would hash IN (a put — caller I/O); the bridge VALIDATES the type allows text and leaves
    // the put to the caller (it returns the raw string as content; the caller's host emit puts it). A
    // {kind:"cas"} ref is verified to exist + kind/mime-gated. A reference object / null gate on "none".
    let content = raw_content.clone();
    match &content {
        Json::Str(_) => {
            if !type_allows_content_kind(type_def, "text") {
                return Err(HostError::invalid(format!(
                    "create-matter: matter type \"{matter_type}\" does not carry text content"
                )));
            }
        }
        v if is_cas_ref(v) => {
            let hash = get_str(v, "hash").unwrap_or("");
            if !cas_exists(root, hash) {
                return Err(HostError::unknown_content("create-matter", hash));
            }
            let kind_of = match get_str(v, "encoding") {
                Some("utf8") => "text",
                _ => "binary",
            };
            if !type_allows_content_kind(type_def, kind_of) {
                return Err(HostError::invalid(format!(
                    "create-matter: matter type \"{matter_type}\" does not carry {kind_of} content"
                )));
            }
            if !type_allows_mime(type_def, get_str(v, "mimeType")) {
                return Err(HostError::invalid(format!(
                    "create-matter: MIME \"{}\" is not allowed for matter type \"{matter_type}\"",
                    get_str(v, "mimeType").unwrap_or("")
                )));
            }
        }
        Json::Obj(_) | Json::Arr(_) => {
            if !type_allows_content_kind(type_def, "none") {
                return Err(HostError::invalid(format!(
                    "create-matter: matter type \"{matter_type}\" does not carry reference content"
                )));
            }
        }
        Json::Null => {
            if !type_allows_content_kind(type_def, "none") {
                return Err(HostError::invalid(format!(
                    "create-matter: matter type \"{matter_type}\" requires content"
                )));
            }
        }
        _ => {
            return Err(HostError::invalid(
                "create-matter: content must be a string, a cas content ref, a reference object, or null",
            ))
        }
    }

    // Name: explicit -> the carried filename -> a generated `<type><n>` unique in the folder.
    let name = resolve_matter_name(
        root,
        &history,
        get(params, "name"),
        &content,
        &matter_type,
        space_id.as_deref(),
        parent_matter_id.as_deref(),
    );

    // Coord at birth: validated against the destination space's size (THROW out-of-bounds).
    let coord = match get(params, "coord") {
        Some(c) if is_plain_object(c) => {
            matter_coord_in_bounds(root, &history, space_id.as_deref(), c)?;
            Some(c.clone())
        }
        _ => None,
    };

    // Build the enriched spec (the do:create-matter fact's params). Drop stray coord/origin; re-add the
    // validated coord only.
    let mut enriched: Vec<(String, Json)> = match params {
        Json::Obj(e) => e.iter().filter(|(k, _)| k != "coord" && k != "origin").cloned().collect(),
        _ => Vec::new(),
    };
    set_field(&mut enriched, "name", jstr(&name));
    set_field(&mut enriched, "spaceId", opt_str(&space_id));
    set_field(&mut enriched, "parentMatterId", opt_str(&parent_matter_id));
    set_field(&mut enriched, "beingId", jstr(&caller));
    set_field(&mut enriched, "type", jstr(&matter_type));
    set_field(&mut enriched, "content", content.clone());
    if let Some(c) = coord {
        if !matches!(&c, Json::Obj(e) if e.is_empty()) {
            set_field(&mut enriched, "coord", c);
        }
    }
    let enriched_spec = Json::Obj(enriched);

    // Content-addressed id from the finalized spec (the self is never inside its own hash).
    let matter_id = matter_content_id(&enriched_spec);

    Ok(obj(vec![
        ("enrichedSpec", enriched_spec),
        ("matterId", jstr(&matter_id)),
        ("spaceId", opt_str(&space_id)),
        ("parentMatterId", opt_str(&parent_matter_id)),
    ]))
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
/// detectTargetKind: a `{ kind }` target -> its kind; a bare string id -> "matter" (the set-matter /
/// create-matter default target). (_targetShape.js detectTargetKind, the matter-side default.)
fn detect_target_kind(target: &Json) -> &str {
    match get_str(target, "kind") {
        Some(k) if !k.is_empty() => k,
        _ => "matter",
    }
}

/// classifyMatter floor: text -> generic, a cas ref -> file, a `{url}` ref -> http, else generic.
/// (The JS classifier weighs richer signals from the type registry's `claims`; the bridge carries the
/// content-shape floor — the same answer for the common shapes; the registry gate enforces it either way.)
fn classify_matter(content: &Json, _params: &Json) -> String {
    match content {
        Json::Str(_) => "generic".to_string(),
        v if is_cas_ref(v) => "file".to_string(),
        Json::Obj(_) if matches!(get(content, "url"), Some(Json::Str(_))) => "http".to_string(),
        _ => "generic".to_string(),
    }
}

/// resolveMatterName floor: explicit name -> the cas ref's `name` -> a generated `<type>1` (the bridge
/// mints the first free index by scanning the folder's matter names; the JS does the same bounded scan).
fn resolve_matter_name(
    root: &Path,
    history: &str,
    explicit: Option<&Json>,
    content: &Json,
    matter_type: &str,
    space_id: Option<&str>,
    parent_matter_id: Option<&str>,
) -> String {
    if let Some(Json::Str(s)) = explicit {
        if !s.is_empty() {
            return s.clone();
        }
    }
    if is_cas_ref(content) {
        if let Some(n) = get_str(content, "name").filter(|s| !s.is_empty()) {
            return n.to_string();
        }
    }
    // Generated `<type><n>`: scan the folder's live matter names for the lowest free index.
    let existing = folder_matter_names(root, history, space_id, parent_matter_id);
    let mut n = 1;
    loop {
        let candidate = format!("{matter_type}{n}");
        if !existing.contains(&candidate) {
            return candidate;
        }
        n += 1;
        if n > 100_000 {
            return format!("{matter_type}{n}"); // guard
        }
    }
}

/// An Option<String> as a Json string, or Json::Null when None/empty — the JS `... || null`. The
/// DELETED sentinel is a real value (a soft-deleted matter's spaceId), so it rides through.
fn opt_str(v: &Option<String>) -> Json {
    match v {
        Some(s) if !s.is_empty() => jstr(s),
        _ => Json::Null,
    }
}

/// `{ ...obj, key: val }` over an owned entry vec (append if absent).
fn set_field(e: &mut Vec<(String, Json)>, key: &str, val: Json) {
    match e.iter_mut().find(|(k, _)| k == key) {
        Some(slot) => slot.1 = val,
        None => e.push((key.to_string(), val)),
    }
}

// ── resolve-end-matter-spec (endMatterHost.js) ──────────────────────────────────────────────────────
/// resolve-end-matter-spec(target, caller, branch) -> { matterId, factParams:{} }.
///
/// A being retires a matter. The lone substrate read: load the matter row, then gate AUTHOR-or-ROOT-
/// OWNER (the SAME rule the JS handler enforced: the author always may; a non-author may only when they
/// own the matter's tree ROOT; the heaven boundary, where resolveRootSpace throws / yields no owner,
/// means "no root owner" and the author rule alone decides). The verb carries NO params (the reducer
/// derives the tombstone from the verb itself), so the spec returns empty factParams + the matterId for
/// the idFrom:"matterId" target. Lays NO fact; a HostError IS the .word's refusal. The `caller` arrives
/// as the .word's standard-trigger `caller` arg (NOT the AuthCtx — the JS host read `caller` directly).
pub fn resolve_end_matter(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
    let caller = arg(args, 1);
    let branch = arg(args, 2);

    let caller = match caller {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        _ => return Err(HostError::unauthorized("end-matter: identity required")),
    };
    let history = branch_or(branch, history);
    let matter_id_target = target_id_of(target);
    let row = load_row(root, &history, "matter", &matter_id_target);
    let matter_id = get_str(&row, "_id").unwrap_or(&matter_id_target).to_string();

    let is_author = get_str(&row, "beingId").unwrap_or("") == caller;
    let mut is_root_owner = false;
    if !is_author {
        // The root-owner gate: resolveRootSpace(row.spaceId) then getSpaceOwner. The heaven boundary /
        // a broken tree yields None (the JS `catch`), and the author rule alone then decides.
        if let Some(space_id) = get_str(&row, "spaceId").filter(|s| !s.is_empty()) {
            is_root_owner =
                crate::toolkit::resolve_root_owner(root, space_id).as_deref() == Some(caller);
        }
    }
    if !is_author && !is_root_owner {
        return Err(HostError::forbidden(
            "Only the matter author or the tree owner can delete this matter",
        ));
    }

    Ok(obj(vec![
        ("matterId", jstr(&matter_id)),
        ("factParams", obj(vec![])),
    ]))
}
