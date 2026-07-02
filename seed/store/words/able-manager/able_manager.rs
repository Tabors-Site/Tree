// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// able_manager.rs — the live able-authoring floor see-ops, ported native (ableManagerHost.js, the host
// floor for set-able.word / delete-able.word). The DECISIONS live in the `.word`: every gate
// (valid-able-name / valid-able-cognition; able-registered / able-deletable / able-blocks-delete) is a
// `.word` PREDICATE (a condition the grammar expresses inline, NOT a `see` escape — the parser does not
// lower them, so the survey does not see them and they are enforced in the word). This wave ports the
// two genuine see escapes the survey flags:
//
//   author-able(params)   build the live able's canonical word-set (the picker inputs collapsed into the
//                         `can` granted-word list + the able qualities), VALIDATE the shape, and RETURN
//                         { written, name, origin, hotRegistered, ableQualities, manifestName } — the
//                         block set-able.word surfaces (written/name/origin/hotRegistered) plus the
//                         built manifest spec for the caller to stamp.
//   remove-able(name)     RETURN { deleted, name, manifestName } — the block delete-able.word surfaces.
//
// HONEST IMPURITY DEFERRAL (the cut this port makes): in JS, author-able / remove-able are NOT pure
// reads — they WRITE the `.ables/<name>` manifest child (addManifestChild / removeManifestChild — a
// do:makespace / do:end-space chain write on the .ables heaven space reel) AND hot-(un)register the
// able in an in-memory registry (registerAble / unregisterAble — live without a restart). A treehost
// resolver lays NO fact and the Rust able-word fold / in-memory registry are not yet ported, so this
// bridge ports the VALIDATION + the manifest-child SPEC and DEFERS:
//   - the manifest WRITE (the do:makespace / do:end-space on .ables) -> caller-side seal, the SAME
//     cut config.rs / model.rs make for the 5D NAME-ACT seal (the resolver returns the spec, the seal
//     lays the fact). The returned `manifestName` + `ableQualities` carry what the write needs.
//   - the in-memory HOT-REGISTER -> deferred with the able-word fold (the SAME deferral grant's
//     `able-exists` / makematter's extension-type gate make). `hotRegistered: true` is preserved as
//     the byte-compatible return the `.word` reads; the live-registry effect lands when the fold ports.
// The `.ables` parent heaven space is read here (findByHeavenSpace, on-disk via toolkit) to confirm the
// scaffold is planted — the read half of the manifest write the seal completes.

use std::path::Path;

use treehash::Json;

use crate::toolkit::{self, get, jstr, obj};
use crate::{arg, AuthCtx, HostError};

/// The HEAVEN_SPACE.ABLES marker ("ables" — heavenSpaces.js HEAVEN_SPACE.ABLES).
const HEAVEN_ABLES: &str = "ables";

// ── parse-lines (ableManagerHost.js parseLines) ──────────────────────────────────────────────────────
/// One entry per line: a string splits on `\r?\n`, trims, drops blanks; an array maps to non-empty
/// strings; anything else is empty. The canSee/canDo/canBe picker inputs.
fn parse_lines(value: &Json) -> Vec<String> {
    match value {
        Json::Arr(items) => items
            .iter()
            .filter_map(|v| match v {
                Json::Str(s) if !s.is_empty() => Some(s.clone()),
                Json::Str(_) => None,
                // JS String(x) on a non-string array entry; only non-empty survive Boolean filter.
                other => {
                    let s = stringify_scalar(other);
                    if s.is_empty() {
                        None
                    } else {
                        Some(s)
                    }
                }
            })
            .collect(),
        Json::Str(s) => s
            .split('\n')
            .map(|line| line.trim_end_matches('\r').trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// JS String(x) for the simple scalars parse_lines may meet in an array (numbers/bools); objects are not
/// expected on the line-list path (canCall keeps objects on its own branch).
fn stringify_scalar(v: &Json) -> String {
    match v {
        Json::Str(s) => s.clone(),
        Json::Num(n) => {
            if n.fract() == 0.0 {
                format!("{}", *n as i64)
            } else {
                format!("{n}")
            }
        }
        Json::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

/// One `{ verb, word }` granted-word entry.
fn can_entry(verb: &str, word: &str) -> Json {
    obj(vec![("verb", jstr(verb)), ("word", jstr(word))])
}

// ── author-able ───────────────────────────────────────────────────────────────────────────────────────
/// author-able(params) -> the live able spec + the surfaced block. Collapses the picker inputs
/// (canSee/canDo/canCall/canBe) into the canonical `can` granted-word-set (each entry carrying its
/// verb), builds the `ableQualities` the manifest child carries, and returns the block. The manifest
/// WRITE + the hot-register are caller-side seal deferrals (see the module header).
pub fn author_able(
    root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let params = arg(args, 0);
    let name = match toolkit::get_str(params, "name") {
        Some(s) => s.trim().to_string(),
        None => String::new(),
    };
    if name.is_empty() {
        return Err(HostError::invalid("set-able: `name` is required"));
    }

    let required_cognition = match toolkit::get_str(params, "requiredCognition") {
        Some(s) if !s.trim().is_empty() => jstr(s.trim()),
        _ => Json::Null,
    };

    let can_see = parse_lines(get(params, "canSee").unwrap_or(&Json::Null));
    let can_do = parse_lines(get(params, "canDo").unwrap_or(&Json::Null));
    // canCall keeps objects verbatim; a string entry becomes { verb:"call", word }.
    let can_call_raw = get(params, "canCall").unwrap_or(&Json::Null);
    let can_be = parse_lines(get(params, "canBe").unwrap_or(&Json::Null));
    let prompt = match get(params, "prompt") {
        Some(Json::Str(s)) => s.clone(),
        _ => String::new(),
    };

    // Collapse the picker inputs into the canonical granted-word-set `can` — each carries its verb.
    let mut can: Vec<Json> = Vec::new();
    for w in &can_see {
        can.push(can_entry("see", w));
    }
    for w in &can_do {
        can.push(can_entry("do", w));
    }
    for entry in can_call_entries(can_call_raw) {
        can.push(entry);
    }
    for w in &can_be {
        can.push(can_entry("be", w));
    }

    // permissions: the de-duplicated verb set (insertion order: see, do, call, be — as encountered).
    let mut permissions: Vec<Json> = Vec::new();
    for e in &can {
        if let Some(v) = toolkit::get_str(e, "verb") {
            if !permissions.iter().any(|p| matches!(p, Json::Str(s) if s == v)) {
                permissions.push(jstr(v));
            }
        }
    }

    let able_qualities = obj(vec![
        ("cognition", Json::Null), // live ables don't carry cognition (it's on the being)
        ("requiredCognition", required_cognition.clone()),
        ("permissions", Json::Arr(permissions)),
        ("respondMode", jstr("async")),
        ("triggerOn", Json::Arr(vec![jstr("message")])),
        ("can", Json::Arr(can)),
        ("replyTo", Json::Null),
        ("prompt", jstr(&prompt)),
        ("origin", jstr("live")),
    ]);

    // The read half of the manifest write: confirm the `.ables` heaven space is planted (the seal lays
    // the manifest child under it). A missing scaffold is an internal fault (heaven not bootstrapped).
    if toolkit::heaven_space_id(root, HEAVEN_ABLES).is_none() {
        return Err(HostError::new(
            crate::Reason::Internal,
            "set-able: the .ables heaven space was not found; story is not properly bootstrapped",
        ));
    }

    Ok(obj(vec![
        ("written", Json::Bool(true)),
        ("name", jstr(&name)),
        ("origin", jstr("live")),
        ("hotRegistered", Json::Bool(true)),
        // the built manifest spec for the caller-side seal (the .word ignores these extra fields).
        ("manifestName", jstr(&name)),
        ("ableQualities", able_qualities),
    ]))
}

/// The canCall granted-word entries: an array keeps each entry verbatim (a string -> { verb:"call",
/// word }, an object -> { verb:"call", ...entry }); a string value splits to lines, each a word.
fn can_call_entries(value: &Json) -> Vec<Json> {
    match value {
        Json::Arr(items) => items
            .iter()
            .map(|w| match w {
                Json::Str(s) => can_entry("call", s),
                Json::Obj(fields) => {
                    // { verb:"call", ...entry } — entry fields win except verb is forced to "call"
                    // only when absent (the JS spread sets verb:"call" FIRST, so an entry's own verb
                    // overrides). Mirror: start from the entry, ensure a verb (default "call").
                    let mut out: Vec<(String, Json)> = vec![("verb".to_string(), jstr("call"))];
                    for (k, v) in fields {
                        if k == "verb" {
                            if let Some(slot) = out.iter_mut().find(|(kk, _)| kk == "verb") {
                                slot.1 = v.clone();
                            }
                        } else {
                            out.push((k.clone(), v.clone()));
                        }
                    }
                    Json::Obj(out)
                }
                _ => can_entry("call", ""),
            })
            .collect(),
        Json::Str(_) => parse_lines(value)
            .iter()
            .map(|w| can_entry("call", w))
            .collect(),
        _ => Vec::new(),
    }
}

// ── remove-able ───────────────────────────────────────────────────────────────────────────────────────
/// remove-able(name) -> { deleted, name, manifestName }. The manifest child REMOVE (do:end-space on
/// .ables) + the unregister are caller-side seal deferrals (see the module header). `deleted: true` is
/// the byte-compatible return delete-able.word reads.
pub fn remove_able(
    root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let name = match arg(args, 0) {
        Json::Str(s) => s.trim().to_string(),
        _ => String::new(),
    };
    if name.is_empty() {
        return Err(HostError::invalid("delete-able: `name` is required"));
    }
    // The read half: confirm the `.ables` scaffold is planted (the seal removes the child under it).
    if toolkit::heaven_space_id(root, HEAVEN_ABLES).is_none() {
        return Err(HostError::new(
            crate::Reason::Internal,
            "delete-able: the .ables heaven space was not found; story is not properly bootstrapped",
        ));
    }
    Ok(obj(vec![
        ("deleted", Json::Bool(true)),
        ("name", jstr(&name)),
        ("manifestName", jstr(&name)),
    ]))
}
