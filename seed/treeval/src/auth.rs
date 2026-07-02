// treeval::auth — the act gate's CROSS-HISTORY resolution: the sophisticated part that must NOT be
// lost in the verb collapse. Two invariants live here:
//
//   1. The history that GATES an act and the history a fact STAMPS on can never diverge — one
//      precedence chain, used by both (authorize.js + the verb layer's resolveHistoryForFact).
//   2. The FOREIGN-ACTOR guard: a cross-story actor's act carries THEIR home history (a path in
//      another substrate's namespace). Their grants HERE were granted here, on local histories, so
//      a foreign actor's grants read from the TARGET's history, not their own. Plus the "look
//      through the portal" semantic — you remain yourself across branches.
//
// Ports seed/ibp/historyResolve.js (resolveTargetHistory) + authorize.js's actorHistory derivation
// (lines 174-179). PURE: a function of (target, moment, args, storyDomain). The able-walk
// (authorizeViaAbles, 664 LOC) and the authorize control flow are separate, later pieces.

use treehash::Json;

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}

/// nonEmpty (historyResolve.js): a non-empty string, else None. The `||` chains below treat None as
/// JS falsy, so this doubles as the `||`-truthiness test for histories.
fn non_empty(v: Option<&Json>) -> Option<String> {
    match v {
        Some(Json::Str(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// resolveTargetHistory (historyResolve.js): target.history -> moment.targetHistory ->
/// moment.actorAct.history -> currentHistory -> null. The most specific statement of where the
/// target lives wins; this is the SAME chain the fact stamp uses, so gate and stamp never diverge.
pub fn resolve_target_history(
    target: Option<&Json>,
    moment: Option<&Json>,
    current_history: Option<&Json>,
) -> Option<String> {
    non_empty(target.and_then(|t| get(t, "history")))
        .or_else(|| non_empty(moment.and_then(|m| get(m, "targetHistory"))))
        .or_else(|| non_empty(moment.and_then(|m| get(m, "actorAct")).and_then(|a| get(a, "history"))))
        .or_else(|| non_empty(current_history))
}

/// The actorHistory derivation (authorize.js 174-179), INCLUDING the foreign-actor guard:
///   actorActIsLocal = !moment.actorAct.story || moment.actorAct.story === storyDomain
///   actorHistory    = args.actorHistory || (actorActIsLocal ? moment.actorAct.history : null) || targetHistory
/// A foreign actor (their act's story != the local story domain) reads grants from `target_history`,
/// never from their own home history.
pub fn resolve_actor_history(
    args_actor_history: Option<&Json>,
    moment: Option<&Json>,
    story_domain: &str,
    target_history: Option<&str>,
) -> Option<String> {
    let actor_act = moment.and_then(|m| get(m, "actorAct"));
    let actor_act_is_local = match actor_act.and_then(|a| get(a, "story")) {
        None | Some(Json::Null) => true,                 // !story
        Some(Json::Str(s)) if s.is_empty() => true,      // !story (empty)
        Some(Json::Str(s)) => s == story_domain,         // local iff same domain
        _ => false,
    };
    non_empty(args_actor_history)
        .or_else(|| {
            if actor_act_is_local {
                non_empty(actor_act.and_then(|a| get(a, "history")))
            } else {
                None // foreign actor: drop their home history, fall to the target's
            }
        })
        .or_else(|| target_history.map(|s| s.to_string()))
}

// ── the authorize control flow (the decision skeleton) ───────────────────────

fn as_str(v: &Json) -> Option<&str> {
    match v {
        Json::Str(s) => Some(s),
        _ => None,
    }
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(fields: Vec<(&str, Json)>) -> Json {
    Json::Obj(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn truthy(v: &Json) -> bool {
    match v {
        Json::Null => false,
        Json::Bool(b) => *b,
        Json::Str(s) => !s.is_empty(),
        Json::Num(n) => *n != 0.0,
        _ => true,
    }
}
/// JS `expr || null` for an optional field.
fn or_null(v: Option<&Json>) -> Json {
    match v {
        Some(x) if truthy(x) => x.clone(),
        _ => Json::Null,
    }
}

/// Inputs to the authorize DECISION. The three entangled resolutions are pre-computed by the caller
/// (kept OUT of the pure skeleton): `ext_blocked` = the extension-scope gate's verdict (Some(ownerExt)
/// if blocked), `able_result` = authorizeViaAbles's `{ok, able?, reason?}`, `inheritation_ok` =
/// hasAuthorityOver (the being-tree downward-authority walk). identity/target are Json objects.
pub struct DecideArgs<'a> {
    pub identity: Option<&'a Json>,
    pub verb: &'a str,
    pub target: Option<&'a Json>,
    pub audit_being_id: Option<&'a str>,
    pub ext_blocked: Option<&'a str>,
    pub able_result: &'a Json,
    pub inheritation_ok: bool,
}

/// authorize() control flow (authorize.js 65-229) — the PURE decision skeleton. The order is
/// load-bearing: I-Am bypass → discovery-see → ext-scope deny → able-walk grant → inheritation
/// fallback (additive: grants, never denies) → deny. Returns the verb-dispatch shape {ok, actor, reason?}.
pub fn authorize_decide(a: &DecideArgs) -> Json {
    let field = |k: &str| a.identity.and_then(|i| get(i, k)).and_then(as_str);

    // 1. I-Am bypass — the bootstrap axiom (the I-being is "I")
    if field("name") == Some("I") || field("beingId") == Some("I") {
        return obj(vec![("ok", Json::Bool(true)), ("actor", jstr("I"))]);
    }
    // 2. SEE on .discovery — the pre-identity surface every client reads on socket open
    let is_discovery = matches!(a.target.and_then(|t| get(t, "isDiscovery")), Some(Json::Bool(true)));
    if a.verb == "see" && is_discovery {
        return obj(vec![("ok", Json::Bool(true)), ("actor", jstr("discovery"))]);
    }
    // 3. extension scope gate (resolved upstream: getWordSync.ownerExtension + isExtensionBlockedAtSpace)
    if let Some(ext) = a.ext_blocked {
        return obj(vec![
            ("ok", Json::Bool(false)),
            ("actor", jstr("extension-blocked")),
            ("reason", jstr(&format!("Extension \"{ext}\" is blocked at this position"))),
        ]);
    }
    // 5. the able-walk grant -> verb-dispatch {ok, actor, reason}
    if matches!(get(a.able_result, "ok"), Some(Json::Bool(true))) {
        let actor = match get(a.able_result, "able") {
            Some(Json::Str(s)) if !s.is_empty() => s.clone(),
            _ => "permitted".to_string(),
        };
        return obj(vec![
            ("ok", Json::Bool(true)),
            ("actor", jstr(&actor)),
            ("reason", or_null(get(a.able_result, "reason"))),
        ]);
    }
    // 6. inheritation coverage — DO-on-being only; the being-tree owns the downward-authority axis
    let name_id = field("nameId");
    if a.verb == "do"
        && name_id.is_some_and(|s| !s.is_empty())
        && a.audit_being_id.is_some_and(|s| !s.is_empty())
        && a.inheritation_ok
    {
        return obj(vec![("ok", Json::Bool(true)), ("actor", jstr(name_id.unwrap()))]);
    }
    // 7. deny
    obj(vec![
        ("ok", Json::Bool(false)),
        ("actor", jstr("anonymous")),
        ("reason", or_null(get(a.able_result, "reason"))),
    ])
}
