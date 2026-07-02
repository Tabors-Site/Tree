// llm_outbound.rs — the Node-free verification of the OUTBOUND LLM transport at the edge. A being's LLM
// able decides -> the assembled prompt POSTs to the connected provider -> the model's reply becomes the
// Word the being speaks. All in-process Rust: no node proc, no real OpenAI key, no inbound TLS server.
//
// The OUTBOUND edge has two transports (treeos_lib::llm_http): http:// (local model, zero-dep TcpStream)
// and https:// (cloud provider, ureq/rustls). A real https mock needs a TLS cert + a trusted CA, so the
// https leg is proven at the dispatch/body/decrypt level (unit tests in llm_http.rs); the END-TO-END
// POST -> Word loop is proven here over a LOCAL mock provider on http (a real socket, a canned OpenAI
// completion), which exercises the identical body-build + content-extract + failover + decide path.
//
// Proofs:
//   (SSRF)   the SSRF gate refuses a disallowed base URL BEFORE any socket opens (the security floor).
//   (POST)   an allowed connection POSTs to the mock and gets the canned Word back (the outbound edge).
//   (DECIDE) cognize llm mode no longer hard-refuses: an llm-mode able, decided with the SAME transport
//            closure cognize_view builds, reaches the provider and turns the model's WORD into an Act.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use treecognition::{cognize, Cognition, FailShape};
use treehash::Json;
use treeos_lib::llm_http::{call_connection, Conn};

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// A one-shot mock OpenAI-compatible provider: bind an ephemeral port, accept ONE request, read it, and
/// reply with a canned chat-completion whose content is `word`. Returns the bound base URL. Runs on its
/// own thread; the test drives the client side. No TLS (a local http mock — the cloud TLS leg is the
/// unit tests'), a real socket end to end.
fn mock_provider(word: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            // drain the request head (read until the header/body split or the socket stalls)
            let mut buf = [0u8; 4096];
            let _ = sock.read(&mut buf);
            let body = format!(r#"{{"choices":[{{"message":{{"role":"assistant","content":"{word}"}}}}]}}"#);
            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            let _ = sock.write_all(resp.as_bytes());
        }
    });
    format!("http://{}:{}", addr.ip(), addr.port())
}

#[test]
fn ssrf_gate_refuses_a_disallowed_base_url_before_any_socket() {
    // a private IP with no allowlist opt-in is refused by the SYNC gate — no socket is ever opened.
    let no_allow: Vec<String> = vec![];
    assert!(treecognition::ssrf::validate_base_url("http://169.254.169.254/latest", &no_allow, None).is_err());
    assert!(treecognition::ssrf::validate_base_url("http://10.0.0.5:11434", &no_allow, None).is_err());
    // a public cloud endpoint passes (and is canonicalized) — the gate opens only for the allowed.
    assert_eq!(
        treecognition::ssrf::validate_base_url("https://api.openai.com/v1/", &no_allow, None).unwrap(),
        "https://api.openai.com/v1"
    );
    // a LAN model opted in via allowedLlmDomains passes despite being private (the Ollama path).
    let allow = vec!["lan.example".to_string()];
    assert!(treecognition::ssrf::validate_base_url("http://ollama.lan.example:11434", &allow, None).is_ok());
}

#[test]
fn outbound_post_returns_the_models_word() {
    // an allowed connection POSTs the assembled prompt and gets the canned Word back — the outbound edge.
    let base_url = mock_provider("I make notebook.");
    let conn = Conn { base_url, model: "gpt-4o".into(), key: Some("sk-test".into()), timeout_secs: 5 };
    let word = call_connection(&conn, "I am Cain.").expect("the mock provider answers");
    assert_eq!(word, "I make notebook.");
}

#[test]
fn failover_seam_wraps_the_outbound_call() {
    // the same call through call_with_failover (the policy cognize_view uses) returns the Word.
    let base_url = mock_provider("do move.");
    let conn = Conn { base_url, model: "gpt-4o".into(), key: None, timeout_secs: 5 };
    let mut call = |_id: &str| call_connection(&conn, "I am Cain.");
    let word = treecognition::call::call_with_failover(&["primary".to_string()], &mut call).expect("failover returns the Word");
    assert_eq!(word, "do move.");
}

#[test]
fn cognize_llm_mode_no_longer_refuses_and_speaks_an_act() {
    // an llm-mode able + the SAME transport closure cognize_view builds (SSRF gate -> failover ->
    // call_connection). The model speaks a Word with a deed -> cognize decides an Act (NOT the old
    // "no native transport" Internal refusal).
    let base_url = mock_provider("I make notebook.");
    let conn = Conn { base_url: base_url.clone(), model: "gpt-4o".into(), key: Some("sk-test".into()), timeout_secs: 5 };

    // the SSRF gate runs before any socket (a public/allowed url; here a loopback mock opted in).
    let allow = vec!["127.0.0.1".to_string()];
    let ssrf_ok = treecognition::ssrf::validate_base_url(&base_url, &allow, None);
    assert!(ssrf_ok.is_ok(), "the mock url passes the gate (opted in)");

    let transport = |prompt: &str| -> Result<String, (FailShape, String)> {
        let mut call = |_id: &str| call_connection(&conn, prompt);
        treecognition::call::call_with_failover(&["primary".to_string()], &mut call)
    };

    // a minimal llm-mode able spec + identity + face (what cognize::decide consumes).
    let spec = obj(vec![("requiredCognition", jstr("llm")), ("grantedVocabulary", Json::Arr(vec![jstr("make")]))]);
    let flows: Vec<Json> = vec![];
    let face = obj(vec![("position", obj(vec![("name", jstr("the workshop"))]))]);
    let identity = obj(vec![("name", jstr("Cain")), ("able", jstr("maker")), ("space", jstr("the workshop"))]);
    let host = |_: &str, _: &[Json]| false;

    let decision = cognize::decide(&spec, &flows, &face, &identity, &host, &transport);
    match decision {
        Cognition::Act { content } => assert_eq!(content, "I make notebook."),
        other => panic!("llm mode should speak an Act, got {other:?}"),
    }
}
