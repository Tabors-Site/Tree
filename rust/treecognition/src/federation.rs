// treecognition::federation — the cross-story membrane, RESHAPED. The old federation-manager
// (offer-template / request-template / accept / reject / fulfill … + dispatch-federation-intent) is
// pre-Word logic: a 7-op handshake protocol with its own template/being offer state machine. In the
// new shape it DISSOLVES — there is no handshake. Federation is simply a **moment/act whose RIGHT
// STANCE names a foreign reality**: the address IS the reach. If the target story is another reality,
// the wire routes the very same `moment`/`act` to that peer's wire and relays its answer; if it is
// local, nothing federates. One grammar (the IBP address) covers same-story and cross-story alike.
//
// This module is the PURE decision: given an IBP address + the local reality domain, is this cross-
// story, and to which peer? The cross-story TRANSPORT (resolve the peer's wire endpoint via discovery,
// open the connection, send the moment/act, relay the response) is the EDGE — the same boundary family
// as the cloud-LLM HTTPS call (treeos wires it; an https peer needs the TLS client dep).

use treeaddress::{expand, parse, Ctx};
use treehash::Json;

/// The canonical content of a reality's signed ADDRESS-FACT — what it signs with its I key to attest
/// "reality <r> is reachable at <host:port> via <transport>". This is the dns.md/ip..md security core:
/// resolution is a SIGNED FACT, not raw DNS. A hijacked DNS record or coerced CA is powerless because
/// neither can forge the I signature over this content — so a peer's reachability cannot be spoofed to
/// redirect federation. The signature (treesign, the edge) covers exactly these bytes; the verifier
/// rebuilds this content and checks it against the peer's PINNED I public key (trust-on-first-use).
pub fn address_fact_content(reality: &str, host: &str, port: u16, transport: &str) -> Json {
    Json::Obj(vec![
        ("reality".to_string(), Json::Str(reality.to_string())),
        ("host".to_string(), Json::Str(host.to_string())),
        ("port".to_string(), Json::Num(port as f64)),
        ("transport".to_string(), Json::Str(transport.to_string())),
    ])
}

/// Is this address cross-story, and to which peer reality domain? Returns the foreign story when the
/// RIGHT stance (the moment/act's scope) sits on a reality other than `local_story`; None when it is
/// local (a relative or same-story address). The left stance (the asker) is never the federation axis —
/// the reach is decided by WHERE the act lands (the right stance), per the IBPA attribution doctrine.
pub fn cross_story_target(input: &str, local_story: &str) -> Option<String> {
    let ctx = Ctx { current_story: Some(local_story.to_string()), ..Default::default() };
    let addr = parse(input, &ctx).ok()?;
    let story = expand(&addr, &ctx).right.story?;
    if story != local_story {
        Some(story)
    } else {
        None
    }
}

/// True if the address reaches a foreign reality (a cross-story moment/act).
pub fn is_cross_story(input: &str, local_story: &str) -> bool {
    cross_story_target(input, local_story).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_a_foreign_right_stance() {
        // a right stance on another reality -> federate to that peer
        assert_eq!(cross_story_target("tabor :: treeos.ai/room@ruler", "myplace.site"), Some("treeos.ai".to_string()));
        assert!(is_cross_story("treeos.ai/room@ruler", "myplace.site"));
    }

    #[test]
    fn same_story_and_relative_are_local() {
        // explicit same story -> local (no federation)
        assert_eq!(cross_story_target("treeos.ai/room@ruler", "treeos.ai"), None);
        // a relative address (no story typed) inherits local -> local
        assert_eq!(cross_story_target("/room@ruler", "treeos.ai"), None);
        assert!(!is_cross_story("@ruler", "treeos.ai"));
    }

    #[test]
    fn a_bridge_routes_by_the_right_stance() {
        // the LEFT (asker) being on the local story, the RIGHT on a peer -> federate to the right's story
        assert_eq!(cross_story_target("treeos.ai/me@asker :: peer.world/there@host", "treeos.ai"), Some("peer.world".to_string()));
    }
}
