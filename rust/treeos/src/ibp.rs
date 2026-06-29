// ibp.rs — the IBP wire, the TWO primitives over WebSocket. Everything a client says is a `moment`
// (perceive — a read that never stamps; SEE ops are moments) or an `act` (one Word — the write). No
// REST verbs: the see-ops moved off HTTP into `moment`, and the Word write is `act`. A message is JSON
// `{ verb: "moment" | "act", ... }`; a non-JSON line falls back to the legacy read for back-compat.
//
//   moment { op, args }                 -> a SEE-op view (classify-matter, address, …)
//   moment { history?, kind, id }       -> perceive a stored reel (read + verify + fold)
//   moment { }                          -> the reel index
//   act    { word, actor, history?, basis? } -> run the Word, stamp its facts

use std::path::Path;

use treehash::Json;
use treeprotocol::{code, IbpError};

use crate::chain::{json, num_field, reel, reels};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn get_str(v: &Json, k: &str) -> Option<String> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// Handle one wire message: a moment/act JSON, else the legacy text read. Returns the JSON reply.
pub fn handle_wire(msg: &str, root: &Path) -> String {
    if let Ok(req) = treehash::parse(msg.trim()) {
        // FEDERATION: a moment/act whose `address` names a FOREIGN reality is carried to that peer's
        // wire verbatim (the act is already I-signed; the peer verifies the I key — the trust is the
        // signature, not the network). Reaching a LAN/private peer is allowed (no SSRF block here).
        // A `federated:true` HOP MARKER prevents a re-dispatch loop: once a message lands at the peer it
        // is processed LOCALLY even if its address still reads foreign (a stale/misconfigured local
        // story must never bounce it back out). The marker is a wire annotation, not act content, so it
        // never touches the I signature (which covers the Word, not the envelope).
        if get(&req, "federated").is_none() {
            if let Some(addr) = get_str(&req, "address") {
                let local = crate::config::story_host(root).unwrap_or_else(|| "localhost".to_string());
                if let Some(peer) = treecognition::federation::cross_story_target(&addr, &local) {
                    // resolve the peer to a VERIFIED host:port via its pinned signed address-fact (not
                    // raw DNS) — refuse if the signature does not check out.
                    let target = match crate::federation::resolve_verified(&peer) {
                        Ok(t) => t,
                        Err(e) => return json(&IbpError::new(code::PEER_UNREACHABLE, format!("federation to {peer}: {e}")).envelope()),
                    };
                    let mut hop = req.clone();
                    if let Json::Obj(e) = &mut hop {
                        e.push(("federated".to_string(), Json::Bool(true)));
                    }
                    let wire = treehash::stringify(&hop);
                    return match crate::federation::dispatch(&target, &wire) {
                        Ok(reply) => reply,
                        Err(e) => json(&IbpError::new(code::PEER_UNREACHABLE, format!("federation to {peer} ({target}): {e}")).envelope()),
                    };
                }
            }
        }
        match get_str(&req, "verb").as_deref() {
            Some("moment") => return json(&moment(&req, root)),
            Some("act") => return json(&act(&req, root)),
            // cognize = the autonomous loop (moment -> decide a Word -> act), built on the two primitives.
            Some("cognize") => {
                return json(&match crate::cognize::cognize_view(&req, root) {
                    Ok(view) => view,
                    Err(msg) => IbpError::new(code::INVALID_INPUT, msg).envelope(),
                })
            }
            _ => {}
        }
    }
    legacy_read(msg, root)
}

/// A moment: perceive. A see-op (op) computes a view; a target (kind/id) is the authorized perceive
/// (treeibp::moment — the see-gate, then read+verify+fold, with the world's ord as the act's basis);
/// otherwise the reel index.
fn moment(req: &Json, root: &Path) -> Json {
    if let Some(op) = get_str(req, "op") {
        let args = get(req, "args").cloned().unwrap_or(Json::Null);
        let view = match crate::seeops::see_op(&op, &args, root) {
            Some(v) => v,
            None => IbpError::new(code::VERB_NOT_SUPPORTED, format!("unknown see-op '{op}'")).envelope(),
        };
        return obj(vec![("verb", jstr("moment")), ("op", jstr(&op)), ("view", view)]);
    }
    let view = match get_str(req, "id") {
        Some(id) => {
            // the REAL perceive primitive: authorize(see) -> read -> verify -> fold. The reader (left
            // Name) is the `actor`; granted ables authorize via the seed `.word` vocabulary.
            let reader = get(req, "actor").cloned().unwrap_or(Json::Null);
            let h = get_str(req, "history").unwrap_or_else(|| "0".to_string());
            let k = get_str(req, "kind").unwrap_or_default();
            let ables_dir = std::path::Path::new("seed/store/words/ables");
            treeibp::moment(&reader, &k, &id, root, &h, |name| treeibp::fold_word_able(name, ables_dir))
        }
        None => reels(root),
    };
    // strip secrets before the view leaves the server (encryptedApiKey / password / credentialPlain …).
    obj(vec![("verb", jstr("moment")), ("view", treeprotocol::redact::redact_secrets(&view))])
}

/// An act: stamp facts. Either a raw `word` (a genesis act / do-op) OR a materials `op` invoked by name
/// with the trigger args ({target, field, value, merge, branch} ride on the request). The actor signs
/// `I`'s acts with the story key (a being's key is client-side; unsigned here). Returns each outcome.
fn act(req: &Json, root: &Path) -> Json {
    let actor = get(req, "actor").cloned().unwrap_or(Json::Null);
    let history = get_str(req, "history").unwrap_or_else(|| "0".to_string());
    let basis = num_field(req, "basis");
    let outcomes = if let Some(op) = get_str(req, "op") {
        // a materials op: the request itself is the trigger (target/field/value/merge/branch).
        crate::act::run_op(&op, req, &actor, root, &history, basis)
    } else if let Some(word) = get_str(req, "word") {
        crate::act::run_word(&word, &actor, root, &history, basis)
    } else {
        return IbpError::new(code::INVALID_INPUT, "act needs a 'word' or an 'op'").envelope();
    };
    // redact secrets from the stamped facts before they leave (a set-being password fact, etc.).
    let results: Vec<Json> = outcomes.iter().map(|o| treeprotocol::redact::redact_secrets(&crate::act::outcome_json(o))).collect();
    obj(vec![("verb", jstr("act")), ("ok", Json::Bool(true)), ("engine", jstr("rust")), ("results", Json::Arr(results))])
}

/// Legacy text read (pre-moment/act): `reels` | `history/kind/id`. Kept so existing WS readers work.
fn legacy_read(msg: &str, root: &Path) -> String {
    let segs: Vec<&str> = msg.trim().trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    if segs == ["reels"] {
        json(&reels(root))
    } else if segs.len() == 3 {
        json(&reel(root, segs[0], segs[1], segs[2]))
    } else {
        json(&IbpError::new(code::INVALID_INPUT, "send a moment/act JSON, or 'history/kind/id' / 'reels'").envelope())
    }
}
