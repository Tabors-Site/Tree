// treeval::able — the clean fold-based able-walk: the SUBSTANCE of authorizeViaAbles (does a granted
// able cover an act?) without the accreted 664-LOC structure. An able SPEC is a folded word —
//   { canSee:[…], canDo:[…], canCall:[…], canBe:[…], reach:[…] }
// the shape parseAbleWord / foldAbleNoun produce (the stable contract). Coverage of one grant is two
// pure predicates:
//   permits(spec, verb, req)                          — does a can-list allow this verb/op?
//   reach_covers(spec, target, base_covered)          — does the reach include the target?
// The grants, the specs, and `base_covered` (= host-descendant relation, spaceIsAtOrBelow) come from
// the FOLD (treefold) — these predicates take them as inputs and stay PURE. Ports the substance of
// ableAuth.js (permits*) + spaceLookup.js (matchPattern / ableReachesTarget reach loop).

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
fn as_arr(v: Option<&Json>) -> &[Json] {
    match v {
        Some(Json::Arr(a)) => a.as_slice(),
        _ => &[],
    }
}
/// A can-list entry's primary field: a bare string IS the value; an object carries it under `key`.
fn entry_field<'a>(entry: &'a Json, key: &str) -> Option<&'a str> {
    match entry {
        Json::Str(s) => Some(s),
        Json::Obj(_) => get(entry, key).and_then(as_str),
        _ => None,
    }
}
/// A secondary field (intent/as) only exists on OBJECT entries — never read it off a bare string.
fn obj_field<'a>(entry: &'a Json, key: &str) -> Option<&'a str> {
    match entry {
        Json::Obj(_) => get(entry, key).and_then(as_str),
        _ => None,
    }
}

/// matchPattern (spaceLookup.js): a reach/glob pattern vs a target space-id or path.
pub fn match_pattern(pat: &str, target_space: Option<&str>, target_path: Option<&str>) -> bool {
    if pat == "**" || pat == "/**" || pat == "/" {
        return true;
    }
    if target_space == Some(pat) || target_path == Some(pat) {
        return true;
    }
    // prefix/** — subtree at any depth
    if let Some(p0) = pat.strip_suffix("/**") {
        let prefix = if p0.is_empty() { "/" } else { p0 };
        if let Some(tp) = target_path {
            if tp == prefix || tp.starts_with(&format!("{prefix}/")) {
                return true;
            }
        }
    }
    // prefix/* — direct children only
    if let Some(p0) = pat.strip_suffix("/*") {
        let prefix = if p0.is_empty() { "/" } else { p0 };
        if let Some(tp) = target_path {
            let pfx = format!("{prefix}/");
            if let Some(rest) = tp.strip_prefix(&pfx) {
                if !rest.is_empty() && !rest.contains('/') {
                    return true;
                }
            }
        }
    }
    false
}

/// matchBeingNamePattern (ableAuth.js): a canCall pattern vs a target being name.
pub fn match_being_name_pattern(pattern: &str, target_being: Option<&str>) -> bool {
    if pattern.is_empty() {
        return false;
    }
    if pattern == "@*" || pattern == "*" {
        return true;
    }
    let Some(tb) = target_being else {
        return false;
    };
    let want = pattern.strip_prefix('@').unwrap_or(pattern);
    match want.strip_suffix('*') {
        Some(prefix) => tb.starts_with(prefix),
        None => tb == want,
    }
}

/// The act being authorized, by verb (the field the verb's `permits` consults).
pub struct PermitReq<'a> {
    pub action: Option<&'a str>,
    pub intent: Option<&'a str>,
    pub operation: Option<&'a str>,
    pub see_op: Option<&'a str>,
    pub target_being: Option<&'a str>,
}

/// permits (ableAuth.js): does the spec's can-list for `verb` allow this op?
pub fn permits(spec: &Json, verb: &str, req: &PermitReq) -> bool {
    match verb {
        "see" => permits_see(spec, req.see_op),
        "do" => permits_do(spec, req.action),
        "call" => permits_call(spec, req.target_being, req.intent),
        "be" => permits_be(spec, req.operation),
        _ => false,
    }
}

fn permits_see(spec: &Json, see_op: Option<&str>) -> bool {
    let list = as_arr(get(spec, "canSee"));
    if list.is_empty() {
        return false;
    }
    for entry in list {
        let Some(name) = entry_field(entry, "name") else { continue };
        if name == "*" {
            return true;
        }
        if see_op == Some(name) {
            return true;
        }
    }
    false
}

fn permits_do(spec: &Json, action: Option<&str>) -> bool {
    let Some(action) = action else { return false };
    for entry in as_arr(get(spec, "canDo")) {
        let Some(a) = entry_field(entry, "action") else { continue };
        if a == "*" || a == action {
            return true;
        }
        // namespace: `set-being:position` matches canDo `set-being` or `set-being:*`
        if let Some(idx) = action.find(':') {
            if idx > 0 {
                let ns = &action[..idx];
                if a == ns || a == format!("{ns}:*") {
                    return true;
                }
            }
        }
        // wildcard prefix on the entry: `grant-able:*` matches `grant-able:human`
        if let Some(prefix) = a.strip_suffix(":*") {
            if action == prefix || action.starts_with(&format!("{prefix}:")) {
                return true;
            }
        }
    }
    false
}

fn permits_call(spec: &Json, target_being: Option<&str>, intent: Option<&str>) -> bool {
    for entry in as_arr(get(spec, "canCall")) {
        if obj_field(entry, "as") == Some("receiver") {
            continue; // receiver-side declarations don't grant outbound call
        }
        let Some(pattern) = entry_field(entry, "pattern") else { continue };
        if !match_being_name_pattern(pattern, target_being) {
            continue;
        }
        // no requested intent, or entry unconstrained, or wildcard, or exact match
        match (intent, obj_field(entry, "intent")) {
            (None, _) | (_, None) | (_, Some("*")) => return true,
            (Some(i), Some(ei)) if i == ei => return true,
            _ => {}
        }
    }
    false
}

fn permits_be(spec: &Json, operation: Option<&str>) -> bool {
    let Some(operation) = operation else { return false };
    for entry in as_arr(get(spec, "canBe")) {
        let Some(op) = entry_field(entry, "operation") else { continue };
        if op == "*" || op == operation {
            return true;
        }
    }
    false
}

/// ableReachesTarget reach loop (spaceLookup.js): start from `base_covered` (target at/below host),
/// then apply the spec's reach patterns in order — a bare pattern ADDS coverage, a `!`-pattern
/// EXCLUDES. No reach list ⇒ just the base. `target_path` is derived from the fold by the caller.
pub fn reach_covers(spec: &Json, target_space: Option<&str>, target_path: Option<&str>, base_covered: bool) -> bool {
    let reach = as_arr(get(spec, "reach"));
    if reach.is_empty() {
        return base_covered;
    }
    let mut covered = base_covered;
    for pat in reach {
        let Some(p) = as_str(pat) else { continue };
        if p.is_empty() {
            continue;
        }
        if let Some(excl) = p.strip_prefix('!') {
            if match_pattern(excl, target_space, target_path) {
                covered = false;
            }
        } else if match_pattern(p, target_space, target_path) {
            covered = true;
        }
    }
    covered
}

// ── the layered able-walk (authorizeViaAbles, the new shape) ──────────────────
//
// NO special "arrival floor" loophole — that was old logic. Access is CONDITIONAL on holding a being:
// a reality either offers a PUBLIC being to inhabit (connect → you gain its grants), requires you to
// BRING a being from your own story (federation), or offers none (private). Those are CONNECT flows,
// not auth special-cases. So an anonymous caller (no being) simply has no grants and is no owner, and
// falls through to deny; the instant it holds a being, the normal grant-walk applies.
//
// NO law:cannot prohibition register either — that concept was drift (Tabor: "i never had a
// law:cannot"). A able permits exactly what its spec's can-lists allow; nothing globally overrides a
// grant. There is no separate "cannot beats can" layer.

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(fields: Vec<(&str, Json)>) -> Json {
    Json::Obj(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn grant(able: &str, anchor: Json) -> Json {
    obj(vec![("ok", Json::Bool(true)), ("able", jstr(able)), ("anchor", anchor)])
}
fn deny(reason: &str) -> Json {
    obj(vec![("ok", Json::Bool(false)), ("reason", jstr(reason))])
}
/// `host || anchor || null` with empty strings treated as falsy.
fn first_anchor(a: Option<&str>, b: Option<&str>) -> Json {
    a.filter(|s| !s.is_empty())
        .or(b.filter(|s| !s.is_empty()))
        .map(jstr)
        .unwrap_or(Json::Null)
}

/// One granted able with its spec + host resolved from the fold, and the host-descendant base.
pub struct Grant<'a> {
    pub able: &'a str,
    pub anchor_space_id: Option<&'a str>,
    pub spec: &'a Json,
    pub host_space_id: Option<&'a str>,
    pub base_covered: bool,
}

/// Everything the able-walk needs, with every FOLD read pre-resolved (owner-claim, grants+specs+base)
/// so the walk itself is pure.
pub struct WalkArgs<'a> {
    pub identity: Option<&'a Json>, // { beingId, name }
    pub verb: &'a str,
    pub owner_claim: Option<&'a Json>, // { ownerIds:[…], spaceId } — nearest owned ancestor
    pub grants: &'a [Grant<'a>],
    pub target_space: Option<&'a str>,
    pub target_path: Option<&'a str>,
    pub req: PermitReq<'a>,
}

/// The able-walk: i-am → owner → grant-loop → deny. PURE over the pre-resolved fold inputs.
/// Returns {ok, able?, anchor?, reason?}. No arrival-floor and no law:cannot special cases (both drift).
pub fn able_walk(a: &WalkArgs) -> Json {
    let field = |k: &str| a.identity.and_then(|i| get(i, k)).and_then(as_str);

    // 1. I-Am bootstrap axiom — the I-being is "I"
    let being_id = field("beingId");
    if being_id == Some("I") || field("name") == Some("I") {
        return grant("i-am", Json::Null);
    }
    // 2. ownership — nearest-claim-wins; an identified actor in the claim's owners ⇒ allow.
    //    (Anonymous: no beingId, so never an owner — falls through.)
    if let (Some(bid), Some(claim)) = (being_id, a.owner_claim) {
        if as_arr(get(claim, "ownerIds")).iter().any(|id| as_str(id) == Some(bid)) {
            return grant("owner", get(claim, "spaceId").and_then(as_str).map(jstr).unwrap_or(Json::Null));
        }
        // else someone else's claim — fall through to the grant-loop
    }
    // 3. the grant-walk — the first granted able whose reach covers AND whose spec permits.
    //    (Anonymous: no being ⇒ no grants ⇒ empty.)
    for g in a.grants {
        if reach_covers(g.spec, a.target_space, a.target_path, g.base_covered) && permits(g.spec, a.verb, &a.req) {
            return grant(g.able, first_anchor(g.host_space_id, g.anchor_space_id));
        }
    }
    // 4. deny
    let op = a.req.action.or(a.req.see_op).or(a.req.operation).or(a.req.intent);
    deny(&format!("no granted able permits {}{}", a.verb, op.map(|o| format!(":{o}")).unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use treehash::parse;

    fn spec(s: &str) -> Json {
        parse(s).expect("spec json")
    }

    #[test]
    fn match_pattern_globs() {
        assert!(match_pattern("**", None, Some("/anything")));
        assert!(match_pattern("/garden/**", None, Some("/garden/shed")));
        assert!(match_pattern("/garden/**", None, Some("/garden"))); // = prefix
        assert!(match_pattern("/garden/*", None, Some("/garden/shed"))); // direct child
        assert!(!match_pattern("/garden/*", None, Some("/garden/shed/tool"))); // too deep
        assert!(match_pattern("space-123", Some("space-123"), None)); // exact id
        assert!(!match_pattern("/garden", None, Some("/other")));
    }

    #[test]
    fn permits_do_namespaces_and_wildcards() {
        assert!(permits(&spec(r#"{"canDo":["*"]}"#), "do", &req_do("anything")));
        assert!(permits(&spec(r#"{"canDo":["set-being:*"]}"#), "do", &req_do("set-being:position")));
        assert!(permits(&spec(r#"{"canDo":["set-being"]}"#), "do", &req_do("set-being:position")));
        assert!(permits(&spec(r#"{"canDo":["set-being"]}"#), "do", &req_do("set-being")));
        assert!(!permits(&spec(r#"{"canDo":["grant-able"]}"#), "do", &req_do("set-being")));
    }

    #[test]
    fn permits_see_call_be() {
        assert!(permits(&spec(r#"{"canSee":["*"]}"#), "see", &req_see("place")));
        assert!(permits(&spec(r#"{"canSee":["arrival-view"]}"#), "see", &req_see("arrival-view")));
        assert!(!permits(&spec(r#"{"canSee":["arrival-view"]}"#), "see", &req_see("place")));
        assert!(permits(&spec(r#"{"canCall":["@cherub:*"]}"#), "call", &req_call("cherub:mate", None)));
        assert!(permits(&spec(r#"{"canCall":[{"pattern":"@fed","intent":"negotiate"}]}"#), "call", &req_call("fed", Some("negotiate"))));
        assert!(!permits(&spec(r#"{"canCall":[{"pattern":"@fed","intent":"negotiate"}]}"#), "call", &req_call("fed", Some("other"))));
        assert!(!permits(&spec(r#"{"canCall":[{"as":"receiver","pattern":"@x"}]}"#), "call", &req_call("x", None)));
        assert!(permits(&spec(r#"{"canBe":["connect"]}"#), "be", &req_be("connect")));
        assert!(!permits(&spec(r#"{"canBe":["connect"]}"#), "be", &req_be("kill")));
    }

    #[test]
    fn reach_base_add_exclude() {
        // no reach -> just the base
        assert!(reach_covers(&spec("{}"), None, Some("/x"), true));
        assert!(!reach_covers(&spec("{}"), None, Some("/x"), false));
        // add lifts a false base
        assert!(reach_covers(&spec(r#"{"reach":["/garden/**"]}"#), None, Some("/garden/shed"), false));
        // ! exclude beats a true base (the carve-out)
        assert!(!reach_covers(&spec(r#"{"reach":["!/vault/**"]}"#), None, Some("/vault/x"), true));
        // add then exclude, in order
        assert!(!reach_covers(&spec(r#"{"reach":["/a/**","!/a/secret/**"]}"#), None, Some("/a/secret/x"), false));
        assert!(reach_covers(&spec(r#"{"reach":["/a/**","!/a/secret/**"]}"#), None, Some("/a/open"), false));
    }

    #[test]
    fn able_walk_layered_flow() {
        let id = spec(r#"{"beingId":"b1"}"#);

        // 1. I-Am bypass
        let iam = spec(r#"{"beingId":"I"}"#);
        let r = able_walk(&WalkArgs { identity: Some(&iam), verb: "do", owner_claim: None, grants: &[], target_space: None, target_path: None, req: req_do("x") });
        assert_eq!(as_str(get(&r, "able").unwrap()), Some("i-am"));

        // 2. owner — nearest-claim-wins
        let claim = spec(r#"{"ownerIds":["b1"],"spaceId":"s1"}"#);
        let r = able_walk(&WalkArgs { identity: Some(&id), verb: "do", owner_claim: Some(&claim), grants: &[], target_space: None, target_path: None, req: req_do("x") });
        assert_eq!(as_str(get(&r, "able").unwrap()), Some("owner"));
        assert_eq!(as_str(get(&r, "anchor").unwrap()), Some("s1"));

        // 3. a grant whose reach covers (base) AND whose spec permits
        let gspec = spec(r#"{"canDo":["set-being:*"]}"#);
        let grants = [Grant { able: "editor", anchor_space_id: None, spec: &gspec, host_space_id: Some("root"), base_covered: true }];
        let r = able_walk(&WalkArgs { identity: Some(&id), verb: "do", owner_claim: None, grants: &grants, target_space: Some("sX"), target_path: None, req: req_do("set-being:position") });
        assert_eq!(as_str(get(&r, "able").unwrap()), Some("editor"));
        assert_eq!(as_str(get(&r, "anchor").unwrap()), Some("root"));

        // 4. a grant that permits but whose reach EXCLUDES the target -> deny
        let gspec2 = spec(r#"{"canDo":["*"],"reach":["/garden/**"]}"#);
        let grants2 = [Grant { able: "editor", anchor_space_id: None, spec: &gspec2, host_space_id: None, base_covered: false }];
        let r = able_walk(&WalkArgs { identity: Some(&id), verb: "do", owner_claim: None, grants: &grants2, target_space: None, target_path: Some("/other"), req: req_do("x") });
        assert!(matches!(get(&r, "ok"), Some(Json::Bool(false))));
        assert!(as_str(get(&r, "reason").unwrap()).unwrap().starts_with("no granted able permits do:x"));

        // 5. anonymous (no being) -> no grants, no owner -> deny (must connect to a public being first)
        let anon = spec("{}");
        let r = able_walk(&WalkArgs { identity: Some(&anon), verb: "see", owner_claim: None, grants: &[], target_space: None, target_path: None, req: req_see("place") });
        assert!(matches!(get(&r, "ok"), Some(Json::Bool(false))));
    }

    fn req_do(a: &str) -> PermitReq<'_> {
        PermitReq { action: Some(a), intent: None, operation: None, see_op: None, target_being: None }
    }
    fn req_see(s: &str) -> PermitReq<'_> {
        PermitReq { action: None, intent: None, operation: None, see_op: Some(s), target_being: None }
    }
    fn req_call<'a>(b: &'a str, intent: Option<&'a str>) -> PermitReq<'a> {
        PermitReq { action: None, intent, operation: None, see_op: None, target_being: Some(b) }
    }
    fn req_be(op: &str) -> PermitReq<'_> {
        PermitReq { action: None, intent: None, operation: Some(op), see_op: None, target_being: None }
    }
}
