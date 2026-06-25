// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The per-kind reducers + the 12 shared apply* helpers, ported from
// seed/materials/reducerHelpers.js and seed/materials/{being,space,matter,name,
// library}/reducer.js. Each is a pure (state, fact) -> state. Composition order
// per kind matches the JS reducers exactly; key order does not matter (canonicalize
// sorts). `fact.date` is read deterministically off the row (not a clock).

use crate::value as v;
use crate::value::Json;

const DELETED: &str = "deleted";
const QUALITIES_PREFIX: &str = "qualities.";

const SET_ACTIONS: &[&str] = &[
    "set-space", "set-being", "set-matter", "set-model", "rename-matter", "set-render",
    "set-being-flow", "set-owner", "remove-owner",
];
const CREATE_ACTIONS: &[&str] = &["create-space", "create-matter"];
const SCALAR_SET_FIELDS: &[&str] = &[
    "name", "type", "owner", "parent", "parentBeingId", "defaultAble", "homeSpace", "homeHistory",
    "password", "content", "spaceId", "beingId", "coord", "size", "position",
];

// ── fact accessors ──────────────────────────────────────────────────────────
fn fstr<'a>(fact: &'a Json, key: &str) -> &'a str {
    match v::get(fact, key) {
        Some(Json::Str(s)) => s,
        _ => "",
    }
}
fn act(f: &Json) -> &str {
    fstr(f, "act")
}
fn verb(f: &Json) -> &str {
    fstr(f, "verb")
}
fn of_kind(f: &Json) -> &str {
    match v::get(f, "of") {
        Some(o) => match v::get(o, "kind") {
            Some(Json::Str(s)) => s,
            _ => "",
        },
        None => "",
    }
}
fn params(f: &Json) -> Json {
    v::get(f, "params").cloned().unwrap_or_else(v::empty_obj)
}
fn date(f: &Json) -> Json {
    v::get(f, "date").cloned().unwrap_or(Json::Null)
}

// ── qualities helpers ───────────────────────────────────────────────────────

/// `{ ...obj, [head]: ... }` walking parts; null leaf deletes. Mirrors setDeepPath.
fn set_deep_path(obj: &Json, parts: &[&str], value: &Json) -> Json {
    let head = parts[0];
    if parts.len() == 1 {
        if v::is_null(value) {
            return v::del(obj, head);
        }
        return v::set(obj, head, value.clone());
    }
    // child = obj[head] if object-non-array else {}
    let child = match v::get(obj, head) {
        Some(c) if v::is_object(c) => c.clone(),
        _ => v::empty_obj(),
    };
    v::set(obj, head, set_deep_path(&child, &parts[1..], value))
}

pub fn apply_set_qualities(state: &Json, fact: &Json) -> Json {
    if !SET_ACTIONS.contains(&act(fact)) {
        return state.clone();
    }
    let p = params(fact);
    let field = match v::get(&p, "field") {
        Some(Json::Str(s)) if s.starts_with(QUALITIES_PREFIX) => s.clone(),
        _ => return state.clone(),
    };
    let rest = &field[QUALITIES_PREFIX.len()..];
    if rest.is_empty() {
        return state.clone();
    }
    let parts: Vec<&str> = rest.split('.').collect();
    let namespace = parts[0];
    if namespace.is_empty() {
        return state.clone();
    }
    let current_qualities = v::get(state, "qualities").cloned().unwrap_or_else(v::empty_obj);
    let value = v::get(&p, "value").cloned().unwrap_or(Json::Null);
    let merge = !matches!(v::get(&p, "merge"), Some(Json::Bool(false))); // default true

    if parts.len() == 1 {
        // whole-namespace write
        if v::is_null(&value) {
            let next = v::del(&current_qualities, namespace);
            return v::set(state, "qualities", next);
        }
        if !v::is_js_object(&value) {
            return state.clone(); // malformed primitive — pass through
        }
        if v::is_array(&value) {
            if merge {
                return state.clone();
            }
            let nq = v::set(&current_qualities, namespace, value);
            return v::set(state, "qualities", nq);
        }
        let current_ns = match v::get(&current_qualities, namespace) {
            Some(x) if v::is_object(x) => x.clone(),
            _ => v::empty_obj(),
        };
        let new_ns = if merge {
            v::merge(&current_ns, &value)
        } else {
            value
        };
        let nq = v::set(&current_qualities, namespace, new_ns);
        return v::set(state, "qualities", nq);
    }

    // deep path: currentNs is namespace value if typeof==="object" (incl array) else {}
    let current_ns = match v::get(&current_qualities, namespace) {
        Some(x) if v::is_js_object(x) => x.clone(),
        _ => v::empty_obj(),
    };
    let new_ns = set_deep_path(&current_ns, &parts[1..], &value);
    let nq = v::set(&current_qualities, namespace, new_ns);
    v::set(state, "qualities", nq)
}

pub fn apply_set_field(state: &Json, fact: &Json) -> Json {
    if !SET_ACTIONS.contains(&act(fact)) {
        return state.clone();
    }
    let p = params(fact);
    let field = match v::get(&p, "field") {
        Some(Json::Str(s)) if SCALAR_SET_FIELDS.contains(&s.as_str()) => s.clone(),
        _ => return state.clone(),
    };
    let value = v::get(&p, "value").cloned().unwrap_or(Json::Null);
    if v::is_null(&value) {
        return v::del(state, &field);
    }
    v::set(state, &field, value)
}

// ── being lifecycle ─────────────────────────────────────────────────────────

pub fn apply_connection_state(state: &Json, fact: &Json) -> Json {
    if verb(fact) != "be" || of_kind(fact) != "being" {
        return state.clone();
    }
    let a = act(fact);
    if a != "connect" && a != "release" {
        return state.clone();
    }
    let qualities = v::get(state, "qualities").cloned().unwrap_or_else(v::empty_obj);
    let prev = v::get(&qualities, "connection").cloned().unwrap_or_else(v::empty_obj);
    let connection = if a == "connect" {
        let p = params(fact);
        let inhabited_by = v::or_truthy(v::get(&p, "inhabitedBy"), Json::Null);
        // since = fact.date || params.since || null
        let since = if v::truthy(&date(fact)) {
            date(fact)
        } else {
            v::or_truthy(v::get(&p, "since"), Json::Null)
        };
        let c = v::set(&prev, "inhabitedBy", inhabited_by);
        v::set(&c, "since", since)
    } else {
        v::set(&prev, "inhabitedBy", Json::Null)
    };
    let nq = v::set(&qualities, "connection", connection);
    v::set(state, "qualities", nq)
}

pub fn apply_death(state: &Json, fact: &Json) -> Json {
    if verb(fact) != "be" || act(fact) != "death" || of_kind(fact) != "being" {
        return state.clone();
    }
    let qualities = v::get(state, "qualities").cloned().unwrap_or_else(v::empty_obj);
    // idempotent: first death wins — the be:death FACT's existence IS the death (no clock).
    if v::get(&qualities, "death").is_some() {
        return state.clone();
    }
    let p = params(fact);
    let by_actor = {
        let a = v::or_truthy(v::get(&p, "byActor"), Json::Null);
        if v::truthy(&a) {
            a
        } else {
            v::or_truthy(v::get(fact, "through"), Json::Null)
        }
    };
    let connection = match v::get(&qualities, "connection") {
        Some(c) => v::set(c, "inhabitedBy", Json::Null),
        None => v::set(&v::empty_obj(), "inhabitedBy", Json::Null),
    };
    let death = v::set(&v::empty_obj(), "byActor", by_actor);
    let nq = v::set(&v::set(&qualities, "connection", connection), "death", death);
    let s = v::set(state, "position", Json::Null);
    let s = v::set(&s, "coord", Json::Null);
    v::set(&s, "qualities", nq)
}

pub fn apply_true_name(state: &Json, fact: &Json) -> Json {
    if verb(fact) != "be" || act(fact) != "truename" || of_kind(fact) != "being" {
        return state.clone();
    }
    let p = params(fact);
    let true_name = match v::get(&p, "trueName") {
        Some(Json::Str(s)) if !s.is_empty() => s.clone(),
        _ => return state.clone(),
    };
    if matches!(v::get(state, "trueName"), Some(Json::Str(s)) if *s == true_name) {
        return state.clone();
    }
    let upd = if v::truthy(&date(fact)) {
        date(fact)
    } else {
        v::get(state, "updatedAt").cloned().unwrap_or(Json::Null)
    };
    let s = v::set(state, "trueName", v::jstr(&true_name));
    v::set(&s, "updatedAt", upd)
}

pub fn apply_able_grants(state: &Json, fact: &Json) -> Json {
    if verb(fact) != "do" {
        return state.clone();
    }
    let is_grant = matches!(act(fact), "grant-able" | "take-able" | "ask-able");
    let is_revoke = act(fact) == "revoke-able";
    if !is_grant && !is_revoke {
        return state.clone();
    }
    if of_kind(fact) != "being" {
        return state.clone();
    }
    let p = params(fact);
    if !v::is_object(&p) {
        return state.clone();
    }
    let able = match v::get(&p, "able") {
        Some(Json::Str(s)) if !s.is_empty() => s.clone(),
        _ => return state.clone(),
    };
    let anchor_space = v::or_truthy(v::get(&p, "anchorSpaceId"), Json::Null);
    let anchor_being = v::or_truthy(v::get(&p, "anchorBeingId"), Json::Null);
    if !v::truthy(&anchor_space) && !v::truthy(&anchor_being) {
        return state.clone();
    }
    // grantedBy = params.grantedBy || String(fact.through) || null
    let granted_by = {
        let g = v::or_truthy(v::get(&p, "grantedBy"), Json::Null);
        if v::truthy(&g) {
            g
        } else {
            match v::get(fact, "through") {
                Some(t) if v::truthy(t) => v::jstr(v::as_str(t).unwrap_or("")),
                _ => Json::Null,
            }
        }
    };
    if !v::truthy(&granted_by) {
        return state.clone();
    }

    let existing_qualities = v::get(state, "qualities").cloned().unwrap_or_else(v::empty_obj);
    let existing: Vec<Json> = match v::get(&existing_qualities, "ablesGranted") {
        Some(Json::Arr(a)) => a.clone(),
        _ => Vec::new(),
    };

    let matches_tuple = |e: &Json| -> bool {
        v::json_eq(&v::or_truthy(v::get(e, "able"), Json::Null), &v::jstr(&able))
            && v::json_eq(&v::or_truthy(v::get(e, "anchorSpaceId"), Json::Null), &anchor_space)
            && v::json_eq(&v::or_truthy(v::get(e, "anchorBeingId"), Json::Null), &anchor_being)
            && v::json_eq(&v::or_truthy(v::get(e, "grantedBy"), Json::Null), &granted_by)
    };

    if is_grant {
        if existing.iter().any(matches_tuple) {
            return state.clone();
        }
        let entry = {
            let e = v::set(&v::empty_obj(), "able", v::jstr(&able));
            let e = v::set(&e, "anchorSpaceId", anchor_space);
            let e = v::set(&e, "anchorBeingId", anchor_being);
            v::set(&e, "grantedBy", granted_by)
        };
        let mut next = existing.clone();
        next.push(entry);
        let nq = v::set(&existing_qualities, "ablesGranted", Json::Arr(next));
        return v::set(state, "qualities", nq);
    }

    // revoke
    let filtered: Vec<Json> = existing.iter().filter(|e| !matches_tuple(e)).cloned().collect();
    if filtered.len() == existing.len() {
        return state.clone();
    }
    let nq = v::set(&existing_qualities, "ablesGranted", Json::Arr(filtered));
    v::set(state, "qualities", nq)
}

pub fn apply_create_being(state: &Json, fact: &Json) -> Json {
    if verb(fact) != "be" || act(fact) != "birth" || of_kind(fact) != "being" {
        return state.clone();
    }
    let spec = params(fact);
    if !v::is_object(&spec) {
        return state.clone();
    }
    let default_able = {
        let d = v::or_truthy(v::get(&spec, "defaultAble"), Json::Null);
        if v::truthy(&d) {
            d
        } else {
            v::or_truthy(v::get(&spec, "able"), Json::Null)
        }
    };
    let position = v::nullish(
        v::get(&spec, "position"),
        v::nullish(
            v::get(&spec, "currentSpace"),
            v::nullish(v::get(&spec, "homeSpace"), Json::Null),
        ),
    );
    let mut s = state.clone();
    // name / password: present-or-omit (JS sets undefined -> dropped)
    if let Some(n) = v::get(&spec, "name") {
        s = v::set(&s, "name", n.clone());
    }
    if let Some(pw) = v::get(&spec, "password") {
        s = v::set(&s, "password", pw.clone());
    }
    s = v::set(&s, "defaultAble", default_able);
    s = v::set(&s, "trueName", v::nullish(v::get(&spec, "trueName"), Json::Null));
    s = v::set(&s, "parentBeingId", v::nullish(v::get(&spec, "parentBeingId"), Json::Null));
    s = v::set(&s, "homeSpace", v::nullish(v::get(&spec, "homeSpace"), Json::Null));
    s = v::set(&s, "homeHistory", v::nullish(v::get(&spec, "homeHistory"), Json::Null));
    s = v::set(&s, "isRemote", Json::Bool(v::truthy(&v::get(&spec, "isRemote").cloned().unwrap_or(Json::Null))));
    s = v::set(&s, "homeStory", v::nullish(v::get(&spec, "homeStory"), Json::Null));
    s = v::set(&s, "qualities", v::nullish(v::get(&spec, "qualities"), v::empty_obj()));
    s = v::set(&s, "position", position);
    s = v::set(&s, "coord", v::nullish(v::get(&spec, "coord"), Json::Null));
    // No clock: createdAt was dropped in the "WHEN is chain position" cleanup. updatedAt is
    // re-added by the reducer-level bump (bump_updated) on any state change.
    v::set(&s, "updatedAt", date(fact))
}

// ── space / matter lifecycle ────────────────────────────────────────────────

pub fn apply_create_space(state: &Json, fact: &Json) -> Json {
    if verb(fact) != "do" || !CREATE_ACTIONS.contains(&act(fact)) || of_kind(fact) != "space" {
        return state.clone();
    }
    let spec = params(fact);
    if !v::is_object(&spec) {
        return state.clone();
    }
    // owner = spec.owner ? String(spec.owner) : spec.ownerId ? String(spec.ownerId) : null
    let owner = {
        let o = v::or_truthy(v::get(&spec, "owner"), Json::Null);
        if v::truthy(&o) {
            to_js_string(&o)
        } else {
            let oid = v::or_truthy(v::get(&spec, "ownerId"), Json::Null);
            if v::truthy(&oid) {
                to_js_string(&oid)
            } else {
                Json::Null
            }
        }
    };
    let parent = v::nullish(v::get(&spec, "parent"), v::nullish(v::get(&spec, "parentId"), Json::Null));
    let mut s = state.clone();
    if let Some(n) = v::get(&spec, "name") {
        s = v::set(&s, "name", n.clone());
    }
    s = v::set(&s, "type", v::nullish(v::get(&spec, "type"), Json::Null));
    s = v::set(&s, "parent", parent.clone());
    s = v::set(&s, "owner", owner);
    s = v::set(&s, "heavenSpace", v::nullish(v::get(&spec, "heavenSpace"), Json::Null));
    s = v::set(&s, "size", v::nullish(v::get(&spec, "size"), Json::Null));
    s = v::set(&s, "coord", v::nullish(v::get(&spec, "coord"), Json::Null));
    s = v::set(&s, "qualities", v::nullish(v::get(&spec, "qualities"), v::empty_obj()));
    // No clock: createdAt dropped ("WHEN is chain position"); updatedAt via the reducer bump.
    s = v::set(&s, "updatedAt", date(fact));
    // position: spec.parent ?? spec.parentId ?? null
    v::set(&s, "position", parent)
}

pub fn apply_make_heaven(state: &Json, fact: &Json) -> Json {
    if act(fact) != "make-heaven" || of_kind(fact) != "space" {
        return state.clone();
    }
    let p = params(fact);
    match v::get(&p, "heavenSpace") {
        Some(Json::Str(s)) if !s.is_empty() => v::set(state, "heavenSpace", v::jstr(s)),
        _ => state.clone(),
    }
}

pub fn apply_move(state: &Json, fact: &Json) -> Json {
    if verb(fact) != "do" || act(fact) != "move" {
        return state.clone();
    }
    let kind = of_kind(fact);
    if kind != "space" && kind != "matter" {
        return state.clone();
    }
    let p = params(fact);
    let coord = v::get(&p, "coord");
    if let Some(c) = coord {
        let x = finite(v::get(c, "x"));
        let y = finite(v::get(c, "y"));
        if v::is_object(c) && x.is_some() && y.is_some() {
            let mut nc = v::set(&v::set(&v::empty_obj(), "x", Json::Num(x.unwrap())), "y", Json::Num(y.unwrap()));
            if let Some(z) = finite(v::get(c, "z")) {
                nc = v::set(&nc, "z", Json::Num(z));
            }
            let s = v::set(state, "coord", nc);
            return v::set(&s, "updatedAt", date(fact));
        }
    }
    match v::get(&p, "to") {
        Some(Json::Str(to)) if !to.is_empty() => {
            if kind == "space" {
                let s = v::set(state, "parent", v::jstr(to));
                let s = v::set(&s, "position", v::jstr(to));
                v::set(&s, "updatedAt", date(fact))
            } else {
                let s = v::set(state, "spaceId", v::jstr(to));
                let s = v::set(&s, "position", v::jstr(to));
                v::set(&s, "updatedAt", date(fact))
            }
        }
        _ => state.clone(),
    }
}

pub fn apply_create_matter(state: &Json, fact: &Json) -> Json {
    if verb(fact) != "do" || !CREATE_ACTIONS.contains(&act(fact)) || of_kind(fact) != "matter" {
        return state.clone();
    }
    let spec = params(fact);
    let mut s = state.clone();
    s = v::set(&s, "spaceId", v::nullish(v::get(&spec, "spaceId"), Json::Null));
    s = v::set(&s, "beingId", v::nullish(v::get(&spec, "beingId"), Json::Null));
    s = v::set(&s, "name", v::nullish(v::get(&spec, "name"), Json::Null));
    s = v::set(&s, "content", v::nullish(v::get(&spec, "content"), Json::Null));
    // type: spec.type || "generic"
    s = v::set(&s, "type", v::or_truthy(v::get(&spec, "type"), v::jstr("generic")));
    s = v::set(&s, "coord", v::nullish(v::get(&spec, "coord"), Json::Null));
    s = v::set(&s, "parentMatterId", v::nullish(v::get(&spec, "parentMatterId"), Json::Null));
    s = v::set(&s, "qualities", v::nullish(v::get(&spec, "qualities"), v::empty_obj()));
    s = v::set(&s, "children", Json::Arr(Vec::new()));
    s = v::set(&s, "position", v::nullish(v::get(&spec, "spaceId"), Json::Null));
    // No clock: createdAt dropped ("WHEN is chain position"); updatedAt via the reducer bump.
    v::set(&s, "updatedAt", date(fact))
}

pub fn apply_purge_content(state: &Json, fact: &Json) -> Json {
    if verb(fact) != "do" || act(fact) != "purge-content" || of_kind(fact) != "matter" {
        return state.clone();
    }
    let p = params(fact);
    let hash = match v::get(&p, "hash") {
        Some(h) if v::truthy(h) => h.clone(),
        _ => return state.clone(),
    };
    let content = match v::get(state, "content") {
        Some(c) if v::is_object(c) => c.clone(),
        _ => return state.clone(),
    };
    if !v::json_eq(&v::get(&content, "hash").cloned().unwrap_or(Json::Null), &hash) {
        return state.clone();
    }
    let c = v::set(&content, "purged", Json::Bool(true));
    let c = v::set(&c, "preview", Json::Null);
    v::set(state, "content", c)
}

// ── library lifecycle (flat switch; no updatedAt) ───────────────────────────

const NAME_OPS: &[&str] = &["declare", "mint", "banish", "close", "connect", "release", "set-password"];

pub fn reduce_library(state: &Json, fact: &Json) -> Json {
    let a = act(fact);
    let p = params(fact);
    // Name identity facts fold into names[nameId] — a Name has no reel of its own (it ACTS, it is
    // never acted-on). declare/banish/connect/release/set-password ride the library reel.
    if verb(fact) == "name" && NAME_OPS.contains(&a) {
        let name_id = match v::get(&p, "nameId") {
            Some(Json::Str(s)) if !s.is_empty() => s.clone(),
            _ => return state.clone(),
        };
        let names = v::get(state, "names").cloned().unwrap_or_else(v::empty_obj);
        let had = v::get(&names, &name_id).is_some();
        let cur = v::get(&names, &name_id).cloned().unwrap_or_else(v::empty_obj);
        let next_entry = fold_name(&cur, fact);
        if had && v::json_eq(&next_entry, &cur) {
            return state.clone(); // idempotent no-op
        }
        return v::set(state, "names", v::set(&names, &name_id, next_entry));
    }
    match a {
        "share-book" => {
            let root = match v::get(&p, "root") {
                Some(r) if v::truthy(r) => r.clone(),
                _ => return state.clone(),
            };
            let entry = obj_from(&[
                ("root", root.clone()),
                ("title", v::nullish(v::get(&p, "title"), Json::Null)),
                ("author", v::nullish(v::get(&p, "author"), Json::Null)),
                ("sharedBy", v::nullish(v::get(&p, "sharedBy"), Json::Null)),
                ("kind", v::nullish(v::get(&p, "kind"), Json::Null)),
                ("bodyRef", v::nullish(v::get(&p, "bodyRef"), Json::Null)),
                ("at", date(fact)),
            ]);
            let books = v::get(state, "books").cloned().unwrap_or_else(v::empty_obj);
            let books = v::set(&books, v::as_str(&root).unwrap_or(""), entry);
            v::set(state, "books", books)
        }
        "peer-add" => {
            let domain = match v::get(&p, "domain") {
                Some(d) if v::truthy(d) => d.clone(),
                _ => return state.clone(),
            };
            let entry = obj_from(&[
                ("domain", domain.clone()),
                ("addedBy", v::nullish(v::get(&p, "addedBy"), Json::Null)),
                ("at", date(fact)),
            ]);
            let peers = v::get(state, "peers").cloned().unwrap_or_else(v::empty_obj);
            let peers = v::set(&peers, v::as_str(&domain).unwrap_or(""), entry);
            v::set(state, "peers", peers)
        }
        "peer-remove" => {
            let domain = match v::get(&p, "domain") {
                Some(d) if v::truthy(d) => d.clone(),
                _ => return state.clone(),
            };
            let peers = v::get(state, "peers").cloned().unwrap_or_else(v::empty_obj);
            let peers = v::del(&peers, v::as_str(&domain).unwrap_or(""));
            v::set(state, "peers", peers)
        }
        "config-set" => {
            let key = match v::get(&p, "key") {
                Some(k) if !v::is_null(k) => k.clone(),
                _ => return state.clone(),
            };
            let config = v::get(state, "config").cloned().unwrap_or_else(v::empty_obj);
            let config = v::set(&config, v::as_str(&key).unwrap_or(""), v::get(&p, "value").cloned().unwrap_or(Json::Null));
            v::set(state, "config", config)
        }
        "config-delete" => {
            let key = match v::get(&p, "key") {
                Some(k) if !v::is_null(k) => k.clone(),
                _ => return state.clone(),
            };
            let config = v::get(state, "config").cloned().unwrap_or_else(v::empty_obj);
            let config = v::del(&config, v::as_str(&key).unwrap_or(""));
            v::set(state, "config", config)
        }
        _ => state.clone(),
    }
}

pub fn initial_library() -> Json {
    obj_from(&[
        ("names", v::empty_obj()),
        ("books", v::empty_obj()),
        ("peers", v::empty_obj()),
        ("config", v::empty_obj()),
    ])
}

// A Name's identity-layer fold (declare/banish/connect/release/set-password), folded into the
// library's names catalog. A Name has no reel of its own. No clock: closure/connection are booleans
// whose WHEN is the fact's chain position; updatedAt rides the fact's date. Returns the SAME value
// on a no-op (idempotent close, key-less set-password). Twin of library/reducer.js foldName.
fn fold_name(s: &Json, fact: &Json) -> Json {
    let p = params(fact);
    let spec = v::get(&p, "spec");
    match act(fact) {
        "declare" | "mint" => {
            let spec = match spec {
                Some(x) if v::is_object(x) => x,
                _ => return s.clone(),
            };
            let created = match v::get(s, "createdAt") {
                Some(c) if !v::is_null(c) => c.clone(),
                _ => date(fact),
            };
            let mut o = s.clone();
            o = v::set(&o, "parentNameId", v::nullish(v::get(spec, "parentNameId"), Json::Null));
            o = v::set(&o, "privateKeyEnc", v::nullish(v::get(spec, "privateKeyEnc"), Json::Null));
            o = v::set(&o, "identity", v::nullish(v::get(spec, "identity"), Json::Null));
            o = v::set(&o, "soulType", v::nullish(v::get(spec, "soulType"), Json::Null));
            o = v::set(&o, "name", v::nullish(v::get(spec, "name"), Json::Null));
            o = v::set(&o, "createdAt", created);
            v::set(&o, "updatedAt", date(fact))
        }
        "banish" | "close" => {
            if v::truthy(&v::get(s, "closed").cloned().unwrap_or(Json::Null)) {
                return s.clone();
            }
            let o = v::set(s, "closed", Json::Bool(true));
            v::set(&o, "updatedAt", date(fact))
        }
        "connect" => v::set(&v::set(s, "connected", Json::Bool(true)), "updatedAt", date(fact)),
        "release" => v::set(&v::set(s, "connected", Json::Bool(false)), "updatedAt", date(fact)),
        "set-password" => {
            let spec = match spec {
                Some(x) => x,
                None => return s.clone(),
            };
            match v::get(spec, "privateKeyEnc") {
                Some(pk) if !v::is_null(pk) => {
                    v::set(&v::set(s, "privateKeyEnc", pk.clone()), "updatedAt", date(fact))
                }
                _ => s.clone(),
            }
        }
        _ => s.clone(),
    }
}

// ── composed reducers (one per kind) ────────────────────────────────────────

fn bump_updated(prev: &Json, next: Json, fact: &Json) -> Json {
    // `if (next !== state) next = {...next, updatedAt: fact.date}`, then
    // `return next === state ? {...state} : next`. Value-wise: if changed, set
    // updatedAt; else return unchanged. (Identity-only clones are invisible to canonicalize.)
    if v::json_eq(prev, &next) {
        prev.clone()
    } else {
        v::set(&next, "updatedAt", date(fact))
    }
}

pub fn reduce_being(state: &Json, fact: &Json) -> Json {
    let mut next = state.clone();
    next = apply_create_being(&next, fact);
    next = apply_connection_state(&next, fact);
    next = apply_death(&next, fact);
    next = apply_true_name(&next, fact);
    next = apply_set_field(&next, fact);
    next = apply_set_qualities(&next, fact);
    next = apply_able_grants(&next, fact);
    let p = params(fact);
    if let Some(tp) = v::get(&p, "toPosition") {
        next = v::set(&next, "position", tp.clone());
    }
    bump_updated(state, next, fact)
}

pub fn reduce_space(state: &Json, fact: &Json) -> Json {
    let mut next = state.clone();
    next = apply_create_space(&next, fact);
    next = apply_make_heaven(&next, fact);
    next = apply_set_field(&next, fact);
    next = apply_set_qualities(&next, fact);
    next = apply_move(&next, fact);
    let p = params(fact);
    let explicit = match v::get(&p, "parent") {
        Some(x) => Some(x.clone()),
        None => v::get(&p, "parentId").cloned(),
    };
    if let Some(x) = explicit {
        next = v::set(&next, "position", x);
    }
    if act(fact) == "set-space" && matches!(v::get(&p, "field"), Some(Json::Str(s)) if s == "parent") {
        next = v::set(&next, "position", v::get(&p, "value").cloned().unwrap_or(Json::Null));
    }
    if act(fact) == "end-space" && of_kind(fact) == "space" {
        let owner = {
            let thr = v::or_truthy(v::get(fact, "through"), Json::Null);
            if v::truthy(&thr) {
                to_js_string(&thr)
            } else {
                let o = v::or_truthy(v::get(&next, "owner"), Json::Null);
                if v::truthy(&o) {
                    to_js_string(&o)
                } else {
                    v::jstr("")
                }
            }
        };
        next = v::set(&next, "parent", v::jstr(DELETED));
        next = v::set(&next, "position", v::jstr(DELETED));
        next = v::set(&next, "owner", owner);
    }
    bump_updated(state, next, fact)
}

pub fn reduce_matter(state: &Json, fact: &Json) -> Json {
    let mut next = state.clone();
    next = apply_create_matter(&next, fact);
    next = apply_set_field(&next, fact);
    next = apply_set_qualities(&next, fact);
    next = apply_move(&next, fact);
    if act(fact) == "end-matter" && of_kind(fact) == "matter" {
        next = v::set(&next, "spaceId", v::jstr(DELETED));
        next = v::set(&next, "beingId", v::jstr(DELETED));
    }
    next = apply_purge_content(&next, fact);
    let p = params(fact);
    let explicit = match v::get(&p, "toPosition") {
        Some(x) => Some(x.clone()),
        None => v::get(&p, "spaceId").cloned(),
    };
    if let Some(x) = explicit {
        next = v::set(&next, "position", x);
    }
    bump_updated(state, next, fact)
}

// Name has NO reducer of its own: a Name acts but is never acted-on, so it has an act-chain and
// no reel. Name facts fold into the library reel's names catalog (reduce_library / fold_name above).

pub fn is_gone_matter(state: &Json) -> bool {
    matches!(v::get(state, "spaceId"), Some(Json::Str(s)) if s == DELETED)
}

// ── small helpers ───────────────────────────────────────────────────────────

fn obj_from(pairs: &[(&str, Json)]) -> Json {
    Json::Obj(pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect())
}

fn finite(v: Option<&Json>) -> Option<f64> {
    match v {
        Some(Json::Num(n)) if n.is_finite() => Some(*n),
        _ => None,
    }
}

/// JS String(x): strings pass through; other scalars coerce. (Our data only ever
/// coerces strings here, but keep it total.)
fn to_js_string(x: &Json) -> Json {
    match x {
        Json::Str(_) => x.clone(),
        Json::Null => v::jstr("null"),
        Json::Bool(b) => v::jstr(if *b { "true" } else { "false" }),
        Json::Num(n) => Json::Str(treehash::canonicalize(&Json::Num(*n))),
        _ => v::jstr(""),
    }
}
