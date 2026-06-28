// treeval::cond — the condition evaluator: a parsed cond IR (treeword parse_cond / parse_leaf) +
// the folded state -> bool. Ports seed/present/word/cond.js (resolveCond + resolveTest +
// resolveOperand + idEquals). PURE except the domain predicates (resolvedBy / seeCall), which
// dispatch through an injected `host` fn (fail-closed when none). This is what gates a flow: the
// runtime evaluates the When-condition here, then runs the flow's effects if it holds.

use crate::get_path;
use treehash::Json;

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
fn get_str<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    get(v, k).and_then(as_str)
}
fn arr(v: &Json) -> Option<&[Json]> {
    match v {
        Json::Arr(a) => Some(a.as_slice()),
        _ => None,
    }
}

/// idEquals: `String(a ?? "") === String(b ?? "")` — coerce both to strings (null/undefined -> "").
fn json_str(v: &Json) -> String {
    match v {
        Json::Null => String::new(),
        Json::Str(s) => s.clone(),
        Json::Bool(b) => b.to_string(),
        Json::Num(n) => num_str(*n),
        _ => String::new(),
    }
}
fn num_str(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}
fn id_equals(a: &Json, b: &Json) -> bool {
    json_str(a) == json_str(b)
}

/// JS `Number()`: number -> itself, numeric string -> parsed, bool -> 1/0, null -> 0, else NaN.
fn num_of(v: Option<&Json>) -> f64 {
    match v {
        Some(Json::Num(n)) => *n,
        Some(Json::Str(s)) => s.trim().parse().unwrap_or(f64::NAN),
        Some(Json::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(Json::Null) => 0.0,
        _ => f64::NAN, // undefined (None) / object / array
    }
}

/// resolveOperand: `{ ref }` -> getPath; `$`-string -> getPath; else the literal.
fn resolve_operand(v: &Json, ctx: &Json) -> Json {
    if let Json::Obj(_) = v {
        if let Some(r) = get(v, "ref").and_then(as_str) {
            return get_path(r, ctx).unwrap_or(Json::Null);
        }
    }
    if let Json::Str(s) = v {
        if let Some(rest) = s.strip_prefix('$') {
            return get_path(rest, ctx).unwrap_or(Json::Null);
        }
    }
    v.clone()
}

/// A flag / clause read: truthy iff PRESENT and non-empty (an empty array/string reads as absent).
fn present_nonempty(v: Option<Json>) -> bool {
    match v {
        Some(Json::Arr(a)) => !a.is_empty(),
        Some(Json::Str(s)) => !s.is_empty(),
        Some(Json::Bool(b)) => b,
        Some(Json::Null) | None => false,
        Some(_) => true,
    }
}

fn resolve_test(test: &Json, ctx: &Json) -> bool {
    let left = get_path(get_str(test, "path").unwrap_or(""), ctx); // Option<Json>: None = undefined
    let null = Json::Null;
    let operand = || {
        let src = get(test, "against").or_else(|| get(test, "value")).unwrap_or(&null);
        resolve_operand(src, ctx)
    };
    match get_str(test, "op").unwrap_or("") {
        "equals" => id_equals(left.as_ref().unwrap_or(&null), &operand()),
        // reads/holds: left is present, non-null, non-false
        "reads" | "holds" => matches!(&left, Some(v) if !matches!(v, Json::Null | Json::Bool(false))),
        "isFinite" => matches!(&left, Some(Json::Num(n)) if n.is_finite()),
        "isString" => matches!(&left, Some(Json::Str(_))),
        "in" => arr(&operand()).is_some_and(|a| a.iter().any(|x| id_equals(x, left.as_ref().unwrap_or(&null)))),
        "compare" => {
            let (l, r) = (num_of(left.as_ref()), num_of(Some(&operand())));
            match get_str(test, "as").unwrap_or("") {
                "lt" => l < r,
                "le" => l <= r,
                "gt" => l > r,
                "ge" => l >= r,
                _ => l == r,
            }
        }
        _ => left.is_some(), // default: left !== undefined
    }
}

/// resolveCond (cond.js): a parsed cond IR + folded state -> bool. `host` dispatches the domain
/// predicates (resolvedBy / seeCall); pass `&|_, _| false` to fail closed when there are none.
/// NOTE (faithful to the JS): all/any return DIRECTLY — `negated` flips only a LEAF result.
pub fn resolve_cond(cond: &Json, ctx: &Json, host: &dyn Fn(&str, &[Json]) -> bool) -> bool {
    if let Some(all) = get(cond, "all").and_then(arr) {
        return all.iter().all(|c| resolve_cond(c, ctx, host));
    }
    if let Some(any) = get(cond, "any").and_then(arr) {
        return any.iter().any(|c| resolve_cond(c, ctx, host));
    }
    let v = if let Some(test) = get(cond, "test") {
        resolve_test(test, ctx)
    } else if let Some(rb) = get(cond, "resolvedBy").and_then(as_str) {
        let args: Vec<Json> = get(cond, "args").and_then(arr).map_or(Vec::new(), |a| a.iter().map(|x| resolve_operand(x, ctx)).collect());
        host(rb, &args)
    } else if let Some(sc) = get(cond, "seeCall").and_then(as_str) {
        let args: Vec<Json> = get(cond, "args").and_then(arr).map_or(Vec::new(), |a| a.iter().map(|x| resolve_operand(x, ctx)).collect());
        host(sc, &args)
    } else if let Some(flag) = get(cond, "flag").and_then(as_str) {
        present_nonempty(get_path(flag, ctx))
    } else if let Some(clause) = get(cond, "clause").and_then(as_str) {
        clause.strip_prefix('$').map(|rest| present_nonempty(get_path(rest, ctx))).unwrap_or(false)
    } else {
        false
    };
    if matches!(get(cond, "negated"), Some(Json::Bool(true))) {
        !v
    } else {
        v
    }
}
