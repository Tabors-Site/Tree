// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// acquisition.rs — the acquisition floor see-ops, ported native (acquisitionHost.js, the host env for
// ask-able.word / take-able.word). These are the able-ACQUISITION substrate reads + the grant-record
// BUILD. The able-walk verdict + the able-spec lookup (`able-spec-for-grant`) + the idempotency check
// (`already-holds`) + the take policy (`is-grabbable`) + the queue owner read (`owner-of`) are the
// `.word`'s OTHER escapes/predicates; this wave ports the three the survey flags:
//
//   asked-policy(found)              normalizeAcquisition(spec).asked: the raw asked policy
//                                    ("auto" | "queue" | false) the §9 Match dispatches on. false flows
//                                    back as a falsy flag -> the `.word` refuses "not ask-acquirable".
//   grant-internal(caller, able, found)  buildInternalGrant: the grant RECORD, FLAT — the SAME
//                                    {able, anchorSpaceId, anchorBeingId, grantedBy} the reducer folds,
//                                    plus granteeBeingId. A pure compute, NO fact (no grantedAt: a
//                                    grant's WHEN is its fact's chain seq, never a clock). The
//                                    dispatcher's ONE auto-Fact lays the caller-attributed do:grant-able.
//   able-request(able, found, caller)    the request PAYLOAD the owner's inbox receives (a pure compute,
//                                    no fact): { able, anchorSpaceId, askerBeingId, askerName, reason }.
//                                    askerName is the asker being's folded `name` (a being row READ).
//
// Pure substrate: a policy read off the already-resolved able spec, a record build, and one being fold.
// It lays NO fact and mutates nothing. (The queue-path SUMMON — `call the owner to able-request` — is a
// transport delivery the `.word` fires, not a substrate fact; it stays a caller-side host escape, like
// cherub-connect's session ops.)

use std::path::Path;

use treehash::Json;

use crate::toolkit::{self, get, get_str, jstr, obj};
use crate::{arg, AuthCtx, HostError};

/// The genesis I-name (seedBeings.js `I = "i-am"`) — buildInternalGrant's `grantedBy ?? I` default.
const I: &str = "i-am";

// ── asked-policy ──────────────────────────────────────────────────────────────────────────────────────
/// asked-policy(found) -> the normalized acquisition.asked of the found able spec
/// (`found.spec.acquisition.asked`): "auto" / "queue" / false (the DEFAULT, and the fallback for any
/// other value). normalizeAcquisition: an `asked` of exactly "auto" | "queue" | false survives; anything
/// else (absent / garbage / a different string) is the closed default `false`.
pub fn asked_policy(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let found = arg(args, 0);
    let spec = get(found, "spec").unwrap_or(&Json::Null);
    let asked = get(spec, "acquisition").and_then(|a| get(a, "asked"));
    let out = match asked {
        Some(Json::Str(s)) if s == "auto" => jstr("auto"),
        Some(Json::Str(s)) if s == "queue" => jstr("queue"),
        // exactly `false` survives; absent / any-other-value is the closed default `false`.
        _ => Json::Bool(false),
    };
    Ok(out)
}

// ── grant-internal ────────────────────────────────────────────────────────────────────────────────────
/// grant-internal(caller, able, found) -> the FLAT grant record:
///   { granteeBeingId, able, anchorSpaceId, anchorBeingId, grantedBy }.
/// buildInternalGrant: grantee + grantedBy are the caller (the able's own acquisition policy is the gate
/// that already fired, so the grant attributes to the taker/asker). anchorSpaceId is `found.anchor`
/// (null when absent). No anchorBeingId here (the JS passes none -> null). No grantedAt (chain seq is the
/// when). `grantedBy` defaults to I only when the caller is empty (the JS `grantedBy ? String : I`).
pub fn grant_internal(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let caller = match arg(args, 0) {
        Json::Str(s) => s.clone(),
        _ => String::new(),
    };
    let able = arg(args, 1).clone();
    let found = arg(args, 2);
    let anchor = match get_str(found, "anchor") {
        Some(a) if !a.is_empty() => jstr(a),
        _ => Json::Null,
    };
    let granted_by = if caller.is_empty() { jstr(I) } else { jstr(&caller) };
    let grantee = jstr(&caller);

    Ok(obj(vec![
        ("granteeBeingId", grantee),
        ("able", able),
        ("anchorSpaceId", anchor),
        ("anchorBeingId", Json::Null),
        ("grantedBy", granted_by),
    ]))
}

// ── able-request ──────────────────────────────────────────────────────────────────────────────────────
/// able-request(able, found, caller) -> the request payload the owner's inbox receives:
///   { able, anchorSpaceId, askerBeingId, askerName, reason: null }.
/// askerName is the asker being's folded `name` (a being row READ; null when the being has no row / no
/// name). A pure compute + one fold; NO fact.
pub fn able_request(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let able = arg(args, 0).clone();
    let found = arg(args, 1);
    let caller = match arg(args, 2) {
        Json::Str(s) => s.clone(),
        _ => String::new(),
    };
    let anchor = match get_str(found, "anchor") {
        Some(a) if !a.is_empty() => jstr(a),
        _ => Json::Null,
    };
    let asker_name = match toolkit::get_str(&toolkit::load_row(root, history, "being", &caller), "name")
    {
        Some(n) => jstr(n),
        None => Json::Null,
    };

    Ok(obj(vec![
        ("able", able),
        ("anchorSpaceId", anchor),
        ("askerBeingId", jstr(&caller)),
        ("askerName", asker_name),
        ("reason", Json::Null),
    ]))
}
