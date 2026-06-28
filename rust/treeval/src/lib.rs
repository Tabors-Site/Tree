// treeval — the Word evaluator's RASTERIZE: an act IR node (from treeword) + an eval context ->
// the fact SPEC the stamper seals. Byte-identical to seed/present/word/evaluator.js: evalAct's emit
// path (1180-1193) + the four resolvers (resolveName/resolveBeing/resolveTarget/resolveValue,
// 1301-1360) + getPath (cond.js). The DO path (doVerb's op handlers, evalAct 1141-1177) authorizes
// + folds + stamps through the real op handler — a separate, later port. This is every NON-do verb:
//   emit({ verb, act, through: through || by, by, of: resolveTarget(of), [to], params, [_event], [_sets] })
//
// ctx is a Json object: { identity: { nameId, beingId }, bindings: {...}, state: {...}, beings: {...} }.
// getPath returns Option<Json>: None = JS `undefined`, Some(Json::Null) = JS `null`. The resolvers
// branch on exactly that distinction (`got !== undefined ? got : ...`), so it is preserved here.

use treehash::Json;

pub mod able;
pub mod auth;

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn as_str(v: &Json) -> Option<&str> {
    match v {
        Json::Str(s) => Some(s),
        _ => None,
    }
}
fn is_null(v: &Json) -> bool {
    matches!(v, Json::Null)
}
/// JS truthiness — for the `||` in `through || by` (null/false/""/0 are falsy).
fn truthy(v: &Json) -> bool {
    match v {
        Json::Null => false,
        Json::Bool(b) => *b,
        Json::Str(s) => !s.is_empty(),
        Json::Num(n) => *n != 0.0,
        _ => true,
    }
}
fn obj(fields: Vec<(&str, Json)>) -> Json {
    Json::Obj(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// getPath (cond.js): a dotted read of ctx — bindings, then state, then beings; descent stops at
/// null. None = `undefined`, Some(Json::Null) = `null`.
pub fn get_path(path: &str, ctx: &Json) -> Option<Json> {
    let segs: Vec<&str> = path.split('.').collect();
    let head = segs[0];
    let mut cur: Option<Json> = None;
    for src in ["bindings", "state", "beings"] {
        if let Some(src_obj) = get(ctx, src) {
            if let Some(val) = get(src_obj, head) {
                cur = Some(val.clone());
                break;
            }
        }
    }
    for seg in &segs[1..] {
        match &cur {
            Some(c) if !is_null(c) => cur = get(c, seg).cloned(),
            _ => break,
        }
    }
    cur
}

/// resolveName (rule 9): null/"I" -> identity.nameId ?? identity.beingId; else the proper name.
pub fn resolve_name(reference: Option<&Json>, ctx: &Json) -> Json {
    let identity = get(ctx, "identity");
    let pick = || match identity.and_then(|i| get(i, "nameId")) {
        Some(n) if !is_null(n) => n.clone(),
        _ => identity.and_then(|i| get(i, "beingId")).cloned().unwrap_or(Json::Null),
    };
    match reference {
        None | Some(Json::Null) => pick(),
        Some(Json::Str(s)) if s == "I" => pick(),
        Some(v) => v.clone(),
    }
}

/// resolveBeing: { ref } -> bindings[ref] ?? ref; else verbatim.
pub fn resolve_being(reference: &Json, ctx: &Json) -> Json {
    if let Some(r) = get(reference, "ref").and_then(as_str) {
        return match get(ctx, "bindings").and_then(|b| get(b, r)) {
            Some(v) if !is_null(v) => v.clone(),
            _ => Json::Str(r.to_string()),
        };
    }
    reference.clone()
}

/// resolveTarget: None if no `of`; `of.bind` mints a fresh id; `of.ref` reads getPath ?? bindings;
/// else { kind, id }. `mint` supplies a live id at a bind site (None -> the dry-run `<bind>` form).
pub fn resolve_target(of: Option<&Json>, ctx: &Json, mint: Option<&dyn Fn(&str) -> String>) -> Option<Json> {
    let of = of?;
    let kind = get(of, "kind").cloned().unwrap_or(Json::Null);
    if let Some(bind) = get(of, "bind").and_then(as_str) {
        let id = match mint {
            Some(f) => Json::Str(f(as_str(&kind).unwrap_or(""))),
            None => Json::Str(format!("<{bind}>")),
        };
        return Some(obj(vec![("kind", kind), ("id", id)]));
    }
    if let Some(r) = get(of, "ref").and_then(as_str) {
        let key = r.strip_prefix('$').unwrap_or(r);
        let id = match get_path(key, ctx) {
            Some(g) => g, // `got !== undefined ? got` — Some(Null) counts as found
            None => get(ctx, "bindings").and_then(|b| get(b, r)).cloned().unwrap_or(Json::Null),
        };
        return Some(obj(vec![("kind", kind), ("id", id)]));
    }
    let id = get(of, "id").cloned().unwrap_or(Json::Null);
    Some(obj(vec![("kind", kind), ("id", id)]))
}

/// resolveValue: $-ref / { ref } read getPath; a being's proper name -> its id; arrays/objects recurse.
pub fn resolve_value(v: &Json, ctx: &Json) -> Json {
    if let Json::Str(s) = v {
        if let Some(rest) = s.strip_prefix('$') {
            return match get_path(rest, ctx) {
                Some(g) => g,
                None => v.clone(),
            };
        }
        if let Some(beings) = get(ctx, "beings") {
            if let Some(id) = get(beings, s) {
                return id.clone();
            }
        }
        return v.clone();
    }
    if let Some(r) = get(v, "ref").and_then(as_str) {
        return get_path(r, ctx).unwrap_or(Json::Null);
    }
    if let Json::Arr(a) = v {
        return Json::Arr(a.iter().map(|x| resolve_value(x, ctx)).collect());
    }
    if let Json::Obj(e) = v {
        return Json::Obj(e.iter().map(|(k, x)| (k.clone(), resolve_value(x, ctx))).collect());
    }
    v.clone()
}

/// Rasterize an act IR node down the EMIT path (every non-do verb) -> the fact spec emit() seals
/// (evaluator.js 1180-1193), before the stamp-time actId/history are appended. `mint` is consulted
/// only for an `of.bind` target.
pub fn rasterize_emit(act: &Json, ctx: &Json, mint: Option<&dyn Fn(&str) -> String>) -> Json {
    let by = resolve_name(get(act, "by"), ctx);
    let through_resolved = match get(act, "through") {
        Some(t) if truthy(t) => resolve_being(t, ctx),
        _ => Json::Null,
    };
    let through_field = if truthy(&through_resolved) { through_resolved } else { by.clone() };
    let mut spec = vec![
        ("verb".to_string(), get(act, "verb").cloned().unwrap_or(Json::Null)),
        ("act".to_string(), get(act, "act").cloned().unwrap_or(Json::Null)),
        ("through".to_string(), through_field),
        ("by".to_string(), by),
    ];
    if let Some(o) = resolve_target(get(act, "of"), ctx, mint) {
        spec.push(("of".to_string(), o));
    }
    if let Some(t) = get(act, "to") {
        spec.push(("to".to_string(), resolve_being(t, ctx)));
    }
    if let Some(p) = get(act, "params") {
        spec.push(("params".to_string(), resolve_value(p, ctx)));
    }
    if let Some(e) = get(act, "event") {
        spec.push(("_event".to_string(), e.clone()));
    }
    if let Some(s) = get(act, "sets") {
        spec.push(("_sets".to_string(), s.clone()));
    }
    Json::Obj(spec)
}
