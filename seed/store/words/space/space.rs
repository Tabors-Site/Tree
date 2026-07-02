// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// space.rs — the three space host see-ops, ported native:
//
//   resolve-set-space-spec  (setSpaceHost.js): route on `field`, run the reads that can't be native
//       Word (sibling-NAME availability via findByName, the heaven-space immutability gate, COORD-
//       BOUNDS against the PARENT's size, the maxSpaceSize cap), return { spaceId, factParams }.
//   resolve-birth-space     (spaceHost.js -> spaces.js resolveBirthSpace): name/type/size validation,
//       coord auto-assign / bounds inside the parent, sibling-name uniqueness, the uuid mint; returns
//       { enrichedSpec, spaceId }. (The parent-lock + heaven-parent gate + max-children check are I/O
//       concerns that stay caller-side; the SUBSTRATE validation is here.)
//   resolve-end-space-spec  (endSpaceHost.js -> spaces.js deleteSpaceHistory): the already-deleted
//       refusal (the loaded row's parent === DELETED). OWNER/not-root authority is the CALLER's input
//       (AuthCtx); I bypasses. Returns { spaceId } (no factParams: the reducer derives the whole fold).
//
// Each lays NO fact; a HostError IS the .word's refusal. Byte-compatible with the JS host's block.

use std::path::Path;

use treehash::Json;

use crate::being::{branch_or, js_typeof, target_id_of};
use crate::toolkit::{
    get, get_str, is_deleted, is_nonempty_str, is_plain_object, jstr, load_row, load_space_size,
    name_unique, obj,
};
use crate::{arg, AuthCtx, HostError};

const RESERVED_SET_META_NS: &[&str] = &["inbox"];

// ── maxSpaceSize (spaces.js assertValidSpaceSize cap) ───────────────────────────────────────────────
/// The configured max per-axis space size. The JS reads `config.maxSpaceSize` (a config row); the
/// substrate default is 1000 per axis. A size axis above this THROWS. (A config follow-up can thread a
/// real cap; the validation SHAPE is what the bridge needs.)
const MAX_SPACE_SIZE: f64 = 1000.0;

// ── resolve-set-space-spec ──────────────────────────────────────────────────────────────────────────
/// resolve-set-space-spec(target, field, value, merge, branch) -> { spaceId, factParams }.
/// The `.word`'s `If no field` gate runs FIRST. NORMALIZED name/type are used for the throw + the
/// uniqueness check only; the fact records the caller's ORIGINAL value.
pub fn resolve_set_space_spec(
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
        _ => return Err(HostError::invalid("set-space: `field` is required")),
    };
    let history = branch_or(branch, history);
    let space_id = target_id_of(target);
    // Load the target row once (the heaven-immutability gate + the name-collision exclude + the coord
    // parent lookup read it). A typed-space target and a stance both resolve to a space id here; the
    // stance's spaceId is its `.spaceId` (carried on the target object).
    let target_space_id = match get_str(target, "spaceId").filter(|s| !s.is_empty()) {
        Some(s) => s.to_string(),
        None => space_id.clone(),
    };
    let row = load_row(root, &history, "space", &target_space_id);

    let block = |id: &str, extra: Vec<(&str, Json)>| -> Json {
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
        obj(vec![("spaceId", jstr(id)), ("factParams", obj(fp))])
    };

    // ── qualities paths ────────────────────────────────────
    if let Some(rest) = field.strip_prefix("qualities.") {
        let namespace = rest.split('.').next().unwrap_or("");
        if RESERVED_SET_META_NS.contains(&namespace) {
            return Err(HostError::invalid(format!(
                "set-space: qualities namespace \"{namespace}\" is not writable through set-space; it has a dedicated verb."
            )));
        }
        if rest.matches('.').count() > 1 {
            return Err(HostError::invalid(format!(
                "set-space: deep qualities path \"{field}\" not supported (max depth: qualities.<namespace>.<innerKey>)"
            )));
        }
        if !rest.contains('.') && !matches!(value, Json::Null) && !is_plain_object(value) && !matches!(value, Json::Arr(_)) {
            return Err(HostError::invalid(
                "set-space: qualities-namespace value must be an object",
            ));
        }
        return Ok(block(&target_space_id, vec![]));
    }

    // ── schema-field writes ────────────────────────────────
    match field {
        "name" => {
            let name = match value {
                Json::Str(s) if !s.is_empty() => s.as_str(),
                _ => {
                    return Err(HostError::invalid(
                        "set-space: `value` must be a string for field=name",
                    ))
                }
            };
            let normalized = assert_valid_space_name(name)?;
            // heaven-space immutability gate (the loaded row's heavenSpace marker is non-null).
            if has_heaven_marker(&row) {
                return Err(HostError::invalid("set-space: cannot rename heaven spaces"));
            }
            // sibling-name uniqueness, scoped by the PARENT space (only when the name actually changes).
            let current = get_str(&row, "name").unwrap_or("");
            if current != normalized {
                let parent = get_str(&row, "parent").unwrap_or("");
                let scope = obj(vec![("parent", jstr(parent))]);
                if !name_unique(root, &history, "space", &normalized, &scope, Some(&target_space_id))? {
                    return Err(HostError::name_taken("set-space", &normalized, &history));
                }
            }
            Ok(block(&target_space_id, vec![]))
        }
        "type" => {
            assert_valid_space_type(value)?; // THROWS on a bad type; the fact records the ORIGINAL value
            if has_heaven_marker(&row) {
                return Err(HostError::invalid(
                    "set-space: cannot change type on heaven spaces",
                ));
            }
            Ok(block(&target_space_id, vec![]))
        }
        "parent" => {
            // Bare space-id, null, or the DELETED sentinel string.
            if matches!(value, Json::Null) || is_deleted(value) {
                return Ok(block(&target_space_id, vec![]));
            }
            if !is_nonempty_str(value) {
                return Err(HostError::invalid(format!(
                    "set-space: parent must be a space id string, null, or the DELETED sentinel . got {}",
                    js_typeof(value)
                )));
            }
            Ok(block(&target_space_id, vec![]))
        }
        "owner" => {
            if !matches!(value, Json::Null) && !is_nonempty_str(value) {
                return Err(HostError::invalid(
                    "set-space: `owner` value must be a beingId string or null",
                ));
            }
            Ok(block(&target_space_id, vec![]))
        }
        // coord: this space's position INSIDE its parent. Bounds-checked against the PARENT's size.
        "coord" => {
            if matches!(value, Json::Null) {
                return Ok(block(&target_space_id, vec![]));
            }
            if !is_plain_object(value) {
                return Err(HostError::invalid(
                    "set-space: coord must be {x, y, z?} or null",
                ));
            }
            // Build the finite-axis `out` and refuse a present-but-non-finite axis (the JS throws
            // INVALID_INPUT per axis), then require at least one axis.
            let out = finite_axes_or_throw(value, "set-space")?;
            if matches!(&out, Json::Obj(e) if e.is_empty()) {
                return Err(HostError::invalid(
                    "set-space: coord requires at least one axis",
                ));
            }
            // Bounds against the parent's size (the parent of THIS space).
            let parent_id = get_str(&row, "parent").filter(|s| !s.is_empty());
            if let Some(pid) = parent_id {
                let parent_size = load_space_size(root, &history, pid);
                crate::toolkit::assert_coord_within_size_pub(&out, &parent_size, "set-space", "the parent space")?;
            }
            Ok(block(&target_space_id, vec![]))
        }
        // size: the space's bounding box. assertValidSpaceSize reads the maxSpaceSize cap (THROWS).
        "size" => {
            if matches!(value, Json::Null) {
                return Ok(block(&target_space_id, vec![]));
            }
            assert_valid_space_size(value)?;
            Ok(block(&target_space_id, vec![]))
        }
        other => Err(HostError::invalid(format!(
            "set-space: unknown field \"{other}\". Supported: name, type, parent, owner, size, coord, qualities.<namespace>[.<innerKey>]"
        ))),
    }
}

// ── resolve-birth-space (make — the space creation op, renamed from create-space in M1C) ─────
/// resolve-birth-space(target, targetKind, params, caller, branch) -> { enrichedSpec, spaceId }.
/// The substrate validation half of spaces.js resolveBirthSpace: name/type/size validation + sibling-
/// name uniqueness under the parent + the uuid mint. The parent is the target's id (or a stance's
/// position spaceId). `caller` (AuthCtx.actor_being_id) is the creator; the `.word` already refused
/// "no caller". Returns the enriched birth spec the do:make fact records.
pub fn resolve_create_space(
    root: &Path,
    history: &str,
    args: &[Json],
    ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
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
                "make requires an identified actor",
            ))
        }
    };

    // parent = the target's id (a stance carries `.spaceId`; the place root refuses — caller-gated).
    let parent_id = match get_str(target, "spaceId").filter(|s| !s.is_empty()) {
        Some(s) => s.to_string(),
        None => target_id_of(target),
    };

    // name: explicit -> validated; else a generated default (the JS resolveBirthSpace mints "space<n>"
    // when absent — the bridge accepts the explicit name and validates it; an absent name is left for
    // the caller's name-floor, matching how make's name floor stays caller-assistable).
    let raw_name = get(params, "name").cloned().unwrap_or(Json::Null);
    let name = match &raw_name {
        Json::Str(s) if !s.is_empty() => assert_valid_space_name(s)?,
        Json::Null => String::new(),
        _ => {
            return Err(HostError::invalid(
                "make: `name` must be a string",
            ))
        }
    };
    // sibling-name uniqueness under the parent (no self at birth -> exclude None).
    if !name.is_empty() {
        let scope = obj(vec![("parent", jstr(&parent_id))]);
        if !name_unique(root, &history, "space", &name, &scope, None)? {
            return Err(HostError::name_taken("make", &name, &history));
        }
    }

    // type + size validation (THROW on a bad type / oversize axis). null passes through.
    let ty = get(params, "type").cloned().unwrap_or(Json::Null);
    if !matches!(ty, Json::Null) {
        assert_valid_space_type(&ty)?;
    }
    let size = get(params, "size").cloned().unwrap_or(Json::Null);
    if !matches!(size, Json::Null) {
        assert_valid_space_size(&size)?;
    }

    // The uuid mint (id from POSITION: a fresh space is positional identity, a uuid — id_derivation
    // rule). Deterministic seed so the test is reproducible; a real run threads the moment uuid.
    let space_id = mint_space_id(&parent_id, &name);

    // The enriched spec the fact records: the params + the resolved parent/name/creator.
    let mut enriched: Vec<(String, Json)> = match params {
        Json::Obj(e) => e.clone(),
        _ => Vec::new(),
    };
    set_field(&mut enriched, "name", jstr(&name));
    set_field(&mut enriched, "parent", jstr(&parent_id));
    set_field(&mut enriched, "beingId", jstr(&caller));
    let enriched_spec = Json::Obj(enriched);

    Ok(obj(vec![
        ("enrichedSpec", enriched_spec),
        ("spaceId", jstr(&space_id)),
    ]))
}

// ── resolve-end-space-spec (end-space) ──────────────────────────────────────────────────────────────
/// resolve-end-space-spec(target, branch) -> { spaceId }. The substrate gate: the already-deleted
/// refusal (the loaded row's parent === DELETED). The OWNER/not-root authority is the CALLER's input
/// (AuthCtx.authorized; I bypasses via is_i). No factParams — the space reducer derives the whole fold
/// (parent->DELETED, position->DELETED, owner->the deleter) from the fact's act + through.
pub fn resolve_end_space_spec(
    root: &Path,
    history: &str,
    args: &[Json],
    ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
    let branch = arg(args, 1);
    let history = branch_or(branch, history);
    let space_id = target_id_of(target);

    // Authority: the owner/not-root check is the caller's verdict. I bypasses (genesis / boot mirror
    // sync), exactly as deleteSpaceHistory's `beingId !== I` gate did. A non-I unauthorized actor is
    // refused.
    if !ctx.is_i && !ctx.authorized {
        return Err(HostError::unauthorized(format!(
            "end-space: not authorized to end space \"{space_id}\""
        )));
    }

    // The already-deleted refusal: the loaded row's parent IS the DELETED sentinel.
    let row = load_row(root, &history, "space", &space_id);
    if let Some(parent) = get(&row, "parent") {
        if is_deleted(parent) {
            return Err(HostError::already_deleted(&space_id));
        }
    }
    Ok(obj(vec![("spaceId", jstr(&space_id))]))
}

// ── space validation helpers (spaces.js assertValidSpaceName/Type/Size) ─────────────────────────────
/// assertValidSpaceName: trim, refuse empty / "/" / "." / ".." / a leading "~" (reserved sigils), and
/// return the NORMALIZED (trimmed) name. The uniqueness check + the immutability throw use this; the
/// fact records the caller's ORIGINAL value.
fn assert_valid_space_name(name: &str) -> Result<String, HostError> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err(HostError::invalid(
            "set-space: space name must be a non-empty string",
        ));
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.starts_with('~') {
        return Err(HostError::invalid(format!(
            "set-space: space name \"{trimmed}\" uses a reserved character (/, ~, ., ..)"
        )));
    }
    Ok(trimmed)
}

// The seed basic space types the registry knows (spaces.js VALID type set). An unknown type THROWS.
const VALID_SPACE_TYPES: &[&str] = &["generic", "room", "place", "thread", "branch"];

/// assertValidSpaceType: a known type string, or null (passes — the reducer defaults). THROWS otherwise.
fn assert_valid_space_type(value: &Json) -> Result<(), HostError> {
    match value {
        Json::Null => Ok(()),
        Json::Str(s) if VALID_SPACE_TYPES.contains(&s.as_str()) => Ok(()),
        Json::Str(s) => Err(HostError::invalid(format!(
            "set-space: unknown space type \"{s}\""
        ))),
        _ => Err(HostError::invalid(
            "set-space: type must be a string or null",
        )),
    }
}

/// assertValidSpaceSize: each present axis a finite number in (0, maxSpaceSize]; at least one axis;
/// THROWS otherwise. null is handled by the caller (passes through to unset).
fn assert_valid_space_size(value: &Json) -> Result<(), HostError> {
    if !is_plain_object(value) {
        return Err(HostError::invalid(
            "set-space: size must be an object {x, y, z?} or null",
        ));
    }
    let mut any = false;
    for a in ["x", "y", "z"] {
        match get(value, a) {
            None => continue,
            Some(Json::Num(n)) if n.is_finite() && *n > 0.0 && *n <= MAX_SPACE_SIZE => any = true,
            Some(Json::Num(n)) if *n > MAX_SPACE_SIZE => {
                return Err(HostError::invalid(format!(
                    "set-space: size.{a}={n} exceeds the max space size ({MAX_SPACE_SIZE})"
                )))
            }
            Some(_) => {
                return Err(HostError::invalid(format!(
                    "set-space: size.{a} must be a positive finite number"
                )))
            }
        }
    }
    if !any {
        return Err(HostError::invalid(
            "set-space: size requires at least one positive axis",
        ));
    }
    Ok(())
}

/// Build the finite-axis `out` object from a coord, REFUSING a present-but-non-finite axis (the JS
/// set-space coord throws INVALID_INPUT per axis). An absent axis is skipped.
fn finite_axes_or_throw(value: &Json, op: &str) -> Result<Json, HostError> {
    let mut out: Vec<(String, Json)> = Vec::new();
    for a in ["x", "y", "z"] {
        match get(value, a) {
            None => continue,
            Some(Json::Num(n)) if n.is_finite() => out.push((a.to_string(), Json::Num(*n))),
            Some(_) => {
                return Err(HostError::invalid(format!(
                    "{op}: coord.{a} must be a finite number"
                )))
            }
        }
    }
    Ok(Json::Obj(out))
}

/// `state.heavenSpace` is a non-null marker — the immutability gate (heaven spaces refuse name/type).
fn has_heaven_marker(row: &Json) -> bool {
    !matches!(get(row, "heavenSpace"), None | Some(Json::Null))
}

/// Mint a fresh space id (positional identity -> a uuid, the id_derivation rule). Deterministic over
/// (parent, name) so the test is reproducible; a real run threads the moment's uuid. Prefixed `sp-` so
/// it is recognizable, 32 hex of a content hash for collision-resistance.
fn mint_space_id(parent: &str, name: &str) -> String {
    let seed = format!("space\0{parent}\0{name}");
    let h = treehash::sha256_hex(seed.as_bytes());
    format!("sp-{}", &h[..32])
}

/// `{ ...obj, key: val }` over an owned entry vec (append if absent).
fn set_field(e: &mut Vec<(String, Json)>, key: &str, val: Json) {
    match e.iter_mut().find(|(k, _)| k == key) {
        Some(slot) => slot.1 = val,
        None => e.push((key.to_string(), val)),
    }
}
