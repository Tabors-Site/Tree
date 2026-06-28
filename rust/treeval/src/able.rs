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

const ARRIVAL_ABLE: &str = "arrival";

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

/// The arrival floor (the implicit anonymous / cross-story able), resolved from the fold.
pub struct ArrivalFloor<'a> {
    pub spec: Option<&'a Json>, // None when no arrival able is registered
    pub host_space_id: Option<&'a str>,
    pub base_covered: bool,
}

/// Everything the able-walk needs, with every FOLD read pre-resolved (prohibition verdict,
/// owner-claim, grants+specs+base, arrival floor) so the walk itself is pure.
pub struct WalkArgs<'a> {
    pub identity: Option<&'a Json>, // { beingId, name, canopyVerifiedSender, story }
    pub verb: &'a str,
    pub i_am: &'a str,
    pub prohibited: bool, // prohibitedByLaw — the folded `cannot` register
    pub owner_claim: Option<&'a Json>, // { ownerIds:[…], spaceId } — nearest owned ancestor
    pub grants: &'a [Grant<'a>],
    pub arrival: ArrivalFloor<'a>,
    pub target_space: Option<&'a str>,
    pub target_path: Option<&'a str>,
    pub req: PermitReq<'a>,
}

fn check_arrival_floor(af: &ArrivalFloor, verb: &str, req: &PermitReq, ts: Option<&str>, tp: Option<&str>) -> Json {
    let Some(spec) = af.spec else {
        return deny("no arrival able registered; anonymous callers have no floor.");
    };
    if !reach_covers(spec, ts, tp, af.base_covered) {
        return deny("arrival floor does not reach this position.");
    }
    if permits(spec, verb, req) {
        return grant(ARRIVAL_ABLE, af.host_space_id.map(jstr).unwrap_or(Json::Null));
    }
    deny("arrival floor does not permit this action; please authenticate.")
}

/// The full able-walk (authorizeViaAbles): law → i-am → arrival floor → owner → grant-loop →
/// cross-story fallback → deny. PURE over the pre-resolved fold inputs. Returns {ok, able?, anchor?, reason?}.
pub fn able_walk(a: &WalkArgs) -> Json {
    let field = |k: &str| a.identity.and_then(|i| get(i, k)).and_then(as_str);

    // 1. prohibition wins (rule 14) — a folded `cannot` beats any grant
    if a.prohibited {
        return deny("prohibited by law");
    }
    // 2. I-Am bootstrap axiom
    let being_id = field("beingId");
    if being_id == Some(a.i_am) || field("name") == Some(a.i_am) {
        return grant("i-am", Json::Null);
    }
    // 3. anonymous arrival floor — stateless callers run under the implicit arrival able
    if !being_id.is_some_and(|s| !s.is_empty()) {
        return check_arrival_floor(&a.arrival, a.verb, &a.req, a.target_space, a.target_path);
    }
    // 4. ownership — nearest-claim-wins; actor in the claim's owners ⇒ allow
    if let Some(claim) = a.owner_claim {
        if as_arr(get(claim, "ownerIds")).iter().any(|id| as_str(id) == being_id) {
            return grant("owner", get(claim, "spaceId").and_then(as_str).map(jstr).unwrap_or(Json::Null));
        }
        // else someone else's claim — fall through to the grant-loop
    }
    // 5. the grant-walk — the first granted able whose reach covers AND whose spec permits
    for g in a.grants {
        if reach_covers(g.spec, a.target_space, a.target_path, g.base_covered) && permits(g.spec, a.verb, &a.req) {
            return grant(g.able, first_anchor(g.host_space_id, g.anchor_space_id));
        }
    }
    // 6. cross-story fallback — a canopy-verified foreign actor falls to the arrival floor
    let canopy = matches!(a.identity.and_then(|i| get(i, "canopyVerifiedSender")), Some(Json::Bool(true)));
    if canopy || field("story").is_some_and(|s| !s.is_empty()) {
        return check_arrival_floor(&a.arrival, a.verb, &a.req, a.target_space, a.target_path);
    }
    // 7. deny
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
