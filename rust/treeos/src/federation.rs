// federation.rs — the cross-story TRANSPORT (the edge half of the federation reshape). Federation is a
// moment/act whose RIGHT STANCE names a foreign reality (treecognition::federation::cross_story_target
// is the pure detector); this carries it: open a connection to the peer reality's wire, send the very
// same moment/act message, relay its reply. One grammar, same-story and cross-story alike.
//
// SECURITY SHAPE (philosophy/dns.md + ip..md):
//   - The TRUST is the I PRIVATE KEY, not the network. The cross-story act is SIGNED by the sending
//     reality's I key (the act path already signs I's acts via the story key); the PEER verifies it
//     against the sender's I PUBLIC KEY. A hijacked DNS record or coerced CA cannot impersonate a
//     reality, because neither can produce the I signature. DNS/CAs are NOT in the trust path.
//   - RESOLUTION is signed ADDRESS-FACTS (the Peering layer), not raw DNS: a reality stamps its
//     reachability (ip/port/transport) as a signed fact; DNS is one overrideable publishing channel.
//     (That Peering/address-fact resolver is a later layer; here the peer domain resolves via the OS
//     for now, with the signed-fact override as the future per dns.md's plan.)
//   - NO SSRF IP-BLOCK here, UNLIKE the LLM connection (treecognition::ssrf). Reaching a LAN / private
//     reality IS a federation FEATURE (the mDNS LAN-peering plan, dns.md); the security is the I
//     signature on the act, not refusing an internal IP. So federation does not gate on the address.
//
// IP is dumb plumbing; identity (the I key) + the signed act are the trust. HTTP/WS only for now —
// wss (TLS) to a cloud peer is the deferred edge boundary, and IBP-over-raw-TCP (no HTTP) is dns.md's
// native transport, a later layer. A minimal zero-dep WS client (the server already has the WS server).

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use treehash::Json;

// ── Signed address-fact resolution (the dns.md/ip..md security core) ──────────────────────────────
// Federation resolves a peer NOT by trusting DNS, but by a SIGNED ADDRESS-FACT pinned in the local
// Peering cache (.story/peers.json): `{ "<domain>": { pubkey, host, port, transport, sig } }`. `pubkey`
// is the peer's I key, pinned trust-on-first-use; `sig` is that key's signature over the canonical
// address-fact content. We refuse to connect unless the signature verifies — so a hijacked DNS record
// or spoofed reachability is powerless (it cannot forge the I signature), and the verified host/port
// come from the SIGNED content, not from whatever DNS would answer.

fn peers_path() -> &'static Path {
    Path::new(".story/peers.json")
}

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn gstr(v: &Json, k: &str) -> Option<String> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

/// Resolve a peer reality domain to a VERIFIED `host:port`, or refuse. Reads the pinned signed address-
/// fact from `.story/peers.json`, rebuilds its canonical content, and checks the signature against the
/// pinned I pubkey. An unknown peer, a missing signature, or a bad signature all REFUSE (no fall back to
/// raw DNS — that is the whole security point). The verified host/port are the peer's own I-signed
/// reachability; reaching a LAN/private address is allowed (the trust is the signature, not the IP).
pub fn resolve_verified(domain: &str) -> Result<String, String> {
    let raw = std::fs::read_to_string(peers_path()).map_err(|_| format!("no Peering cache (.story/peers.json) — peer '{domain}' is unknown"))?;
    let peers = treehash::parse(&raw).map_err(|_| "Peering cache is not valid JSON".to_string())?;
    let entry = get(&peers, domain).ok_or_else(|| format!("unknown peer '{domain}': not in the Peering cache"))?;

    let pubkey = gstr(entry, "pubkey").ok_or("peer entry missing pubkey")?;
    let host = gstr(entry, "host").ok_or("peer entry missing host")?;
    let port = match get(entry, "port") {
        Some(Json::Num(n)) => *n as u16,
        _ => return Err("peer entry missing/!numeric port".to_string()),
    };
    let transport = gstr(entry, "transport").unwrap_or_else(|| "ws".to_string());
    let sig = gstr(entry, "sig").ok_or("peer address-fact is UNSIGNED — refusing")?;

    let raw_pub = treesign::key_id_to_pubkey(&pubkey).ok_or("peer pubkey is not a valid key id")?;
    let content = treecognition::federation::address_fact_content(domain, &host, port, &transport);
    if !treesign::verify_with_pubkey(&raw_pub, &treehash::stringify(&content), &sig) {
        return Err(format!("peer '{domain}' address-fact signature INVALID — refusing (possible DNS hijack / spoofed reachability)"));
    }
    Ok(format!("{host}:{port}"))
}

/// Publish THIS reality's own signed address-fact: sign `{reality, host, port, transport}` with the
/// story (I) key and return the publishable record (a peer pins it in its Peering cache). The inverse
/// of `resolve_verified` — the I private key is the only thing that can mint it.
pub fn publish_address_fact(reality: &str, host: &str, port: u16, transport: &str) -> Result<Json, String> {
    let seed = treesign::load_story_seed(Path::new(".story")).map_err(|_| "cannot load story (I) key from .story".to_string())?;
    let kp = treesign::keypair_from_seed(&seed);
    let content = treecognition::federation::address_fact_content(reality, host, port, transport);
    let sig = treesign::sign_value(&seed, &content);
    Ok(Json::Obj(vec![
        ("reality".to_string(), Json::Str(reality.to_string())),
        ("pubkey".to_string(), Json::Str(treesign::encode_key_id(&kp.raw_pub))),
        ("host".to_string(), Json::Str(host.to_string())),
        ("port".to_string(), Json::Num(port as f64)),
        ("transport".to_string(), Json::Str(transport.to_string())),
        ("sig".to_string(), Json::Str(sig)),
    ]))
}

/// A fixed Sec-WebSocket-Key (any valid base64 16-byte value works — the server computes the accept and
/// we don't re-validate it; this is a transport handshake, not a security nonce).
const WS_KEY: &str = "dGhlIHNhbXBsZSBub25jZQ==";
const MASK: [u8; 4] = [0x37, 0xfa, 0x21, 0x3d];

fn host_port(peer: &str) -> (String, u16) {
    match peer.rsplit_once(':') {
        Some((h, p)) if p.parse::<u16>().is_ok() => (h.to_string(), p.parse().unwrap()),
        _ => (peer.to_string(), 80),
    }
}

/// Dispatch a moment/act message to a PEER reality's WS wire; relay its reply. Opens ws://<peer>/ws,
/// reads past the server's greeting frame, sends `message`, returns the next reply. Errors on any
/// transport failure (the caller surfaces it as the federation refusal).
pub fn dispatch(peer: &str, message: &str) -> Result<String, String> {
    let (host, port) = host_port(peer);
    let mut s = TcpStream::connect((host.as_str(), port)).map_err(|e| format!("federation connect {peer}: {e}"))?;
    s.set_read_timeout(Some(Duration::from_secs(30))).ok();
    s.set_write_timeout(Some(Duration::from_secs(30))).ok();

    let req = format!("GET /ws HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {WS_KEY}\r\nSec-WebSocket-Version: 13\r\n\r\n");
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    read_http_handshake(&mut s)?; // consume the 101 response headers
    let _greet = read_frame(&mut s)?; // the server greets with its health summary; discard
    send_masked(&mut s, message)?;
    read_frame(&mut s)
}

fn read_http_handshake(s: &mut TcpStream) -> Result<(), String> {
    let mut buf = Vec::new();
    let mut one = [0u8; 1];
    loop {
        let n = s.read(&mut one).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("peer closed during handshake".to_string());
        }
        buf.push(one[0]);
        if buf.ends_with(b"\r\n\r\n") {
            return Ok(());
        }
        if buf.len() > 8192 {
            return Err("handshake too large".to_string());
        }
    }
}

/// Send a text frame, client-masked (RFC 6455 requires client→server masking).
fn send_masked(s: &mut TcpStream, text: &str) -> Result<(), String> {
    let data = text.as_bytes();
    let n = data.len();
    let mut frame = vec![0x81u8]; // FIN + text
    if n < 126 {
        frame.push(0x80 | n as u8);
    } else if n < 65536 {
        frame.push(0x80 | 126);
        frame.extend_from_slice(&(n as u16).to_be_bytes());
    } else {
        frame.push(0x80 | 127);
        frame.extend_from_slice(&(n as u64).to_be_bytes());
    }
    frame.extend_from_slice(&MASK);
    frame.extend(data.iter().enumerate().map(|(i, b)| b ^ MASK[i % 4]));
    s.write_all(&frame).map_err(|e| e.to_string())
}

/// Read one server text frame (server→client is unmasked).
fn read_frame(s: &mut TcpStream) -> Result<String, String> {
    let mut h = [0u8; 2];
    read_exact(s, &mut h)?;
    let mut len = (h[1] & 0x7f) as usize;
    if len == 126 {
        let mut e = [0u8; 2];
        read_exact(s, &mut e)?;
        len = u16::from_be_bytes(e) as usize;
    } else if len == 127 {
        let mut e = [0u8; 8];
        read_exact(s, &mut e)?;
        len = u64::from_be_bytes(e) as usize;
    }
    let mut payload = vec![0u8; len];
    read_exact(s, &mut payload)?;
    Ok(String::from_utf8_lossy(&payload).into_owned())
}

fn read_exact(s: &mut TcpStream, buf: &mut [u8]) -> Result<(), String> {
    s.read_exact(buf).map_err(|e| e.to_string())
}
