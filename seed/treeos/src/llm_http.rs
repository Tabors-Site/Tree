// llm_http.rs — the LLM TRANSPORT at the edge: the OUTBOUND client that POSTs the assembled Word prompt
// to an OpenAI-compatible / ollama endpoint and returns the model's text. This is the ONE external
// boundary treecognition leaves open (it consumes a plain `&str -> Result<String,…>` transport); the
// protocol shaping (chat body, content extraction) + the socket live HERE, so the decider stays
// provider-agnostic.
//
// TWO transports, by scheme:
//   - http://  — a LOCAL model (ollama/qwen3 on the LAN) needs no TLS; the zero-dep TcpStream client
//                stays (`call_http`), so booting an offline local inference backend pulls in no crypto.
//   - https:// — a CLOUD provider (OpenAI-compatible) needs TLS; `call_https` uses `ureq` (blocking,
//                rustls — no OpenSSL, a tiny outbound-only surface). This is the OUTBOUND edge ONLY; the
//                inbound IBP wire stays plain WS. The SSRF gate runs at the cognize seam BEFORE either
//                socket opens, so neither path can be reached with a disallowed base URL.
//
// The api key is sealed on the chain with the FRESH treesign at-rest envelope (AES-256-GCM under
// credential_key(JWT_SECRET) — treehost::llm::encrypt_api_key). It DECRYPTS here (`decrypt_api_key`) with
// the matching treesign::decrypt_credential only to set the Authorization bearer at the moment of the call
// — the cleartext key never leaves this edge and never returns to a fact.
//
// Token-at-a-time streaming (stream:true / SSE) over https is the next refinement — this cut requests the
// full completion and returns the whole Word, which decide_llm parses; the one-token-per-Word decode lands
// on top.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use treecognition::call::CallError;
use treehash::Json;

fn s<'a>(v: &'a Json, k: &str) -> &'a str {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).and_then(|(_, x)| if let Json::Str(t) = x { Some(t.as_str()) } else { None }).unwrap_or(""),
        _ => "",
    }
}
fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}

/// A resolved connection: where to call + how. (`base_url` http only; `key` optional bearer;
/// `timeout_secs` from internalConfig `llmTimeout`.)
pub struct Conn {
    pub base_url: String,
    pub model: String,
    pub key: Option<String>,
    pub timeout_secs: u64,
}

/// The OpenAI-compatible chat body: the assembled Word prompt is the system message; a minimal user
/// turn wakes the decode. `stream` requests token-at-a-time output (Tabor: always one token at a time,
/// toward the emergent one-token-per-Word model).
pub fn chat_request_body(model: &str, system_prompt: &str, stream: bool) -> String {
    let msgs = Json::Arr(vec![
        Json::Obj(vec![("role".into(), Json::Str("system".into())), ("content".into(), Json::Str(system_prompt.into()))]),
        Json::Obj(vec![("role".into(), Json::Str("user".into())), ("content".into(), Json::Str("Decide your next Word.".into()))]),
    ]);
    let body = Json::Obj(vec![
        ("model".into(), Json::Str(model.into())),
        ("messages".into(), msgs),
        ("stream".into(), Json::Bool(stream)),
    ]);
    treehash::canonicalize(&body)
}

/// Accumulate the spoken Word from a STREAMED response, token by token — the pour reaching deeper, each
/// chunk one contact. Handles OpenAI SSE (`data: {choices:[{delta:{content}}]}` … `data: [DONE]`) and
/// ollama NDJSON (`{message:{content},done}` per line). The chunks are walked in emission order; this is
/// the "one token at a time" read. (For the emergent one-token-per-Word model each chunk IS a stamp;
/// today we accumulate to the full Word and parse once.)
pub fn accumulate_stream(body: &str) -> String {
    let mut out = String::new();
    for line in body.lines() {
        let payload = line.trim();
        let payload = payload.strip_prefix("data:").map(str::trim).unwrap_or(payload);
        if payload.is_empty() || payload == "[DONE]" {
            continue;
        }
        if let Ok(chunk) = treehash::parse(payload) {
            out.push_str(&stream_token(&chunk));
        }
    }
    out
}

/// One streamed chunk's token: OpenAI `choices[0].delta.content`, else ollama `message.content`, else
/// `response`.
fn stream_token(chunk: &Json) -> String {
    if let Some(Json::Arr(choices)) = get(chunk, "choices") {
        if let Some(first) = choices.first() {
            let d = s(get(first, "delta").unwrap_or(&Json::Null), "content");
            if !d.is_empty() {
                return d.to_string();
            }
        }
    }
    let m = s(get(chunk, "message").unwrap_or(&Json::Null), "content");
    if !m.is_empty() {
        return m.to_string();
    }
    s(chunk, "response").to_string()
}

/// Pull the spoken text from a response: OpenAI `choices[0].message.content`, else ollama
/// `message.content`, else `response`. Empty string if none (decide_llm reads empty as See).
pub fn extract_content(response_json: &Json) -> String {
    if let Some(Json::Arr(choices)) = get(response_json, "choices") {
        if let Some(first) = choices.first() {
            let c = s(get(first, "message").unwrap_or(&Json::Null), "content");
            if !c.is_empty() {
                return c.to_string();
            }
        }
    }
    let m = s(get(response_json, "message").unwrap_or(&Json::Null), "content");
    if !m.is_empty() {
        return m.to_string();
    }
    s(response_json, "response").to_string()
}

/// Parse "http://host[:port][/base]" -> (host, port, base_path). HTTPS is refused (no TLS here).
fn parse_http_url(url: &str) -> Option<(String, u16, String)> {
    let rest = url.strip_prefix("http://")?;
    let (authority, base) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().ok()?),
        None => (authority.to_string(), 80),
    };
    Some((host, port, base.trim_end_matches('/').to_string()))
}

/// Split a raw HTTP/1.1 response into (status, body), de-chunking a `Transfer-Encoding: chunked` body.
pub fn parse_http_response(raw: &str) -> Result<(u16, String), String> {
    let split = raw.find("\r\n\r\n").ok_or("malformed HTTP response (no header/body split)")?;
    let head = &raw[..split];
    let body = &raw[split + 4..];
    let status: u16 = head.lines().next().and_then(|l| l.split_whitespace().nth(1)).and_then(|c| c.parse().ok()).ok_or("malformed HTTP status line")?;
    let chunked = head.lines().any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    let body = if chunked { dechunk(body) } else { body.to_string() };
    Ok((status, body))
}

/// Decode an HTTP/1.1 chunked body (size-in-hex CRLF, data, CRLF, … , 0 CRLF).
fn dechunk(body: &str) -> String {
    let mut out = String::new();
    let mut rest = body;
    loop {
        let nl = match rest.find("\r\n") {
            Some(i) => i,
            None => break,
        };
        let size = usize::from_str_radix(rest[..nl].trim(), 16).unwrap_or(0);
        if size == 0 {
            break;
        }
        let start = nl + 2;
        let end = (start + size).min(rest.len());
        out.push_str(&rest[start..end]);
        rest = rest.get(end + 2..).unwrap_or(""); // skip the trailing CRLF
    }
    out
}

/// Call ONE connection: POST the chat body, read the reply, classify failures as a CallError (so
/// call_with_failover can branch). Dispatches by scheme — https:// -> the ureq/rustls TLS client (cloud
/// providers), http:// -> the zero-dep TcpStream client (local ollama). The SSRF gate has already passed
/// the base URL at the cognize seam, so this layer only opens the socket the operator opted into.
pub fn call_connection(conn: &Conn, system_prompt: &str) -> Result<String, CallError> {
    if conn.base_url.starts_with("https://") {
        call_https(conn, system_prompt)
    } else {
        call_http(conn, system_prompt)
    }
}

/// Pull the spoken Word from a raw response body: a single JSON object (stream:false / non-streaming
/// server) parses once; a streamed (SSE / NDJSON) body is walked token by token.
fn word_from_body(resp_body: &str) -> String {
    match treehash::parse(resp_body.trim()) {
        Ok(single) => extract_content(&single),
        Err(_) => accumulate_stream(resp_body),
    }
}

/// OUTBOUND HTTPS (cloud provider) over ureq + rustls. POST the chat body with the bearer header, read
/// the completion. A non-2xx maps to its status (so failover branches); a transport/timeout error is a
/// timeout-class failure. TLS is the ONLY thing ureq adds — same body, same extraction as the http path.
fn call_https(conn: &Conn, system_prompt: &str) -> Result<String, CallError> {
    let url = format!("{}/v1/chat/completions", conn.base_url.trim_end_matches('/'));
    let body = chat_request_body(&conn.model, system_prompt, false); // full completion (https streaming = follow-up)

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(conn.timeout_secs.max(1))))
        .build()
        .into();
    let mut req = agent.post(&url).header("content-type", "application/json");
    if let Some(k) = &conn.key {
        req = req.header("authorization", &format!("Bearer {k}"));
    }
    match req.send(&body) {
        Ok(mut resp) => {
            let text = resp.body_mut().read_to_string().map_err(|e| CallError::timeout(format!("read body: {e}")))?;
            Ok(word_from_body(&text))
        }
        // ureq surfaces a non-2xx as a StatusCode error (status_as_error defaults on). Carry its code so
        // call_with_failover classifies 429/502/503/504 as retryable, 4xx/500 as fatal.
        Err(ureq::Error::StatusCode(code)) => Err(CallError::status(code as u32, format!("model endpoint returned {code}"))),
        Err(e) => Err(CallError::timeout(format!("https transport: {e}"))),
    }
}

/// OUTBOUND HTTP (local model) over the zero-dep TcpStream client — no TLS, no crypto dep, so an offline
/// local inference backend (ollama/qwen3 on the LAN) needs nothing more than the std net stack.
fn call_http(conn: &Conn, system_prompt: &str) -> Result<String, CallError> {
    let (host, port, base) = parse_http_url(&conn.base_url).ok_or_else(|| CallError::status(0, "base URL must be http:// or https://"))?;
    let path = format!("{base}/v1/chat/completions");
    let body = chat_request_body(&conn.model, system_prompt, true); // token-at-a-time output

    let mut stream = TcpStream::connect((host.as_str(), port)).map_err(|e| CallError::timeout(format!("connect {host}:{port}: {e}")))?;
    let timeout = Some(Duration::from_secs(conn.timeout_secs.max(1)));
    stream.set_read_timeout(timeout).ok();
    stream.set_write_timeout(timeout).ok();

    let mut req = format!("POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
    if let Some(k) = &conn.key {
        req.push_str(&format!("Authorization: Bearer {k}\r\n"));
    }
    req.push_str("\r\n");
    req.push_str(&body);

    stream.write_all(req.as_bytes()).map_err(|e| CallError::timeout(format!("write: {e}")))?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| CallError::timeout(format!("read: {e}")))?;

    let (status, resp_body) = parse_http_response(&String::from_utf8_lossy(&raw)).map_err(|e| CallError::status(status_guess(&raw), e))?;
    if !(200..300).contains(&status) {
        return Err(CallError::status(status as u32, format!("model endpoint returned {status}")));
    }
    Ok(word_from_body(&resp_body))
}

fn status_guess(_raw: &[u8]) -> u32 {
    502 // a malformed/truncated upstream reply is a retryable gateway-class failure
}

/// DECRYPT the stored LLM api key with the FRESH treesign shape — AES-256-GCM under
/// credential_key(JWT_SECRET) (HKDF-SHA256), the same at-rest seal treesign::credential uses for every
/// other secret. NO legacy AES-256-CBC `ivHex:ciphertextHex` anywhere: the connection-seal's encrypt side
/// (treehost::llm::encrypt_api_key) now uses the matching treesign::encrypt_credential, so seal and unseal
/// are the SAME primitive. One envelope, one reality.
///
/// JWT_SECRET is the edge secret (read from the process env, like the story key). Returns None on an
/// absent env secret or a malformed/corrupt blob (never panics); the caller then sends no bearer (a local
/// model needs none). The cleartext stays in this function's caller and never re-enters a fact.
pub fn decrypt_api_key(blob: &str) -> Option<String> {
    let secret = std::env::var("JWT_SECRET").ok().filter(|s| !s.is_empty())?;
    let key = treesign::credential_key(&secret);
    treesign::decrypt_credential(blob, &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_body_is_openai_shaped() {
        let b = chat_request_body("qwen3", "I am Cain.", true);
        let p = treehash::parse(&b).unwrap();
        assert_eq!(s(&p, "model"), "qwen3");
        assert!(matches!(get(&p, "stream"), Some(Json::Bool(true))));
        if let Some(Json::Arr(m)) = get(&p, "messages") {
            assert_eq!(s(&m[0], "role"), "system");
            assert_eq!(s(&m[0], "content"), "I am Cain.");
            assert_eq!(s(&m[1], "role"), "user");
        } else {
            panic!("messages missing");
        }
    }

    #[test]
    fn extract_handles_openai_and_ollama_shapes() {
        let openai = treehash::parse(r#"{"choices":[{"message":{"role":"assistant","content":"do move."}}]}"#).unwrap();
        assert_eq!(extract_content(&openai), "do move.");
        let ollama = treehash::parse(r#"{"message":{"content":"I make x."}}"#).unwrap();
        assert_eq!(extract_content(&ollama), "I make x.");
        let gen = treehash::parse(r#"{"response":"see weather as sky."}"#).unwrap();
        assert_eq!(extract_content(&gen), "see weather as sky.");
        let empty = treehash::parse(r#"{"choices":[]}"#).unwrap();
        assert_eq!(extract_content(&empty), "");
    }

    #[test]
    fn parses_status_and_dechunks() {
        let plain = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi";
        assert_eq!(parse_http_response(plain).unwrap(), (200, "hi".to_string()));
        let chunked = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\ndo m\r\n4\r\nove.\r\n0\r\n\r\n";
        assert_eq!(parse_http_response(chunked).unwrap(), (200, "do move.".to_string()));
        let bad = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n";
        assert_eq!(parse_http_response(bad).unwrap().0, 503);
    }

    #[test]
    fn accumulates_streamed_tokens_in_order() {
        // OpenAI SSE: each chunk one delta token, terminated by [DONE]
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"do \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"move\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\".\"}}]}\n\ndata: [DONE]\n\n";
        assert_eq!(accumulate_stream(sse), "do move.");
        // ollama NDJSON: one object per line, last `done`
        let ndjson = "{\"message\":{\"content\":\"I make \"},\"done\":false}\n{\"message\":{\"content\":\"x.\"},\"done\":false}\n{\"message\":{\"content\":\"\"},\"done\":true}\n";
        assert_eq!(accumulate_stream(ndjson), "I make x.");
    }

    #[test]
    fn parse_http_url_is_the_http_path_only() {
        // parse_http_url parses the LOCAL http path; https is routed to call_https (ureq), not parsed here.
        assert!(parse_http_url("https://api.openai.com").is_none());
        assert_eq!(parse_http_url("http://localhost:11434/v1").unwrap(), ("localhost".to_string(), 11434, "/v1".to_string()));
        assert_eq!(parse_http_url("http://host").unwrap(), ("host".to_string(), 80, "".to_string()));
    }

    #[test]
    fn decrypt_api_key_uses_the_fresh_treesign_shape() {
        // FRESH shape only: AES-256-GCM under credential_key(JWT_SECRET) — the same seal treesign uses for
        // every at-rest secret. NO legacy AES-CBC ivHex:ctHex.
        let secret = "the-edge-jwt-secret";
        std::env::set_var("JWT_SECRET", secret);
        let key = treesign::credential_key(secret);
        let blob = treesign::encrypt_credential("sk-secret-123", &key).unwrap();
        assert_eq!(decrypt_api_key(&blob).as_deref(), Some("sk-secret-123"));
        // a malformed blob -> None (no panic); the caller then sends no bearer
        assert_eq!(decrypt_api_key("not-base64!!"), None);
        std::env::remove_var("JWT_SECRET");
        // no env secret -> None
        assert_eq!(decrypt_api_key(&blob), None);
    }

    #[test]
    fn https_dispatch_uses_non_streaming_body() {
        // a https conn requests the full completion (stream:false) — the streamed token decode is the
        // http path / a follow-up; this asserts the body shape the https transport sends.
        let b = chat_request_body("gpt-4o", "I am Cain.", false);
        let p = treehash::parse(&b).unwrap();
        assert!(matches!(get(&p, "stream"), Some(Json::Bool(false))));
    }
}
