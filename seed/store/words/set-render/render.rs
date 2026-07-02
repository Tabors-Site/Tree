// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// render.rs — the set-render host see-op, ported native (setRenderHost.js / setRender.js
// validateRenderBlock):
//
//   validate-render-block(params, kind) -> { field:"qualities.render", value:<block>, merge }
//
// Validate the target KIND (matter|space|being) + the render block (reject unknown top-level keys;
// validate model / scale / rotation / animations / sounds), then SHAPE the do:set-render fact params
// (the SAME { field, value, merge } the retired JS handler's stampsFact laid, which applySetQualities
// folds unchanged). A PURE compute: it lays NO fact (no fold, no I/O); a HostError IS the .word's
// refusal. Byte-identical to validateRenderBlock (same VALID_KEYS, same per-channel gates, same merge
// default `input.merge !== false`).

use std::path::Path;

use treehash::Json;

use crate::toolkit::{get, is_plain_object, jstr, obj};
use crate::{arg, AuthCtx, HostError};

const VALID_KEYS: &[&str] = &["model", "scale", "rotation", "animations", "sounds", "merge"];

/// A present-and-non-null field (the JS `input.<k> !== undefined`; the parser passes absent as Null).
fn present<'a>(input: &'a Json, k: &str) -> Option<&'a Json> {
    match get(input, k) {
        Some(Json::Null) | None => None,
        Some(v) => Some(v),
    }
}

/// A finite Json number, else None (Number.isFinite).
fn finite(v: &Json) -> Option<f64> {
    match v {
        Json::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

// ── validate-render-block (setRender.js validateRenderBlock) ────────────────────────────────────────
/// validate-render-block(params, kind). `kind` (null allowed) gates the target type; `params` is the
/// render block. Returns the do:set-render fact params; THROWS on a bad kind / unknown key / malformed
/// channel.
pub fn validate_render_block(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let input = arg(args, 0);
    let kind = arg(args, 1);

    // target-kind gate (kind != null && not one of matter|space|being).
    if let Json::Str(k) = kind {
        if k != "matter" && k != "space" && k != "being" {
            return Err(HostError::invalid(format!(
                "set-render: target must be matter, space, or being (got \"{k}\")"
            )));
        }
    }

    if !is_plain_object(input) {
        return Err(HostError::invalid("set-render: params must be an object"));
    }

    // reject unknown top-level keys.
    if let Json::Obj(entries) = input {
        for (key, _) in entries {
            if !VALID_KEYS.contains(&key.as_str()) {
                return Err(HostError::invalid(format!(
                    "set-render: unknown key \"{key}\". Allowed: {}.",
                    VALID_KEYS.join(", ")
                )));
            }
        }
    }

    let mut block: Vec<(&str, Json)> = Vec::new();

    // model — a non-empty string (asset ref) OR an object with a string matterId/url.
    if let Some(model) = present(input, "model") {
        match model {
            Json::Str(s) if !s.is_empty() => block.push(("model", model.clone())),
            Json::Obj(_)
                if matches!(get(model, "matterId"), Some(Json::Str(_)))
                    || matches!(get(model, "url"), Some(Json::Str(_))) =>
            {
                block.push(("model", model.clone()));
            }
            _ => {
                return Err(HostError::invalid(
                    "set-render: model must be a non-empty string (asset ref) or an object with matterId/url (model matter; prefer the set-model op)",
                ));
            }
        }
    }

    // scale — a positive finite number.
    if let Some(scale) = present(input, "scale") {
        match finite(scale) {
            Some(n) if n > 0.0 => block.push(("scale", Json::Num(n))),
            _ => {
                return Err(HostError::invalid(
                    "set-render: scale must be a positive finite number",
                ));
            }
        }
    }

    // rotation — an object { x, y, z } each finite.
    if let Some(rotation) = present(input, "rotation") {
        if !is_plain_object(rotation) {
            return Err(HostError::invalid(
                "set-render: rotation must be an object {x, y, z}",
            ));
        }
        let mut r: Vec<(&str, Json)> = Vec::new();
        for axis in ["x", "y", "z"] {
            match get(rotation, axis).and_then(finite) {
                Some(n) => r.push((axis, Json::Num(n))),
                None => {
                    return Err(HostError::invalid(format!(
                        "set-render: rotation.{axis} must be a finite number"
                    )));
                }
            }
        }
        block.push(("rotation", obj(r)));
    }

    // animations / sounds — an object of { factAction: non-empty-string }.
    for channel in ["animations", "sounds"] {
        let m = match present(input, channel) {
            None => continue,
            Some(m) => m,
        };
        if !is_plain_object(m) {
            return Err(HostError::invalid(format!(
                "set-render: {channel} must be an object of {{factAction: name}}"
            )));
        }
        let mut out: Vec<(&str, Json)> = Vec::new();
        if let Json::Obj(entries) = m {
            for (action, name) in entries {
                if action.is_empty() {
                    return Err(HostError::invalid(format!(
                        "set-render: {channel} keys must be non-empty strings"
                    )));
                }
                match name {
                    Json::Str(s) if !s.is_empty() => out.push((action.as_str(), name.clone())),
                    _ => {
                        return Err(HostError::invalid(format!(
                            "set-render: {channel}[\"{action}\"] must be a non-empty string"
                        )));
                    }
                }
            }
        }
        block.push((channel, obj(out)));
    }

    // merge default true unless the caller passed merge:false (input.merge !== false).
    let merge = !matches!(get(input, "merge"), Some(Json::Bool(false)));

    Ok(obj(vec![
        ("field", jstr("qualities.render")),
        ("value", obj(block)),
        ("merge", Json::Bool(merge)),
    ]))
}
