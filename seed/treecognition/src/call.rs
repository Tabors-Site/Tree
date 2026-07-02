// treecognition::call — the failover routing policy (port of call.js). Given the resolved connection
// chain (chain.rs), try each connection in order: a RETRYABLE failure falls through to the next, a
// FATAL one stops the walk. Returns the first success, or the terminal failure mapped to a FailShape.
//
// 500 is deliberately NOT retryable: local inference backends (ollama, qwen3, …) return 500 for
// DETERMINISTIC failures (context too long, bad params) — a blind retry fails identically and burns the
// stack. 502/503/504 stay retryable (transient upstream/network); 429 stays retryable (rate limit).
//
// PURE routing. The per-call timeout, the 429 backoff, and the cumulative deadline (15s in the JS) are
// the EDGE's — the injected `call` owns the clock + the socket; this layer owns only which connection
// answers and how a failure is classified. So it is fully testable with a fake caller.

use crate::FailShape;

/// 500 is intentionally absent — see the module note.
const RETRYABLE: &[u32] = &[429, 502, 503, 504];

/// A failed model call: an HTTP status (if the server answered), and/or a timeout.
#[derive(Debug, Clone)]
pub struct CallError {
    pub status: Option<u32>,
    pub timed_out: bool,
    pub message: String,
}

impl CallError {
    pub fn status(code: u32, message: impl Into<String>) -> Self {
        CallError { status: Some(code), timed_out: false, message: message.into() }
    }
    pub fn timeout(message: impl Into<String>) -> Self {
        CallError { status: None, timed_out: true, message: message.into() }
    }
}

/// A retryable failure walks to the next connection; a fatal one stops.
pub fn is_retryable(err: &CallError) -> bool {
    err.timed_out || err.status.is_some_and(|s| RETRYABLE.contains(&s))
}

/// Map a terminal call failure to the cognition failure class.
pub fn fail_shape(err: &CallError) -> FailShape {
    if err.timed_out {
        FailShape::Timeout
    } else if err.status.is_some() {
        FailShape::HttpError
    } else {
        FailShape::Internal
    }
}

/// Walk the chain: the first connection that succeeds wins; a retryable error tries the next; a fatal
/// error stops immediately. On exhaustion, the last failure's shape is returned. An empty chain is an
/// Internal failure (nothing resolved).
pub fn call_with_failover(connections: &[String], call: &mut dyn FnMut(&str) -> Result<String, CallError>) -> Result<String, (FailShape, String)> {
    if connections.is_empty() {
        return Err((FailShape::Internal, "no LLM connection resolved for this call".to_string()));
    }
    let mut last: Option<CallError> = None;
    for conn in connections {
        match call(conn) {
            Ok(text) => return Ok(text),
            Err(err) if !is_retryable(&err) => return Err((fail_shape(&err), err.message)),
            Err(err) => last = Some(err),
        }
    }
    let err = last.unwrap_or_else(|| CallError { status: None, timed_out: false, message: "exhausted".into() });
    Err((fail_shape(&err), format!("all {} connection(s) failed: {}", connections.len(), err.message)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conns(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn retryable_classification_matches_the_policy() {
        assert!(is_retryable(&CallError::status(429, "")));
        assert!(is_retryable(&CallError::status(503, "")));
        assert!(is_retryable(&CallError::timeout("")));
        assert!(!is_retryable(&CallError::status(500, ""))); // deterministic local failure
        assert!(!is_retryable(&CallError::status(400, "")));
    }

    #[test]
    fn first_success_wins_without_touching_the_rest() {
        let mut seen = Vec::new();
        let mut call = |c: &str| {
            seen.push(c.to_string());
            Ok::<_, CallError>(format!("from {c}"))
        };
        let r = call_with_failover(&conns(&["a", "b", "c"]), &mut call);
        assert_eq!(r.unwrap(), "from a");
        assert_eq!(seen, vec!["a"]); // b, c never tried
    }

    #[test]
    fn retryable_walks_to_the_next_connection() {
        let mut call = |c: &str| {
            if c == "a" {
                Err(CallError::status(503, "upstream"))
            } else {
                Ok(format!("from {c}"))
            }
        };
        assert_eq!(call_with_failover(&conns(&["a", "b"]), &mut call).unwrap(), "from b");
    }

    #[test]
    fn fatal_500_stops_the_walk() {
        let mut seen = Vec::new();
        let mut call = |c: &str| {
            seen.push(c.to_string());
            Err::<String, _>(CallError::status(500, "ctx too long"))
        };
        let (shape, _) = call_with_failover(&conns(&["a", "b"]), &mut call).unwrap_err();
        assert_eq!(shape, FailShape::HttpError);
        assert_eq!(seen, vec!["a"]); // never falls through to b on a fatal error
    }

    #[test]
    fn all_retryable_exhausts_to_the_last_shape() {
        let mut call = |_: &str| Err::<String, _>(CallError::timeout("deadline"));
        let (shape, _) = call_with_failover(&conns(&["a", "b"]), &mut call).unwrap_err();
        assert_eq!(shape, FailShape::Timeout);
    }

    #[test]
    fn empty_chain_is_an_internal_failure() {
        let mut call = |_: &str| Ok::<_, CallError>("x".to_string());
        let (shape, _) = call_with_failover(&[], &mut call).unwrap_err();
        assert_eq!(shape, FailShape::Internal);
    }
}
