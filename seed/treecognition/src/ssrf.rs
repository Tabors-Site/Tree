// treecognition::ssrf — network safety for an LLM connection's base URL (port of ssrf.js). Keeps a
// misconfigured/hostile URL from reaching internal services (cloud metadata, local admin, loopback,
// the LAN). Blocks: localhost / 0.0.0.0 / ::1 by host; cloud metadata endpoints; private IP ranges
// (RFC1918, link-local, CGNAT, ULA, IPv6 link-local); credentials in the URL; non-http(s) schemes.
//
// Opt-in: a host (or any superdomain) on the story's `allowedLlmDomains` bypasses the gate — that's how
// an operator stands up Ollama on the LAN. Without it, the gate stays closed.
//
// `validate_base_url` is the SYNCHRONOUS check (pure). The DNS resolution check is I/O, so the lookup
// itself happens at the edge; `check_resolved_ips` is the pure rule it applies to each resolved A/AAAA.
// (Faithful to the JS, with one tightening: the IPv6 private-range checks only fire on colon-bearing
// hosts, so a domain like "fcserver.com" isn't mis-flagged the way the JS `/^fc/` regex would.)

/// Hosts refused outright. The story's own host is appended at the call site (`own_host`).
pub const BLOCKED_HOSTS: &[&str] = &["localhost", "0.0.0.0", "[::1]", "metadata.google.internal", "169.254.169.254", "metadata.internal"];

/// Is this address in a private/internal range? IPv4 prefixes (RFC1918 / link-local / CGNAT / TEST-NET)
/// plus IPv6 ULA / link-local / loopback / unspecified.
pub fn is_blocked_ip(host: &str) -> bool {
    let low = host.to_lowercase();
    // IPv4 literal prefixes
    if low.starts_with("127.") || low.starts_with("10.") || low.starts_with("192.168.") || low.starts_with("169.254.") || low.starts_with("0.") || low.starts_with("198.18.") || low.starts_with("198.19.") {
        return true;
    }
    // 172.16.0.0 – 172.31.255.255
    if let Some(rest) = low.strip_prefix("172.") {
        if let Ok(o) = rest.split('.').next().unwrap_or("").parse::<u32>() {
            if (16..=31).contains(&o) {
                return true;
            }
        }
    }
    // 100.64.0.0/10 (CGNAT)
    if let Some(rest) = low.strip_prefix("100.") {
        if let Ok(o) = rest.split('.').next().unwrap_or("").parse::<u32>() {
            if (64..=127).contains(&o) {
                return true;
            }
        }
    }
    // IPv6 (strip [] brackets; only colon-bearing hosts, so a "fc…" DOMAIN isn't mis-flagged)
    let v6 = low.trim_start_matches('[').trim_end_matches(']');
    if v6.contains(':') && (v6.starts_with("fc") || v6.starts_with("fd") || v6.starts_with("fe80") || v6 == "::1" || v6 == "::") {
        return true;
    }
    false
}

/// Is `hostname` (or a superdomain) on the opt-in `allowed` list? Empty list = no bypass (gate closed).
pub fn host_in_allowed_llm_domains(hostname: &str, allowed: &[String]) -> bool {
    allowed.iter().any(|d| {
        let low = d.to_lowercase();
        hostname == low || hostname.ends_with(&format!(".{low}"))
    })
}

/// Apply the private-IP rule to each DNS-resolved address (the edge resolves; this is the pure gate).
/// Err on the first private/internal hit, so a public hostname that resolves inward is refused.
pub fn check_resolved_ips(ips: &[String]) -> Result<(), String> {
    for ip in ips {
        if is_blocked_ip(ip) {
            return Err("URL resolves to a private/internal IP".to_string());
        }
    }
    Ok(())
}

/// Validate an LLM base URL synchronously -> the canonicalized URL (no trailing slash), or an error.
/// `own_host` is the story's own hostname (also refused). `allowed` is the opt-in domain list.
pub fn validate_base_url(base_url: &str, allowed: &[String], own_host: Option<&str>) -> Result<String, String> {
    let (scheme, rest) = base_url.split_once("://").ok_or("Invalid base URL")?;
    match scheme.to_lowercase().as_str() {
        "http" | "https" => {}
        _ => return Err("Only http and https URLs are allowed".to_string()),
    }
    // authority = up to the first path/query/fragment delimiter
    let authority = &rest[..rest.find(['/', '?', '#']).unwrap_or(rest.len())];
    if authority.contains('@') {
        return Err("URLs with credentials are not allowed".to_string());
    }
    // hostname = authority minus :port (keep [..] for IPv6)
    let hostname = if let Some(stripped) = authority.strip_prefix('[') {
        // [ipv6](:port)? -> keep the bracketed form
        let end = stripped.find(']').map(|i| i + 1).unwrap_or(stripped.len());
        format!("[{}", &stripped[..end])
    } else {
        authority.split(':').next().unwrap_or(authority).to_string()
    }
    .to_lowercase();
    if hostname.is_empty() {
        return Err("Invalid base URL".to_string());
    }

    if host_in_allowed_llm_domains(&hostname, allowed) {
        return Ok(base_url.trim_end_matches('/').to_string());
    }
    if BLOCKED_HOSTS.contains(&hostname.as_str()) || own_host.is_some_and(|h| h.eq_ignore_ascii_case(&hostname)) {
        return Err("This base URL is not allowed".to_string());
    }
    if is_blocked_ip(&hostname) {
        return Err("Local/private network URLs are not allowed. Add the host to `allowedLlmDomains` in story config to opt in (e.g. for Ollama or a LAN-hosted LLM).".to_string());
    }
    if !allowed.is_empty() {
        return Err(format!("LLM domain \"{hostname}\" is not in this story's allowed list."));
    }
    Ok(base_url.trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_allow() -> Vec<String> {
        vec![]
    }

    #[test]
    fn blocks_private_and_metadata_and_loopback() {
        assert!(is_blocked_ip("127.0.0.1"));
        assert!(is_blocked_ip("10.1.2.3"));
        assert!(is_blocked_ip("192.168.0.1"));
        assert!(is_blocked_ip("172.16.5.5") && is_blocked_ip("172.31.0.1"));
        assert!(!is_blocked_ip("172.32.0.1")); // just outside the RFC1918 /12
        assert!(is_blocked_ip("169.254.1.1")); // link-local / metadata
        assert!(is_blocked_ip("100.64.0.1") && !is_blocked_ip("100.63.0.1")); // CGNAT edge
        assert!(is_blocked_ip("[fc00::1]") && is_blocked_ip("fe80::1") && is_blocked_ip("::1"));
        assert!(!is_blocked_ip("fcserver.com")); // a domain, not an IPv6 ULA
        assert!(!is_blocked_ip("8.8.8.8"));
    }

    #[test]
    fn validate_refuses_the_dangerous_and_passes_public() {
        assert!(validate_base_url("ftp://x.com", &no_allow(), None).is_err()); // scheme
        assert!(validate_base_url("http://user:pw@api.openai.com", &no_allow(), None).is_err()); // creds
        assert!(validate_base_url("http://localhost:11434", &no_allow(), None).is_err()); // blocked host
        assert!(validate_base_url("http://169.254.169.254/latest", &no_allow(), None).is_err()); // metadata IP
        assert!(validate_base_url("http://10.0.0.5:8080", &no_allow(), None).is_err()); // private IP
        // a public endpoint passes and is canonicalized (no trailing slash)
        assert_eq!(validate_base_url("https://api.openai.com/v1/", &no_allow(), None).unwrap(), "https://api.openai.com/v1");
    }

    #[test]
    fn allowed_domains_opt_in_bypasses_and_closes_others() {
        let allow = vec!["lan.example".to_string()];
        // a LAN host opted in passes despite being private
        assert!(validate_base_url("http://ollama.lan.example:11434", &allow, None).is_ok());
        // with a non-empty allow list, anything NOT on it is refused (even public)
        assert!(validate_base_url("https://api.openai.com", &allow, None).is_err());
    }

    #[test]
    fn own_story_host_is_refused() {
        assert!(validate_base_url("https://my.story", &no_allow(), Some("my.story")).is_err());
    }

    #[test]
    fn resolved_private_ip_is_caught() {
        assert!(check_resolved_ips(&["8.8.8.8".into(), "10.0.0.1".into()]).is_err());
        assert!(check_resolved_ips(&["8.8.8.8".into(), "1.1.1.1".into()]).is_ok());
    }
}
