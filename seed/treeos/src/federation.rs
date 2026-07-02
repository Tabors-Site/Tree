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

// ── Signed address-fact resolution, CHAIN-NATIVE (the dns.md/ip..md security core) ─────────────────
// Federation resolves a peer NOT by trusting DNS, but by a SIGNED ADDRESS-FACT that I pinned as an ACT
// on the LIBRARY REEL (verb "peer", act "peer-pin"), folded into `state.peers`. `pubkey` is the peer's I
// key; `sig` is that key's signature over the canonical address-fact content. We refuse to connect unless
// the signature verifies — a hijacked DNS record or spoofed reachability is powerless (it cannot forge
// the I signature). There is NO `.story/peers.json` side-file: a peering is an event on the chain, not a
// mutable cache. Writes go through `crate::act::peering_act` (I-signed); reads fold the library reel here.
//
// COLLISION-AWARE (dns.md Phase 5): an alias is a nickname more than one reality may claim, so an entry
// holds an ARRAY of claims: `{ "<alias>": { "claims": [ {pubkey,host,port,transport,sig}, … ], "pinned"? } }`.
// Resolution verifies each and then: 0 valid -> refuse; 1 -> resolve; >=2 -> refuse and SURFACE all
// claimants, unless a `pinned` pubkey (a `peer-choose` act) selects one.

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
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// A verified claim distilled from a folded peers entry (the signature checks out against `pubkey`).
pub struct Claim {
    pub pubkey: String,
    pub host: String,
    pub port: u16,
    pub transport: String,
}

/// Fold the LIBRARY REEL and return its `state.peers` map — the chain-native Peering directory, folded
/// from every `peer-pin` / `peer-choose` act I sealed. No side-file: the reel is the truth.
fn folded_peers(root: &Path) -> Json {
    let alias = crate::config::story_alias();
    let facts = treestore::read_reel_file(root, "0", "library", &alias, None, None);
    let state = treefold::fold("library", &facts);
    get(&state, "peers").cloned().unwrap_or_else(|| Json::Obj(vec![]))
}

/// Pull the claim list out of a folded peers entry.
fn entry_claims(entry: &Json) -> Vec<Json> {
    match get(entry, "claims") {
        Some(Json::Arr(a)) => a.clone(),
        _ if get(entry, "pubkey").is_some() => vec![entry.clone()], // tolerate a flat single-claim entry
        _ => vec![],
    }
}

/// Verify ONE claim's signed address-fact against its own pubkey; None if malformed/unsigned/invalid.
fn verify_claim(domain: &str, claim: &Json) -> Option<Claim> {
    let pubkey = gstr(claim, "pubkey")?;
    let host = gstr(claim, "host")?;
    let port = match get(claim, "port") {
        Some(Json::Num(n)) => *n as u16,
        _ => return None,
    };
    let transport = gstr(claim, "transport").unwrap_or_else(|| "ws".to_string());
    let sig = gstr(claim, "sig")?;
    let raw_pub = treesign::key_id_to_pubkey(&pubkey)?;
    let content = treecognition::federation::address_fact_content(domain, &host, port, &transport);
    if !treesign::verify_with_pubkey(&raw_pub, &treehash::stringify(&content), &sig) {
        return None;
    }
    Some(Claim { pubkey, host, port, transport })
}

/// The VERIFIED claimants for an alias (from the folded library reel), plus the pinned pubkey (if any).
/// Unsigned/invalid claims are dropped silently — only cryptographically valid claimants survive.
pub fn verified_claimants(root: &Path, domain: &str) -> (Vec<Claim>, Option<String>) {
    let peers = folded_peers(root);
    let entry = match get(&peers, domain) {
        Some(e) => e,
        None => return (vec![], None),
    };
    let pinned = gstr(entry, "pinned");
    let claims = entry_claims(entry).iter().filter_map(|c| verify_claim(domain, c)).collect();
    (claims, pinned)
}

/// Resolve a peer reality domain to a VERIFIED `host:port`, or refuse. Folds the library reel's peering
/// acts, rebuilds each claim's canonical content, and checks the signature against the claimant's I
/// pubkey. An unknown peer or all-invalid claims REFUSE (no fall back to raw DNS — the security point). A
/// COLLISION (>=2 valid claimants) refuses and surfaces them, unless a `pinned` pubkey (a `peer-choose`
/// act) resolves the tie. Reaching a LAN/private address is allowed (the trust is the signature, not IP).
pub fn resolve_verified(root: &Path, domain: &str) -> Result<String, String> {
    let (mut claims, pinned) = verified_claimants(root, domain);
    if let Some(pin) = &pinned {
        claims.retain(|c| &c.pubkey == pin);
    }
    match claims.len() {
        0 => Err(format!("unknown peer '{domain}': no verified claimant on the library reel")),
        1 => {
            let c = &claims[0];
            Ok(format!("{}:{}", c.host, c.port))
        }
        _ => {
            let who: Vec<String> = claims.iter().map(|c| format!("{} ({}:{})", c.pubkey, c.host, c.port)).collect();
            Err(format!(
                "COLLISION: {} realities claim '{domain}' — pin one with `treeos pin {domain} <pubkey>`:\n  {}",
                claims.len(),
                who.join("\n  ")
            ))
        }
    }
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

/// Pin a VERIFIED claim by sealing a `peer-pin` act on the LIBRARY REEL AS I — chain-native, no side-file.
/// The fold keeps a different-key claimant for the same alias as a SEPARATE claimant (a collision, surfaced
/// at resolve time) and refreshes a same-key claim (an address change). The caller has already verified the
/// signature; here I record my choice to trust it as an event on the reel. The claim carries its own alias
/// in `reality`.
pub fn pin_claim(root: &Path, claim: &Json) -> Result<(), String> {
    let alias = gstr(claim, "reality").ok_or("claim missing reality/alias")?;
    outcome(crate::act::peering_act("peer-pin", claim.clone(), root, &alias))
}

/// Record a collision trust CHOICE by sealing a `peer-choose` act on the library reel AS I. This is the
/// decision dns.md leaves OUT of any central authority — you pin the pubkey you trust for a nickname.
pub fn pin_choice(root: &Path, alias: &str, pubkey: &str) -> Result<(), String> {
    let params = obj(vec![("reality", Json::Str(alias.to_string())), ("pubkey", Json::Str(pubkey.to_string()))]);
    outcome(crate::act::peering_act("peer-choose", params, root, alias))
}

/// One peering-act outcome -> Result (Authorized = Ok, Denied = Err).
fn outcome(outcomes: Vec<treeibp::Outcome>) -> Result<(), String> {
    match outcomes.into_iter().next() {
        Some(treeibp::Outcome::Authorized(_)) => Ok(()),
        Some(treeibp::Outcome::Denied(r)) => Err(r),
        None => Err("peering act produced no outcome".to_string()),
    }
}

/// The whole folded peers directory (for `treeos peers`).
pub fn peering_cache(root: &Path) -> Json {
    folded_peers(root)
}

/// Answer a FORWARDING query (dns.md Phase 6, the peer SIDE): the signed claim(s) THIS reality can vouch
/// for about `alias`, folded from its library reel. Every returned claim carries its claimant's OWN
/// I-signature, so the asker verifies it independently — the forwarder cannot forge or substitute a claim,
/// it can only pass along (or withhold) ones it holds. A reality self-pins its own claim when it serves,
/// so asking A about A returns A's own signed fact; asking A about B returns B's (if A has met B).
pub fn resolve_reply(root: &Path, alias: &str) -> Json {
    let peers = folded_peers(root);
    let mut claims: Vec<Json> = Vec::new();
    if let Some(entry) = get(&peers, alias) {
        for raw in entry_claims(entry) {
            if verify_claim(alias, &raw).is_some() {
                claims.push(raw);
            }
        }
    }
    obj(vec![("claims", Json::Arr(claims))])
}

/// FORWARDING (dns.md Phase 6, the asker SIDE): ask a KNOWN peer "who is `<alias>`?" over the wire; it
/// replies with the signed claim(s) it holds. Each claim is self-verifying (the claimant's own I-signature
/// over its address-fact), so a malicious forwarder cannot forge one: we VERIFY every returned claim and
/// PIN the valid ones (a `peer-pin` act on our library reel). Discovery by INTRODUCTION with no central
/// infrastructure — D finds B by asking A, trusting B's key, never A's word. Returns the pinned claimants.
pub fn resolve_via_peer(root: &Path, peer: &str, alias: &str) -> Result<Vec<String>, String> {
    let query = treehash::stringify(&obj(vec![
        ("verb", Json::Str("resolve".to_string())),
        ("alias", Json::Str(alias.to_string())),
    ]));
    let reply = dispatch(peer, &query)?;
    let parsed = treehash::parse(&reply).map_err(|_| format!("peer '{peer}' gave a non-JSON resolve reply"))?;
    let claims = match get(&parsed, "claims") {
        Some(Json::Arr(a)) => a.clone(),
        _ => return Err(format!("peer '{peer}' knows no claimant for '{alias}'")),
    };
    let mut pinned = Vec::new();
    for c in &claims {
        if let Some(v) = verify_claim(alias, c) {
            pin_claim(root, c)?;
            pinned.push(format!("{} ({}:{})", v.pubkey, v.host, v.port));
        }
    }
    if pinned.is_empty() {
        return Err(format!("peer '{peer}' returned claim(s) for '{alias}' but NONE verified — ignoring (forged forward?)"));
    }
    Ok(pinned)
}

/// The LIVE HANDSHAKE (dns.md Phase 2): open a connection to a peer and exchange signed "I am `<alias>`"
/// address-facts, each side VERIFYING + PINNING the other (a `peer-pin` act on each reel). Unlike trusting
/// an mDNS multicast, this confirms the peer is actually REACHABLE and controls its key live, and it is
/// BIDIRECTIONAL — the peer records us too. `my_*` describe our own reachability to introduce. Returns the
/// peer claimant(s) we pinned.
pub fn handshake(root: &Path, peer: &str, my_alias: &str, my_host: &str, my_port: u16) -> Result<Vec<String>, String> {
    let my_fact = publish_address_fact(my_alias, my_host, my_port, "ws")?;
    let msg = treehash::stringify(&obj(vec![
        ("verb", Json::Str("hello".to_string())),
        ("fact", my_fact),
    ]));
    let reply = dispatch(peer, &msg)?;
    let parsed = treehash::parse(&reply).map_err(|_| format!("peer '{peer}' gave a non-JSON hello reply"))?;
    let claims = match get(&parsed, "claims") {
        Some(Json::Arr(a)) => a.clone(),
        _ => return Err(format!("peer '{peer}' did not introduce itself")),
    };
    let mut pinned = Vec::new();
    for c in &claims {
        let alias = gstr(c, "reality").unwrap_or_default();
        if !alias.is_empty() {
            if let Some(v) = verify_claim(&alias, c) {
                pin_claim(root, c)?;
                pinned.push(format!("{alias}: {} ({}:{})", v.pubkey, v.host, v.port));
            }
        }
    }
    if pinned.is_empty() {
        return Err(format!("peer '{peer}' replied but its self-introduction did not verify"));
    }
    Ok(pinned)
}

/// Answer a HELLO (the peer side of the handshake): VERIFY + PIN the caller's offered signed fact (a
/// `peer-pin` act on our reel), then introduce OURSELVES back with our own signed claim(s). Both sides end
/// up recording each other. The caller's fact carries its own I-signature, so a forged introduction is
/// dropped, not pinned.
pub fn hello_reply(root: &Path, incoming_fact: &Json, own_alias: &str) -> Json {
    if let Some(alias) = gstr(incoming_fact, "reality") {
        if verify_claim(&alias, incoming_fact).is_some() {
            let _ = pin_claim(root, incoming_fact);
        }
    }
    resolve_reply(root, own_alias)
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
