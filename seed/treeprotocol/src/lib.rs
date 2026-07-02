// treeprotocol — the IBP protocol error/envelope contract (port of seed/ibp/protocol.js). The error
// VOCABULARY the wire knows (IBP_ERR), the ONE canonical code -> HTTP-status mapping (throw sites carry
// only a semantic code; the wire derives the status here), the IbpError type, the transport-agnostic
// ok/error envelope shapes, and the message-pattern -> code mapper. PURE. The express send* helpers
// (sendOk/sendError/sendCaughtError) stay glue — treeos owns its own wire layer.

use regex::Regex;
use treehash::Json;

pub mod redact;

/// The IBP error code set — the codes the wire knows. (String codes are the wire contract; these
/// constants name them so callers don't hand-type the strings.)
pub mod code {
    // Data
    pub const SPACE_NOT_FOUND: &str = "SPACE_NOT_FOUND";
    pub const BEING_NOT_FOUND: &str = "BEING_NOT_FOUND";
    pub const MATTER_NOT_FOUND: &str = "MATTER_NOT_FOUND";
    pub const BRANCH_NOT_FOUND: &str = "BRANCH_NOT_FOUND";
    pub const NAME_NOT_FOUND: &str = "NAME_NOT_FOUND";
    // Auth
    pub const UNAUTHORIZED: &str = "UNAUTHORIZED";
    pub const FORBIDDEN: &str = "FORBIDDEN";
    pub const SESSION_EXPIRED: &str = "SESSION_EXPIRED";
    // Validation
    pub const INVALID_INPUT: &str = "INVALID_INPUT";
    pub const INVALID_TYPE: &str = "INVALID_TYPE";
    pub const INVALID_SPACE: &str = "INVALID_SPACE";
    // Rate limiting
    pub const RATE_LIMITED: &str = "RATE_LIMITED";
    // LLM
    pub const LLM_TIMEOUT: &str = "LLM_TIMEOUT";
    pub const LLM_FAILED: &str = "LLM_FAILED";
    pub const LLM_NOT_CONFIGURED: &str = "LLM_NOT_CONFIGURED";
    // Document size
    pub const DOCUMENT_SIZE_EXCEEDED: &str = "DOCUMENT_SIZE_EXCEEDED";
    // Uploads
    pub const UPLOAD_DISABLED: &str = "UPLOAD_DISABLED";
    pub const UPLOAD_TOO_LARGE: &str = "UPLOAD_TOO_LARGE";
    pub const UPLOAD_MIME_REJECTED: &str = "UPLOAD_MIME_REJECTED";
    // Space-tree health
    pub const SPACE_DORMANT: &str = "SPACE_DORMANT";
    // Extensions
    pub const EXTENSION_NOT_FOUND: &str = "EXTENSION_NOT_FOUND";
    pub const EXTENSION_BLOCKED: &str = "EXTENSION_BLOCKED";
    // Hooks
    pub const HOOK_TIMEOUT: &str = "HOOK_TIMEOUT";
    pub const HOOK_CANCELLED: &str = "HOOK_CANCELLED";
    // Conflict
    pub const RESOURCE_CONFLICT: &str = "RESOURCE_CONFLICT";
    // Federation
    pub const PEER_NOT_FOUND: &str = "PEER_NOT_FOUND";
    pub const PEER_UNREACHABLE: &str = "PEER_UNREACHABLE";
    // Origin / historical / cross-branch doctrine
    pub const SOURCE_READ_ONLY: &str = "SOURCE_READ_ONLY";
    pub const HISTORICAL_READ_ONLY: &str = "HISTORICAL_READ_ONLY";
    pub const CROSS_BRANCH_FORBIDDEN: &str = "CROSS_BRANCH_FORBIDDEN";
    pub const STORY_PAUSED: &str = "STORY_PAUSED";
    pub const MISSING_BRANCH: &str = "MISSING_BRANCH";
    // System
    pub const INTERNAL: &str = "INTERNAL";
    pub const TIMEOUT: &str = "TIMEOUT";
    // Wire-specific
    pub const ADDRESS_PARSE_ERROR: &str = "ADDRESS_PARSE_ERROR";
    pub const ABLE_UNAVAILABLE: &str = "ABLE_UNAVAILABLE";
    pub const VERB_NOT_SUPPORTED: &str = "VERB_NOT_SUPPORTED";
    pub const ACTION_NOT_SUPPORTED: &str = "ACTION_NOT_SUPPORTED";
    pub const INVALID_INTENT: &str = "INVALID_INTENT";
    pub const NOT_A_BEING: &str = "NOT_A_BEING";
    pub const NOT_A_SEED: &str = "NOT_A_SEED";
}

/// The one canonical semantic-code -> HTTP-status mapping. Unknown codes are 500 (the wire always has a
/// number).
pub fn http_status_for(c: &str) -> u16 {
    match c {
        code::INVALID_INPUT | code::INVALID_TYPE | code::INVALID_SPACE | code::ADDRESS_PARSE_ERROR | code::INVALID_INTENT => 400,
        code::UNAUTHORIZED => 401,
        code::FORBIDDEN | code::EXTENSION_BLOCKED | code::SESSION_EXPIRED | code::UPLOAD_DISABLED | code::SOURCE_READ_ONLY | code::HISTORICAL_READ_ONLY | code::CROSS_BRANCH_FORBIDDEN | code::STORY_PAUSED | code::NOT_A_BEING | code::NOT_A_SEED => 403,
        code::SPACE_NOT_FOUND | code::BEING_NOT_FOUND | code::MATTER_NOT_FOUND | code::BRANCH_NOT_FOUND | code::NAME_NOT_FOUND | code::PEER_NOT_FOUND | code::EXTENSION_NOT_FOUND | code::ABLE_UNAVAILABLE | code::VERB_NOT_SUPPORTED | code::ACTION_NOT_SUPPORTED => 404,
        code::RESOURCE_CONFLICT => 409,
        code::DOCUMENT_SIZE_EXCEEDED | code::UPLOAD_TOO_LARGE => 413,
        code::UPLOAD_MIME_REJECTED => 415,
        code::RATE_LIMITED => 429,
        code::PEER_UNREACHABLE => 502,
        code::LLM_TIMEOUT | code::LLM_FAILED | code::LLM_NOT_CONFIGURED | code::SPACE_DORMANT => 503,
        // INTERNAL / TIMEOUT / HOOK_* / MISSING_BRANCH (internal threading bug) / unknown
        _ => 500,
    }
}

/// An IBP error: a semantic code + a message + an optional detail payload. (No PartialEq: Json carries
/// the detail and isn't PartialEq; compare on `.code` / canonicalized envelopes.)
#[derive(Debug, Clone)]
pub struct IbpError {
    pub code: String,
    pub message: String,
    pub detail: Option<Json>,
}

impl IbpError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        IbpError { code: code.to_string(), message: message.into(), detail: None }
    }
    pub fn with_detail(code: &str, message: impl Into<String>, detail: Json) -> Self {
        IbpError { code: code.to_string(), message: message.into(), detail: Some(detail) }
    }
    pub fn http_status(&self) -> u16 {
        http_status_for(&self.code)
    }
    /// The transport-agnostic error envelope `{ status:"error", error:{ code, message, detail? } }`.
    pub fn envelope(&self) -> Json {
        let mut err = vec![("code".to_string(), Json::Str(self.code.clone())), ("message".to_string(), Json::Str(self.message.clone()))];
        if let Some(d) = &self.detail {
            err.push(("detail".to_string(), d.clone()));
        }
        obj(vec![("status", Json::Str("error".to_string())), ("error", Json::Obj(err))])
    }
}

/// The transport-agnostic success envelope `{ status:"ok", data }`.
pub fn ok(data: Json) -> Json {
    obj(vec![("status", Json::Str("ok".to_string())), ("data", data)])
}

/// Translate a plain error message into an IbpError by matching it against ordered `(regex, code)`
/// rules; the first match wins, else `fallback`. (The JS `mapPatternsToIbpError`; an already-IbpError
/// passes through at the call site, which Rust's type system makes explicit, so this takes a message.)
pub fn map_patterns(message: &str, rules: &[(&Regex, &str)], fallback: &str) -> IbpError {
    for (re, code) in rules {
        if re.is_match(message) {
            return IbpError::new(code, message);
        }
    }
    IbpError::new(fallback, message)
}

fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_mapping_matches_the_table() {
        assert_eq!(http_status_for(code::INVALID_INPUT), 400);
        assert_eq!(http_status_for(code::ADDRESS_PARSE_ERROR), 400);
        assert_eq!(http_status_for(code::UNAUTHORIZED), 401);
        assert_eq!(http_status_for(code::FORBIDDEN), 403);
        assert_eq!(http_status_for(code::CROSS_BRANCH_FORBIDDEN), 403);
        assert_eq!(http_status_for(code::SPACE_NOT_FOUND), 404);
        assert_eq!(http_status_for(code::RESOURCE_CONFLICT), 409);
        assert_eq!(http_status_for(code::RATE_LIMITED), 429);
        assert_eq!(http_status_for(code::LLM_TIMEOUT), 503);
        assert_eq!(http_status_for(code::PEER_UNREACHABLE), 502);
        // MISSING_BRANCH is an internal threading bug -> 500, not a permission
        assert_eq!(http_status_for(code::MISSING_BRANCH), 500);
        // unknown -> 500
        assert_eq!(http_status_for("NONESUCH"), 500);
    }

    #[test]
    fn error_envelope_shape() {
        let e = IbpError::new(code::BEING_NOT_FOUND, "no such being");
        assert_eq!(e.http_status(), 404);
        let env = e.envelope();
        assert_eq!(treehash::canonicalize(&env), r#"{"error":{"code":"BEING_NOT_FOUND","message":"no such being"},"status":"error"}"#);
    }

    #[test]
    fn pattern_mapping_first_match_wins() {
        let not_found = Regex::new(r"(?i)not found").unwrap();
        let reserved = Regex::new(r"(?i)reserved|heaven").unwrap();
        let rules = [(&reserved, code::FORBIDDEN), (&not_found, code::SPACE_NOT_FOUND)];
        assert_eq!(map_patterns("space not found", &rules, code::INTERNAL).code, code::SPACE_NOT_FOUND);
        assert_eq!(map_patterns("that is reserved", &rules, code::INTERNAL).code, code::FORBIDDEN);
        assert_eq!(map_patterns("kaboom", &rules, code::INTERNAL).code, code::INTERNAL);
    }
}
