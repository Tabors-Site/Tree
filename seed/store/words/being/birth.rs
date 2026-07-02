// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// birth.rs — resolve-birth-being, the floor see-op for be:birth (identity/birth.js birthBeing). This
// is the VALIDATION + SPEC half of birthBeing: it validates the birth, mints the content-addressed
// being id, and returns the be:birth fact spec the dispatcher stamps. It lays NO fact and mutates
// nothing; a HostError IS the refusal. Byte-compatible with the JS host's stamped factSpec.
//
// What it PORTS (the substrate validation the JS birthBeing ran before emitFact):
//   - name default / validation (the BEING_NAME_RE shape gate);
//   - parentBeingId present + the parent EXISTS (load_row -> BeingNotFound when absent);
//   - the MOTHER carries a trueName (the being expresses the name that births it);
//   - the BIRTH-GATE inheritation (hasAuthorityOver via the AuthCtx minter — Unauthorized when the
//     minting Name does not cover the parent position; I / self / root bypass);
//   - the SOVEREIGN OVERRIDE (an explicit spec.trueName must be a declared, non-banished Name);
//   - name-uniqueness (name_unique -> NameCollision);
//   - coord pick / coord-bounds (an explicit coord is bounds-checked; an absent coord is auto-picked
//     in-bounds inside the position space's size — CoordOutOfBounds when an explicit coord is outside);
//   - the content-addressed being id (being_content_id, byte-identical to beingId.js).
//
// What STAYS a HOST / seal concern (NOT this resolver — see NOTES.md):
//   - the CREDENTIAL keypair / password mint (mintCredentialSpec: bcrypt hash + encrypted plaintext —
//     crypto I/O the seal performs; the resolver carries NO password field);
//   - the parent-able INHERITANCE grants (_inheritParentAbles — its OWN moments, afterSeal);
//   - the global ANOINT (_anointGlobal — its OWN moment, afterSeal).
//
// The .word call shape (mirrors make / make):
//   `see resolve-birth-being(target, params, caller, branch) as birth.`
//     args = [target (the parent being), params (the be:birth spec), caller, branch]

use std::path::Path;

use treehash::Json;

use crate::being::{branch_or, target_id_of};
use crate::toolkit::{
    being_content_id, get, get_str, has_authority_over, is_i_name, is_plain_object, jstr, load_row,
    load_space_size, name_banished, name_declared, name_unique, obj,
};
use crate::{arg, AuthCtx, HostError};

/// The being-name shape gate (birth.js BEING_NAME_RE `/^[a-zA-Z0-9_-]{1,32}$/`).
fn valid_being_name(name: &str) -> bool {
    let len = name.chars().count();
    len >= 1
        && len <= 32
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// resolve-birth-being(target, params, caller, branch) -> the be:birth fact SPEC + the being id.
///
/// Returns `{ beingId, factParams }` where `factParams` is the be:birth fact's params (the same block
/// the JS birthBeing stamped, MINUS the credential `password` the seal mints). `caller` (the MINTER's
/// beingId) arrives via the AuthCtx; the birth-gate reads the minter's Name from it (`name_id`) or, when
/// absent, from the minter being's trueName.
pub fn resolve_birth_being(
    root: &Path,
    history: &str,
    args: &[Json],
    ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
    let params = arg(args, 1);
    let branch = arg(args, 3);
    let history = branch_or(branch, history);

    // ── Required: name (validated) ──
    let name = match get_str(params, "name") {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            return Err(HostError::invalid(
                "be:birth: `name` is required",
            ))
        }
    };
    if !valid_being_name(&name) {
        return Err(HostError::invalid(
            "be:birth: name may only contain letters, numbers, hyphens, and underscores (1-32 chars)",
        ));
    }

    // ── Required: parentBeingId (the parent being target OR an explicit spec.parentBeingId) ──
    let parent_being_id = {
        let from_target = target_id_of(target);
        if !from_target.is_empty() {
            from_target
        } else {
            get_str(params, "parentBeingId").unwrap_or_default().to_string()
        }
    };
    if parent_being_id.is_empty() {
        return Err(HostError::invalid(format!(
            "be:birth(\"{name}\"): parentBeingId is required. The being-tree is rooted at the I-Am; \
             every other being chains back through its parent."
        )));
    }

    // ── Parent EXISTS (loadOrFold -> the folded mother row, or BeingNotFound) ──
    let parent_row = load_row(root, &history, "being", &parent_being_id);
    if matches!(parent_row, Json::Null) {
        let short: String = parent_being_id.chars().take(8).collect();
        return Err(HostError::being_not_found(format!(
            "be:birth(\"{name}\"): parentBeingId \"{short}\" does not resolve to an existing being. \
             The being-tree would have a dangling reference."
        )));
    }

    // ── The MOTHER's trueName (the being expresses the name that births it; no fallback) ──
    let mother_true_name = match get_str(&parent_row, "trueName").filter(|s| !s.is_empty()) {
        Some(s) => s.to_string(),
        None => {
            let short: String = parent_being_id.chars().take(8).collect();
            return Err(HostError::invalid(format!(
                "be:birth(\"{name}\"): the mother (parentBeingId \"{short}\") carries no trueName; \
                 a being must express the name that births it."
            )));
        }
    };

    // ── BIRTH-GATE (inheritation). The MINTER's Name must cover the parent position — unless the
    // birth is inherently allowed: I minter, root admission (parent = I), or self-birth (parent = the
    // minter). For any OTHER position, hasAuthorityOver gates it (Unauthorized when uncovered). ──
    let minter_being_id = ctx.actor_being_id.clone().unwrap_or_default();
    let is_i_minter = ctx.is_i || is_i_name(&minter_being_id);
    let under_root = is_i_name(&parent_being_id);
    let under_self = !minter_being_id.is_empty() && parent_being_id == minter_being_id;
    if !is_i_minter && !under_root && !under_self {
        // The minter's Name: the minter being's trueName (the act's nameId is the same Name folded
        // onto the being row; treehost reads the substrate, so it reads the minter being's trueName).
        let minter_name = if minter_being_id.is_empty() {
            String::new()
        } else {
            let minter_row = load_row(root, &history, "being", &minter_being_id);
            get_str(&minter_row, "trueName").unwrap_or_default().to_string()
        };
        let covered = !minter_name.is_empty()
            && has_authority_over(root, &history, &minter_name, &parent_being_id);
        if !covered {
            let short: String = parent_being_id.chars().take(8).collect();
            return Err(HostError::forbidden(format!(
                "be:birth(\"{name}\"): the minting Name has no authority over parent position \
                 \"{short}\" — you may only birth under a position you own or hold an inheritation \
                 point on."
            )));
        }
    }

    // ── SOVEREIGN OVERRIDE. An explicit spec.trueName different from the mother's makes the being the
    // NAMED's own; the named Name must be DECLARED on this story and NOT banished. ──
    let mut effective_true_name = mother_true_name.clone();
    if let Some(explicit) = get_str(params, "trueName").filter(|s| !s.is_empty()) {
        if explicit != mother_true_name {
            if !name_declared(root, explicit) {
                let short: String = explicit.chars().take(12).collect();
                return Err(HostError::invalid(format!(
                    "be:birth(\"{name}\"): explicit trueName \"{short}\" is not a declared Name on this story."
                )));
            }
            if name_banished(root, explicit) {
                let short: String = explicit.chars().take(12).collect();
                return Err(HostError::forbidden(format!(
                    "be:birth(\"{name}\"): trueName \"{short}\" is banished."
                )));
            }
            effective_true_name = explicit.to_string();
        }
    }

    // ── Name uniqueness (the bare-name being scope; no self at birth) ──
    if !name_unique(root, &history, "being", &name, &Json::Null, None)? {
        return Err(HostError::name_taken("be:birth", &name, &history));
    }

    // ── homeSpace (an explicit spec.homeSpace / spec.homeId; the bridge accepts it as given — the
    // space-exists gate is a caller I/O concern in the JS too: the home is created in the same moment). ──
    let home_space = get_str(params, "homeSpace")
        .or_else(|| get_str(params, "homeId"))
        .unwrap_or_default()
        .to_string();

    // ── Resolve position. birthHere=true places the being at the parent's current position; else the
    // being appears at its own home (position = homeSpace). ──
    let birth_here = matches!(get(params, "birthHere"), Some(Json::Bool(true)));
    let position = if birth_here {
        match get_str(&parent_row, "position").filter(|s| !s.is_empty()) {
            Some(p) => p.to_string(),
            None => {
                return Err(HostError::invalid(format!(
                    "be:birth(\"{name}\"): birthHere=true but parent has no current position."
                )))
            }
        }
    } else {
        home_space.clone()
    };

    // ── Resolve coord. An explicit coord is bounds-checked against the position space's size; an absent
    // coord is auto-picked in-bounds when the position space carries a size (else left null — the
    // portal's hash-ring fallback handles a sizeless space). ──
    let resolved_coord = resolve_coord(root, &history, params, &position)?;

    // ── Build the be:birth fact spec (the stamped factSpec, MINUS the credential password the seal
    // mints). Order mirrors birth.js factSpec. ──
    let mut fp: Vec<(String, Json)> = Vec::new();
    fp.push(("name".to_string(), jstr(&name)));
    fp.push((
        "defaultAble".to_string(),
        resolve_default_able(params),
    ));
    fp.push(("trueName".to_string(), jstr(&effective_true_name)));
    fp.push(("parentBeingId".to_string(), jstr(&parent_being_id)));
    fp.push(("homeSpace".to_string(), opt_str(&home_space)));
    fp.push(("homeHistory".to_string(), jstr(&history)));
    fp.push(("position".to_string(), opt_str(&position)));
    if let Some(c) = &resolved_coord {
        fp.push(("coord".to_string(), c.clone()));
    }
    if matches!(get(params, "isRemote"), Some(Json::Bool(true))) {
        fp.push(("isRemote".to_string(), Json::Bool(true)));
    }
    if let Some(hs) = get_str(params, "homeStory").filter(|s| !s.is_empty()) {
        fp.push(("homeStory".to_string(), jstr(hs)));
    }
    fp.push(("qualities".to_string(), resolve_qualities(params)));
    let fact_params = Json::Obj(fp);

    // ── The content-addressed being id: sha256 of (parentBeingId, name, homeHistory, bornAt). bornAt is
    // the be:birth act id the caller threads in spec.bornAt (the moment's actId); absent -> null. The id
    // derives from the FINALIZED spec + bornAt; the self is never inside its own hash. ──
    let id_input = obj(vec![
        ("parentBeingId", jstr(&parent_being_id)),
        ("name", jstr(&name)),
        ("homeHistory", jstr(&history)),
        ("bornAt", get(params, "bornAt").cloned().unwrap_or(Json::Null)),
    ]);
    let being_id = being_content_id(&id_input);

    Ok(obj(vec![
        ("beingId", jstr(&being_id)),
        ("factParams", fact_params),
    ]))
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
/// The default able: spec.defaultAble || spec.able || spec.ables[0] || null (birth.js order). A
/// non-human cognition REQUIRING one is a caller/seal concern (the resolver carries the resolved value;
/// null when none was supplied).
fn resolve_default_able(params: &Json) -> Json {
    if let Some(s) = get_str(params, "defaultAble").filter(|s| !s.is_empty()) {
        return jstr(s);
    }
    if let Some(s) = get_str(params, "able").filter(|s| !s.is_empty()) {
        return jstr(s);
    }
    if let Some(Json::Arr(items)) = get(params, "ables") {
        if let Some(Json::Str(first)) = items.first() {
            if !first.is_empty() {
                return jstr(first);
            }
        }
    }
    Json::Null
}

/// Qualities: spec.qualities deep-passes through when an object; else `{}`. (The auth/cognition/flow
/// SEEDS the JS merged in are seal concerns — credential.plain is a credential mint output, cognition
/// defaultKind + flow ride the caller's qualities already; the resolver carries the caller's qualities
/// verbatim.)
fn resolve_qualities(params: &Json) -> Json {
    match get(params, "qualities") {
        Some(q) if is_plain_object(q) => q.clone(),
        _ => Json::Obj(Vec::new()),
    }
}

/// An Option-like String as a Json string, or Json::Null when empty (the JS `... || null`).
fn opt_str(s: &str) -> Json {
    if s.is_empty() {
        Json::Null
    } else {
        jstr(s)
    }
}

/// Resolve the birth coord. An EXPLICIT coord (spec.coord, an object) is bounds-checked against the
/// position space's size (CoordOutOfBounds when outside). An ABSENT coord is auto-picked in-bounds when
/// the position space carries a positive (x, y) size; else left None. The pick is DETERMINISTIC (a hash
/// of the position id + name folded into the size box) so a resolver READ is reproducible — the JS used
/// Math.random for spread, which is a placement nicety, not a correctness invariant (the bounds gate is
/// the invariant; both land an in-bounds cell).
fn resolve_coord(
    root: &Path,
    history: &str,
    params: &Json,
    position: &str,
) -> Result<Option<Json>, HostError> {
    if let Some(coord) = get(params, "coord") {
        if !matches!(coord, Json::Null) {
            if !is_plain_object(coord) {
                return Err(HostError::invalid(
                    "be:birth: `coord` must be an object {x, y, z?} or null",
                ));
            }
            if position.is_empty() {
                return Ok(Some(coord.clone()));
            }
            let size = load_space_size(root, history, position);
            crate::toolkit::assert_coord_within_size_pub(coord, &size, "be:birth", "space")?;
            return Ok(Some(coord.clone()));
        }
        // explicit null coord -> no coord (the reducer omits it).
        return Ok(None);
    }
    // No explicit coord: auto-pick in-bounds inside the position space's size, when there is one.
    if position.is_empty() {
        return Ok(None);
    }
    let size = load_space_size(root, history, position);
    let (sx, sy) = match (axis(&size, "x"), axis(&size, "y")) {
        (Some(x), Some(y)) if x > 0.0 && y > 0.0 => (x, y),
        _ => return Ok(None), // no positive (x, y) size -> no coord (hash-ring fallback handles it).
    };
    // Deterministic in-bounds cell from a hash of (position, name).
    let name = get_str(params, "name").unwrap_or("");
    let seed = treehash::sha256_hex(format!("birth-coord\0{position}\0{name}").as_bytes());
    let h0 = u64::from_str_radix(&seed[0..16], 16).unwrap_or(0);
    let h1 = u64::from_str_radix(&seed[16..32], 16).unwrap_or(0);
    let cx = (h0 % (sx.trunc() as u64).max(1)) as f64;
    let cy = (h1 % (sy.trunc() as u64).max(1)) as f64;
    Ok(Some(obj(vec![("x", Json::Num(cx)), ("y", Json::Num(cy))])))
}

/// A positive finite size axis as f64, or None.
fn axis(size: &Json, a: &str) -> Option<f64> {
    match get(size, a) {
        Some(Json::Num(n)) if n.is_finite() && *n > 0.0 => Some(*n),
        _ => None,
    }
}
