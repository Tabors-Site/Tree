// treeibp — the IBP layer: the TWO primitives, moment + act, over the determinism spine. The six-verb
// collapse, RUNNING. Both share ONE gate (treeval authorize, grants FOLDED from the chain):
//
//   act(word)    = parse (treeword) → authorize → rasterize (treeval) → stamp (treestore)
//                  — a being speaks one word; an authorized act lands on the chain, a denied one does not.
//   moment(tgt)  = authorize(see) → read → verify → fold
//                  — a being perceives, left stance; the gate guards the read, the fold IS the percept.
//
// AUTHENTICATION belongs at MOMENT (Tabor): accessing a Name needs its private key, so taking a moment
// proves that key — a being that can perceive is authenticated AND holds its key to sign. So `act`
// TRUSTS the moment-established identity and signs with the key already in hand (the injected `sign`);
// you cannot act without a moment. (`authorize` here is PERMISSION, not identity; moment-time key
// verification is the next piece.)
//
// The able SPEC production (foldAbleNoun) is INJECTED as `able_spec_of` — the JS side is porting
// parseAbleWord → the engine; treeibp takes a resolver so it stays decoupled from that work. The able
// SPEC SHAPE { canSee, canDo, canCall, canBe, reach } is the stable contract.
//
// == THE ONE PATH (Tabor: "the I reads the .word through the stamper as an act") ==
//
//   parse -> act_inner -> run_body_expand -> seal_specs -> moments
//
// EVERY act entry converges here. `act_inner` is the single private pipeline: parse the Word, run its
// body through the ONE real body loop (`run_body_expand` - acts, flows, control flow, threading
// bindings + state, and the composite-by-reference expansion), then AUTHORIZE + SEAL each produced spec
// as a moment (`seal_specs` -> `seal_one` -> treestore's `commit_moment`). The public entries `act`,
// `act_via_fold`, `act_via_fold_bound` are thin wrappers that differ ONLY in the two injected closures
// they hand `act_inner` - the op-word resolver (`op_word_of`: inline / fold-backed) and the initial ctx
// binds (empty / caller-supplied anchors). There is no second runner: `run_body` / `run_body_host` are
// no-expand wrappers over `run_body_expand`, so ONE body loop is the whole vocabulary. The I reads the
// .word through the stamper as an act: same words -> same specs -> same sealed facts -> same ids.

use std::path::Path;
use std::sync::Mutex;
use treehash::Json;
use treeseed::HostError; // the host see-op refusal (the .word's refusal); the resolver seam run_body calls
use treestore::{
    commit_moment, commit_moment_signed, next_ord, read_ord, read_reel_file, verify_fact_chain,
};
use treeval::able::{able_walk, Grant, PermitReq, WalkArgs};
use treeval::auth::{authorize_decide, DecideArgs};

// The bootstrap NAME is "I" - the signer + the source of all authority (I signs, I has authority). The
// name-being split (project_name_being_refactor): "I" is the NAME here (the authority axis in
// `has_authority_over` + the authorize bypass), DISTINCT from the first BEING "Am" (the be:birth target +
// the public vocabulary reel, treewordfold::AM_BEING). This const is the NAME; the being id "Am" lives in
// treegenesis::AM_BEING / treewordfold::AM_BEING. (`am` is the being's birth word; i-am/I_AM were drift.)
const I_AM: &str = "I";

/// The story = its NAME/ALIAS (crossOrigin.js: "the substrate domain, e.g. tabors.site"). The on-disk
/// store keys act-chains under it AND the act-sig commits to it, so it must be stable per store. Set at
/// first boot via `STORY_DOMAIN` (default "localhost"). NOT a DNS requirement — per philosophy/dns.md a
/// reality is its I key + a chosen alias resolved through Peering ("whatever name they want"). Matches the
/// same static in config.rs + treebook (all read the env `.env` loads at startup).
static STORY: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| std::env::var("STORY_DOMAIN").unwrap_or_else(|_| "localhost".to_string()));

/// Per-reel STRIPE LOCKS (256). A reel is a hash chain: writes to ONE reel MUST serialize (no fork, no
/// silent same-seq drop), but different reels are independent. So same-reel writers hash to the same
/// stripe and serialize, while different reels almost always differ → fully parallel — the "heavy by
/// many names at once" case. The lock is held across `next_ord` + `commit_moment` so a hot reel's ords
/// match its seq (landing) order. In-process only (one forest = one process = one store).
const STRIPES: usize = 256;
static REEL_LOCKS: [Mutex<()>; STRIPES] = [const { Mutex::new(()) }; STRIPES];

fn reel_stripe(history: &str, kind: &str, id: &str) -> usize {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    history.hash(&mut h);
    kind.hash(&mut h);
    id.hash(&mut h);
    (h.finish() % STRIPES as u64) as usize
}

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn get_str<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}
fn as_arr(v: &Json) -> &[Json] {
    match v {
        Json::Arr(a) => a.as_slice(),
        _ => &[],
    }
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn ok_true(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}
/// Set (replace) one key on a Json object, preserving the rest.
fn set_field(v: &Json, key: &str, val: Json) -> Json {
    let mut e: Vec<(String, Json)> = match v {
        Json::Obj(o) => o.iter().filter(|(k, _)| k != key).cloned().collect(),
        _ => Vec::new(),
    };
    e.push((key.to_string(), val));
    Json::Obj(e)
}

/// A per-Name, DETERMINISTIC being id from (nameId, being-name): so a Name saying "I am Tabor" twice
/// yields the SAME being (→ connect, not a re-birth), and two different Names' "Tabor" never collide.
/// Readable prefix + a hash of the Name+name (the id-derivation rule: a being's id = the hash of its
/// birth, here bound to its Name so it's sovereign).
fn derive_being_id(name_id: &str, being_name: &str) -> String {
    let low = being_name.to_lowercase();
    let h = treehash::sha256_hex(format!("{name_id}:{low}").as_bytes());
    format!("{low}-{}", &h[..12])
}

/// "I" = the acting Name's FACET (the user's doctrine): once you are a Name, "I" is not the story I — it
/// is YOUR facet of I (your Name). When a Name speaks `I am <Name>` (a `be:birth`), the being it makes is
/// the Name's OWN: a per-Name deterministic id, attributed to the Name (`by`), expressing the Name
/// (`trueName`), self-stamped (`through`), and — when the speaker is already EMBODIED (driving a being) —
/// born OUT OF that being (`parentBeingId` = the current being; "I am George" births George out of you).
/// trueName is FORCED to the Name. At genesis (actor is the bare story "I") this is a no-op.
fn facet_resolve(spec: &Json, actor: &Json) -> Json {
    let name_id = match get_str(actor, "nameId") {
        Some(n) if !n.is_empty() && n != I_AM => n.to_string(),
        _ => return spec.clone(),
    };
    if get_str(spec, "verb") != Some("be") || get_str(spec, "act") != Some("birth") {
        return spec.clone();
    }
    let display_name = get(spec, "of").and_then(|o| get_str(o, "id")).unwrap_or("").to_string();
    let being_id = derive_being_id(&name_id, &display_name);
    let mut params = get(spec, "params").cloned().unwrap_or_else(|| obj(vec![]));
    params = set_field(&params, "trueName", jstr(&name_id));
    params = set_field(&params, "name", jstr(&display_name));
    // born out of the current being when embodied, else a root being of the Name (no parent).
    if let Some(parent) = get_str(actor, "beingId").filter(|b| !b.is_empty() && *b != I_AM) {
        params = set_field(&params, "parentBeingId", jstr(parent));
    }
    // a being is ALWAYS born INTO a space (user doctrine — never spaceless). treeos enriches the actor
    // with `homeSpace` (the actor's current space, else the story's place root); spawn the being there.
    // The COORD is not hardcoded here — `with_default_placement` gives any un-placed creation a derived
    // spot, so future words get it for free.
    if let Some(home) = get_str(actor, "homeSpace").filter(|h| !h.is_empty()) {
        params = set_field(&params, "homeSpace", jstr(home));
        params = set_field(&params, "position", jstr(home));
    }
    let s = set_field(spec, "of", obj(vec![("kind", jstr("being")), ("id", jstr(&being_id))]));
    let s = set_field(&s, "by", jstr(&name_id));
    let s = set_field(&s, "through", jstr(&being_id));
    set_field(&s, "params", params)
}

/// A DETERMINISTIC pseudo-random ground spot for an id (clock-free — NO Math.random). Two hash bytes →
/// x,y in 0..99. Same id always lands the same place; different ids spread out. This is how any new
/// space/being "just gets a position" without hardcoding, and future words inherit it for free.
fn derive_coord(id: &str) -> (f64, f64) {
    let h = treehash::sha256_hex(id.as_bytes());
    let x = u32::from_str_radix(h.get(0..4).unwrap_or("0"), 16).unwrap_or(0) % 100;
    let y = u32::from_str_radix(h.get(4..8).unwrap_or("0"), 16).unwrap_or(0) % 100;
    (x as f64, y as f64)
}

/// DEFAULT PLACEMENT (user doctrine: "the word just gives them values"): any creation that lands a being
/// or a space and carries NO coord gets a derived-random one; a NEW space with no parent defaults under
/// the actor's current space (`homeSpace`). Explicit values a later word set (`… at 0,0`, `… in heaven`)
/// always win — this only fills what's absent. General over ALL make/birth words, present and future.
fn with_default_placement(spec: &Json, actor: &Json) -> Json {
    // `make` is ONE act over both nouns (of.kind picks); placement is for the SPACE make only — a
    // matter-make fact keeps its shape exactly (no coord derive, no parent default), as create-matter
    // never placed.
    let of_kind = get(spec, "of").and_then(|o| get_str(o, "kind"));
    let placeable = matches!(
        (get_str(spec, "verb"), get_str(spec, "act")),
        (Some("be"), Some("birth")) | (Some("do"), Some("make"))
    ) && (get_str(spec, "verb") == Some("be") || of_kind == Some("space"));
    if !placeable {
        return spec.clone();
    }
    let id = get(spec, "of").and_then(|o| get_str(o, "id")).unwrap_or("").to_string();
    let mut params = get(spec, "params").cloned().unwrap_or_else(|| obj(vec![]));
    if get(&params, "coord").is_none() {
        let (x, y) = derive_coord(&id);
        params = set_field(&params, "coord", obj(vec![("x", Json::Num(x)), ("y", Json::Num(y))]));
    }
    // a new SPACE with no parent falls under the actor's current space (the "current parent" default).
    if get_str(spec, "act") == Some("make") && get(&params, "parent").is_none() {
        if let Some(home) = get_str(actor, "homeSpace").filter(|h| !h.is_empty()) {
            params = set_field(&params, "parent", jstr(home));
        }
    }
    set_field(spec, "params", params)
}

/// True when the actor is a real Name (a facet of I), not the bare story "I" and not a bodiless nobody.
fn actor_name_facet(actor: &Json) -> Option<String> {
    match get_str(actor, "nameId") {
        Some(n) if !n.is_empty() && n != I_AM => Some(n.to_string()),
        _ => None,
    }
}
/// Fold a being's reel off disk → its granted ables (qualities.ablesGranted).
pub fn fold_grants(dir: &Path, history: &str, being_id: &str) -> Json {
    let facts = read_reel_file(dir, history, "being", being_id, None, None);
    let state = treefold::fold("being", &facts);
    get(&state, "qualities")
        .and_then(|q| get(q, "ablesGranted"))
        .cloned()
        .unwrap_or(Json::Arr(vec![]))
}

/// foldAbleNoun (seedAbleFold.js): parse an able's `.word` + collect its grant-set into the spec
/// `permits` consumes — `{ canSee, canDo, canCall, canBe, reach, requiredCognition }`. The `can`
/// lines group by verb; a `call X as receiver` entry splits into `{ pattern, as }`. PURE.
pub fn fold_able_noun(name: &str, text: &str) -> Json {
    let nodes = treeword::parse(text);
    let (mut can_see, mut can_do, mut can_call, mut can_be, mut reach) = (vec![], vec![], vec![], vec![], vec![]);
    let mut required_cognition = Json::Null;
    for n in &nodes {
        match get_str(n, "kind") {
            Some("can") => {
                let word = get_str(n, "of").unwrap_or("");
                match get_str(n, "verb").unwrap_or("") {
                    "see" => can_see.push(jstr(word)),
                    "do" => can_do.push(jstr(word)),
                    "be" => can_be.push(jstr(word)),
                    "call" => can_call.push(split_call(word)),
                    _ => {} // recall, etc. — not gated by permits
                }
            }
            Some("reach") => {
                if let Some(to) = get_str(n, "to") {
                    reach.push(jstr(to));
                }
            }
            Some("cognition") => required_cognition = get_str(n, "mode").map(jstr).unwrap_or(Json::Null),
            _ => {} // is / wakes — not part of the auth spec
        }
    }
    obj(vec![
        ("name", jstr(name)),
        ("canSee", Json::Arr(can_see)),
        ("canDo", Json::Arr(can_do)),
        ("canCall", Json::Arr(can_call)),
        ("canBe", Json::Arr(can_be)),
        ("reach", Json::Arr(reach)),
        ("requiredCognition", required_cognition),
    ])
}

/// `call X as receiver` → `{ pattern: X, as: receiver }`; a bare pattern stays a string.
fn split_call(word: &str) -> Json {
    let lw = word.to_lowercase();
    for tag in ["receiver", "actor"] {
        let suf = format!(" as {tag}");
        if lw.ends_with(&suf) {
            return obj(vec![("pattern", jstr(word[..word.len() - suf.len()].trim())), ("as", jstr(tag))]);
        }
    }
    jstr(word)
}

/// foldWordAble (seedAbleFold.js): fold `<ables_dir>/<name>.word` → its spec, or None if absent.
/// This is the foldAbleNoun seam in Rust — what `able_spec_of` plugs into for the binary.
pub fn fold_word_able(name: &str, ables_dir: &Path) -> Option<Json> {
    if name.is_empty() {
        return None;
    }
    let text = std::fs::read_to_string(ables_dir.join(format!("{name}.word"))).ok()?;
    Some(fold_able_noun(name, &text))
}

/// The space's ancestor chain [self, parent, …, root] with each space's folded state, walking
/// `state.parent` off the chain (getAncestorChain's job). Cycle-guarded + depth-capped.
fn ancestor_states(dir: &Path, history: &str, space_id: &str) -> Vec<(String, Json)> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut cur = space_id.to_string();
    while seen.insert(cur.clone()) && out.len() < 64 {
        let facts = read_reel_file(dir, history, "space", &cur, None, None);
        let state = treefold::fold("space", &facts);
        let parent = get_str(&state, "parent").filter(|s| !s.is_empty()).map(|s| s.to_string());
        out.push((cur.clone(), state));
        match parent {
            Some(p) => cur = p,
            None => break,
        }
    }
    out
}

/// spaceIsAtOrBelow: is `target` the host or a descendant of it (host on target's ancestor chain)?
pub fn space_is_at_or_below(dir: &Path, history: &str, target: &str, host: &str) -> bool {
    target == host || ancestor_states(dir, history, target).iter().any(|(id, _)| id == host)
}

/// findNearestOwnedAncestor: the nearest space at/above `space_id` carrying an owner -> {ownerIds, spaceId}.
pub fn nearest_owned_ancestor(dir: &Path, history: &str, space_id: &str) -> Option<Json> {
    for (id, state) in ancestor_states(dir, history, space_id) {
        if let Some(owner) = get_str(&state, "owner").filter(|s| !s.is_empty()) {
            return Some(obj(vec![
                ("ownerIds", Json::Arr(vec![jstr(owner)])),
                ("spaceId", jstr(&id)),
            ]));
        }
    }
    None
}

/// livePointsAt (inheritation.js): the Names holding a LIVE inheritation point AT this being-tree
/// position. Read the grant/revoke-inheritation facts on the POSITION being's reel (`verb:"do"`,
/// `act:"grant-/revoke-inheritation"`, granted Name in `params.name`); keep the latest grant vs the
/// latest revoke per Name by chain ORDER (seq totally orders one reel — never the clock), live when
/// the grant out-orders the revoke (`gSeq > rSeq`, or no revoke). Reads the single `history` reel —
/// the JS unions the history's reel-lineage; that cross-history union is the deferred refinement,
/// matching how the space-ancestry walk here also reads a single history.
fn live_points_at(dir: &Path, history: &str, being_id: &str) -> std::collections::HashSet<String> {
    let facts = read_reel_file(dir, history, "being", being_id, None, None);
    let seq_of = |f: &Json| match get(f, "seq") {
        Some(Json::Num(n)) => *n,
        _ => 0.0,
    };
    let mut latest_grant: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    let mut latest_revoke: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for f in &facts {
        if get_str(f, "verb") != Some("do") {
            continue;
        }
        let into = match get_str(f, "act") {
            Some("grant-inheritation") => &mut latest_grant,
            Some("revoke-inheritation") => &mut latest_revoke,
            _ => continue,
        };
        if let Some(name) = get(f, "params").and_then(|p| get_str(p, "name")) {
            into.insert(name.to_string(), seq_of(f)); // seq-ascending read -> last write wins == latest
        }
    }
    latest_grant
        .into_iter()
        .filter(|(name, g)| latest_revoke.get(name).map_or(true, |r| g > r))
        .map(|(name, _)| name)
        .collect()
}

/// anchorsAtNode (inheritation.js): the authority anchors at ONE being-tree node — the owner
/// (`state.trueName`) plus every Name holding a live inheritation point there. Consumes `live_points`.
fn anchors_at_node(state: &Json, mut live_points: std::collections::HashSet<String>) -> std::collections::HashSet<String> {
    if let Some(owner) = get_str(state, "trueName").filter(|s| !s.is_empty()) {
        live_points.insert(owner.to_string());
    }
    live_points
}

/// hasAuthorityOver (inheritation.js): does `name_id` have authority over `being_id` on `history`?
/// I is universal (the bootstrap axiom, parallel to authorize's I-Am bypass); otherwise walk the
/// being-tree UP via `parentBeingId` and answer yes at the first node whose anchors (owner + live
/// inheritation points) include the Name. The being-tree carries DOWNWARD authority: an anchor at a
/// being OR any ancestor covers the whole subtree — a child born under a covered position inherits
/// coverage with nothing stored (the walk from the child passes through the anchor). Cycle-guarded,
/// depth-capped (256) like the JS walkUp. This is what wires authorize's `inheritation_ok`.
pub fn has_authority_over(dir: &Path, history: &str, name_id: &str, being_id: &str) -> bool {
    if name_id.is_empty() || being_id.is_empty() {
        return false;
    }
    if name_id == I_AM {
        return true; // I is the source of all authority on its own story
    }
    let mut seen = std::collections::HashSet::new();
    let mut cur = being_id.to_string();
    for _ in 0..256 {
        if !seen.insert(cur.clone()) {
            break; // a cycle in parentBeingId
        }
        let facts = read_reel_file(dir, history, "being", &cur, None, None);
        if facts.is_empty() {
            break; // no facts == no projection (the JS `!row?.state`)
        }
        let state = treefold::fold("being", &facts);
        let points = live_points_at(dir, history, &cur);
        if anchors_at_node(&state, points).contains(name_id) {
            return true;
        }
        match get_str(&state, "parentBeingId").filter(|s| !s.is_empty()) {
            Some(p) => cur = p.to_string(),
            None => break, // the I-AM being / a root
        }
    }
    false
}

/// The shared GATE — fold the actor's grants, resolve each able's spec (foldAbleNoun, injected), and
/// run the able-walk + the authorize decision. Returns the verb-dispatch verdict {ok, actor, reason}.
pub fn authorize(
    verb: &str,
    op: Option<&str>,
    target_space: Option<&str>,
    audit_being_id: Option<&str>,
    identity: &Json,
    dir: &Path,
    history: &str,
    able_spec_of: impl Fn(&str) -> Option<Json>,
) -> Json {
    let grants_json = match get_str(identity, "beingId") {
        Some(b) => fold_grants(dir, history, b),
        None => Json::Arr(vec![]),
    };
    // resolve specs + the host-descendant base (spaceIsAtOrBelow over the real space tree), then
    // build the Grant structs borrowing them.
    let resolved: Vec<(String, Option<&str>, Json, bool)> = as_arr(&grants_json)
        .iter()
        .filter_map(|g| {
            let able = get_str(g, "able")?;
            let spec = able_spec_of(able)?;
            let anchor = get_str(g, "anchorSpaceId");
            let base = match (target_space, anchor) {
                (Some(ts), Some(host)) => space_is_at_or_below(dir, history, ts, host),
                _ => false,
            };
            Some((able.to_string(), anchor, spec, base))
        })
        .collect();
    let grant_structs: Vec<Grant> = resolved
        .iter()
        .map(|(able, anchor, spec, base)| Grant {
            able: able.as_str(),
            anchor_space_id: *anchor,
            spec,
            host_space_id: *anchor,
            base_covered: *base,
        })
        .collect();
    // the nearest owned ancestor of the target (findNearestOwnedAncestor)
    let owner_claim = target_space.and_then(|ts| nearest_owned_ancestor(dir, history, ts));
    let req = PermitReq {
        action: if verb == "do" { op } else { None },
        intent: None,
        operation: if verb == "be" { op } else { None },
        see_op: if verb == "see" { op } else { None },
        target_being: None,
    };
    let able_result = able_walk(&WalkArgs {
        identity: Some(identity),
        verb,
        owner_claim: owner_claim.as_ref(),
        grants: &grant_structs,
        target_space,
        target_path: None,
        req,
    });
    // inheritation coverage (the being-tree downward-authority axis): a DO on a being the actor's
    // Name has authority over — owns it, or owns/holds a live point at any ancestor (hasAuthorityOver).
    // Computed only for DO-on-being with a named actor; the able-walk (space reach) ran first above.
    let name_id = get_str(identity, "nameId").filter(|s| !s.is_empty());
    let inheritation_ok = match (verb, name_id, audit_being_id) {
        ("do", Some(n), Some(b)) if !b.is_empty() => has_authority_over(dir, history, n, b),
        _ => false,
    };
    authorize_decide(&DecideArgs {
        identity: Some(identity),
        verb,
        target: None,
        audit_being_id,
        ext_blocked: None,
        able_result: &able_result,
        inheritation_ok,
    })
}

/// Seal ONE authorized spec as a MOMENT through treestore's doctrine-correct pipeline — `commit_moment`
/// (act-FIRST, with the orphan self-heal + .acthead CAS: the moment-seal corruption protection, Thm 7 /
/// Cor 7.1). The act WRAPS the fact: `{by, through, to, story, history, deltaF:[spec]}` — one act lays
/// one fact on one reel (a Word's spec IS a moment; `startMessage`/`endMessage` are dead — a moment is
/// just the one word). `sign` is the INJECTED crypto so treeibp stays crypto-free like the spine: when
/// present the act is ed25519-signed BEFORE it lands (`commit_moment_signed`); when `None` it's unsigned.
/// Returns the stamped fact doc read back off its reel, or `None` on a seal error.
fn seal_one(
    dir: &Path,
    history: &str,
    kind: &str,
    id: &str,
    spec: &Json,
    basis: Option<f64>,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Option<Json> {
    let by = get_str(spec, "by").unwrap_or(I_AM);
    // the deltaF entry = the rasterized fact, carrying its reel `history` (seal_moment keys each fact's
    // reel by its own history / of.kind / of.id).
    let fact = match spec {
        Json::Obj(e) if !e.iter().any(|(k, _)| k == "history") => {
            let mut e2 = e.clone();
            e2.push(("history".to_string(), jstr(history)));
            Json::Obj(e2)
        }
        _ => spec.clone(),
    };
    let mut fields: Vec<(&str, Json)> = vec![
        ("by", jstr(by)),
        ("through", get(spec, "through").cloned().unwrap_or(Json::Null)),
        ("to", get(spec, "to").cloned().unwrap_or(Json::Null)),
        ("story", jstr(STORY.as_str())),
        ("history", jstr(history)),
        ("deltaF", Json::Arr(vec![fact])),
    ];
    // basis = the global ord this act was DECIDED against (the moment the being perceived). It rides the
    // act opening as a NON-DIGEST annotation (auto-excluded by the content_of_act + sig-payload
    // allowlists), so the gap `ord - basis` = causal staleness in EVENTS. Advisory telemetry, never a gate.
    if let Some(b) = basis {
        fields.push(("basis", Json::Num(b)));
    }
    let act_doc = obj(fields);
    // Allocate the global ord + commit UNDER the per-reel stripe lock: same reel serializes (a hash chain
    // requires it — no fork, no silent same-seq drop), different reels stay parallel, and `ord` (claimed
    // inside) matches the landing (seq) order. ord is NON-DIGEST — it never moves an _id or the act-sig.
    let committed = {
        let _guard = REEL_LOCKS[reel_stripe(history, kind, id)]
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let ord = next_ord(dir);
        match sign {
            Some(s) => commit_moment_signed(dir, &act_doc, ord, s),
            None => commit_moment(dir, &act_doc, ord),
        }
    }
    .ok()?;
    // read the stamped fact back off its reel (the moment's durable record) for the outcome.
    let fid = committed.fact_ids.first()?;
    read_reel_file(dir, history, kind, id, None, None)
        .into_iter()
        .find(|f| get_str(f, "_id") == Some(fid.as_str()))
}

/// The outcome of one act in a Word.
pub enum Outcome {
    Authorized(Json), // the stamped fact doc
    Denied(String),   // the gate's reason
}

/// `ranAsMoments` (moments.md) — the POSITIVE marker that a Word ran as N MOMENTS, so the dispatcher
/// must NOT auto-stamp a fact for the Word itself: a composite word lays NO fact of its own, its DEEDS
/// do. In the JS dispatcher this gated an else-branch that would have auto-Fact'd; in Rust the `act`
/// family NEVER auto-stamps — it ONLY seals the specs the body produced (`seal_specs` opens one moment
/// per spec). So this is structural here, and the marker is a TRUE assertion over the outcome list: an
/// outcome list IS the N moments (one Outcome per deed-fact / refusal), never a single fused composite
/// fact. Holds for every `act` entry by construction - they all converge on `act_inner`, whose runner
/// has no composite-fact path to skip. (Surfaced as a predicate so a caller / test can
/// name the invariant.)
pub fn ran_as_moments(_outcomes: &[Outcome]) -> bool {
    true // the act family always runs as N moments; there is no auto-stamp of the composite word
}

/// The ACT primitive - a being speaks a Word: parse -> run its body (`run_body_expand`: acts, flows, and
/// control flow, threading bindings + state) → AUTHORIZE + SEAL each act that targets a reel (the
/// moment-seal, `seal_one`). ONE entry; declarations are skipped, and a state-only act threads its
/// `sets` without sealing. `sign` is the optional injected signer (treeibp stays crypto-free; the edge
/// binary supplies the story/Name key) — present = the acts land ed25519-signed, `None` = unsigned.
/// (Paired with `moment`, the read primitive — the two-primitive surface.)
///
/// A thin wrapper over `act_inner` (THE ONE PATH) with INLINE ops (an empty `op_word_of` - every node
/// rasterizes inline, no composite-by-reference expansion) and NO initial binds. Byte-identical to the
/// old `act_with_ops(..., |_| None, ...)`.
pub fn act(
    word: &str,
    actor: &Json,
    dir: &Path,
    history: &str,
    able_spec_of: impl Fn(&str) -> Option<Json>,
    basis: Option<f64>,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Vec<Outcome> {
    act_inner(word, actor, dir, history, able_spec_of, |_| None, &obj(vec![]), basis, sign)
}

/// THE ONE PATH - the single act pipeline every public entry converges on: parse -> run the body via the
/// EXPANDING runner (`run_body_expand`, the one real body loop) -> AUTHORIZE + SEAL each produced spec as
/// a moment (`seal_specs`). PRIVATE: the public entries (`act`, `act_via_fold`, `act_via_fold_bound`) are
/// thin wrappers differing ONLY in the two injected closures - `op_word_of` (the COMPOSITE-by-reference
/// resolver: a WORD-SOLE materials op - set-being / set-space / make / end-space / set-matter /
/// make - carries NO inline body; `op_word_of(op)` returns its co-located `.word` and the deed
/// naming it is EXPANDED, its trigger derived from the act's OWN fields, its `Return` do-fact sealed as
/// the moment) and `binds` (the WORLD-ANCHOR seam: a `{ <anchor>: <id>, ... }` object the genesis reader
/// seeds into ctx.bindings so a creation Word's `of`/`params` refs resolve to already-created ids). A
/// node with no materials body runs the inline path. There is NO external trigger channel - the trigger
/// is INTERNAL, derived from the act.
#[allow(clippy::too_many_arguments)]
fn act_inner(
    word: &str,
    actor: &Json,
    dir: &Path,
    history: &str,
    able_spec_of: impl Fn(&str) -> Option<Json>,
    op_word_of: impl Fn(&str) -> Option<String>,
    binds: &Json,
    basis: Option<f64>,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Vec<Outcome> {
    let nodes = treeword::parse(word);
    let fail_closed = |_: &str, _: &[Json]| false; // domain predicates fail closed (no host wired)

    // The HOST SEE-OP seam (treehost): the AuthCtx is free here - `actor` carries the identity, and the
    // resolver runs BEFORE the act's authorize (it's the substrate READ the `.word` runs to BUILD its
    // fact). I (the bootstrap Name / boot mirror) bypasses the create/end resolvers' gates; a real
    // being is a `caller`. The closure closes over (dir, history, resolver, auth) and calls
    // treeseed::Resolvers - the faithful mirror of the `host`/`able_spec_of` injection seams.
    let auth = match get_str(actor, "beingId") {
        Some(b) if b == I_AM => treeseed::AuthCtx::i_am(),
        Some(b) if !b.is_empty() => treeseed::AuthCtx::caller(b),
        _ => treeseed::AuthCtx::default(),
    };
    let resolver = treeseed::Resolvers; // the default see-op table (resolve-X -> its native body)
    let see_op = |op: &str, args: &[Json]| -> Result<Json, HostError> {
        treeseed::HostResolver::resolve(&resolver, op, args, dir, history, &auth)
    };

    // Run the WHOLE body through the EXPANDING driver. A deed naming a declared op-word (its `.word`
    // resolved by op_word_of) is EXPANDED into running that body with the deed-derived trigger; a
    // composite deed (an op-word whose `.word` itself names op-words — set-owner.word's `do set-space`)
    // expands the SAME way, recursively, all the way down (expand_one threads itself). Each produced
    // spec is one act -> one fact -> one moment; `seal_specs` opens a moment per spec. Deeds that are
    // NOT op-words (grant-able, a plain field set) rasterize inline as before. This is the N-MOMENTS
    // composite: one entry, the body fans out to its deeds, every deed lays its own fact and NONE is
    // fused — the top-level word itself lays no fact of its own (its deeds do), so the dispatcher's
    // result is the N outcomes, never a single composite fact (`ran_as_moments`, below).
    let initial_binds = match binds {
        Json::Obj(_) => binds.clone(),
        _ => obj(vec![]),
    };
    let mut ctx = obj(vec![
        ("identity", actor.clone()),
        ("bindings", initial_binds),
        ("state", obj(vec![])),
        ("beings", obj(vec![])),
    ]);
    let expand = |n: &Json, c: &mut Json| expand_one(n, c, actor, history, &op_word_of, &see_op);
    let specs = match run_body_expand(&nodes, &mut ctx, &fail_closed, &see_op, &expand) {
        Ok(s) => s,
        Err(e) => return vec![Outcome::Denied(e.to_string())],
    };

    let basis = basis.or_else(|| Some(read_ord(dir))); // the moment-ord this Word was decided against
    seal_specs(&specs, actor, dir, history, &able_spec_of, basis, sign)
}

/// Derive the STANDARD trigger from an act node's OWN fields — the do.js runOpWord mapping, sourced from
/// the ACT (not a separate channel): `target` = the act's `of` ({kind,id}, rasterized so a `ref` target
/// resolves), `field`/`value`/`merge` (+ any op params) = the act's `params`, `branch` = the history,
/// `caller` = the actor's beingId, `targetId`/`targetKind` extracted from the target. Matches do.js's
/// trigger key names + shape so the op `.word`'s `see resolve-X($target, $field, ...)` binds identically.
fn derive_trigger(node: &Json, ctx: &Json, actor: &Json, history: &str) -> Json {
    // rasterize the act's `of` against ctx so a `{ref}` / `$id` target resolves to a concrete {kind,id}
    // (the JS dispatcher passes the resolved ctx.target). A plain {kind,id} passes through unchanged.
    let mut target = treeval::resolve_target(get(node, "of"), ctx, None).unwrap_or(Json::Null);
    // RECOVER a LITERAL id the parser ref-keyed. `do <op> on the being <id>` lowers the id to a
    // `{ kind, ref }` (parse_do_target always refs), so resolve_target yields a NULL id when the ref is
    // not a binding (an id named directly, not a $var). Fall back to the act's raw `of.ref`/`of.id` as
    // the literal id — the being WAS named in the act, the trigger is derived from the act's own field.
    let id_empty = matches!(get(&target, "id"), None | Some(Json::Null))
        || get_str(&target, "id").map(|s| s.is_empty()).unwrap_or(false);
    if id_empty {
        let of = get(node, "of");
        let lit = of
            .and_then(|o| get_str(o, "id").or_else(|| get_str(o, "ref")))
            .filter(|s| !s.is_empty() && !s.starts_with('$'));
        if let Some(lit) = lit {
            if let Json::Obj(t) = &mut target {
                t.retain(|(k, _)| k != "id");
                t.push(("id".to_string(), jstr(lit)));
            }
        }
    }
    let target = target;
    let params = match get(node, "params") {
        Some(p) => treeval::resolve_value(p, ctx),
        None => obj(vec![]),
    };
    // STANDARD trigger: op params spread top-level (so `$field`/`$value`/`$merge` resolve), then the
    // standard keys LAST so an op param can never shadow them (do.js ordering).
    let mut fields: Vec<(String, Json)> = match &params {
        Json::Obj(e) => e.clone(),
        _ => Vec::new(),
    };
    let set = |fields: &mut Vec<(String, Json)>, k: &str, v: Json| {
        fields.retain(|(kk, _)| kk != k);
        fields.push((k.to_string(), v));
    };
    set(&mut fields, "target", target.clone());
    set(&mut fields, "params", params);
    if let Some(t) = trigger_target_id(&obj(vec![("target", target.clone())])) {
        set(&mut fields, "targetId", jstr(&t));
    }
    if let Some(k) = get_str(&target, "kind") {
        set(&mut fields, "targetKind", jstr(k));
    }
    if let Some(b) = get_str(actor, "beingId").filter(|s| !s.is_empty()) {
        set(&mut fields, "caller", jstr(b));
    }
    set(&mut fields, "branch", jstr(history));
    Json::Obj(fields)
}

/// op_word_via_fold — the FOLD-BACKED op-word resolver. THE keystone of the chain-as-vocabulary build:
/// a word resolves from the CHAIN FOLD of declare-word facts (treewordfold::resolve_word), NOT a
/// hardcoded code table. Replaces the old `fold_op_word` match (set-being / set-space / end-space /
/// set-matter — the only 4) with the genuine fold: ANY word the chain declares as `kind:"op"` resolves,
/// nothing is hard-declared in code.
///
/// The split (doctrine: the word-fold is STORE logic, the file path is the bottom turtle):
///   1. resolve the word's DESCRIPTOR from the chain word-fold (treewordfold). Not declared, disabled,
///      or not a `kind:"op"` word -> None (the act runs inline, the existing path).
///   2. it IS a declared op word -> ask the HOST `file_of(op)` for its `.word` BODY off disk (the
///      bottom-turtle code-matter lookup the binary owns; for a seed op, the bundled `.word`). None
///      from the host (no co-located body found) -> None, the act runs inline.
///
/// The descriptor itself (noun, idFrom, factAction, able) rides the fold — it is the SAME data the JS
/// `binding.word` carried — so the run/seal of the op's `.word` is driven by what the chain declared,
/// never a code constant. Generic over whatever I has read in: a word declared LATER (by I reading the
/// genesis book) resolves the moment its coin fact lands, with no code change.
pub fn op_word_via_fold(
    dir: &Path,
    history: &str,
    actor_being: &str,
    op: &str,
    file_of: impl Fn(&str, Option<&str>) -> Option<String>,
) -> Option<String> {
    // THE RESOLVE SEAM (lineage vocabulary): a being resolves words against its OWN mother-lineage
    // vocabulary — the UNION fold of Am (the root base) up through every mother to the actor. So a word
    // coined on an ancestor's reel resolves for a descendant (inherited through the fold), Am's genesis
    // base is universal, and a NON-descendant does NOT see a being's private coins. The empty actor
    // falls back to Am's base fold (the genesis reader / the pre-being bootstrap, which resolves the
    // universal vocabulary before a being-tree exists).
    let desc = if actor_being.is_empty() {
        treewordfold::resolve_word(dir, history, op)?
    } else {
        treewordfold::resolve_lineage_word(dir, history, actor_being, op)?
    };
    if !desc.is_op() {
        return None; // declared, but not an op word (a concept / type / reducer / …) — run inline
    }
    // the chain says "op"; the host resolves its `.word` code-matter off disk, keyed by the op name +
    // the NOUN the fold declared (which names the materials subfolder — being / space / matter).
    file_of(op, desc.noun.as_deref())
}

/// op_word_file — the HOST file-path map: a seed op's name -> its co-located `.word` source off disk.
/// This is the BOTTOM TURTLE (the JS `registerAbleWord(able, op, URL)` host registration), NOT the
/// vocabulary: the vocabulary is the fold; this only maps a known seed op to the bundled body file. It
/// searches the two seed roots the JS registers from — `materials/<kind>/<op>.word` (the set/end family)
/// and the carved-out `store/words/<folder>/<op>.word` (make/make/owner/…). The op's
/// NOUN (from the fold descriptor) names the materials subfolder; the store/words layout is folder-per-op
/// so the op name is tried as `<op>/<op>.word`. (The `create.word` alias probe died with the M1C
/// rename — every op file's stem IS the op name now.)
pub fn op_word_file(op: &str, noun: Option<&str>, materials_dir: &Path, store_words_dir: &Path) -> Option<String> {
    // 1) materials/<noun>/<op>.word (set-being -> being/set-being, set-space/end-space -> space/…).
    if let Some(kind) = noun {
        let p = materials_dir.join(kind).join(format!("{op}.word"));
        if let Ok(s) = std::fs::read_to_string(&p) {
            return Some(s);
        }
    }
    // 2) store/words/<op>/<op>.word (the carved-out word-sole ops).
    let rel = store_words_dir.join(op).join(format!("{op}.word"));
    if let Ok(s) = std::fs::read_to_string(&rel) {
        return Some(s);
    }
    // 2b) the noun bundles in FIXED order — space first, so a noun-less `make` lands on the SPACE
    //     body deterministically (mirrors treeseed::word_path's preference; the M1C generic-make:
    //     one coin, a floor body per noun, transitional until the frames speak the made noun).
    for n in ["space", "being", "matter"] {
        let p = store_words_dir.join(n).join(format!("{op}.word"));
        if let Ok(s) = std::fs::read_to_string(&p) {
            return Some(s);
        }
    }
    // 3) the carved-out ops live under a FEATURE folder keyed by their able / extension (owner/set-owner,
    //    credential/credential-read, llm-assigner/set-story-llm, …) — the folder is the JS
    //    registerAbleWord URL, NOT derivable from the op name. So the host DISCOVERS the body by a bounded
    //    walk of its bundled words dir for `<op>.word`. This is the bottom turtle (the host's own disk
    //    layout), not the vocabulary — the vocabulary already said "op" from the fold.
    find_word_file(store_words_dir, op, 3)
}

/// Bounded recursive search for `<op>.word` under `dir` (the host's bundled word tree). Depth-capped so
/// a deep tree can't run away. The first match wins (the seed layout is one file per op name).
fn find_word_file(dir: &Path, op: &str, depth: usize) -> Option<String> {
    let target = format!("{op}.word");
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            subdirs.push(p);
        } else if p.file_name().and_then(|n| n.to_str()) == Some(target.as_str()) {
            if let Ok(s) = std::fs::read_to_string(&p) {
                return Some(s);
            }
        }
    }
    if depth == 0 {
        return None;
    }
    for sd in subdirs {
        if let Some(s) = find_word_file(&sd, op, depth - 1) {
            return Some(s);
        }
    }
    None
}

/// `act_via_fold` — the act entry that resolves each op word's body FROM the chain word-fold (the
/// keystone wiring). A thin wrapper over `act_inner` (THE ONE PATH) with the `op_word_of` closure built
/// by `op_word_via_fold`: the word-fold (treewordfold, reading the declare-word facts off `dir`/`history`)
/// decides whether an act-node names a declared op word, and the host `file_of` loads that op's `.word`
/// off disk. So the runner consults the FOLD, never a hardcoded op list. `file_of` is the binary's
/// seed-`.word` path map (op_word_file); the binds are empty; everything else (authorize, seal, sign) is
/// unchanged.
#[allow(clippy::too_many_arguments)]
pub fn act_via_fold(
    word: &str,
    actor: &Json,
    dir: &Path,
    history: &str,
    able_spec_of: impl Fn(&str) -> Option<Json>,
    file_of: impl Fn(&str, Option<&str>) -> Option<String>,
    basis: Option<f64>,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Vec<Outcome> {
    // the actor's being — the lineage the op-word fold resolves against (its mother-lineage vocabulary).
    let actor_being = get_str(actor, "beingId").unwrap_or("").to_string();
    act_inner(
        word,
        actor,
        dir,
        history,
        able_spec_of,
        |op| op_word_via_fold(dir, history, &actor_being, op, &file_of),
        &obj(vec![]),
        basis,
        sign,
    )
}

/// `act_via_fold` with INITIAL ctx bindings - the genesis world-anchor seam. A thin wrapper over
/// `act_inner` (THE ONE PATH) with the fold-backed `op_word_of` AND the caller's `binds`: the genesis
/// reader threads the `$root` / `$heaven` / `$cherub` … anchors it has already created so a creation
/// Word's parent/target/grant refs resolve to the live ids. The empty-binds case IS `act_via_fold`
/// (byte-identical for every existing caller).
#[allow(clippy::too_many_arguments)]
pub fn act_via_fold_bound(
    word: &str,
    actor: &Json,
    dir: &Path,
    history: &str,
    able_spec_of: impl Fn(&str) -> Option<Json>,
    file_of: impl Fn(&str, Option<&str>) -> Option<String>,
    binds: &Json,
    basis: Option<f64>,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Vec<Outcome> {
    // the actor's being — the lineage the op-word fold resolves against (its mother-lineage vocabulary).
    let actor_being = get_str(actor, "beingId").unwrap_or("").to_string();
    act_inner(
        word,
        actor,
        dir,
        history,
        able_spec_of,
        |op| op_word_via_fold(dir, history, &actor_being, op, &file_of),
        binds,
        basis,
        sign,
    )
}

/// AUTHORIZE + SEAL each reel-targeting spec a body produced (the stamping half of `act`, factored so
/// the materials-`.word` entry `run_op_word` shares the EXACT authorize + moment-seal path). A
/// state-only spec (no reel target) is skipped; an unauthorized one is `Denied`; the rest seal as a
/// moment (`seal_one`). Byte-identical to the loop `act` ran inline before this extraction.
fn seal_specs(
    specs: &[Json],
    actor: &Json,
    dir: &Path,
    history: &str,
    able_spec_of: impl Fn(&str) -> Option<Json>,
    basis: Option<f64>,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Vec<Outcome> {
    let mut out = Vec::new();
    for spec in specs {
        // "I" = the acting Name's facet: a Name's be:birth makes its OWN being (by/trueName/through = it).
        let mut spec = facet_resolve(spec, actor);
        // any un-placed being/space gets a derived-random coord + default parent (never hardcoded).
        spec = with_default_placement(&spec, actor);
        let (k, i) = match get(&spec, "of") {
            Some(o) => (
                get_str(o, "kind").unwrap_or("being").to_string(),
                get_str(o, "id").unwrap_or("").to_string(),
            ),
            None => ("being".to_string(), String::new()),
        };
        if i.is_empty() {
            continue; // a state-only act (no reel target) - its `sets` already threaded
        }
        // CREATE-OR-CONNECT ("I am Tabor" doctrine): a Name saying `I am X` births X if new, else just
        // SWITCHES to the being it already has under that name on this history — a `be:connect`, not a
        // re-birth (the id is per-Name deterministic, so the existing reel IS this Name's own X).
        if actor_name_facet(actor).is_some()
            && get_str(&spec, "verb") == Some("be")
            && get_str(&spec, "act") == Some("birth")
            && !read_reel_file(dir, history, "being", &i, None, None).is_empty()
        {
            spec = set_field(&spec, "act", jstr("connect"));
        }
        let verb = get_str(&spec, "verb").unwrap_or("");
        let op = get_str(&spec, "act");
        let audit_being = if k == "being" { Some(i.as_str()) } else { None }; // being target -> inheritation axis
        // A Name birthing OR connecting its OWN being is inherently authorized — it is the I of its beings,
        // exactly as the genesis I births "Am". facet_resolve forced trueName = the Name (and the id is
        // per-Name), so the being is provably its own; no grant needed. Every OTHER act runs the able-walk.
        let name_self_be = verb == "be" && matches!(op, Some("birth") | Some("connect")) && actor_name_facet(actor).is_some();
        // A being moving its OWN body (do:move whose target is the actor's own being) is inherently
        // allowed — you control where you stand; no grant needed. move.word set the target to $caller.
        let own_body = get_str(actor, "beingId").map_or(false, |b| !b.is_empty() && b != I_AM && b == i);
        let self_move = verb == "do" && op == Some("move") && own_body;
        // renaming YOUR OWN being (My name is X) is inherently allowed — you name yourself.
        let self_rename = verb == "do"
            && op == Some("set-being")
            && own_body
            && get(&spec, "params").and_then(|p| get_str(p, "field")) == Some("name");
        if !name_self_be && !self_move && !self_rename && !ok_true(&authorize(verb, op, Some(&i), audit_being, actor, dir, history, &able_spec_of)) {
            out.push(Outcome::Denied(format!("not authorized: {verb}:{}", op.unwrap_or(""))));
            continue;
        }
        match seal_one(dir, history, &k, &i, &spec, basis, sign) {
            Some(fact) => out.push(Outcome::Authorized(fact)),
            None => out.push(Outcome::Denied(format!("seal failed: {verb}:{}", op.unwrap_or("")))),
        }
    }
    out
}

/// runOpWord (do.js) in Rust - the materials-`.word` entry. A WORD-SOLE op (`set-being` / `set-space` /
/// `make` / `set-matter` / `make` / `end-space`) runs its co-located `.word` THROUGH
/// this: seed the STANDARD trigger bindings (`target` / `field` / `value` / `merge` / `branch` / the
/// extracted `caller` / `targetId`), parse + run the body with the host see-op seam wired (so the
/// body's `see resolve-X` reaches treehost), and AUTHORIZE + SEAL the do-fact the `Return` terminator
/// synthesized - the SAME authorize + moment-seal `act` uses. A host refusal (the `.word`'s refusal) is
/// surfaced as a single `Outcome::Denied`, carrying the host throw's reason. `trigger` is the op's
/// resolved params (`{ target, field, value, merge, branch, ... }`), exactly as the dispatcher passed.
pub fn run_op_word(
    word: &str,
    actor: &Json,
    trigger: &Json,
    dir: &Path,
    history: &str,
    able_spec_of: impl Fn(&str) -> Option<Json>,
    basis: Option<f64>,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Vec<Outcome> {
    let auth = match get_str(actor, "beingId") {
        Some(b) if b == I_AM => treeseed::AuthCtx::i_am(),
        Some(b) if !b.is_empty() => treeseed::AuthCtx::caller(b),
        _ => treeseed::AuthCtx::default(),
    };
    let resolver = treeseed::Resolvers;
    let see_op = |op: &str, args: &[Json]| -> Result<Json, HostError> {
        treeseed::HostResolver::resolve(&resolver, op, args, dir, history, &auth)
    };
    let specs = match run_op_body(word, actor, trigger, history, &see_op) {
        Ok(specs) => specs,
        Err(host_err) => return vec![Outcome::Denied(host_err.to_string())],
    };
    let basis = basis.or_else(|| Some(read_ord(dir)));
    seal_specs(&specs, actor, dir, history, &able_spec_of, basis, sign)
}

/// The SHARED op-`.word` runner (the trigger->specs core both `run_op_word` and `act_inner` call).
/// Seed the trigger as ctx.bindings (so the body's `see resolve-X($target, ...)` resolves them), plus
/// the extracted `caller` (the actor's beingId) + `branch` + `targetId` the standard trigger carries,
/// then parse + run the op's `.word` body through the host see-op seam. Returns the produced fact specs
/// (the `Return` terminator's do-fact), or the host throw (the `.word`'s refusal). NO authorize/seal —
/// the caller seals via `seal_specs` (the ONE moment-seal path). The `see_op` seam is passed in so the
/// caller controls the resolver + AuthCtx (it has the same `auth` already built).
fn run_op_body(
    word: &str,
    actor: &Json,
    trigger: &Json,
    history: &str,
    see_op: &dyn Fn(&str, &[Json]) -> Result<Json, HostError>,
) -> Result<Vec<Json>, HostError> {
    // The base op-body run: NO nested composite-by-reference expansion (a deed inside this `.word`
    // rasterizes inline). `run_op_body_expand` below threads the `expand_op` seam for the recursive case.
    let no_expand = |_: &Json, _: &mut Json| None;
    run_op_body_expand(word, actor, trigger, history, see_op, &no_expand)
}

/// `run_op_body` PLUS the composite-by-reference seam threaded: an op-word's `.word` whose body holds a
/// deed naming ANOTHER op-word (set-owner.word's `do set-space`) expands that deed recursively. Seeds
/// the standard trigger bindings exactly as `run_op_body` does, then runs the body through
/// `run_body_expand` carrying `expand_op` — so a nested op-deed re-reads its own `.word` and re-facts it
/// (its own moment), all the way down.
fn run_op_body_expand(
    word: &str,
    actor: &Json,
    trigger: &Json,
    history: &str,
    see_op: &dyn Fn(&str, &[Json]) -> Result<Json, HostError>,
    expand_op: &ExpandOp,
) -> Result<Vec<Json>, HostError> {
    let mut bindings = match trigger {
        Json::Obj(e) => e.clone(),
        _ => Vec::new(),
    };
    if !bindings.iter().any(|(k, _)| k == "caller") {
        if let Some(b) = get_str(actor, "beingId").filter(|s| !s.is_empty()) {
            bindings.push(("caller".to_string(), jstr(b)));
        }
    }
    if !bindings.iter().any(|(k, _)| k == "branch") {
        bindings.push(("branch".to_string(), jstr(history)));
    }
    if !bindings.iter().any(|(k, _)| k == "targetId") {
        if let Some(t) = trigger_target_id(trigger) {
            bindings.push(("targetId".to_string(), jstr(&t)));
        }
    }
    let mut ctx = obj(vec![
        ("identity", actor.clone()),
        ("bindings", Json::Obj(bindings)),
        ("state", obj(vec![])),
        ("beings", obj(vec![])),
    ]);
    let nodes = treeword::parse(word);
    let fail_closed = |_: &str, _: &[Json]| false;
    run_body_expand(&nodes, &mut ctx, &fail_closed, see_op, expand_op)
}

/// The composite-by-reference EXPANDER (one deed). If `node` is a `do` act naming a declared op-word
/// (resolved by `op_word_of`), run that word's `.word` body with the deed-derived trigger and return
/// its produced fact specs — recursively, so a nested op-deed expands the same way (the `expand_op`
/// closure it threads calls back into THIS function). `None` when the deed is not an op-word (it
/// rasterizes inline). This is the SAME expansion the top-level `act_inner` loop does, now reachable
/// from inside any body (a flow-wrapped deed, a deed inside another op's `.word`).
fn expand_one(
    node: &Json,
    ctx: &Json,
    actor: &Json,
    history: &str,
    op_word_of: &dyn Fn(&str) -> Option<String>,
    see_op: &dyn Fn(&str, &[Json]) -> Result<Json, HostError>,
) -> Option<Result<Vec<Json>, HostError>> {
    if get_str(node, "kind") != Some("act") || get_str(node, "verb") != Some("do") {
        return None;
    }
    // THE BEING STEP: `do move` carrying a `direction` (the WASD/compass step) is the actor's own walk.
    // Produce the do:move DIRECTLY on the actor's being — its coord is the FOLD of these steps (the
    // position reducer shifts by the direction's cell). No op-word needed; the direction is already
    // validated by the parser, and there is no bounds gate for a being step (resolve_move_being doesn't
    // impose one). This is the reliable path the move.word's matter+being composite couldn't produce.
    if get_str(node, "act") == Some("move") {
        if let Some(dir) = get(node, "params").and_then(|p| get_str(p, "direction")) {
            if let Some(being) = get_str(actor, "beingId").filter(|b| !b.is_empty() && *b != I_AM) {
                let spec = obj(vec![
                    ("kind", jstr("act")),
                    ("verb", jstr("do")),
                    ("act", jstr("move")),
                    ("of", obj(vec![("kind", jstr("being")), ("id", jstr(being))])),
                    ("params", obj(vec![("direction", jstr(dir))])),
                ]);
                return Some(Ok(vec![spec]));
            }
        }
    }
    // SELF RENAME: `do set-being` on the `name` field with no target is "My name is X" — the actor
    // renaming its OWN being. Set it directly on $caller's being (the fold sets `name`). Only `name` is
    // short-circuited here — a targeted set-being on someone else still goes through the op-word + auth.
    if get_str(node, "act") == Some("set-being")
        && get(node, "of").is_none()
        && get(node, "params").and_then(|p| get_str(p, "field")) == Some("name")
    {
        if let Some(being) = get_str(actor, "beingId").filter(|b| !b.is_empty() && *b != I_AM) {
            let params = get(node, "params").cloned().unwrap_or_else(|| obj(vec![]));
            let spec = obj(vec![
                ("kind", jstr("act")),
                ("verb", jstr("do")),
                ("act", jstr("set-being")),
                ("of", obj(vec![("kind", jstr("being")), ("id", jstr(being))])),
                ("params", params),
            ]);
            return Some(Ok(vec![spec]));
        }
    }
    let body = get_str(node, "act").and_then(op_word_of)?;
    let trigger = derive_trigger(node, ctx, actor, history);
    // recurse: a deed inside THIS op's `.word` that names yet another op-word expands the same way.
    let nested = move |n: &Json, c: &mut Json| expand_one(n, c, actor, history, op_word_of, see_op);
    Some(run_op_body_expand(&body, actor, &trigger, history, see_op, &nested))
}

/// targetIdOf for the trigger seed: a `{kind,id}` target -> its id; a bare id string -> itself.
fn trigger_target_id(trigger: &Json) -> Option<String> {
    match get(trigger, "target") {
        Some(Json::Str(s)) => Some(s.clone()),
        Some(t @ Json::Obj(_)) => get_str(t, "id").map(|s| s.to_string()),
        _ => None,
    }
}

fn json_str(v: &Json) -> String {
    match v {
        Json::Null => String::new(),
        Json::Str(s) => s.clone(),
        Json::Bool(b) => b.to_string(),
        Json::Num(n) => format!("{n}"),
        _ => String::new(),
    }
}
/// resolveOperand for the for-each collection / match subject: {ref}/$-string -> get_path, else literal.
fn resolve_operand(v: &Json, ctx: &Json) -> Json {
    if let Some(r) = get_str(v, "ref") {
        return treeval::get_path(r, ctx).unwrap_or(Json::Null);
    }
    if let Json::Str(s) = v {
        if let Some(rest) = s.strip_prefix('$') {
            return treeval::get_path(rest, ctx).unwrap_or(Json::Null);
        }
    }
    v.clone()
}
/// Set ctx.<dim>.<k> = v (dim = "bindings" or "state"), creating the dim object if absent.
fn set_nested(ctx: &mut Json, dim: &str, k: &str, v: Json) {
    if let Json::Obj(fields) = ctx {
        if !fields.iter().any(|(kk, _)| kk == dim) {
            fields.push((dim.to_string(), Json::Obj(Vec::new())));
        }
        for (kk, sub) in fields.iter_mut() {
            if kk == dim {
                if let Json::Obj(s) = sub {
                    s.retain(|(sk, _)| sk != k);
                    s.push((k.to_string(), v));
                }
                return;
            }
        }
    }
}
/// Apply an act's `sets` (its world-state effect) to ctx.state, so a later cond sees it.
fn apply_sets(ctx: &mut Json, node: &Json) {
    if let Some(Json::Obj(sets)) = get(node, "sets") {
        for (k, v) in sets.clone() {
            set_nested(ctx, "state", &k, v);
        }
    }
}

/// The FLOW eval driver: walk a flow body, executing control flow against the threaded ctx, and
/// return the flat sequence of RESOLVED fact specs (rasterize_emit per act). Handles act / if /
/// while / for-each / match; threads bindings (for-each item + an act's `as`) and state (an act's
/// `sets`, so loops terminate and chained conds see prior effects). `host` resolves domain predicates.
///
/// This is the PURE-WORD surface (no host see-op): it fails the `see resolve-X` floor CLOSED (a
/// materials `.word` that reaches a host see-op needs `run_body_host`, which threads the resolver
/// seam). Existing callers keep this exact signature; `act` calls the threaded form below.
///
/// ONE LOOP: there is a SINGLE real body loop, `run_body_expand`. This `run_body` is a thin NO-EXPAND,
/// NO-RESOLVER wrapper over it (a see-floor that refuses + a no-op `expand_op`), so its behavior is
/// byte-identical to the JS host-less default while sharing the one loop.
///
/// (NOTE per the act/fact doctrine: stamping these specs is fact-only today - the act-log/moment-seal
/// is the doctrine-correct write, tracked separately.)
pub fn run_body(body: &[Json], ctx: &mut Json, host: &dyn Fn(&str, &[Json]) -> bool) -> Vec<Json> {
    // No resolver wired - the `see resolve-X` floor fails CLOSED (the JS host-less default). A pure
    // control-flow Word never reaches a `see` node, so this only refuses an actual host see-op, which
    // surfaces as the SAME empty-effects no-op the unwired floor always produced. No composite expansion
    // (a no-op `expand_op`): the pure-word floor rasterizes every deed inline.
    let see_floor = |op: &str, _args: &[Json]| {
        Err(HostError::invalid(format!(
            "host see-op \"{op}\" reached run_body with no resolver wired (use act / run_body_host)"
        )))
    };
    let no_expand = |_: &Json, _: &mut Json| None;
    run_body_expand(body, ctx, host, &see_floor, &no_expand).unwrap_or_default()
}

/// The FLOW eval driver WITH the host see-op seam threaded - the materials-`.word` end-to-end form.
/// Identical to `run_body` for every existing arm (act / if / while / for-each / match / flow), PLUS:
///   - `see`    - a `see resolve-X(args) as bind` node: resolve the positional `args` against ctx,
///     call the injected `see_op` (which drives treehost's `HostResolver` against the on-disk store),
///     and BIND the returned block under `bind` (so the `.word`'s `$spec.factParams` reaches the
///     stamped fact through the `return` arm + the existing act path). A resolver refusal (the JS host
///     THROW) is the `.word`'s REFUSAL - it short-circuits the body and propagates as `Err(HostError)`.
///   - `return` - the materials `.word`'s success terminator (`Return spaceId: $spec.spaceId,
///     factParams: $spec.factParams.`): mirror do.js `stampsWordFact` + `idFrom`. Read `extra`
///     (resolving each `{ref}` against ctx), then synthesize the ONE caller-attributed do-fact spec
///     the dispatcher would have stamped - `{ verb:"do", act:<fact op>, of:{kind,id}, params, by,
///     through }` - and emit it. The fact TARGET is an explicit `factTarget {kind,id}` if present
///     (end-space), else the id-key (`beingId`/`spaceId`/`matterId`) names the id + the kind; the
///     params are `factParams` (absent for end-space - the reducer derives the whole fold). The fact
///     op + `by`/`through` ride on the ctx (`__factOp` set by the `see` arm; `identity` the actor).
///
/// The return widens to carry the refusal: `Ok(specs)` is the emitted facts, `Err` is the host throw
/// (the `.word`'s refusal), which `act` maps to `Outcome::Denied` - the SAME shape an unauthorized act
/// produces.
pub fn run_body_host(
    body: &[Json],
    ctx: &mut Json,
    host: &dyn Fn(&str, &[Json]) -> bool,
    see_op: &dyn Fn(&str, &[Json]) -> Result<Json, HostError>,
) -> Result<Vec<Json>, HostError> {
    // The base form: NO composite-by-reference expansion (an op-deed inside the body rasterizes inline,
    // as it always did). The expanding form `run_body_expand` threads the `expand_op` seam below; this
    // keeps `run_body_host`'s signature + behavior byte-identical for its direct callers (the host-seam
    // test, the pure-word `run_body` floor).
    let no_expand = |_: &Json, _: &mut Json| None;
    run_body_expand(body, ctx, host, see_op, &no_expand)
}

/// The expanding-body type: given an act node + the threaded ctx, EITHER recognize it as an op-word
/// deed and run that word's `.word` (returning its produced fact specs — `Some(Ok(specs))`, the
/// composite-by-reference expansion, N facts), OR surface the nested word's refusal (`Some(Err(e))`),
/// OR decline (`None` — not an op-word deed, the body rasterizes it inline as before).
type ExpandOp<'a> = dyn Fn(&Json, &mut Json) -> Option<Result<Vec<Json>, HostError>> + 'a;

/// `run_body_host` PLUS the composite-by-reference seam: an `act` node naming a declared op-word is
/// EXPANDED (its `.word` re-read + re-facted, recursively) instead of rasterized inline. This is the
/// N-MOMENTS recursion — a composite body of N deeds runs each deed as its own act→fact, and a deed
/// that is itself a composite (a `do set-space` inside set-owner.word) expands the SAME way, all the
/// way down. The produced specs are flattened in source order; `seal_specs` then opens one moment per
/// spec (each its own chain link). `expand_op` declines (`None`) for a non-op deed (grant-able, a plain
/// field set), which falls through to the unchanged inline rasterize.
fn run_body_expand(
    body: &[Json],
    ctx: &mut Json,
    host: &dyn Fn(&str, &[Json]) -> bool,
    see_op: &dyn Fn(&str, &[Json]) -> Result<Json, HostError>,
    expand_op: &ExpandOp,
) -> Result<Vec<Json>, HostError> {
    let mut out = Vec::new();
    for node in body {
        match get_str(node, "kind") {
            Some("act") => {
                // COMPOSITE-BY-REFERENCE: if this deed names a declared op-word, run its `.word` (each
                // deed its own fact, recursively) instead of rasterizing it inline. `None` = not an op
                // deed -> the inline path below (grant-able, a plain field set).
                if let Some(result) = expand_op(node, ctx) {
                    out.extend(result?); // the nested word's refusal short-circuits the body
                    continue;
                }
                let spec = treeval::rasterize_emit(node, ctx, None);
                if let Some(b) = get_str(node, "bind") {
                    if let Some(id) = get(&spec, "of").and_then(|o| get_str(o, "id")) {
                        set_nested(ctx, "bindings", b, jstr(id));
                    }
                }
                apply_sets(ctx, node);
                out.push(spec);
            }
            // see resolve-X(args) as bind - the host SEE-OP (treehost). Resolve args against ctx (the
            // JS dispatcher passes RESOLVED values, not refs - reuse the same resolve_value the `act`
            // arm leans on), call the resolver, and bind the returned BLOCK under `bind`. A refusal
            // (HostError) is the `.word`'s refusal - propagate it (short-circuits the body).
            Some("see") => {
                let op = get_str(node, "act").unwrap_or("");
                let args: Vec<Json> = match get(node, "args") {
                    Some(Json::Arr(a)) => a.iter().map(|x| treeval::resolve_value(x, ctx)).collect(),
                    _ => vec![],
                };
                let block = see_op(op, &args)?; // Err = the .word's refusal, surfaced
                if let Some(b) = get_str(node, "bind") {
                    set_nested(ctx, "bindings", b, block);
                }
                // record the fact op + noun this see-op feeds, so the `return` arm builds the right
                // do-fact (the JS op.word.{noun,idFrom} declaration, recovered from the see-op name).
                if let Some((fact_op, noun)) = fact_binding_of(op) {
                    set_nested(ctx, "bindings", "__factOp", jstr(fact_op));
                    set_nested(ctx, "bindings", "__factNoun", jstr(noun));
                }
            }
            // Return <items>. - the materials `.word`'s success terminator. Mirror stampsWordFact +
            // idFrom: synthesize the ONE do-fact the dispatcher stamps from the returned block.
            Some("return") => {
                if let Some(spec) = build_return_fact(node, ctx) {
                    out.push(spec);
                }
            }
            Some("if") => {
                let holds = get(node, "cond").is_some_and(|c| treeval::cond::resolve_cond(c, ctx, host));
                let branch = if holds { get(node, "then") } else { get(node, "else") };
                if let Some(Json::Arr(b)) = branch.cloned() {
                    out.extend(run_body_expand(&b, ctx, host, see_op, expand_op)?);
                }
            }
            Some("while") => {
                let mut guard = 0;
                loop {
                    let holds = get(node, "cond").is_some_and(|c| treeval::cond::resolve_cond(c, ctx, host));
                    if !holds || guard >= 100_000 {
                        break;
                    }
                    if let Some(Json::Arr(b)) = get(node, "body").cloned() {
                        out.extend(run_body_expand(&b, ctx, host, see_op, expand_op)?);
                    }
                    guard += 1;
                }
            }
            Some("foreach") => {
                let coll = get(node, "in").map(|i| resolve_operand(i, ctx)).unwrap_or(Json::Null);
                if let (Json::Arr(items), Some(bind), Some(Json::Arr(b))) =
                    (coll, get_str(node, "bind"), get(node, "body").cloned())
                {
                    let bind = bind.to_string();
                    for item in items {
                        set_nested(ctx, "bindings", &bind, item);
                        out.extend(run_body_expand(&b, ctx, host, see_op, expand_op)?);
                    }
                }
            }
            Some("match") => {
                let subj = get_str(node, "on").and_then(|p| treeval::get_path(p, ctx)).map(|v| json_str(&v)).unwrap_or_default();
                if let Some(Json::Arr(cases)) = get(node, "cases") {
                    let chosen = cases
                        .iter()
                        .find(|c| get_str(c, "label") == Some(subj.as_str()))
                        .or_else(|| cases.iter().find(|c| get(c, "label").is_none()));
                    if let Some(Json::Arr(b)) = chosen.and_then(|c| get(c, "body")).cloned() {
                        out.extend(run_body_expand(&b, ctx, host, see_op, expand_op)?);
                    }
                }
            }
            Some("flow") => {
                // a flow node - run its effects (the When-trigger gating is a scheduler concern)
                if let Some(Json::Arr(e)) = get(node, "effects").cloned() {
                    out.extend(run_body_expand(&e, ctx, host, see_op, expand_op)?);
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

/// The see-op name -> (fact op, fact noun) declaration the JS carried as `op.word.{noun,idFrom}`,
/// recovered from the resolve-X name. The materials `.word` runs through `act(word)` with NO op
/// declaration around it, so the `return` arm reconstructs the fact's op + target kind from the
/// see-op the body resolved. The id field (`idFrom`) is the noun's id-key (`<noun>Id`), read off the
/// returned block in the `return` arm. None = not a known materials see-op (no synthesized fact).
fn fact_binding_of(see_op: &str) -> Option<(&'static str, &'static str)> {
    match see_op {
        "resolve-set-being-spec" => Some(("set-being", "being")),
        "resolve-set-space-spec" => Some(("set-space", "space")),
        "resolve-set-matter-spec" => Some(("set-matter", "matter")),
        "resolve-birth-space" => Some(("make", "space")),
        "resolve-birth-spec" => Some(("make", "matter")),
        "resolve-end-space-spec" => Some(("end-space", "space")),
        // move (being step): the do:move on the walker's being reel (move.word direction mode). The
        // Return names an explicit factTarget { kind:"being", id }, so the noun here is advisory.
        "resolve-move-being" => Some(("move", "being")),
        // LLM connection update/delete: the `.word` has NO explicit `do` deed - its `Return beingId:...,
        // factParams: $patch.setBeingParams` IS the fact terminator (the dispatcher lays the one
        // do:set-being on the caller's being from the returned block). add-llm-connection / assign-llm-
        // slot / set-*-llm carry explicit `do` deeds instead, so they need no entry here.
        "resolve-connection-update" | "resolve-connection-removal" => Some(("set-being", "being")),
        _ => None,
    }
}

/// Build the ONE do-fact a materials `.word`'s `Return` terminator yields - the Rust twin of do.js
/// `runOpWord` -> `stampsWordFact(result, noun, idFrom)`. The parsed `return` node carries `extra`
/// (`{ beingId:{ref:"spec.beingId"}, factParams:{ref:"spec.factParams"} }` and friends); resolve each
/// `{ref}` against ctx, then:
///   - the fact TARGET is an explicit `factTarget {kind,id}` (end-space) if present; else the id-key
///     named by `idFrom` (`<noun>Id`) gives the id, and the noun gives the kind;
///   - the params are `factParams` when the word authored them (absent for end-space - the reducer
///     derives the whole fold from the act + through);
///   - the op + by/through come from the ctx (`__factOp` the `see` arm recorded, `identity` the actor).
/// None when there's no `extra` / no resolvable target (a bare `Return value.` with no fact, which the
/// pure-word path leaves as a no-op exactly as before).
fn build_return_fact(node: &Json, ctx: &Json) -> Option<Json> {
    let extra = get(node, "extra")?;
    // the fact op + noun the `see` arm recorded (the JS op.word declaration). Without it, this Return
    // is not a materials-fact terminator - leave it a no-op (the pure-word path).
    let bindings = get(ctx, "bindings");
    let fact_op = bindings.and_then(|b| get_str(b, "__factOp"))?.to_string();
    let noun = bindings.and_then(|b| get_str(b, "__factNoun")).unwrap_or("being").to_string();

    // Resolve every `extra` value (`{ref}`/literal) against ctx - the returned block's fields.
    let resolved_extra = treeval::resolve_value(extra, ctx);

    // The fact TARGET: an explicit { kind, id } factTarget wins (end-space); else `<noun>Id` is the id
    // and the noun is the kind (stampsWordFact's idFrom path).
    let (kind, id) = match get(&resolved_extra, "factTarget") {
        Some(ft) if get(ft, "id").is_some() => (
            get_str(ft, "kind").unwrap_or(&noun).to_string(),
            json_str(get(ft, "id").unwrap_or(&Json::Null)),
        ),
        _ => {
            let id_key = format!("{noun}Id");
            let id = get(&resolved_extra, &id_key).map(json_str).unwrap_or_default();
            (noun.clone(), id)
        }
    };
    if id.is_empty() {
        return None; // no resolvable target - no fact
    }

    // by/through = the actor (the materials `.word` runs AS the caller; the fact is caller-attributed).
    let identity = get(ctx, "identity");
    let by = match identity.and_then(|i| get_str(i, "nameId")).filter(|s| !s.is_empty()) {
        Some(n) => n.to_string(),
        None => identity.and_then(|i| get_str(i, "beingId")).unwrap_or(I_AM).to_string(),
    };
    let through = identity
        .and_then(|i| get_str(i, "beingId"))
        .filter(|s| !s.is_empty())
        .map(jstr)
        .unwrap_or_else(|| jstr(&by));

    // the fact params: factParams when the word authored them (absent for end-space).
    let params = match get(&resolved_extra, "factParams") {
        Some(p) if !matches!(p, Json::Null) => p.clone(),
        _ => obj(vec![]),
    };

    Some(obj(vec![
        ("verb", jstr("do")),
        ("act", jstr(&fact_op)),
        ("through", through),
        ("by", jstr(&by)),
        ("of", obj(vec![("kind", jstr(&kind)), ("id", jstr(&id))])),
        ("params", params),
    ]))
}

/// The MOMENT primitive — a being perceives (left stance): authorize the see, then read + verify +
/// fold the target. Returns {ok, kind, id, ord, verify, state} or {ok:false, reason}. `ord` is the
/// world's "now" at perception (the global ord) — the being carries it as the `basis` of any act it
/// then speaks, so the gap reads as causal staleness. (A future live loop re-perceives for a fresh ord.)
pub fn moment(
    reader: &Json,
    kind: &str,
    id: &str,
    dir: &Path,
    history: &str,
    able_spec_of: impl Fn(&str) -> Option<Json>,
) -> Json {
    let verdict = authorize("see", Some("place"), Some(id), None, reader, dir, history, able_spec_of);
    if !ok_true(&verdict) {
        return obj(vec![
            ("ok", Json::Bool(false)),
            ("reason", get(&verdict, "reason").cloned().unwrap_or(Json::Null)),
        ]);
    }
    let facts = read_reel_file(dir, history, kind, id, None, None);
    let verify = verify_fact_chain(&facts);
    let state = treefold::fold(kind, &facts);
    obj(vec![
        ("ok", Json::Bool(true)),
        ("kind", jstr(kind)),
        ("id", jstr(id)),
        ("ord", Json::Num(read_ord(dir))), // the world's now at perception → the act's basis
        ("verify", verify),
        ("state", state),
    ])
}
