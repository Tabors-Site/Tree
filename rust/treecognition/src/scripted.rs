// treecognition::scripted — the SCRIPTED decider. A scripted being's able `.word` FLOWS *are* its
// rules. At a moment it perceives the inner-face; this scans the flows in order and the FIRST whose
// When-trigger holds over the face decides — its effect, rendered as a Word, is the spoken act. No
// trigger holds => See (it looked and chose not to act; a clean, non-failure outcome).
//
// This is the Word-native shape, NOT a port of the old JS reactor (which carried JS closure triggers
// `{when(state)->bool, then(state)->word}`). Here the trigger IS the flow's parsed When-condition and
// the decision IS the rendered effect: treeword parses the flows + renders the decision, treeval
// evaluates the cond. PURE except the domain predicates (resolvedBy / seeCall), which dispatch through
// an injected `host` (fail-closed when there are none). The inner-face is opaque Json (a projection
// from another lane) — read only via cond paths, so this stays decoupled from the face's shape.

use crate::Cognition;
use treehash::Json;
use treeval::cond::resolve_cond;
use treeword::render::render_effect_word;

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn s<'a>(v: &'a Json, k: &str) -> &'a str {
    match get(v, k) {
        Some(Json::Str(x)) => x,
        _ => "",
    }
}
fn jstr(x: &str) -> Json {
    Json::Str(x.to_string())
}
fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// An equals-test cond over a face path — reuses treeval's canonical id-equality + get_path so a
/// trigger match means exactly what an `equals` cond means anywhere else.
fn equals(path: &str, value: Json) -> Json {
    obj(vec![("test", obj(vec![("op", jstr("equals")), ("path", jstr(path)), ("value", value)]))])
}

/// Decide by script: the first flow whose trigger holds over `face` speaks its effect as a Word; if
/// none hold, See. `host` resolves the domain predicates inside any trigger cond (fail-closed: pass
/// `&|_, _| false`).
pub fn decide_scripted(flows: &[Json], face: &Json, host: &dyn Fn(&str, &[Json]) -> bool) -> Cognition {
    for flow in flows {
        if s(flow, "kind") != "flow" {
            continue;
        }
        let when = match get(flow, "when") {
            Some(w) => w,
            None => continue,
        };
        if !trigger_holds(when, face, host) {
            continue;
        }
        // one Word per moment: the matched flow's FIRST effect is the spoken decision.
        let effects = match get(flow, "effects") {
            Some(Json::Arr(e)) if !e.is_empty() => e,
            _ => return Cognition::See, // a guard-only flow with nothing to speak
        };
        return match render_effect_word(&effects[0]) {
            Some(word) => Cognition::Act { content: word },
            None => Cognition::See, // an effect form not yet speakable as a standalone Word
        };
    }
    Cognition::See
}

/// Does a flow's When-trigger hold given the face?
/// - state ("When it is X") — the running state dimension (the trigger's own key) currently reads X.
/// - event / op — the face carries that triggering clause under `event`. (Provisional: the face's
///   event field belongs to the projection lane; refined when that shape lands.)
fn trigger_holds(when: &Json, face: &Json, host: &dyn Fn(&str, &[Json]) -> bool) -> bool {
    if let Some(Json::Obj(st)) = get(when, "state") {
        if let Some((var, val)) = st.first() {
            return resolve_cond(&equals(var, val.clone()), face, host);
        }
    }
    if let Some(Json::Str(e)) = get(when, "event") {
        return resolve_cond(&equals("event", jstr(e)), face, host);
    }
    if let Some(op) = get(when, "op") {
        let clause = s(op, "clause");
        if !clause.is_empty() {
            return resolve_cond(&equals("event", jstr(clause)), face, host);
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_host(_: &str, _: &[Json]) -> bool {
        false
    }

    #[test]
    fn scripted_first_matching_flow_speaks_an_actable_word() {
        // a genesis act is a real top-level, act-able decision Word (cf. the JS scripted ables that
        // return "I make notebook." as their `then`).
        let make = treeword::parse("I make notebook.").remove(0);
        let flow = obj(vec![
            ("kind", jstr("flow")),
            ("when", obj(vec![("state", obj(vec![("sky", jstr("dawn"))]))])),
            ("effects", Json::Arr(vec![make.clone()])),
        ]);
        // the face carries its dimensions under `state` (cond.js getPath resolves heads there).
        let face_dawn = obj(vec![("state", obj(vec![("sky", jstr("dawn"))]))]);
        let face_noon = obj(vec![("state", obj(vec![("sky", jstr("noon"))]))]);

        // trigger holds -> Act, and the spoken Word re-parses to the very effect it decided.
        match decide_scripted(std::slice::from_ref(&flow), &face_dawn, &no_host) {
            Cognition::Act { content } => {
                assert_eq!(content, "I make notebook.");
                let reparsed = treehash::canonicalize(&Json::Arr(treeword::parse(&content)));
                assert_eq!(reparsed, treehash::canonicalize(&Json::Arr(vec![make.clone()])));
            }
            other => panic!("expected Act, got {other:?}"),
        }
        // trigger does not hold -> See; and no flows at all -> See.
        assert_eq!(decide_scripted(std::slice::from_ref(&flow), &face_noon, &no_host), Cognition::See);
        assert_eq!(decide_scripted(&[], &face_dawn, &no_host), Cognition::See);
        println!("  treecognition::scripted — first-matching-flow decides, else See  OK");
    }

    #[test]
    fn scripted_decision_can_be_a_bare_imperative_deed() {
        // a flow whose effect is a `do` deed -> the spoken decision is "do move." and it re-parses.
        let mv = treeword::parse("When it is dusk:\n  do move.").remove(0);
        let eff = get(&mv, "effects").unwrap();
        let effs = if let Json::Arr(a) = eff { a.clone() } else { vec![] };
        let flow = obj(vec![
            ("kind", jstr("flow")),
            ("when", obj(vec![("state", obj(vec![("sky", jstr("dusk"))]))])),
            ("effects", Json::Arr(effs.clone())),
        ]);
        let face = obj(vec![("state", obj(vec![("sky", jstr("dusk"))]))]);
        match decide_scripted(&[flow], &face, &no_host) {
            Cognition::Act { content } => {
                assert_eq!(content, "do move.");
                let reparsed = treehash::canonicalize(&Json::Arr(treeword::parse(&content)));
                assert_eq!(reparsed, treehash::canonicalize(&Json::Arr(effs)));
            }
            other => panic!("expected Act, got {other:?}"),
        }
    }

    #[test]
    fn scripted_takes_the_first_match_in_order() {
        // ids that are not articles: a bare `a` reads as the article, leaving no object -> no parse.
        let a = treeword::parse("I make x.").remove(0);
        let b = treeword::parse("I make y.").remove(0);
        let flow = |x: &str, eff: &Json| {
            obj(vec![
                ("kind", jstr("flow")),
                ("when", obj(vec![("state", obj(vec![("sky", jstr(x))]))])),
                ("effects", Json::Arr(vec![eff.clone()])),
            ])
        };
        let flows = vec![flow("noon", &a), flow("dawn", &b), flow("dawn", &a)];
        let face = obj(vec![("state", obj(vec![("sky", jstr("dawn"))]))]);
        match decide_scripted(&flows, &face, &no_host) {
            Cognition::Act { content } => assert_eq!(content, "I make y."), // first dawn flow wins
            other => panic!("expected Act, got {other:?}"),
        }
    }
}
