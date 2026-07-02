// treecognition::cognize — the ROUTER + the loop. All cognition is one loop: a being takes a MOMENT
// (perceives its inner-face), DECIDES a Word, and ACTs (seals it). This routes the DECISION by the
// able's cognition mode and then seals an Act through an injected `seal` closure. The moment-read (the
// face) and the seal (treeibp::act) are the EDGE's; this owns the routing + the loop, and stays pure +
// testable. The binary calls `run_moment` with the real seams.
//
//   default  — no autonomous decider. Sensors, the portal's human, a foreign being from another story:
//              they call moment+act through the wire; cognition decides nothing for them -> See.
//   scripted — the able's `.word` flows decide (scripted::decide_scripted).
//   llm      — the model decides (assemble the Word prompt -> llm::decide_llm over the transport).

use crate::{assemble, llm, scripted, Cognition, FailShape};
use treehash::Json;

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

/// Who decides this being's Word.
#[derive(Debug, PartialEq)]
pub enum Mode {
    Default,
    Scripted,
    Llm,
}

/// The able's cognition mode (fold_able_noun -> `requiredCognition`, from "An <able> needs <mode>
/// cognition."). Absent/unknown = Default (the plain moment+act path — no autonomous decider).
pub fn mode_of(able_spec: &Json) -> Mode {
    match s(able_spec, "requiredCognition") {
        "llm" => Mode::Llm,
        "scripted" => Mode::Scripted,
        _ => Mode::Default,
    }
}

/// Decide the Word for one moment, without sealing. `face` is the perceived inner-face; `flows` are the
/// able's parsed `.word` flows (scripted); `identity` + `able_spec` build the llm prompt; `host`
/// resolves domain predicates in scripted triggers; `transport` is the (failover-wrapped) model call.
pub fn decide(able_spec: &Json, flows: &[Json], face: &Json, identity: &Json, host: &dyn Fn(&str, &[Json]) -> bool, transport: &llm::Transport) -> Cognition {
    match mode_of(able_spec) {
        Mode::Default => Cognition::See, // the act arrives from the wire, not from a decider
        Mode::Scripted => scripted::decide_scripted(flows, face, host),
        Mode::Llm => llm::decide_llm(&assemble::build_prompt(identity, able_spec, face), transport),
    }
}

/// The full loop for ONE moment: decide, then on an Act seal the Word through `seal` (treeibp::act at
/// the edge). A seal error becomes an Internal failure (the decision was sound; the rails broke). See /
/// Failure pass through untouched (nothing to seal). Returns the outcome the caller records.
pub fn run_moment(able_spec: &Json, flows: &[Json], face: &Json, identity: &Json, host: &dyn Fn(&str, &[Json]) -> bool, transport: &llm::Transport, seal: &dyn Fn(&str) -> Result<(), String>) -> Cognition {
    let decision = decide(able_spec, flows, face, identity, host, transport);
    if let Cognition::Act { content } = &decision {
        if let Err(e) = seal(content) {
            return Cognition::failure(FailShape::Internal, format!("act seal failed: {e}"));
        }
    }
    decision
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jstr(x: &str) -> Json {
        Json::Str(x.to_string())
    }
    fn obj(f: Vec<(&str, Json)>) -> Json {
        Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
    fn spec(mode: &str) -> Json {
        obj(vec![("requiredCognition", jstr(mode))])
    }
    fn no_host(_: &str, _: &[Json]) -> bool {
        false
    }
    fn never_called(_: &str) -> Result<String, (FailShape, String)> {
        panic!("transport must not be called");
    }

    #[test]
    fn mode_routing() {
        assert_eq!(mode_of(&spec("llm")), Mode::Llm);
        assert_eq!(mode_of(&spec("scripted")), Mode::Scripted);
        assert_eq!(mode_of(&spec("anything-else")), Mode::Default);
        assert_eq!(mode_of(&obj(vec![])), Mode::Default);
    }

    #[test]
    fn default_mode_decides_nothing_and_never_calls_the_model() {
        let d = decide(&spec("default"), &[], &obj(vec![]), &obj(vec![]), &no_host, &never_called);
        assert_eq!(d, Cognition::See);
    }

    #[test]
    fn scripted_mode_routes_to_the_flows() {
        let flow = obj(vec![
            ("kind", jstr("flow")),
            ("when", obj(vec![("state", obj(vec![("sky", jstr("dawn"))]))])),
            ("effects", Json::Arr(treeword::parse("When it is dawn:\n  do crow.").into_iter().filter_map(|n| if let Json::Obj(e) = &n { e.iter().find(|(k, _)| k == "effects").map(|(_, v)| v.clone()) } else { None }).next().map(|e| if let Json::Arr(a) = e { a } else { vec![] }).unwrap_or_default())),
        ]);
        let face = obj(vec![("state", obj(vec![("sky", jstr("dawn"))]))]);
        let d = decide(&spec("scripted"), std::slice::from_ref(&flow), &face, &obj(vec![]), &no_host, &never_called);
        assert_eq!(d, Cognition::Act { content: "do crow.".into() });
    }

    #[test]
    fn run_moment_seals_an_act_and_reports_seal_failure() {
        let identity = obj(vec![("name", jstr("Cain")), ("able", jstr("seer")), ("space", jstr("here"))]);
        // an llm being whose model speaks an act
        let t = |_: &str| Ok::<_, (FailShape, String)>("I make notebook.".to_string());

        // seal succeeds -> the Word is sealed, the Act passes through
        let sealed = std::cell::Cell::new(String::new());
        let ok_seal = |w: &str| {
            sealed.set(w.to_string());
            Ok(())
        };
        let out = run_moment(&spec("llm"), &[], &obj(vec![]), &identity, &no_host, &t, &ok_seal);
        assert_eq!(out, Cognition::Act { content: "I make notebook.".into() });
        assert_eq!(sealed.take(), "I make notebook.");

        // seal fails -> Internal failure
        let bad_seal = |_: &str| Err("disk full".to_string());
        let out = run_moment(&spec("llm"), &[], &obj(vec![]), &identity, &no_host, &t, &bad_seal);
        match out {
            Cognition::Failure { shape, .. } => assert_eq!(shape, FailShape::Internal),
            other => panic!("expected Internal failure, got {other:?}"),
        }
    }
}
