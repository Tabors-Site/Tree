// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// history_pointers.rs — the history-pointer floor see-ops, ported native (historyManagerHost.js, the
// host env for history-manager.word / delete-pointer.word). The CONTROL strand (the gate chain: caller
// present, name valid, canonical valid, .histories space resolved) is the `.word`; these are its
// genuine SUBSTRATE reads + pure computes:
//
//   valid-pointer-name(name)            isPointerName: the pointer-name grammar gate. Returns the
//                                       NORMALIZED (trim + lowercase) name when valid, else null (the
//                                       `.word` reads `If no validName:` to refuse). The normalization
//                                       rides here so the value the .word writes is what the JS wrote.
//   valid-canonical(canonical)          the structural history-path check (CANONICAL_PATH_RE). Returns
//                                       the trimmed path when valid, else null.
//   find-pointers-space-id()            findPointersSpaceId: the `.histories` HEAVEN space id (or null
//                                       when heaven is not planted — the `.word` refuses INTERNAL).
//   read-pointers()                     readPointers: the full pointer map from the `.histories` heaven
//                                       space's qualities.pointers (MAIN-pinned; `main` always present).
//   set-pointer-map(current, name, canonical)  the NEXT pointer map + the previous target. A pure
//                                       compute, NO fact (the `.word` stamps it via `replace the space
//                                       historiesSpace's qualities.pointers`).
//   delete-pointer-map(current, name)   the PRUNED map when the name is present, else null (the no-op).
//
// Pure substrate: every read is a fold of the `.histories` heaven space reel (heaven NEVER branches, so
// it lives on MAIN "0"); every compute is a map merge/prune. It lays NO fact and mutates nothing.
// `is-reserved-pointer` is a `.word` PREDICATE (a condition the grammar expresses, not a `see` escape),
// so it is enforced inline and not a resolver here.

use std::path::Path;

use treehash::Json;

use crate::toolkit::{self, get, jstr, obj};
use crate::{arg, AuthCtx, HostError};

/// MAIN — the canonical canopy history ("0"), the default `main` pointer target (histories.js MAIN).
const MAIN: &str = "0";

/// The HEAVEN_SPACE.HISTORIES marker ("histories" — heavenSpaces.js HEAVEN_SPACE.HISTORIES).
const HEAVEN_HISTORIES: &str = "histories";

// ── the pointer-name grammar (historyRegistry.js isPointerName / POINTER_NAME_RE) ────────────────────
/// `/^[a-z](?:[a-z0-9]|-[a-z0-9])*$/` + length 1..64 — start lowercase letter, then lowercase-
/// alphanumeric or a single `-` always followed by an alphanumeric (so no leading/trailing/consecutive
/// hyphens). Byte-identical to the JS regex (every hyphen demands a following alphanumeric).
fn is_pointer_name(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return false;
    }
    // first char: a lowercase letter.
    if !bytes[0].is_ascii_lowercase() {
        return false;
    }
    let mut i = 1;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_lowercase() || b.is_ascii_digit() {
            i += 1;
            continue;
        }
        if b == b'-' {
            // a hyphen MUST be followed by an alphanumeric (no trailing / consecutive hyphen).
            let next = match bytes.get(i + 1) {
                Some(n) => *n,
                None => return false,
            };
            if !(next.is_ascii_lowercase() || next.is_ascii_digit()) {
                return false;
            }
            i += 2;
            continue;
        }
        return false; // any other byte (uppercase, whitespace, …) fails.
    }
    true
}

// ── the canonical-path grammar (historyManagerHost.js CANONICAL_PATH_RE) ─────────────────────────────
/// `/^(?:0|\d+(?:[a-z]+\d+)*(?:[a-z]+)?)$/` — either the literal "0", or one-or-more digits followed by
/// zero-or-more (letters-then-digits) groups and an optional trailing letter run (the HISTORY_RE shape:
/// `1`, `1a`, `7b3`, `12a3b`, `3ab`). Ported as a small hand-rolled scanner (no regex dep).
fn is_canonical_path(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    if s == "0" {
        return true;
    }
    let mut i = 0;
    // leading run: one-or-more digits.
    let start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == start {
        return false; // must start with a digit (and "0" already handled).
    }
    // zero-or-more (letters+ then digits+) groups.
    loop {
        let letters_start = i;
        while i < bytes.len() && bytes[i].is_ascii_lowercase() {
            i += 1;
        }
        let has_letters = i > letters_start;
        let digits_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        let has_digits = i > digits_start;
        if has_letters && has_digits {
            continue; // a full letters-then-digits group: keep going.
        }
        // not a full group: the only legal tail is an optional trailing letter run (already consumed by
        // has_letters when has_digits is false). Anything left means a malformed shape.
        if has_letters && !has_digits {
            // a trailing letter run consumed; nothing more may follow.
            return i == bytes.len();
        }
        // neither letters nor digits at this position: valid iff we are at the end.
        return i == bytes.len();
    }
}

// ── valid-pointer-name ────────────────────────────────────────────────────────────────────────────────
/// valid-pointer-name(name) -> the normalized (trim + lowercase) name when it matches the grammar, else
/// null. The `.word` reads `If no validName:` to refuse; the normalized value is what gets written.
pub fn valid_pointer_name(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let raw = match arg(args, 0) {
        Json::Str(s) => s.as_str(),
        _ => "",
    };
    let n = raw.trim().to_lowercase();
    if is_pointer_name(&n) {
        Ok(jstr(&n))
    } else {
        Ok(Json::Null)
    }
}

// ── valid-canonical ───────────────────────────────────────────────────────────────────────────────────
/// valid-canonical(canonical) -> the trimmed path when it matches CANONICAL_PATH_RE, else null.
pub fn valid_canonical(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let raw = match arg(args, 0) {
        Json::Str(s) => s.as_str(),
        _ => "",
    };
    let c = raw.trim();
    if is_canonical_path(c) {
        Ok(jstr(c))
    } else {
        Ok(Json::Null)
    }
}

// ── find-pointers-space-id ────────────────────────────────────────────────────────────────────────────
/// find-pointers-space-id() -> the `.histories` heaven space id, or null when heaven is not planted.
/// Heaven never branches: the read is MAIN-pinned (toolkit::heaven_space_id on "0").
pub fn find_pointers_space_id(
    root: &Path,
    _history: &str,
    _args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    match toolkit::heaven_space_id(root, HEAVEN_HISTORIES) {
        Some(id) => Ok(jstr(&id)),
        None => Ok(Json::Null),
    }
}

// ── read-pointers ─────────────────────────────────────────────────────────────────────────────────────
/// read-pointers() -> the pointer map from the `.histories` heaven space's qualities.pointers, defaulting
/// to `{ main: "0" }` when the space is unplanted or carries no pointers. `main` is always ensured present
/// (the JS _readPointerMap defensive default), mirroring readPointers byte-for-byte.
pub fn read_pointers(
    root: &Path,
    _history: &str,
    _args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let default_map = || obj(vec![("main", jstr(MAIN))]);
    let quals = match toolkit::heaven_space_qualities(root, HEAVEN_HISTORIES) {
        Some((_, q)) => q,
        None => return Ok(default_map()),
    };
    let ptrs = match get(&quals, "pointers") {
        Some(Json::Obj(e)) => e.clone(),
        _ => return Ok(default_map()),
    };
    // Ensure `main` is present (a non-empty string), defaulting to MAIN (the JS defensive default).
    let mut out = ptrs;
    let main_ok = out
        .iter()
        .any(|(k, v)| k == "main" && matches!(v, Json::Str(s) if !s.is_empty()));
    if !main_ok {
        out.retain(|(k, _)| k != "main");
        out.push(("main".to_string(), jstr(MAIN)));
    }
    Ok(Json::Obj(out))
}

// ── set-pointer-map ───────────────────────────────────────────────────────────────────────────────────
/// set-pointer-map(current, name, canonical) -> { map: { ...current, [name]: canonical }, previous }.
/// `previous` is `current[name]` when present, else null. A pure compute, NO fact (the `.word` stamps
/// the map via `replace the space historiesSpace's qualities.pointers`).
pub fn set_pointer_map(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let current = arg(args, 0);
    let name = match arg(args, 1) {
        Json::Str(s) => s.clone(),
        _ => String::new(),
    };
    let canonical = arg(args, 2).clone();

    let mut map: Vec<(String, Json)> = match current {
        Json::Obj(e) => e.clone(),
        _ => Vec::new(),
    };
    let previous = map
        .iter()
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.clone())
        .unwrap_or(Json::Null);
    map.retain(|(k, _)| *k != name);
    map.push((name, canonical));

    Ok(obj(vec![("map", Json::Obj(map)), ("previous", previous)]))
}

// ── delete-pointer-map ────────────────────────────────────────────────────────────────────────────────
/// delete-pointer-map(current, name) -> { map: pruned } when the name is present, else null (the no-op
/// the `.word` reads `If no outcome:` for, matching the JS early return). A pure compute, NO fact.
pub fn delete_pointer_map(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let current = arg(args, 0);
    let name = match arg(args, 1) {
        Json::Str(s) => s.as_str(),
        _ => "",
    };
    let map: Vec<(String, Json)> = match current {
        Json::Obj(e) => e.clone(),
        _ => Vec::new(),
    };
    if !map.iter().any(|(k, _)| k == name) {
        return Ok(Json::Null); // name absent: the no-op.
    }
    let next: Vec<(String, Json)> = map.into_iter().filter(|(k, _)| k != name).collect();
    Ok(obj(vec![("map", Json::Obj(next))]))
}
