// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// cherub.rs — the floor see-ops for the three cherub BE words (kill.word / switch.word /
// truename.word). Each control strand reaches through `see` for an irreducible substrate read; the
// KILL/SWITCH/TRUENAME authority is the verb's able-walk (the AuthCtx input), NOT a floor read.
//
//   resolve_kill (killHost.js):
//     resolve-target-being(beingName) -> the target being id from the address handle (findByName on the
//       ACT's history — a being's fact chain is per-history; no silent "0"). null when not found.
//
//   resolve_switch (switchHost.js):
//     destination-missing(history) -> not-found OR deleted (both invalid-input). main always exists.
//     destination-paused(history)  -> the destination history is frozen for writes. main is never paused.
//     being-lives-on(caller, history) -> the caller's reel folds to a LIVING birth there (a name + not
//       dead), else a switch would stamp the first fact of an orphan reel.
//
//   resolve_truename (truenameHost.js):
//     resolve-name-id(token)  -> a pubkey-or-real-name token to a canonical nameId ("i-am" literal, a
//       key id verbatim, else findByName("name") on main). null when none resolves.
//     name-exists(nameId)     -> the Name EXISTS on main (the library catalog entry).
//     name-banished(nameId)   -> the Name is banished (the catalog entry's `closed`).
//
// Each returns a scalar (an id string, or a bool / null) the `.word` binds. No fact laid; the only
// HostError is the unknown-op reject. Composes find_by_name + load_row + the toolkit's name catalog +
// treestore::load_history; reimplements nothing (the same primitives the JS branches called).

use std::path::Path;

use treehash::Json;

use crate::being::branch_or;
use crate::toolkit::{find_name_id, get, get_str, is_i_name, jstr, load_row, name_banished, name_declared};
use crate::{arg, AuthCtx, HostError};

// ── resolve_kill (killHost.js) ──────────────────────────────────────────────────────────────────────
/// resolve-target-being(beingName) -> the target being id (a string), or Json::Null when not found.
pub fn resolve_kill(
    op: &str,
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    match op {
        "resolve-target-being" => Ok(target_being(root, history, arg(args, 0))),
        other => Err(HostError::invalid(format!(
            "host: unknown cherub kill see-op \"{other}\""
        ))),
    }
}

// ── resolve_switch (switchHost.js) ───────────────────────────────────────────────────────────────────
/// The switch destination reads. `op` selects which: destination-missing / destination-paused /
/// being-lives-on. Each returns a bool the `.word` binds.
pub fn resolve_switch(
    op: &str,
    root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    match op {
        "destination-missing" => {
            let h = str_arg(arg(args, 0));
            if treestore::is_main(&h) {
                return Ok(Json::Bool(false)); // main always exists.
            }
            // not-found OR deleted (both invalid-input).
            let missing = match treestore::load_history(root, &h) {
                None => true,
                Some(row) => matches!(get(&row, "deleted"), Some(Json::Bool(true))),
            };
            Ok(Json::Bool(missing))
        }
        "destination-paused" => {
            let h = str_arg(arg(args, 0));
            if treestore::is_main(&h) {
                return Ok(Json::Bool(false)); // main is never paused.
            }
            let paused = match treestore::load_history(root, &h) {
                Some(row) => matches!(get(&row, "paused"), Some(Json::Bool(true))),
                None => false,
            };
            Ok(Json::Bool(paused))
        }
        "being-lives-on" => {
            let caller = str_arg(arg(args, 0));
            let h = str_arg(arg(args, 1));
            // The being's reel folds to a LIVING birth on that history's lineage view: a name (born here)
            // and not dead.
            let slot = load_row(root, &h, "being", &caller);
            let has_name = get_str(&slot, "name").map(|s| !s.is_empty()).unwrap_or(false);
            let dead = matches!(
                get(&slot, "qualities").and_then(|q| get(q, "dead")),
                Some(v) if !matches!(v, Json::Null)
            );
            Ok(Json::Bool(has_name && !dead))
        }
        other => Err(HostError::invalid(format!(
            "host: unknown cherub switch see-op \"{other}\""
        ))),
    }
}

// ── resolve_truename (truenameHost.js) ───────────────────────────────────────────────────────────────
/// The truename Name reads. `op` selects which: resolve-name-id / name-exists / name-banished.
pub fn resolve_truename(
    op: &str,
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    match op {
        // resolve a pubkey-or-real-name token to a canonical nameId. "i-am" is the story root's literal
        // id; a key id (z-prefixed) is already a nameId; else findByName("name") on main.
        "resolve-name-id" => {
            let token = str_arg(arg(args, 0));
            if token.is_empty() {
                return Ok(Json::Null);
            }
            if token == "i-am" {
                return Ok(jstr("i-am"));
            }
            if is_key_id(&token) {
                return Ok(jstr(&token));
            }
            // Names live on main ("0").
            Ok(match find_name_id(root, "0", "name", &token) {
                Some(id) => jstr(&id),
                None => Json::Null,
            })
        }
        // the Name EXISTS on main (the library catalog entry; I is the literal root).
        "name-exists" => {
            let name_id = str_arg(arg(args, 0));
            Ok(Json::Bool(!name_id.is_empty() && name_declared(root, &name_id)))
        }
        // the Name is banished (the catalog entry's `closed`).
        "name-banished" => {
            let name_id = str_arg(arg(args, 0));
            Ok(Json::Bool(name_banished(root, &name_id)))
        }
        other => {
            // The truename branch also resolves the target being via resolve-target-being (shared with
            // kill); route it here too so a truename word's `see` is fully served.
            if other == "resolve-target-being" {
                return Ok(target_being(root, history, arg(args, 0)));
            }
            Err(HostError::invalid(format!(
                "host: unknown cherub truename see-op \"{other}\""
            )))
        }
    }
}

// ── shared helpers ───────────────────────────────────────────────────────────────────────────────────
/// findByName("being", beingName) on the ACT's history -> the being id, or Json::Null. The kill /
/// truename target resolve (a being's fact chain is per-history; resolve on the branch the act is on).
fn target_being(root: &Path, history: &str, name: &Json) -> Json {
    let name = match name {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        _ => return Json::Null,
    };
    let history = branch_or(&Json::Null, history);
    match find_name_id(root, &history, "being", name) {
        Some(id) => jstr(&id),
        None => Json::Null,
    }
}

/// isKeyId (name/keys.js): a "z"-prefixed base58btc multicodec key id. The bridge checks the leading
/// sigil + a bounded length (the cheap discriminator the JS uses before any decode); a malformed body
/// is not a real key but is treated as a key TOKEN here (the JS `resolveNameId` returns it verbatim and
/// a later verify would reject it — the resolve step only classifies the token shape).
fn is_key_id(s: &str) -> bool {
    s.len() > 1 && s.len() <= 64 && s.starts_with('z') && !is_i_name(s)
}

fn str_arg(v: &Json) -> String {
    match v {
        Json::Str(s) => s.clone(),
        _ => String::new(),
    }
}
