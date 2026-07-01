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

/// The CONN-LESS / custodial path: no open-moment session is tracked. Used by the HTTP `/word` seam,
/// federation hops, the live re-rasterize, and tests. Auth-at-moment is BYPASSED here (conn 0): only the
/// story's own custodial path drives it, and `I`'s acts are signed by the edge's story key, not by a
/// per-connection moment. The WS lane uses `handle_wire_conn` so a Name's key is proven at the moment.
pub fn handle_wire(msg: &str, root: &Path) -> String {
    handle_wire_conn(msg, root, 0)
}

/// AUTH-AT-MOMENT. The `conn` is the open-moment session key (live.rs). A `moment` that names a non-`I`
/// actor must carry a KEY-PROOF (a signature by the Name's key over the moment's identity); on success
/// the Name is recorded as authenticated on THIS conn (the open moment = the session). An `act` by a
/// non-`I` actor must ride an OPEN AUTHENTICATED MOMENT for that actor on this conn (the key was checked
/// at the moment, not per-act). conn 0 = the custodial path: the gate is skipped (see `handle_wire`).
pub fn handle_wire_conn(msg: &str, root: &Path, conn: u64) -> String {
    if conn != 0 {
        if let Ok(req) = treehash::parse(msg.trim()) {
            // federation hops carry a foreign address: leave them to the dispatch below (the peer
            // verifies the I signature; a forwarded act is already signed). Local moment/act gate here.
            let foreign = get(&req, "federated").is_none()
                && get_str(&req, "address").is_some_and(|addr| {
                    let local = crate::config::story_host(root).unwrap_or_else(|| "localhost".to_string());
                    treecognition::federation::cross_story_target(&addr, &local).is_some()
                });
            if !foreign {
                match get_str(&req, "verb").as_deref() {
                    Some("moment") => {
                        if let Err(e) = gate_moment(&req, conn, root) {
                            return json(&e.envelope());
                        }
                    }
                    Some("act") => {
                        if let Err(e) = gate_act(&req, conn, root) {
                            return json(&e.envelope());
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    handle_wire_inner(msg, root)
}

/// THE MOMENT GATE: verify the Name's key-proof AT THE MOMENT, then open the session. `I` (the story's
/// custodial key, verified at the edge signer) and an actor-less moment (the reel index) need no proof.
/// A non-`I` actor MUST carry a `proof.value` signed by its key over this moment's identity; on success
/// the Name is authenticated on this conn (its later acts ride this open moment). On a bad/absent proof
/// the moment is REJECTED — you cannot open a Name's moment without its key.
///
/// THE OPTIONAL BEING-PASSWORD (the EXTRA gate): the Name's key is the WHOLE gate for MOST beings. A
/// being MAY set an extra `password` (a hash on its folded state); only THEN must the moment that
/// perceives it also carry the matching `password`. A passwordless being needs no extra gate; the
/// Name's key already passed. Checked AFTER the key-proof (the key is primary; the password is the
/// inner door the Name unlocks to inhabit a protected being).
fn gate_moment(req: &Json, conn: u64, root: &Path) -> Result<(), IbpError> {
    let actor = match get(req, "actor") {
        Some(a) => a,
        None => return Ok(()), // the reel index / a bare moment — nothing to authenticate
    };
    let name_id = actor_name_id(actor);
    let name_id = match name_id {
        Some(n) => n,
        None => return Ok(()), // no named actor (anonymous read) — no session to open
    };
    if is_story(&name_id) {
        return Ok(()); // I: the custodial story key is the edge's, not a per-moment proof
    }
    let proof = get(req, "proof").and_then(|p| get_str(p, "value"));
    match proof {
        Some(sig) if treesign::verify_moment_proof(&name_id, req, &sig) => {
            gate_being_password(req, root)?; // the optional extra gate (only if the being set one)
            crate::live::authenticate(conn, &name_id); // the open moment IS the session
            // ONE BEING, ONE OPEN MOMENT (presentism: a being cannot be present twice). If this moment
            // EMBODIES a being, that being must be free — or already held by THIS conn (ordinary
            // navigation). Held by another conn -> refuse. The shared @arrival being is exempt (many
            // beingless visitors ride it). In the SHARED gate, so WebSocket and the HTTP bridge obey it
            // identically — the one low-level rule, one path.
            if let Some(being) = get_str(actor, "beingId").filter(|b| !b.is_empty() && b != "I") {
                let history = get_str(req, "history").unwrap_or_else(|| "0".to_string());
                if !is_arrival_being(root, &history, &being) && !crate::live::open_being_moment(&being, conn) {
                    return Err(IbpError::new(
                        code::RESOURCE_CONFLICT,
                        format!("being '{being}' already has an open moment elsewhere — a being can hold only one open moment at a time"),
                    ));
                }
            }
            Ok(())
        }
        _ => Err(IbpError::new(
            code::UNAUTHORIZED,
            format!("moment for '{name_id}' needs a valid key-proof (a signature by the Name's key over the moment)"),
        )),
    }
}

/// THE OPTIONAL BEING-PASSWORD gate. If this moment perceives a `being` whose folded state carries a
/// non-empty `password` (a stored hash), the moment MUST also carry a matching plaintext `password`
/// (timing-safe-verified against the hash). A being with NO password set is the common case — it needs
/// no extra gate and returns Ok at once (the Name's key was the whole gate). Only a `kind:"being"`
/// perceive reads a password; a scene/see-op/index moment has no being to gate, so it is exempt.
fn gate_being_password(req: &Json, root: &Path) -> Result<(), IbpError> {
    if get_str(req, "kind").as_deref() != Some("being") {
        return Ok(()); // not a being perceive; nothing carries a being-password
    }
    let being_id = match get_str(req, "id") {
        Some(id) => id,
        None => return Ok(()),
    };
    let facts = treestore::read_reel_file(root, "0", "being", &being_id, None, None);
    if facts.is_empty() {
        return Ok(()); // no such being reel yet — no password to gate (e.g. a fresh perceive)
    }
    let state = treefold::fold("being", &facts);
    let hash = match get_str(&state, "password") {
        Some(h) if !h.is_empty() => h,
        _ => return Ok(()), // the dominant case: the being set NO password — the Name's key suffices
    };
    let given = get_str(req, "password").unwrap_or_default();
    if treesign::verify_password(&given, &hash) {
        Ok(())
    } else {
        Err(IbpError::new(
            code::UNAUTHORIZED,
            format!("being '{being_id}' is password-protected — this moment needs its password"),
        ))
    }
}

/// THE ACT GATE: an act RIDES the open moment. A non-`I` actor's act is attributed WITHOUT re-checking
/// the key (it was checked at the moment) — but it MUST have an open authenticated moment for that actor
/// on this conn. No open moment -> REJECTED (you cannot act without a moment). `I`'s acts are exempt
/// (custodial). The act still carries its own signature for the FACT's chain provenance, verified
/// downstream in the seal; this gate is the SESSION check, not the fact-sig check.
fn gate_act(req: &Json, conn: u64, root: &Path) -> Result<(), IbpError> {
    let actor = get(req, "actor");
    let name_id = actor.and_then(actor_name_id);
    let name_id = match name_id {
        Some(n) => n,
        None => return Ok(()), // an actor-less act (genesis/legacy) — the edge signer governs it
    };
    if is_story(&name_id) {
        return Ok(()); // I: custodial
    }
    if !crate::live::is_authenticated(conn, &name_id) {
        return Err(IbpError::new(
            code::UNAUTHORIZED,
            format!("act by '{name_id}' has no open authenticated moment (open a moment with the Name's key first)"),
        ));
    }
    // OWNERSHIP (the "you are not I" security floor): if the act DRIVES a being, the Name must OWN it
    // (trueName) or hold a live delegation (has_authority_over) — you can only act THROUGH beings you are
    // mother/father of, or that are delegated to you. The sole exception is the SHARED @arrival being,
    // which any beingless visitor rides (and whose able only permits calling @cherub to be born). A Name
    // with no being of its own is @arrival — it cannot borrow another's being. Enforced SERVER-SIDE; the
    // client only reacts.
    let history = get_str(req, "history").unwrap_or_else(|| "0".to_string());
    if let Some(being) = actor.and_then(|a| get_str(a, "beingId")).filter(|b| !b.is_empty() && b != "I") {
        if !is_arrival_being(root, &history, &being) && !treeibp::has_authority_over(root, &history, &name_id, &being) {
            return Err(IbpError::new(
                code::UNAUTHORIZED,
                format!("Name '{name_id}' may not act through being '{being}' — you can only act through beings you own or that are delegated to you"),
            ));
        }
    }
    Ok(())
}

/// The shared @arrival being — the entry stance every beingless visitor rides (many Names at once). Its
/// folded `name` is "arrival". Driving it is allowed for anyone; its ABLE still restricts it to calling
/// @cherub to be born, so the shared body can do nothing else.
fn is_arrival_being(root: &Path, history: &str, being_id: &str) -> bool {
    let facts = treestore::read_reel_file(root, history, "being", being_id, None, None);
    matches!(get_str(&treefold::fold("being", &facts), "name").as_deref(), Some("arrival"))
}

/// The actor's Name id (its pubkey/key-id, per the id-derivation rule). Reads `nameId`, else `beingId`
/// (the portal sends both; `I`'s actor uses `beingId:"I"`).
fn actor_name_id(actor: &Json) -> Option<String> {
    get_str(actor, "nameId").or_else(|| get_str(actor, "beingId"))
}

/// True for the story actor `I` (the custodial path; its key is the edge's story key, not a Name proof).
fn is_story(name_id: &str) -> bool {
    name_id == "I"
}

/// Handle one wire message: a moment/act JSON, else the legacy text read. Returns the JSON reply.
fn handle_wire_inner(msg: &str, root: &Path) -> String {
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
            // a SUMMON: being A calls being B -> B wakes (the present-loop conductor runs B's moment, B
            // decides + acts). The summon-driven wake of the present-loop runtime (Phase 1). CLOCK-FREE:
            // B wakes on this real event, not on a timer. Composes scheduler::wake over the conductor.
            Some("summon") | Some("call") => return json(&summon(&req, root)),
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
    // NAME LOGIN: return a Name's ENCRYPTED key blob for client-side password decrypt (Model B). NOT
    // redacted — the blob is password-locked (scrypt+AES-GCM), safe to return; the password never comes
    // to the server. This is the one deliberate exception to secret redaction.
    if get_str(req, "op").as_deref() == Some("name-key") {
        let args = get(req, "args").cloned().unwrap_or(Json::Null);
        let who = get_str(&args, "name").unwrap_or_default();
        let view = crate::resolve::name_key(&who, root).unwrap_or_else(|e| IbpError::new(code::NAME_NOT_FOUND, e).envelope());
        return obj(vec![("verb", jstr("moment")), ("op", jstr("name-key")), ("view", view)]);
    }
    // TIMELINE: the history's moments (one dot per act) for the history bar's scrubber.
    if get_str(req, "op").as_deref() == Some("timeline") {
        let history = get_str(req, "history").unwrap_or_else(|| "0".to_string());
        let at = num_field(req, "at");
        let view = crate::resolve::timeline(&history, at, root);
        return obj(vec![("verb", jstr("moment")), ("op", jstr("timeline")), ("view", view)]);
    }
    // BRANCHES: the history tree/switcher (main + every live branch).
    if get_str(req, "op").as_deref() == Some("branches") {
        return obj(vec![("verb", jstr("moment")), ("op", jstr("branches")), ("view", crate::resolve::branches(root))]);
    }
    if let Some(op) = get_str(req, "op") {
        let args = get(req, "args").cloned().unwrap_or(Json::Null);
        let view = match crate::seeops::see_op(&op, &args, root) {
            Some(v) => v,
            None => IbpError::new(code::VERB_NOT_SUPPORTED, format!("unknown see-op '{op}'")).envelope(),
        };
        return obj(vec![("verb", jstr("moment")), ("op", jstr(&op)), ("view", view)]);
    }
    // a real IBP ADDRESS (story#history/space/space@being) -> resolve the path to a SCENE descriptor
    // (the place + its children/occupants/matter). A foreign address was already federated upstream, so
    // any address that reaches here is LOCAL. This is the portal's navigation primitive.
    if let Some(addr) = get_str(req, "address") {
        let h = get_str(req, "history").unwrap_or_else(|| "0".to_string());
        // `at` = a past global ord to fold up to (time-travel); absent = live/now.
        let at = num_field(req, "at");
        // `rain:true` -> the RAIN view (all the Name's beings as symbol chains); else the place scene.
        let is_rain = matches!(get(req, "rain"), Some(Json::Bool(true)));
        let view = if is_rain {
            crate::resolve::rain(&addr, &h, at, root)
        } else {
            crate::resolve::scene(&addr, &h, at, root)
        };
        let view = match view {
            Ok(v) => v,
            Err(e) => IbpError::new(code::SPACE_NOT_FOUND, e).envelope(),
        };
        return obj(vec![("verb", jstr("moment")), ("view", treeprotocol::redact::redact_secrets(&view))]);
    }
    // a STORY render (the past as Word) of a being/name — render:"story" over a kind/id target.
    if get_str(req, "render").as_deref() == Some("story") {
        if let Some(id) = get_str(req, "id") {
            let k = get_str(req, "kind").unwrap_or_else(|| "being".to_string());
            let h = get_str(req, "history").unwrap_or_else(|| "0".to_string());
            let at = num_field(req, "at");
            let lang = get_str(req, "lang").unwrap_or_else(|| "en".to_string());
            let view = crate::resolve::story(&k, &id, &h, at, &lang, root).unwrap_or_else(|e| IbpError::new(code::INVALID_INPUT, e).envelope());
            return obj(vec![("verb", jstr("moment")), ("view", treeprotocol::redact::redact_secrets(&view))]);
        }
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
        // CREATE-BRANCH (an I act): fork a new history off main at an optional past ord.
        if op == "create-branch" {
            let label = get_str(req, "label").unwrap_or_else(|| "branch".to_string());
            let at = num_field(req, "at");
            return match crate::resolve::create_branch(&label, at, root) {
                Ok(row) => obj(vec![("verb", jstr("act")), ("ok", Json::Bool(true)), ("op", jstr("create-branch")), ("history", row)]),
                Err(e) => IbpError::new(code::INVALID_INPUT, e).envelope(),
            };
        }
        // NAME REGISTRATION (an I act): declare a Name or set/change its password on the library reel.
        if op == "name-declare" || op == "name-set-password" {
            let nid = get_str(req, "nameId").unwrap_or_default();
            let name = get_str(req, "name").unwrap_or_default();
            let spec = get(req, "spec").cloned().unwrap_or(Json::Null);
            let domain = crate::config::story_host(root).unwrap_or_else(|| "localhost".to_string());
            crate::act::declare_name(&op, &nid, &name, &spec, root, &domain)
        } else {
            // a materials op: the request itself is the trigger (target/field/value/merge/branch).
            crate::act::run_op(&op, req, &actor, root, &history, basis)
        }
    } else if let Some(word) = get_str(req, "word") {
        crate::act::run_word(&word, &actor, root, &history, basis)
    } else {
        return IbpError::new(code::INVALID_INPUT, "act needs a 'word' or an 'op'").envelope();
    };
    // redact secrets from the stamped facts before they leave (a set-being password fact, etc.).
    let results: Vec<Json> = outcomes.iter().map(|o| treeprotocol::redact::redact_secrets(&crate::act::outcome_json(o))).collect();
    obj(vec![("verb", jstr("act")), ("ok", Json::Bool(true)), ("engine", jstr("rust")), ("results", Json::Arr(results))])
}

/// A SUMMON: wake a being. The present-loop runtime's entry from the wire — a real EVENT (a summon),
/// never a timer, drives the wake. The summon names the `being` to wake; the optional `able`/`space`/
/// `event`/`payload`/`from` ride into the moment's inner-face (so a scripted `When event:` flow fires).
/// By default the wake runs SYNCHRONOUSLY (the reply carries the moment outcomes the caller asked for);
/// `detach:true` fires it on the being's own run-loop thread and returns immediately (parallel beings).
/// CLOCK-FREE: nothing here reads a wall-clock. Composes scheduler::wake / wake_sync over the conductor.
fn summon(req: &Json, root: &Path) -> Json {
    let being = match get_str(req, "being").or_else(|| get_str(req, "to")) {
        Some(b) => b,
        None => return IbpError::new(code::INVALID_INPUT, "summon needs a 'being' (or 'to')").envelope(),
    };
    let entry = crate::scheduler::Entry {
        correlation: get_str(req, "correlation").unwrap_or_else(|| being.clone()),
        from: get_str(req, "from"),
        able: get_str(req, "able"),
        space: get_str(req, "space"),
        event: get_str(req, "event"),
        payload: get(req, "payload").cloned(),
        history: get_str(req, "history").unwrap_or_else(|| "0".to_string()),
        basis: num_field(req, "basis"),
        prev: get_str(req, "prev"),
        flows: None, // wire summons parse the able's `.word` flows; injection is an in-process seam.
        priority: get_str(req, "priority"), // drain ranks by priorityRank; clock-free count sort.
    };
    let root_buf = root.to_path_buf();
    let detach = matches!(get(req, "detach"), Some(Json::Bool(true)));
    if detach {
        let accepted = crate::scheduler::wake(&being, entry, &root_buf);
        return obj(vec![
            ("verb", jstr("summon")),
            ("being", jstr(&being)),
            ("woke", Json::Bool(accepted)),
            ("detached", Json::Bool(true)),
        ]);
    }
    // synchronous wake: run the being's moment(s) inline so the reply carries the outcome.
    let reports = crate::scheduler::wake_sync(&being, entry, &root_buf);
    let moments: Vec<Json> = reports.iter().map(|r| r.view()).collect();
    obj(vec![
        ("verb", jstr("summon")),
        ("being", jstr(&being)),
        ("woke", Json::Bool(true)),
        ("moments", Json::Arr(moments)),
    ])
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
