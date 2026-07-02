// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// config.rs — the two story-config host see-ops, ported native (storyConfig.js configHostEnv):
//
//   resolve-config-set    (resolve-config-set):    validate key + value-required + value-size, the
//       PROTECTED_KEYS gate (the I-Am writes seedVersion / disabledExtensions; others refused), and
//       RETURN { key, value, factParams:{ key, value } } — the config-set 5D NAME-ACT's params.
//   resolve-config-delete (resolve-config-delete): validate key + the PROTECTED_KEYS gate, and RETURN
//       { key, factParams:{ key } } (bodiless) — the config-delete NAME-ACT's params.
//
// Each is a PURE validation (no fold, no I/O); it lays NO fact and mutates nothing. The JS host threw
// plain `Error`s here (not IbpError), so the refusal taxonomy maps to `InvalidInput` (a config shape
// refusal). The cache `after-name-act` refresh + the actual name-act SEAL stay caller-side (the 5D
// NAME-ACT path), exactly the cut the JS .word made: "this VALIDATES and RETURNS factParams".

use std::path::Path;

use treehash::Json;

use crate::toolkit::{jstr, obj};
use crate::{arg, AuthCtx, HostError};

// ── the config-key + value gates (storyConfig.js validateKey / validateValue / PROTECTED_KEYS) ──────
/// `/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/` — alphanumeric + underscores, leading letter, max 64 chars.
fn valid_config_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return false;
    }
    if !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    bytes[1..].iter().all(|b| b.is_ascii_alphanumeric() || *b == b'_')
}

/// The reserved prototype-pollution key set (DANGEROUS_KEYS).
const DANGEROUS_KEYS: &[&str] = &[
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "valueOf",
    "hasOwnProperty",
];

/// The protected keys (PROTECTED_KEYS) — scaffold-only; only the I-Am writes/deletes them.
const PROTECTED_KEYS: &[&str] = &["seedVersion", "disabledExtensions"];

/// JSON.stringify(value).length, the byte budget validateValue caps at 65536.
const MAX_VALUE_BYTES: usize = 65536;

/// validateKey: throw the SAME Errors the JS did (non-string is upstream-gated to a String; here the
/// shape + reserved-key gates). Returns Ok or the byte-matched refusal.
fn validate_key(key: &str) -> Result<(), HostError> {
    if !valid_config_key(key) {
        return Err(HostError::invalid(format!(
            "Invalid config key \"{key}\". Must be alphanumeric + underscores, start with letter, max 64 chars."
        )));
    }
    if DANGEROUS_KEYS.contains(&key) {
        return Err(HostError::invalid(format!("Config key \"{key}\" is reserved")));
    }
    Ok(())
}

/// validateValue: the JSON-serializable + 65536-byte cap gate. `undefined` (Json::Null upstream) is
/// allowed through by the JS `if (value === undefined) return`; the set path rejects null BEFORE this.
fn validate_value(value: &Json) -> Result<(), HostError> {
    // treehash::canonicalize is the byte-form; the JS measured JSON.stringify(value).length. The
    // canonical form is a faithful upper-bound twin for the sanity cap (the gate is generous, not exact).
    let size = treehash::canonicalize(value).len();
    if size > MAX_VALUE_BYTES {
        return Err(HostError::invalid(format!(
            "Config value exceeds {MAX_VALUE_BYTES} byte limit ({size} bytes)"
        )));
    }
    Ok(())
}

/// The I-Am internal carve-out: `(caller ?? ctx.identity.beingId) === I`. The bridge has `caller` as the
/// .word's standard-trigger arg + `ctx.is_i`; either being I lets the protected-key write through.
fn is_internal(caller: &Json, ctx: &AuthCtx) -> bool {
    if ctx.is_i {
        return true;
    }
    match caller {
        Json::Str(s) => crate::toolkit::is_i_name(s),
        _ => ctx.actor_being_id.as_deref().map(crate::toolkit::is_i_name).unwrap_or(false),
    }
}

// ── resolve-config-set ──────────────────────────────────────────────────────────────────────────────
/// resolve-config-set(key, value, caller) -> { key, value, factParams:{ key, value } }.
/// Validates key + value-required + the PROTECTED_KEYS gate (I-internal bypass) + value size. The
/// config-set NAME-ACT carries { key, value } as its bodiless params; the dispatcher lays it.
pub fn resolve_config_set(
    _root: &Path,
    _history: &str,
    args: &[Json],
    ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let key = arg(args, 0);
    let value = arg(args, 1);
    let caller = arg(args, 2);

    let key = match key {
        Json::Str(s) => s.as_str(),
        _ => return Err(HostError::invalid("Config key must be a string")),
    };
    validate_key(key)?;
    if matches!(value, Json::Null) {
        return Err(HostError::invalid(
            "set-config: `value` is required (use delete-config to remove)",
        ));
    }
    if PROTECTED_KEYS.contains(&key) && !is_internal(caller, ctx) {
        return Err(HostError::invalid(format!(
            "Config key \"{key}\" is protected and cannot be modified manually"
        )));
    }
    validate_value(value)?;

    let fp = obj(vec![("key", jstr(key)), ("value", value.clone())]);
    Ok(obj(vec![
        ("key", jstr(key)),
        ("value", value.clone()),
        ("factParams", fp),
    ]))
}

// ── resolve-config-delete ─────────────────────────────────────────────────────────────────────────────
/// resolve-config-delete(key, caller) -> { key, factParams:{ key } } (bodiless). Validates key + the
/// PROTECTED_KEYS gate (I-internal bypass).
pub fn resolve_config_delete(
    _root: &Path,
    _history: &str,
    args: &[Json],
    ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let key = arg(args, 0);
    let caller = arg(args, 1);

    let key = match key {
        Json::Str(s) => s.as_str(),
        _ => return Err(HostError::invalid("Config key must be a string")),
    };
    validate_key(key)?;
    if PROTECTED_KEYS.contains(&key) && !is_internal(caller, ctx) {
        return Err(HostError::invalid(format!(
            "Config key \"{key}\" is protected and cannot be deleted manually"
        )));
    }

    let fp = obj(vec![("key", jstr(key))]);
    Ok(obj(vec![("key", jstr(key)), ("factParams", fp)]))
}
