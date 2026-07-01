// mdns.rs — LAN peering via mDNS / DNS-SD (philosophy/dns.md, phase 1). A reality ADVERTISES itself as
// `_treeos._tcp.local.` carrying its own SIGNED address-fact in the TXT record; a peer DISCOVERS it,
// VERIFIES the I-key signature, and PINS it into the Peering cache (.story/peers.json). So two realities
// find each other by NAME on a LAN, cryptographically, with NO DNS. The signature is the trust
// (federation::resolve_verified refuses anything unsigned or invalid); mDNS is only the discovery channel.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use treehash::Json;

const SERVICE: &str = "_treeos._tcp.local.";

/// This reality's LAN IP — the source address for reaching the internet, i.e. the host a peer connects
/// to. No packet is sent (UDP `connect` just sets the default destination); falls back to loopback.
pub fn local_ip() -> String {
    use std::net::UdpSocket;
    UdpSocket::bind("0.0.0.0:0")
        .ok()
        .and_then(|s| {
            s.connect("8.8.8.8:80").ok()?;
            s.local_addr().ok()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn gstr(v: &Json, k: &str) -> Option<String> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).and_then(|(_, x)| match x {
            Json::Str(s) => Some(s.clone()),
            _ => None,
        }),
        _ => None,
    }
}

/// Advertise THIS reality on the LAN: register `_treeos._tcp` carrying the signed address-fact in the TXT.
/// Keep the returned daemon alive to stay advertised. Best-effort — a failure warns and the reality still
/// serves. `reality` is the Story's name/alias, `port` the serve port.
pub fn advertise(reality: &str, port: u16) -> Option<ServiceDaemon> {
    let host_ip = local_ip();
    let fact = match crate::federation::publish_address_fact(reality, &host_ip, port, "ws") {
        Ok(f) => f,
        Err(e) => {
            eprintln!("mDNS advertise: cannot sign address-fact ({e}) — LAN peering off");
            return None;
        }
    };
    // self-pin our OWN signed claim so we can forward it (dns.md Phase 6) and so an alias collision with
    // another claimant surfaces here too (Phase 5) — a reality is a claimant for its own alias.
    let _ = crate::federation::pin_claim(reality, &fact);
    let mut props: HashMap<String, String> = HashMap::new();
    props.insert("reality".into(), reality.to_string());
    props.insert("pubkey".into(), gstr(&fact, "pubkey").unwrap_or_default());
    props.insert("host".into(), host_ip.clone());
    props.insert("transport".into(), "ws".into());
    props.insert("sig".into(), gstr(&fact, "sig").unwrap_or_default());

    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("mDNS: {e}");
            return None;
        }
    };
    let host_name = format!("{reality}.local.");
    let info = match ServiceInfo::new(SERVICE, reality, &host_name, host_ip.as_str(), port, props) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("mDNS ServiceInfo: {e}");
            return None;
        }
    };
    match daemon.register(info) {
        Ok(_) => {
            eprintln!("mDNS: advertising '{reality}' as {SERVICE} on {host_ip}:{port}");
            Some(daemon)
        }
        Err(e) => {
            eprintln!("mDNS register: {e}");
            None
        }
    }
}

/// Discover TreeOS realities on the LAN for `secs` seconds. Each is only accepted if its TXT signed
/// address-fact VERIFIES against its own I-key (unsigned/invalid are ignored). When `pin` is set, the
/// verified fact is written into the Peering cache so `federation::resolve_verified` can reach it. Returns
/// the verified peers (each the same record shape `publish_address_fact` mints).
pub fn discover(secs: u64, pin: bool) -> Vec<Json> {
    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("mDNS: {e}");
            return vec![];
        }
    };
    let rx = match daemon.browse(SERVICE) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("mDNS browse: {e}");
            return vec![];
        }
    };
    let deadline = Instant::now() + Duration::from_secs(secs);
    let mut found: Vec<Json> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    while Instant::now() < deadline {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                if let Some(peer) = verify_resolved(&info) {
                    let reality = gstr(&peer, "reality").unwrap_or_default();
                    if !reality.is_empty() && seen.insert(reality.clone()) {
                        if pin {
                            // collision-aware pin: a different-key claimant for the same alias is KEPT as a
                            // separate claimant (surfaced at resolve time), not silently overwritten.
                            if let Err(e) = crate::federation::pin_claim(&reality, &peer) {
                                eprintln!("mDNS pin '{reality}': {e}");
                            }
                        }
                        found.push(peer);
                    }
                }
            }
            Ok(_) => {}
            Err(_) => break, // timeout — the browse window closed
        }
    }
    found
}

/// Verify a resolved service's TXT signed address-fact against its own I-key; None if unsigned/invalid.
fn verify_resolved(info: &ServiceInfo) -> Option<Json> {
    let get = |k: &str| info.get_property_val_str(k).map(|s| s.to_string());
    let reality = get("reality")?;
    let pubkey = get("pubkey")?;
    let host = get("host")?;
    let transport = get("transport").unwrap_or_else(|| "ws".to_string());
    let sig = get("sig")?;
    let port = info.get_port();
    let raw_pub = treesign::key_id_to_pubkey(&pubkey)?;
    let content = treecognition::federation::address_fact_content(&reality, &host, port, &transport);
    if !treesign::verify_with_pubkey(&raw_pub, &treehash::stringify(&content), &sig) {
        eprintln!("mDNS: '{reality}' address-fact signature INVALID — ignoring (spoofed reachability?)");
        return None;
    }
    Some(Json::Obj(vec![
        ("reality".into(), Json::Str(reality)),
        ("pubkey".into(), Json::Str(pubkey)),
        ("host".into(), Json::Str(host)),
        ("port".into(), Json::Num(port as f64)),
        ("transport".into(), Json::Str(transport)),
        ("sig".into(), Json::Str(sig)),
    ]))
}

