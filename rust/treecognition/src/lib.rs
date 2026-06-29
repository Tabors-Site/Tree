// treecognition — a being's THINKING. All cognition is one loop: a being takes a MOMENT (perceives its
// inner-face), DECIDES a Word, and ACTs (seals it). `moment` + `act` are already Rust (treeibp); the
// only thing that differs by "mode" is WHO decides the Word:
//
//   human    — the PERSON decides. NOT in this crate: the portal calls `moment` (reads the inner-face),
//              shows it, and calls `act` with the Word the person spoke. moment + act, nothing else.
//   scripted — the able's `.word` FLOWS decide. Evaluate each flow's When-condition over the inner-face;
//              the first that holds yields the Word (treeword parses the flows, treeval resolves the cond).
//   llm      — the MODEL decides. One grammar-constrained Word per moment (the pure-word model, llm.md:
//              the emission IS the stamp; no free prose to parse back). Only the model call leaves the box.
//
// So this crate is the two AUTONOMOUS deciders. Each returns a `Cognition` — the discriminated outcome
// (cognitionResult.js): the being acted (a Word), looked and chose not to (SEE = a = empty, not failure),
// or broke. The binary runs the loop: moment -> cognize -> act.

pub mod assemble;
pub mod call;
pub mod chain;
pub mod cognize;
pub mod llm;
pub mod scripted;
pub mod ssrf;

/// The failure CLASS of a broken cognition (cognitionResult.js FAILURE_SHAPES). The infra failures (the
/// cognition tried to act and the rails failed) plus the one DOMAIN failure `Refused` — it perceived the
/// situation and deliberately declined (a perception-aware refusal, not a crash).
#[derive(Debug, Clone, PartialEq)]
pub enum FailShape {
    Timeout,
    HttpError,
    Garbage,
    Aborted,
    Internal,
    Refused,
}

/// The discriminated outcome of ONE moment's cognition (cognitionResult.js). Three kinds, no fourth.
/// Only `Act` carries content, so a non-act literally cannot be sealed — the seal-gate is structural.
#[derive(Debug, Clone, PartialEq)]
pub enum Cognition {
    /// The being ACTED: `content` is the Word it spoke. The moment seals it (into the act's closing).
    Act { content: String },
    /// The being LOOKED and chose not to act — a legitimate outcome (SEE = a = empty), NOT a failure:
    /// no act row, no seal, no retry. The moment ran to completion; the inbox closes clean.
    See,
    /// The cognition BROKE. No act, no completion. `shape` decides recoverability; `reason` is the log.
    Failure { shape: FailShape, reason: String },
}

impl Cognition {
    /// The legacy `ok` field — did a seal happen? (act => true; see/failure => false). New code branches
    /// on the variant; `ok` stays derived because the old code leaned on it.
    pub fn ok(&self) -> bool {
        matches!(self, Cognition::Act { .. })
    }
    /// A failure of the given shape.
    pub fn failure(shape: FailShape, reason: impl Into<String>) -> Self {
        Cognition::Failure { shape, reason: reason.into() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cognition_seal_gate_is_structural() {
        // only Act seals (carries content); See and Failure cannot.
        assert!(Cognition::Act { content: "do move north.".into() }.ok());
        assert!(!Cognition::See.ok());
        assert!(!Cognition::failure(FailShape::Refused, "name collision").ok());
        println!("  treecognition: the Cognition contract — act seals, see/failure do not  OK");
    }
}
