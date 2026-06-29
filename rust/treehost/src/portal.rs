// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// portal.rs — the portal host see-op that is a pure SUBSTRATE read (portalHost.js):
//
//   resolve-containing-space(target) -> the space id the portal forms in (a string), or null.
//
// The space the portal forms in: a space target IS its own containing space; a matter target's
// containing space is the matter's spaceId (a by-id matter LOAD — the kind-dispatch the see-forms can't
// yet shape). Null when the matter has no space (the JS SPACE_NOT_FOUND) or the target is neither kind
// (the JS INVALID_INPUT) — both surface as the .word's "cannot determine containing space" refusal.
//
// portal.word's OTHER see-ops (has-address / valid-address) are IBPA-shape regex checks the Word grammar
// can express as conditions; only this one — the by-id matter fold — is the irreducible substrate read,
// so it is the lone portal op ported here. It lays NO fact.

use std::path::Path;

use treehash::Json;

use crate::toolkit::{get, get_str, jstr, load_row};
use crate::{arg, AuthCtx, HostError};

// ── resolve-containing-space ────────────────────────────────────────────────────────────────────────
/// resolve-containing-space(target) -> the containing space id (string) or Json::Null. A space target is
/// its own space; a matter target's space is its folded `spaceId`. Returns Null for a matter with no
/// space or a target of neither kind (the .word refuses on a falsy result).
pub fn resolve_containing_space(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
    let kind = get_str(target, "kind");
    let id = match get(target, "id") {
        Some(Json::Str(s)) if !s.is_empty() => Some(s.clone()),
        Some(Json::Num(n)) if *n != 0.0 => Some(treehash::canonicalize(&Json::Num(*n))),
        _ => None,
    };

    match kind {
        Some("space") => Ok(match id {
            Some(s) => jstr(&s),
            None => Json::Null,
        }),
        Some("matter") => {
            let id = match id {
                Some(s) => s,
                None => return Ok(Json::Null),
            };
            let row = load_row(root, history, "matter", &id);
            match get_str(&row, "spaceId").filter(|s| !s.is_empty()) {
                Some(sp) => Ok(jstr(sp)),
                None => Ok(Json::Null),
            }
        }
        _ => Ok(Json::Null),
    }
}
