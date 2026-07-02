// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// grant.rs — resolve_grant, the floor see-op for grant-able.word's ONE escape: `able-exists(able)` —
// the able-registry lookup (grantHost.js getAble). A able can't be granted unless it is REGISTERED. A
// bounded fold READ, not a clock or chain write: the grant record is NOT assembled here — it is the
// fact's own params (able + anchor), its SIGNER (grantedBy = the grantor's being, read off `through` by
// the reducer), and its PLACE in the chain (the when, no clock read). `able-exists` returns a bool the
// `.word` binds; a false turns into its `as invalid-input` refusal.
//
// THE REGISTRY (deferred, same shape as matter.rs's type registry): the JS able registry is FOLDED from
// the store's able-words (the "all rules fold" doctrine — `listAbleWordNames` reads every `<able>.word`
// in the ables dir; `getAble` looks the folded able up). There is NO static seed set to mirror, and the
// Rust able-word fold is not yet ported. So the bridge validates the able is a WELL-FORMED non-empty
// kebab identifier (the gate SHAPE: an empty / blank / malformed able is refused); the registry-
// membership check resolves from the able-word fold (the deferred refinement), exactly as makematter
// defers the extension matter-type to the word-fold. The gate is meaningful (rejects the bad shapes)
// without inventing a wrong static allowlist.

use std::path::Path;

use treehash::Json;

use crate::{arg, AuthCtx, HostError};

/// Dispatch the grantHost.js family on `op` (today only `able-exists`).
pub fn resolve_grant(
    op: &str,
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    match op {
        "able-exists" => {
            let able = match arg(args, 0) {
                Json::Str(s) => s.as_str(),
                _ => "",
            };
            Ok(Json::Bool(is_well_formed_able(able)))
        }
        other => Err(HostError::invalid(format!(
            "host: unknown grant see-op \"{other}\""
        ))),
    }
}

/// A well-formed able identifier: a non-empty kebab token (lowercase letters / digits / `-`), not
/// leading/trailing/doubled `-`. The bounded shape gate the bridge enforces in place of the deferred
/// able-word fold's registry-membership check.
fn is_well_formed_able(able: &str) -> bool {
    if able.is_empty() || able.starts_with('-') || able.ends_with('-') || able.contains("--") {
        return false;
    }
    able
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
