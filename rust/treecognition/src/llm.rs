// treecognition::llm — the LLM decider. The model decides the Word for THIS moment. Per word/14.md +
// llm.md the new shape is the moment with two swaps + one addition: INPUT is the face + granted
// vocabulary as WORD (assemble.rs), OUTPUT is the model's WORD text run through the parser (NOT a
// tool-call), and on a miss a single translate-on-miss repair, then fail closed. The emission is
// canonical Word, so a clean parse with a deed IS the act — no free prose to re-interpret.
//
// The ONE external boundary is the model call itself, injected as `transport` (the binary wires a
// native HTTPS POST to an OpenAI-compatible endpoint at the edge, like treesign's ed25519). So this
// module is PURE + fully testable with a fake transport; the SSRF guard + the connection slot-chain +
// the failover live around the transport, not in this state machine.

use crate::{Cognition, FailShape};
use treehash::Json;

/// The injected model call — prompt in, the model's raw text out, or a typed failure (the retryable /
/// fatal split is the transport's; this layer just records the shape). The lifetime lets it close over
/// a client.
pub type Transport<'a> = dyn Fn(&str) -> Result<String, (FailShape, String)> + 'a;

/// Decide by model: send the assembled prompt, turn the returned Word into a Cognition. On garbage
/// (non-empty text that is not Word), make ONE repair attempt, then fail closed — never run a
/// half-parsed Word.
pub fn decide_llm(prompt: &str, transport: &Transport) -> Cognition {
    let text = match transport(prompt) {
        Ok(t) => t,
        Err((shape, reason)) => return Cognition::Failure { shape, reason },
    };
    match classify(&text) {
        Outcome::Act(content) => Cognition::Act { content },
        Outcome::See => Cognition::See,
        Outcome::Garbage => match transport(&repair_prompt(prompt, &text)) {
            Ok(fixed) => match classify(&fixed) {
                Outcome::Act(content) => Cognition::Act { content },
                Outcome::See => Cognition::See,
                Outcome::Garbage => Cognition::Failure {
                    shape: FailShape::Garbage,
                    reason: format!("model output is not Word, even after repair: {fixed:?}"),
                },
            },
            Err((shape, reason)) => Cognition::Failure { shape, reason },
        },
    }
}

enum Outcome {
    /// Word with at least one deed (an act) — seal it.
    Act(String),
    /// Said nothing, or only declared/looked (no deed) — a clean non-act.
    See,
    /// Non-empty text that parses to nothing — not Word; the repair path.
    Garbage,
}

/// Classify the model's reply as Word: empty -> See (said nothing); parses to nothing -> Garbage (the
/// repair path); parses with at least one ACT deed -> Act; parses but no deed -> See.
fn classify(text: &str) -> Outcome {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Outcome::See;
    }
    let nodes = treeword::parse(trimmed);
    if nodes.is_empty() {
        return Outcome::Garbage;
    }
    if nodes.iter().any(is_deed) {
        Outcome::Act(trimmed.to_string())
    } else {
        Outcome::See
    }
}

/// A deed = a runnable act (kind "act"). Declarations/flows a being utters are not deeds (no seal).
fn is_deed(node: &Json) -> bool {
    matches!(node, Json::Obj(e) if e.iter().any(|(k, v)| k == "kind" && matches!(v, Json::Str(s) if s == "act")))
}

/// translate-on-miss: re-issue the prompt, showing the model its non-Word reply, asking for Word only.
fn repair_prompt(original: &str, bad: &str) -> String {
    format!(
        "{original}\n\n[Your previous reply was not valid Word and could not be run:\n{bad}\nReply again with Word only — one statement, ending in a period. Nothing else.]"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn act_when_model_speaks_a_word_with_a_deed() {
        let t = |_: &str| Ok::<_, (FailShape, String)>("I make notebook.".to_string());
        assert_eq!(decide_llm("(prompt)", &t), Cognition::Act { content: "I make notebook.".into() });
    }

    #[test]
    fn see_when_model_says_nothing() {
        let t = |_: &str| Ok::<_, (FailShape, String)>("   ".to_string());
        assert_eq!(decide_llm("(prompt)", &t), Cognition::See);
    }

    #[test]
    fn transport_failure_propagates_its_shape() {
        let t = |_: &str| Err::<String, _>((FailShape::Timeout, "deadline".to_string()));
        assert_eq!(decide_llm("(prompt)", &t), Cognition::failure(FailShape::Timeout, "deadline"));
    }

    #[test]
    fn garbage_triggers_one_repair_then_succeeds() {
        // first reply is not Word; the repair reply is. Exactly two transport calls.
        let calls = Cell::new(0u32);
        let t = |_: &str| {
            calls.set(calls.get() + 1);
            Ok::<_, (FailShape, String)>(if calls.get() == 1 { "uhh, north?".to_string() } else { "I make notebook.".to_string() })
        };
        assert_eq!(decide_llm("(prompt)", &t), Cognition::Act { content: "I make notebook.".into() });
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn garbage_twice_fails_closed_as_garbage() {
        let t = |_: &str| Ok::<_, (FailShape, String)>("still not word".to_string());
        match decide_llm("(prompt)", &t) {
            Cognition::Failure { shape, .. } => assert_eq!(shape, FailShape::Garbage),
            other => panic!("expected Garbage failure, got {other:?}"),
        }
    }
}
