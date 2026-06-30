// config.rs — the story-config READER (port of storyConfig.js getStoryConfigValue). Config is not a
// space: it lives on the ONE 5D library reel (history "0", kind "library", id = story domain) as
// `config-set` / `config-delete` NAME-ACTS. Folding that reel (treefold::reduce_library already does
// it) yields `state.config`, a key -> value map; a missing key falls back to CONFIG_DEFAULTS. This is
// the read side only — writes are name-acts through the act path, unchanged.
//
// The binary consumes a few of these at the edge: `allowedLlmDomains` (the SSRF opt-in), `storyUrl`
// (the story's own host, refused as an LLM target), and `storyLlmConnection` (the chain's story-root
// fallback connection). The rest of CONFIG_DEFAULTS is noted but only the consumed keys are ported.

use std::path::Path;

use treehash::Json;
use treestore::read_reel_file;

/// The story domain = the library reel id (matches treeibp::STORY; a config follow-up: env/domain).
const STORY: &str = "localhost";

/// The seed ables vocabulary dir (the `.word` cognition flows + folded able specs). `$TREE_ABLES_DIR`
/// overrides (a relocated checkout / a test scratch dir), else the cwd-relative `seed/store/words/ables`
/// the binary serves from. No wall-clock; a pure path lookup.
pub fn ables_dir() -> std::path::PathBuf {
    match std::env::var("TREE_ABLES_DIR") {
        Ok(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => std::path::PathBuf::from("seed/store/words/ables"),
    }
}

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}

/// Read a story-config value: fold the library reel into `state.config`, key -> value, else the
/// default. (None = unknown key with no default.)
pub fn read_story_config(root: &Path, key: &str) -> Option<Json> {
    let facts = read_reel_file(root, "0", "library", STORY, None, None);
    let state = treefold::fold("library", &facts);
    config_from_state(&state, key)
}

/// The pure read: `state.config[key]` (non-null) else the default. Split out so it is testable without
/// touching disk.
pub fn config_from_state(state: &Json, key: &str) -> Option<Json> {
    if let Some(cfg) = get(state, "config") {
        if let Some(v) = get(cfg, key) {
            if !matches!(v, Json::Null) {
                return Some(v.clone());
            }
        }
    }
    config_default(key)
}

/// A config default = the story-identity default (storyConfig.js CONFIG_DEFAULTS), else the internal
/// runtime knob (internalConfig.js INTERNAL_CONFIG_DEFAULTS). Both live on the SAME library reel (story-
/// wide + system settings), so one reader serves both — the split is only which defaults table answers.
fn config_default(key: &str) -> Option<Json> {
    story_default(key).or_else(|| internal_default(key))
}

/// storyConfig.js CONFIG_DEFAULTS — the outward-facing story identity (subset the binary reads).
fn story_default(key: &str) -> Option<Json> {
    match key {
        "allowedLlmDomains" | "allowedFrameDomains" | "disabledExtensions" => Some(Json::Arr(vec![])),
        "storyUrl" | "storyLlmConnection" | "timezone" | "seedVersion" | "cookieDomain" => Some(Json::Null),
        "STORY_NAME" => Some(Json::Str("My Place".to_string())),
        "uploadEnabled" => Some(Json::Bool(true)),
        "contentRetention" => Some(Json::Str("all".to_string())),
        _ => None,
    }
}

/// internalConfig.js INTERNAL_CONFIG_DEFAULTS — the inward runtime knobs (LLM call shape, sessions,
/// matter/space limits, hooks, scheduler, cleanup). Ported whole for fidelity; the binary consumes a
/// few today (llmTimeout, failoverTimeout, dnsLookupTimeout), the rest wait for their subsystem to port.
fn internal_default(key: &str) -> Option<Json> {
    let n = |v: f64| Some(Json::Num(v));
    match key {
        // LLM call shape
        "llmTimeout" => n(900.0),
        "llmMaxRetries" => n(3.0),
        "maxToolIterations" => n(15.0),
        "maxConversationMessages" => n(30.0),
        "toolCallTimeout" => n(60.0),
        "toolResultMaxBytes" => n(50000.0),
        "llmMaxConcurrent" => n(20.0),
        "failoverTimeout" => n(15.0),
        "maxMessageContentBytes" => n(32768.0),
        "llmClientCacheTtl" => n(300.0),
        "maxConnectionsPerUser" => n(15.0),
        "dnsLookupTimeout" => n(5000.0),
        // Conversation compression
        "conversationCompression" => Some(Json::Bool(true)),
        "compressionThreshold" => n(20.0),
        "compressionKeep" => n(8.0),
        // Act content
        "maxChatContentBytes" => n(100000.0),
        // Sessions / presence
        "sessionTTL" => n(900.0),
        "staleSessionTimeout" => n(1800.0),
        "maxSessions" => n(10000.0),
        "maxConnectionsPerIp" => n(20.0),
        "maxPresences" => n(50000.0),
        "maxScopedSessions" => n(20000.0),
        "stalePresenceTimeout" => n(1800.0),
        // Matter limits
        "matterMaxChars" => n(5000.0),
        "maxMatterPerSpace" => n(1000.0),
        "matterQueryLimit" => n(5000.0),
        "matterSearchLimit" => n(500.0),
        "maxDocumentSizeBytes" => n(14680064.0),
        // Space tree, ancestor cache, integrity
        "maxChildrenPerSpace" => n(1000.0),
        "maxContributorsPerSpace" => n(500.0),
        "ancestorCacheTTL" => n(30000.0),
        "ancestorCacheMaxEntries" => n(50000.0),
        "ancestorCacheMaxDepth" => n(100.0),
        // Structural mutation locks
        "spaceLockTimeoutMs" => n(30000.0),
        "spaceLockWaitMs" => n(5000.0),
        // Quality namespace limits
        "qualityNamespaceMaxBytes" => n(524288.0),
        "qualityMaxNestingDepth" => n(8.0),
        // Hooks
        "hookTimeoutMs" => n(5000.0),
        "hookMaxHandlers" => n(100.0),
        "hookCircuitThreshold" => n(5.0),
        "hookCircuitHalfOpenMs" => n(300000.0),
        "hookChainTimeoutMs" => n(15000.0),
        // Tools
        "toolCircuitThreshold" => n(5.0),
        "maxExtensionIndexes" => n(20.0),
        // Fact queries
        "factQueryLimit" => n(5000.0),
        // Scheduler backpressure
        "summonInboxDepth" => n(100.0),
        "summonsPerSecond" => n(60.0),
        "summonMaxAgeSeconds" => n(3600.0),
        // Tree circuit breaker
        "treeCircuitEnabled" => Some(Json::Bool(false)),
        "maxTreeSpaces" => n(10000.0),
        "maxTreeQualityBytes" => n(1073741824.0),
        "maxTreeErrorRate" => n(100.0),
        "circuitSpaceWeight" => n(0.4),
        "circuitDensityWeight" => n(0.3),
        "circuitErrorWeight" => n(0.3),
        "circuitCheckInterval" => n(3600000.0),
        // Cleanup
        "uploadCleanupInterval" => n(21600000.0),
        "uploadGracePeriodMs" => n(3600000.0),
        "uploadCleanupBatchSize" => n(1000.0),
        // Wire-layer tuning (socket.io) — null by default
        "socketMaxBufferSize" | "socketPingTimeout" | "socketPingInterval" | "socketConnectTimeout" => Some(Json::Null),
        _ => None,
    }
}

/// A numeric config knob (override on the library reel, else the default).
pub fn num(root: &Path, key: &str) -> Option<f64> {
    match read_story_config(root, key) {
        Some(Json::Num(v)) => Some(v),
        _ => None,
    }
}

/// The per-call LLM socket timeout in seconds (internalConfig `llmTimeout`, default 900).
pub fn llm_timeout_secs(root: &Path) -> u64 {
    num(root, "llmTimeout").map(|v| v as u64).unwrap_or(900)
}

/// `allowedLlmDomains` as a string list (the SSRF opt-in list).
pub fn allowed_llm_domains(root: &Path) -> Vec<String> {
    match read_story_config(root, "allowedLlmDomains") {
        Some(Json::Arr(a)) => a.into_iter().filter_map(|x| if let Json::Str(s) = x { Some(s) } else { None }).collect(),
        _ => Vec::new(),
    }
}

/// The story's own hostname (from `storyUrl`) — refused as an LLM target by the SSRF guard.
pub fn story_host(root: &Path) -> Option<String> {
    let url = match read_story_config(root, "storyUrl") {
        Some(Json::Str(u)) if !u.is_empty() => u,
        _ => return None,
    };
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")).unwrap_or(&url);
    Some(rest.split(['/', ':']).next().unwrap_or(&rest).to_lowercase())
}

/// A story-config STRING (e.g. `storyLlmConnection`) for the chain's story_config seam (consumed once
/// the connection-store -> chain resolution is wired).
#[allow(dead_code)]
pub fn config_str(root: &Path, key: &str) -> Option<String> {
    match read_story_config(root, key) {
        Some(Json::Str(s)) if !s.is_empty() => Some(s),
        _ => None,
    }
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
    fn ceq(a: Option<Json>, b: Option<Json>) -> bool {
        a.map(|v| treehash::canonicalize(&v)) == b.map(|v| treehash::canonicalize(&v))
    }

    #[test]
    fn folded_config_wins_over_default() {
        let state = obj(vec![("config", obj(vec![("allowedLlmDomains", Json::Arr(vec![jstr("lan.example")])), ("storyUrl", jstr("http://my.story:7070"))]))]);
        // a set value is returned
        assert!(ceq(config_from_state(&state, "storyUrl"), Some(jstr("http://my.story:7070"))));
        if let Some(Json::Arr(a)) = config_from_state(&state, "allowedLlmDomains") {
            assert_eq!(a.len(), 1);
        } else {
            panic!("expected the folded list");
        }
        // an unset key falls to its default
        assert!(ceq(config_from_state(&state, "storyLlmConnection"), Some(Json::Null)));
        assert!(ceq(config_from_state(&state, "uploadEnabled"), Some(Json::Bool(true))));
        // a null in the fold is treated as unset -> default
        let nulled = obj(vec![("config", obj(vec![("allowedLlmDomains", Json::Null)]))]);
        assert!(ceq(config_from_state(&nulled, "allowedLlmDomains"), Some(Json::Arr(vec![]))));
    }

    #[test]
    fn defaults_match_storyconfig_js() {
        assert!(ceq(config_default("allowedLlmDomains"), Some(Json::Arr(vec![]))));
        assert!(ceq(config_default("storyLlmConnection"), Some(Json::Null)));
        assert!(ceq(config_default("uploadEnabled"), Some(Json::Bool(true))));
        assert!(ceq(config_default("nonesuch"), None));
    }
}
