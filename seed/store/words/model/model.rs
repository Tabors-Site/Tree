// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// model.rs — the set-model host see-ops, ported native (modelHost.js). set-model is the CONFIG read for
// a 3D model on a being/space/matter — it resolves a model MATTER + snapshots its body, then builds the
// set-<kind> { field, value, merge } the one do:set-model fact carries. It is a SUBSTRATE READ (matter
// fold + content gate), NOT running an LLM. Two ops:
//
//   may-set-model(kind, target, caller)
//       -> a per-kind self/author/owner auth READ (bool). No throw: the .word refuses (forbidden) on false.
//   resolve-model-block(kind, modelMatterId, scale, rotation, forMatterType, clear)
//       -> the ONE block builder, branched on `clear`. SET: resolve the model matter + snapshot
//          {matterId,hash,url,name}, validate forMatterType (space-only + a known type), build the
//          set-<kind> { field, value, merge }. CLEAR: the { field, value:null, merge:false } that nulls
//          the model at its field path.
//
// Content-store work + field-path computation; lays NO fact. The model matter resolve (resolveModelMatter)
// + the per-kind auth (maySetModel) reuse the SAME load_row / cas reads / resolve_root_owner the bridge
// already composes. Byte-identical to the JS block shapes.

use std::path::Path;

use treehash::Json;

use crate::matter::type_known;
use crate::toolkit::{get, get_str, is_cas_ref, jstr, load_row, obj, resolve_root_owner};
use crate::{arg, AuthCtx, HostError};

// ── resolveModelMatter (modelHost.js) ────────────────────────────────────────────────────────────────
/// Resolve + validate a model matter: exists, type "model", live cas bytes (not purged). Throws the SAME
/// IbpErrors the JS did. Returns the folded matter row on success.
fn resolve_model_matter(root: &Path, history: &str, model_matter_id: &str) -> Result<Json, HostError> {
    let row = load_row(root, history, "matter", model_matter_id);
    if matches!(row, Json::Null) {
        return Err(HostError::invalid(format!(
            "set-model: model matter \"{model_matter_id}\" not found"
        )));
    }
    let ty = get_str(&row, "type").unwrap_or("generic");
    if ty != "model" {
        return Err(HostError::invalid(format!(
            "set-model: matter \"{model_matter_id}\" is type \"{ty}\", not \"model\""
        )));
    }
    let content = get(&row, "content").cloned().unwrap_or(Json::Null);
    if !is_cas_ref(&content) {
        return Err(HostError::invalid("set-model: model matter carries no stored bytes"));
    }
    if matches!(get(&content, "purged"), Some(Json::Bool(true))) {
        return Err(HostError::invalid("set-model: this model's bytes were purged"));
    }
    Ok(row)
}

/// isRootOwner: does `actor` own the root of this space's tree? (resolveRootSpace + getSpaceOwner.)
fn is_root_owner(root: &Path, space_id: &str, actor: &str) -> bool {
    resolve_root_owner(root, space_id).as_deref() == Some(actor)
}

// ── may-set-model (maySetModel) ──────────────────────────────────────────────────────────────────────
/// may-set-model(kind, target, caller) -> bool. The per-kind self/author/owner auth READ. A missing
/// target folds to false. No throw — the .word refuses (forbidden) on false.
pub fn may_set_model(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let kind = get_str(arg(args, 0), "kind")
        .map(|s| s.to_string())
        .unwrap_or_else(|| match arg(args, 0) {
            Json::Str(s) => s.clone(),
            _ => String::new(),
        });
    let target_id = crate::being::target_id_of(arg(args, 1));
    let actor = match arg(args, 2) {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        _ => return Ok(Json::Bool(false)),
    };

    let verdict = match kind.as_str() {
        "being" => {
            if target_id == actor {
                true // your body is yours
            } else {
                let slot = load_row(root, history, "being", &target_id);
                match get_str(&slot, "homeSpace").filter(|s| !s.is_empty()) {
                    Some(home) => is_root_owner(root, home, actor),
                    None => false,
                }
            }
        }
        "matter" => {
            let slot = load_row(root, history, "matter", &target_id);
            if matches!(slot, Json::Null) {
                false
            } else if get_str(&slot, "beingId") == Some(actor) {
                true // author
            } else {
                match get_str(&slot, "spaceId").filter(|s| !s.is_empty()) {
                    Some(sp) => is_root_owner(root, sp, actor),
                    None => false,
                }
            }
        }
        "space" => {
            let slot = load_row(root, history, "space", &target_id);
            if matches!(slot, Json::Null) {
                false
            } else if get_str(&slot, "owner").unwrap_or("") == actor {
                true // space owner
            } else {
                is_root_owner(root, &target_id, actor)
            }
        }
        _ => false, // untyped target
    };
    Ok(Json::Bool(verdict))
}

// ── resolve-model-block (resolve-model-block) ─────────────────────────────────────────────────────────
/// resolve-model-block(kind, modelMatterId, scale, rotation, forMatterType, clear) -> the set-<kind>
/// { field, value, merge } the do:set-model fact carries.
pub fn resolve_model_block(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let kind = match arg(args, 0) {
        Json::Str(s) => s.clone(),
        _ => String::new(),
    };
    let model_matter_id = arg(args, 1);
    let scale = arg(args, 2);
    let rotation = arg(args, 3);
    let for_matter_type = arg(args, 4);
    let clear = arg(args, 5);

    let fmt = match for_matter_type {
        Json::Str(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    };

    // CLEAR branch: null the model at its field path (no model resolve).
    let is_clear = matches!(clear, Json::Bool(true))
        || matches!(clear, Json::Str(s) if s == "true");
    if is_clear {
        let field = match &fmt {
            Some(t) => format!("qualities.render.matterModels.{t}"),
            None => "qualities.render.model".to_string(),
        };
        return Ok(obj(vec![
            ("field", jstr(&field)),
            ("value", Json::Null),
            ("merge", Json::Bool(false)),
        ]));
    }

    // SET branch: resolve the model matter + snapshot its body.
    let model_matter_id = match model_matter_id {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        _ => {
            return Err(HostError::invalid(
                "set-model: model matter \"\" not found",
            ));
        }
    };
    let matter = resolve_model_matter(root, history, model_matter_id)?;
    let content = get(&matter, "content").cloned().unwrap_or(Json::Null);
    let hash = get_str(&content, "hash").unwrap_or("");
    let name = get_str(&matter, "name")
        .or_else(|| get_str(&content, "name"))
        .map(jstr)
        .unwrap_or(Json::Null);
    let model = obj(vec![
        ("matterId", jstr(model_matter_id)),
        ("hash", jstr(hash)),
        ("url", jstr(&format!("/api/v1/content/{hash}"))),
        ("name", name),
    ]);

    if let Some(t) = &fmt {
        // forMatterType: a per-type SPACE default at the deep matterModels path (merge:true).
        if kind != "space" {
            return Err(HostError::invalid(
                "set-model: forMatterType applies to space targets only",
            ));
        }
        if !type_known(t) {
            return Err(HostError::invalid(format!(
                "set-model: unknown matter type \"{t}\""
            )));
        }
        return Ok(obj(vec![
            ("field", jstr(&format!("qualities.render.matterModels.{t}"))),
            ("value", model),
            ("merge", Json::Bool(true)),
        ]));
    }

    // entity-level set: merge the render patch (model + optional positive scale + rotation object).
    let mut render_patch: Vec<(&str, Json)> = vec![("model", model)];
    if let Json::Num(n) = scale {
        if n.is_finite() && *n > 0.0 {
            render_patch.push(("scale", Json::Num(*n)));
        }
    }
    if matches!(rotation, Json::Obj(_)) {
        render_patch.push(("rotation", rotation.clone()));
    }
    Ok(obj(vec![
        ("field", jstr("qualities.render")),
        ("value", obj(render_patch)),
        ("merge", Json::Bool(true)),
    ]))
}
