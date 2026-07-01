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
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

// ── The Peering cache is COLLISION-AWARE (dns.md Phase 5 "Collide") ────────────────────────────────
// An alias is a nickname, not an ICANN-owned name: MORE THAN ONE reality may claim `tabors-site`, each
// having signed its OWN claim with its OWN I key. So an entry holds an ARRAY of claims, not one:
//   { "<alias>": { "claims": [ {pubkey,host,port,transport,sig}, ... ], "pinned": "<pubkey>"? } }
// Resolution VERIFIES each claim and then: 0 valid -> refuse; 1 -> resolve; >=2 -> refuse and SURFACE
// all claimants (the system tells you about the ambiguity instead of silently picking one), unless a
// `pinned` pubkey (a local trust choice) selects exactly one. Legacy flat `{pubkey,...}` entries are
// read as a one-claim array (back-compat with the phase-1/2 cache).

/// A verified claim distilled from a cache entry (the signature already checks out against `pubkey`).
pub struct Claim {
    pub pubkey: String,
    pub host: String,
    pub port: u16,
    pub transport: String,
}

/// Pull the claim list out of a cache entry, tolerating the legacy flat single-claim shape.
fn entry_claims(entry: &Json) -> Vec<Json> {
    match get(entry, "claims") {
        Some(Json::Arr(a)) => a.clone(),
        _ if get(entry, "pubkey").is_some() => vec![entry.clone()], // legacy flat entry = one claim
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

/// Read the Peering cache (or an empty object if none/unreadable).
fn read_cache() -> Json {
    std::fs::read_to_string(peers_path())
        .ok()
        .and_then(|s| treehash::parse(&s).ok())
        .unwrap_or_else(|| Json::Obj(vec![]))
}

/// The VERIFIED claimants for an alias, plus the locally pinned pubkey (if any). Unsigned/invalid claims
/// are dropped silently — only cryptographically valid claimants survive.
pub fn verified_claimants(domain: &str) -> (Vec<Claim>, Option<String>) {
    let cache = read_cache();
    let entry = match get(&cache, domain) {
        Some(e) => e,
        None => return (vec![], None),
    };
    let pinned = gstr(entry, "pinned");
    let claims = entry_claims(entry).iter().filter_map(|c| verify_claim(domain, c)).collect();
    (claims, pinned)
}

/// Resolve a peer reality domain to a VERIFIED `host:port`, or refuse. Reads the pinned signed address-
/// facts from `.story/peers.json`, rebuilds each canonical content, and checks the signature against the
/// claimant's I pubkey. An unknown peer or all-invalid claims REFUSE (no fall back to raw DNS — that is
/// the whole security point). A COLLISION (>=2 valid claimants) refuses and surfaces them, unless a
/// `pinned` pubkey resolves the tie. The verified host/port are the peer's own I-signed reachability;
/// reaching a LAN/private address is allowed (the trust is the signature, not the IP).
pub fn resolve_verified(domain: &str) -> Result<String, String> {
    let (mut claims, pinned) = verified_claimants(domain);
    if let Some(pin) = &pinned {
        claims.retain(|c| &c.pubkey == pin);
    }
    match claims.len() {
        0 => Err(format!("unknown peer '{domain}': no verified claimant in the Peering cache")),
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

fn write_cache(cache: &Json) -> Result<(), String> {
    std::fs::create_dir_all(".story").map_err(|e| e.to_string())?;
    std::fs::write(peers_path(), treehash::stringify(cache)).map_err(|e| e.to_string())
}

/// Pin/refresh a VERIFIED claim into the Peering cache under `alias`. A claim from a DIFFERENT pubkey is
/// kept as a SEPARATE claimant (that is a collision, surfaced at resolve time); a claim from the SAME
/// pubkey refreshes in place (an address change — restamp and re-inform). The caller has already checked
/// the signature (trust-on-first-use). Returns whether this pin introduced a NEW claimant (a fresh pubkey).
pub fn pin_claim(alias: &str, claim: &Json) -> Result<bool, String> {
    let pubkey = gstr(claim, "pubkey").ok_or("claim missing pubkey")?;
    let mut cache = read_cache();
    let top = match &mut cache {
        Json::Obj(e) => e,
        _ => return Err("Peering cache is not an object".to_string()),
    };
    let (mut claims, pinned) = match top.iter().find(|(k, _)| k == alias) {
        Some((_, v)) => (entry_claims(v), gstr(v, "pinned")),
        None => (vec![], None),
    };
    let is_new = !claims.iter().any(|c| gstr(c, "pubkey").as_deref() == Some(pubkey.as_str()));
    claims.retain(|c| gstr(c, "pubkey").as_deref() != Some(pubkey.as_str())); // same pubkey -> refresh
    claims.push(claim.clone());
    let mut pairs: Vec<(&str, Json)> = vec![("claims", Json::Arr(claims))];
    if let Some(p) = &pinned {
        pairs.push(("pinned", Json::Str(p.clone())));
    }
    let new_entry = obj(pairs);
    match top.iter_mut().find(|(k, _)| k == alias) {
        Some((_, v)) => *v = new_entry,
        None => top.push((alias.to_string(), new_entry)),
    }
    write_cache(&cache)?;
    Ok(is_new)
}

/// Record a local trust CHOICE for an alias: which claimant pubkey to resolve to when there's a collision.
/// This is the human/policy decision dns.md leaves OUT of any central authority — you pin the pubkey you
/// trust for a nickname; nobody owns the nickname.
pub fn pin_choice(alias: &str, pubkey: &str) -> Result<(), String> {
    let mut cache = read_cache();
    let top = match &mut cache {
        Json::Obj(e) => e,
        _ => return Err("Peering cache is not an object".to_string()),
    };
    let claims = match top.iter().find(|(k, _)| k == alias) {
        Some((_, v)) => entry_claims(v),
        None => return Err(format!("no such alias '{alias}' in the Peering cache")),
    };
    let new_entry = obj(vec![("claims", Json::Arr(claims)), ("pinned", Json::Str(pubkey.to_string()))]);
    if let Some((_, v)) = top.iter_mut().find(|(k, _)| k == alias) {
        *v = new_entry;
    }
    write_cache(&cache)
}

/// The whole Peering cache (for `treeos peers`).
pub fn peering_cache() -> Json {
    read_cache()
}

/// Answer a FORWARDING query (dns.md Phase 6, the peer SIDE): the signed claim(s) THIS reality can vouch
/// for about `alias`, straight from its Peering cache. Every returned claim carries its claimant's OWN
/// I-signature, so the asker verifies it independently — the forwarder cannot forge or substitute a claim,
/// it can only pass along (or withhold) ones it holds. A reality self-pins its own claim when it serves,
/// so asking A about A returns A's own signed fact; asking A about B returns B's (if A has met B).
pub fn resolve_reply(alias: &str) -> Json {
    let cache = read_cache();
    let mut claims: Vec<Json> = Vec::new();
    if let Some(entry) = get(&cache, alias) {
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
/// PIN the valid ones into our Peering cache. This is discovery by INTRODUCTION with no central
/// infrastructure — D finds B by asking A, trusting B's key, never A's word. Returns the pinned claimants.
pub fn resolve_via_peer(peer: &str, alias: &str) -> Result<Vec<String>, String> {
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
            pin_claim(alias, c)?;
            pinned.push(format!("{} ({}:{})", v.pubkey, v.host, v.port));
        }
    }
    if pinned.is_empty() {
        return Err(format!("peer '{peer}' returned claim(s) for '{alias}' but NONE verified — ignoring (forged forward?)"));
    }
    Ok(pinned)
}

/// The LIVE HANDSHAKE (dns.md Phase 2): open a connection to a peer and exchange signed "I am `<alias>`"
/// address-facts, each side VERIFYING + PINNING the other. Unlike trusting an mDNS multicast, this
/// confirms the peer is actually REACHABLE and controls its key live, and it is BIDIRECTIONAL — the peer
/// caches US too (it pins the fact we offer). `my_*` describe our own reachability to introduce. Returns
/// the peer claimant(s) we pinned.
pub fn handshake(peer: &str, my_alias: &str, my_host: &str, my_port: u16) -> Result<Vec<String>, String> {
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
                pin_claim(&alias, c)?;
                pinned.push(format!("{alias}: {} ({}:{})", v.pubkey, v.host, v.port));
            }
        }
    }
    if pinned.is_empty() {
        return Err(format!("peer '{peer}' replied but its self-introduction did not verify"));
    }
    Ok(pinned)
}

/// Answer a HELLO (the peer side of the handshake): VERIFY + PIN the caller's offered signed fact, then
/// introduce OURSELVES back with our own signed claim(s). Both sides end up caching each other. The
/// caller's fact carries its own I-signature, so a forged introduction is dropped, not pinned.
pub fn hello_reply(incoming_fact: &Json, own_alias: &str) -> Json {
    if let Some(alias) = gstr(incoming_fact, "reality") {
        if verify_claim(&alias, incoming_fact).is_some() {
            let _ = pin_claim(&alias, incoming_fact);
        }
    }
    resolve_reply(own_alias)
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
