// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// being.rs — resolve-set-being-spec, the floor see-op for set-being.word (setBeingHost.js). Loads the
// being row, routes on `field` exactly as the JS host did, runs the two reads that cannot be native
// Word (name-uniqueness via findByName, coord-bounds via assertCoordInBounds), and returns
// `{ beingId, factParams }` where factParams is the canonical do:set-being fact shape — { field, value }
// (+ `merge` ONLY when the caller passed it, + `fromPosition` on a position write). It lays NO fact;
// a HostError IS the .word's refusal. Byte-compatible with the JS host's returned block.
//
// The .word call: `see resolve-set-being-spec(target, field, value, merge, branch) as spec.`
//   args = [target, field, value, merge, branch]

use std::path::Path;

use treehash::Json;

use crate::toolkit::{
    being_coord_in_bounds, get_str, is_nonempty_str, is_plain_object, jstr, load_row, name_unique,
    obj,
};
use crate::{arg, AuthCtx, HostError};

// Namespaces NOT writable through set-being qualities (each has its own verb). Mirrors being/ops.js
// RESERVED_SET_META_NS.
const RESERVED_SET_META_NS: &[&str] = &["inbox"];

/// resolve-set-being-spec(target, field, value, merge, branch) -> { beingId, factParams }.
///
/// The `.word`'s `If no field` gate runs FIRST (field present), so we re-state the TYPE half (a
/// non-string field surfaces a clean refusal, never a panic). `branch` overrides the history when
/// passed (the JS `branch || moment.actorAct.history || "0"`); `history` is the enclosing-moment
/// default run_body threads in.
pub fn resolve_set_being_spec(
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

    // Field guard (the JS `!field || typeof field !== "string"`).
    let field = match field {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        _ => return Err(HostError::invalid("set-being: `field` is required")),
    };
    let history = branch_or(branch, history);

    // Load the being row (loadTargetRow -> the folded state, with `_id`).
    let target_id = target_id_of(target);
    let row = load_row(root, &history, "being", &target_id);
    let being_id = get_str(&row, "_id").unwrap_or(&target_id).to_string();

    // The fact params builder: { field, value } + merge only when the caller passed it (byte-identity:
    // an absent merge stays absent; the reducers default merge !== false).
    let block = |extra: Vec<(&str, Json)>| -> Json {
        let mut fp: Vec<(&str, Json)> = vec![("field", jstr(field))];
        // The coord null-clear writes value:null explicitly via `extra`; otherwise value is the raw arg.
        if !extra.iter().any(|(k, _)| *k == "value") {
            fp.push(("value", value.clone()));
        }
        for (k, v) in extra {
            fp.push((k, v));
        }
        if !matches!(merge, Json::Null) {
            fp.push(("merge", merge.clone()));
        }
        obj(vec![("beingId", jstr(&being_id)), ("factParams", obj(fp))])
    };

    // ── qualities paths ────────────────────────────────────
    if let Some(rest) = field.strip_prefix("qualities.") {
        let namespace = rest.split('.').next().unwrap_or("");
        if RESERVED_SET_META_NS.contains(&namespace) {
            return Err(HostError::invalid(format!(
                "set-being: qualities namespace \"{namespace}\" is not writable through set-being; it has a dedicated verb."
            )));
        }
        // namespace-root write (parts.length === 1) with a non-null value must be an object.
        if !rest.contains('.') && !matches!(value, Json::Null) && !is_plain_object(value) && !matches!(value, Json::Arr(_)) {
            return Err(HostError::invalid(
                "set-being: qualities-namespace value must be an object",
            ));
        }
        return Ok(block(vec![]));
    }

    // ── schema-field writes ────────────────────────────────
    match field {
        "name" => {
            let name = match value {
                Json::Str(s) if !s.is_empty() => s.as_str(),
                _ => {
                    return Err(HostError::invalid(
                        "set-being: `value` must be a string for field=name",
                    ))
                }
            };
            // findByName cross-history; beings are global per history (empty scope), exclude self.
            if !name_unique(root, &history, "being", name, &Json::Null, Some(&being_id))? {
                return Err(HostError::name_taken("set-being", name, &history));
            }
            Ok(block(vec![]))
        }
        "parentBeingId" => {
            if matches!(value, Json::Null) {
                return Ok(block(vec![]));
            }
            if !is_nonempty_str(value) {
                return Err(HostError::invalid(format!(
                    "set-being: parentBeingId must be a being id string or null . got {}",
                    js_typeof(value)
                )));
            }
            Ok(block(vec![]))
        }
        "defaultAble" => {
            if !matches!(value, Json::Null) && !matches!(value, Json::Str(_)) {
                return Err(HostError::invalid(
                    "set-being: `defaultAble` value must be a string or null",
                ));
            }
            Ok(block(vec![]))
        }
        "homeSpace" => {
            if matches!(value, Json::Null) {
                return Ok(block(vec![]));
            }
            if !is_nonempty_str(value) {
                return Err(HostError::invalid(format!(
                    "set-being: homeSpace must be a space id string or null . got {}",
                    js_typeof(value)
                )));
            }
            Ok(block(vec![]))
        }
        // password is bcrypt-hashed by the caller; the op records the hash (a non-empty string).
        "password" => {
            if !is_nonempty_str(value) {
                return Err(HostError::invalid(
                    "set-being: `password` value must be the bcrypt hash string",
                ));
            }
            Ok(block(vec![]))
        }
        // position: the Space this being is in. fromPosition rides the fact iff the being actually
        // moved (a truthy old position differing from the new one) — the live-SEE invalidation hint.
        "position" => {
            if !matches!(value, Json::Null) && !is_nonempty_str(value) {
                return Err(HostError::invalid(format!(
                    "set-being: position must be a space id string or null . got {}",
                    js_typeof(value)
                )));
            }
            let new_id = match value {
                Json::Str(s) if !s.is_empty() => Some(s.as_str()),
                _ => None,
            };
            let from_id = get_str(&row, "position").filter(|s| !s.is_empty());
            if let Some(from) = from_id {
                if Some(from) != new_id {
                    return Ok(block(vec![("fromPosition", jstr(from))]));
                }
            }
            Ok(block(vec![]))
        }
        // coord: clamped to the being's containing Space.size (THROW out-of-bounds). The recorded fact
        // carries the ORIGINAL value (the gate runs but its return is not the fact's value).
        "coord" => {
            if matches!(value, Json::Null) {
                return Ok(block(vec![("value", Json::Null)]));
            }
            if !is_plain_object(value) {
                return Err(HostError::invalid(
                    "set-being: `coord` value must be an object {x,y,z?} or null",
                ));
            }
            being_coord_in_bounds(root, &history, &row, value)?;
            Ok(block(vec![]))
        }
        other => Err(HostError::invalid(format!(
            "set-being: unknown field \"{other}\". Supported: name, defaultAble, homeSpace, parentBeingId, password, position, coord, qualities.<namespace>[.<innerKey>]"
        ))),
    }
}

// ── target/branch helpers (shared shape with space/matter) ──────────────────────────────────────────
/// targetIdOf: a `{ kind, id }` target -> its id; a bare id string -> itself; else "". (_targetShape.js
/// targetIdOf.)
pub(crate) fn target_id_of(target: &Json) -> String {
    match target {
        Json::Str(s) => s.clone(),
        Json::Obj(_) => get_str(target, "id").unwrap_or_default().to_string(),
        _ => String::new(),
    }
}

/// `branch || history` — the JS `branch || moment.actorAct.history || "0"`, with `history` carrying the
/// enclosing-moment default (run_body threads it; the binary defaults it to "0").
pub(crate) fn branch_or(branch: &Json, history: &str) -> String {
    match branch {
        Json::Str(s) if !s.is_empty() => s.clone(),
        _ => history.to_string(),
    }
}

/// A coarse JS `typeof` for the error strings (the hosts interpolate `typeof value`).
pub(crate) fn js_typeof(v: &Json) -> &'static str {
    match v {
        Json::Null => "object", // JS `typeof null === "object"`
        Json::Bool(_) => "boolean",
        Json::Num(_) => "number",
        Json::Str(_) => "string",
        Json::Arr(_) | Json::Obj(_) => "object",
    }
}
