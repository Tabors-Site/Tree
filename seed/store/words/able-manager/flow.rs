// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// flow.rs — the set-being-flow host see-op, ported native (setBeingFlowHost.js):
//
//   resolve-set-being-flow-spec(target, params)
//       -> { beingId, factParams:{ field:"qualities.flow", value:<clauses>, merge:false }, clauseCount }
//
// Resolve the TARGET being (explicit params.beingId wins, else the {kind:"being",id} verb target),
// validate the flow CLAUSE ARRAY shape (every clause an object with a non-empty `able` string; normalize
// each to { able[, when][, stack:true] }, dropping unknown keys), and surface a non-fatal `unknownAbles`
// warning. A PURE compute + (in the JS) an able-registry READ for the warning — the Rust able-word fold
// is NOT yet ported, so the bridge defers the registry membership (every able is treated as known: the
// warning is non-fatal in the JS and an authored-moments-later able would clear it anyway), the SAME
// deferral makematter's extension-type gate + grant's able-exists make. The clause-SHAPE validation
// (the substance) is ported EXACTLY. It lays NO fact; a HostError IS the .word's refusal.

use std::path::Path;

use treehash::Json;

use crate::toolkit::{get, get_str, is_plain_object, jstr, obj};
use crate::{arg, AuthCtx, HostError};

// ── resolve-set-being-flow-spec ─────────────────────────────────────────────────────────────────────
/// resolve-set-being-flow-spec(target, params) -> { beingId, factParams, clauseCount }.
pub fn resolve_set_being_flow_spec(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
    let params = arg(args, 1);

    // Resolve the target being: explicit params.beingId (trimmed) wins, else the verb's {kind:"being",id}.
    let explicit = get_str(params, "beingId")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let being_id: Option<String> = match explicit {
        Some(b) => Some(b.to_string()),
        None => {
            if get_str(target, "kind") == Some("being") {
                // the JS `target.id ? String(target.id) : null` (a truthy id, stringified).
                match get(target, "id") {
                    Some(Json::Str(s)) if !s.is_empty() => Some(s.clone()),
                    Some(Json::Num(n)) if *n != 0.0 => Some(treehash::canonicalize(&Json::Num(*n))),
                    _ => None,
                }
            } else {
                None
            }
        }
    };
    let being_id = match being_id {
        Some(b) => b,
        None => {
            return Err(HostError::invalid(
                "set-being-flow: could not resolve target being (pass params.beingId or address a being stance).",
            ));
        }
    };

    // flow must be an array of clauses (the .word's `If no flow` runs first; this re-states the guard).
    let flow = match get(params, "flow") {
        Some(Json::Arr(a)) => a,
        _ => {
            return Err(HostError::invalid(
                "set-being-flow: `flow` must be an array of clauses.",
            ));
        }
    };

    let mut validated: Vec<Json> = Vec::new();
    for (i, clause) in flow.iter().enumerate() {
        if !is_plain_object(clause) {
            return Err(HostError::invalid(format!(
                "set-being-flow: clause[{i}] must be an object."
            )));
        }
        let able = match get(clause, "able") {
            Some(Json::Str(s)) if !s.is_empty() => s.clone(),
            _ => {
                return Err(HostError::invalid(format!(
                    "set-being-flow: clause[{i}].able must be a non-empty string."
                )));
            }
        };
        // The registry read for unknownAbles is DEFERRED (the able-word fold is not yet ported); the
        // warning is non-fatal in the JS (a able may be authored moments later), so its absence changes
        // no fact and no gate. Normalize the clause to { able[, when][, stack:true] }, drop unknown keys.
        let mut out: Vec<(&str, Json)> = vec![("able", Json::Str(able))];
        match get(clause, "when") {
            Some(Json::Null) | None => {}
            Some(w) => out.push(("when", w.clone())),
        }
        if matches!(get(clause, "stack"), Some(Json::Bool(true))) {
            out.push(("stack", Json::Bool(true)));
        }
        validated.push(obj(out));
    }

    let clause_count = validated.len() as f64;
    Ok(obj(vec![
        ("beingId", jstr(&being_id)),
        (
            "factParams",
            obj(vec![
                ("field", jstr("qualities.flow")),
                ("value", Json::Arr(validated)),
                ("merge", Json::Bool(false)),
            ]),
        ),
        ("clauseCount", Json::Num(clause_count)),
    ]))
}
