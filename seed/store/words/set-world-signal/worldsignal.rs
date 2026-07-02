// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// worldsignal.rs — the set-world-signal host see-ops, ported native (set-world-signal/index.js
// ableManagerHostEnv). A world signal is a write to the story root's qualities at
// `qualities.world.<namespace>.<key>`. The .word VALIDATES + authors the do:set-space factParams; the
// dispatcher lays the one fact on the story-root reel. Six pure computes / reads (NO fact):
//
//   valid-namespace(ns)      -> the single-segment kebab-case gate (NS_SEGMENT_RE).
//   valid-key(key)           -> a dotted path, every segment kebab-case.
//   parse-signal-value(v)    -> the value coercion (JSON / bare-number / true|false|null).
//   signal-field(ns, key)    -> the dynamic field path qualities.world.<ns>.<key>.
//   signal-fact(ns, key, v)  -> the do:set-space fact params { field, value }.
//   story-root()             -> the story-root space id (a READ), or null when not planted.
//
// Byte-identical to the JS: same NS_SEGMENT_RE, same parseSignalValue coercion order, same field-path
// join. story-root composes the story-root discovery (toolkit::story_root_id).

use std::path::Path;

use treehash::Json;

use crate::toolkit::{jstr, obj};
use crate::{arg, AuthCtx, HostError};

/// `/^[a-z][a-z0-9-]*$/` — one kebab-case segment (NS_SEGMENT_RE).
fn kebab_segment(s: &str) -> bool {
    let b = s.as_bytes();
    if b.is_empty() || !b[0].is_ascii_lowercase() {
        return false;
    }
    b[1..]
        .iter()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

/// The trimmed string of a Json value (the JS `String(x || "").trim()`).
fn as_trimmed(v: &Json) -> String {
    match v {
        Json::Str(s) => s.trim().to_string(),
        Json::Null => String::new(),
        other => treehash::canonicalize(other).trim().to_string(),
    }
}

// ── the six world-signal escapes ─────────────────────────────────────────────────────────────────────
/// valid-namespace(namespace) -> a single kebab-case segment.
pub fn valid_namespace(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let ns = as_trimmed(arg(args, 0));
    Ok(Json::Bool(!ns.is_empty() && kebab_segment(&ns)))
}

/// valid-key(key) -> a dotted path, every segment kebab-case.
pub fn valid_key(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let k = as_trimmed(arg(args, 0));
    if k.is_empty() {
        return Ok(Json::Bool(false));
    }
    let ok = k.split('.').map(|s| s.trim()).all(kebab_segment);
    Ok(Json::Bool(ok))
}

/// parse-signal-value(value) -> parseSignalValue: JSON / bare-number / true|false|null coercion.
pub fn parse_signal_value(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    Ok(coerce_signal_value(arg(args, 0)))
}

/// parseSignalValue(raw): a non-string is already a JSON shape (passed through); a string maps
/// "true"/"false"/"null" to literals, bare numbers to numbers, object/array/string literals to a JSON
/// parse, else the raw string.
fn coerce_signal_value(raw: &Json) -> Json {
    let s = match raw {
        Json::Null => return Json::Null,
        Json::Str(s) => s,
        other => return other.clone(), // already a JSON shape
    };
    let trimmed = s.trim();
    match trimmed {
        "true" => return Json::Bool(true),
        "false" => return Json::Bool(false),
        "null" => return Json::Null,
        _ => {}
    }
    // bare number: /^-?\d+(\.\d+)?$/
    if is_bare_number(trimmed) {
        if let Ok(n) = trimmed.parse::<f64>() {
            if !n.is_nan() {
                return Json::Num(n);
            }
        }
    }
    // object/array/quoted-string literal -> a JSON parse (fall through to raw on failure).
    let is_literal = (trimmed.starts_with('{') && trimmed.ends_with('}'))
        || (trimmed.starts_with('[') && trimmed.ends_with(']'))
        || (trimmed.starts_with('"') && trimmed.ends_with('"'));
    if is_literal {
        if let Ok(parsed) = treehash::parse(trimmed) {
            return parsed;
        }
    }
    raw.clone()
}

/// /^-?\d+(\.\d+)?$/ over a trimmed string.
fn is_bare_number(s: &str) -> bool {
    let mut chars = s.chars().peekable();
    if chars.peek() == Some(&'-') {
        chars.next();
    }
    let mut saw_digit = false;
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            saw_digit = true;
            chars.next();
        } else {
            break;
        }
    }
    if !saw_digit {
        return false;
    }
    if chars.peek() == Some(&'.') {
        chars.next();
        let mut frac = false;
        while let Some(&c) = chars.peek() {
            if c.is_ascii_digit() {
                frac = true;
                chars.next();
            } else {
                break;
            }
        }
        if !frac {
            return false;
        }
    }
    chars.next().is_none()
}

/// signal-field(namespace, key) -> the dotted field path qualities.world.<ns>.<key>.
pub fn signal_field(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    Ok(jstr(&world_field(arg(args, 0), arg(args, 1))))
}

/// signal-fact(namespace, key, value) -> { field:qualities.world.<ns>.<key>, value }.
pub fn signal_fact(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let field = world_field(arg(args, 0), arg(args, 1));
    let value = arg(args, 2).clone();
    Ok(obj(vec![("field", jstr(&field)), ("value", value)]))
}

/// `qualities.world.<ns>.<key-parts-joined>` (each key segment trimmed). The SAME join the JS builds.
fn world_field(namespace: &Json, key: &Json) -> String {
    let ns = as_trimmed(namespace);
    let key_parts: Vec<String> = as_trimmed(key)
        .split('.')
        .map(|s| s.trim().to_string())
        .collect();
    format!("qualities.world.{ns}.{}", key_parts.join("."))
}

/// story-root() -> the story-root space id (a read), or null when it isn't planted.
pub fn story_root(
    root: &Path,
    _history: &str,
    _args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    Ok(match crate::toolkit::story_root_id(root) {
        Some(id) => jstr(&id),
        None => Json::Null,
    })
}
