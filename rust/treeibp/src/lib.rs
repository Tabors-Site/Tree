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

use std::path::Path;
use std::sync::Mutex;
use treehash::Json;
use treestore::{
    commit_moment, commit_moment_signed, next_ord, read_ord, read_reel_file, verify_fact_chain,
};
use treeval::able::{able_walk, Grant, PermitReq, WalkArgs};
use treeval::auth::{authorize_decide, DecideArgs};

const I_AM: &str = "I"; // the bootstrap Name IS the sign "I"; `am` is its second word/act (i-am/I_AM were drift)

/// The story = the substrate domain (crossOrigin.js: "story — the substrate domain, e.g. tabors.site").
/// The on-disk store keys act-chains under it AND the act-sig commits to it, so it must be stable. A
/// config follow-up (env STORY_NAME / the domain); "localhost" matches the dev store on disk.
const STORY: &str = "localhost";

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
    if name_id == I_AM || name_id == "i-am" || name_id == "I" {
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
        i_am: I_AM,
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
        i_am: I_AM,
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
        ("story", jstr(STORY)),
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

/// The ACT primitive — a being speaks a Word: parse → run its body (`run_body`: acts, flows, and
/// control flow, threading bindings + state) → AUTHORIZE + SEAL each act that targets a reel (the
/// moment-seal, `seal_one`). ONE entry; declarations are skipped, and a state-only act threads its
/// `sets` without sealing. `sign` is the optional injected signer (treeibp stays crypto-free; the edge
/// binary supplies the story/Name key) — present = the acts land ed25519-signed, `None` = unsigned.
/// (Paired with `moment`, the read primitive — the two-primitive surface.)
pub fn act(
    word: &str,
    actor: &Json,
    dir: &Path,
    history: &str,
    able_spec_of: impl Fn(&str) -> Option<Json>,
    basis: Option<f64>,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Vec<Outcome> {
    let mut ctx = obj(vec![
        ("identity", actor.clone()),
        ("bindings", obj(vec![])),
        ("state", obj(vec![])),
        ("beings", obj(vec![])),
    ]);
    let nodes = treeword::parse(word);
    let fail_closed = |_: &str, _: &[Json]| false; // domain predicates fail closed (no host wired)
    let specs = run_body(&nodes, &mut ctx, &fail_closed);
    let basis = basis.or_else(|| Some(read_ord(dir))); // the moment-ord this Word was decided against
    let mut out = Vec::new();
    for spec in &specs {
        let (k, i) = match get(spec, "of") {
            Some(o) => (
                get_str(o, "kind").unwrap_or("being").to_string(),
                get_str(o, "id").unwrap_or("").to_string(),
            ),
            None => ("being".to_string(), String::new()),
        };
        if i.is_empty() {
            continue; // a state-only act (no reel target) — its `sets` already threaded
        }
        let verb = get_str(spec, "verb").unwrap_or("");
        let op = get_str(spec, "act");
        let audit_being = if k == "being" { Some(i.as_str()) } else { None }; // being target -> inheritation axis
        if !ok_true(&authorize(verb, op, Some(&i), audit_being, actor, dir, history, &able_spec_of)) {
            out.push(Outcome::Denied(format!("not authorized: {verb}:{}", op.unwrap_or(""))));
            continue;
        }
        match seal_one(dir, history, &k, &i, spec, basis, sign) {
            Some(fact) => out.push(Outcome::Authorized(fact)),
            None => out.push(Outcome::Denied(format!("seal failed: {verb}:{}", op.unwrap_or("")))),
        }
    }
    out
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
/// (NOTE per the act/fact doctrine: stamping these specs is fact-only today — the act-log/moment-seal
/// is the doctrine-correct write, tracked separately.)
pub fn run_body(body: &[Json], ctx: &mut Json, host: &dyn Fn(&str, &[Json]) -> bool) -> Vec<Json> {
    let mut out = Vec::new();
    for node in body {
        match get_str(node, "kind") {
            Some("act") => {
                let spec = treeval::rasterize_emit(node, ctx, None);
                if let Some(b) = get_str(node, "bind") {
                    if let Some(id) = get(&spec, "of").and_then(|o| get_str(o, "id")) {
                        set_nested(ctx, "bindings", b, jstr(id));
                    }
                }
                apply_sets(ctx, node);
                out.push(spec);
            }
            Some("if") => {
                let holds = get(node, "cond").is_some_and(|c| treeval::cond::resolve_cond(c, ctx, host));
                let branch = if holds { get(node, "then") } else { get(node, "else") };
                if let Some(Json::Arr(b)) = branch.cloned() {
                    out.extend(run_body(&b, ctx, host));
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
                        out.extend(run_body(&b, ctx, host));
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
                        out.extend(run_body(&b, ctx, host));
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
                        out.extend(run_body(&b, ctx, host));
                    }
                }
            }
            Some("flow") => {
                // a flow node — run its effects (the When-trigger gating is a scheduler concern)
                if let Some(Json::Arr(e)) = get(node, "effects").cloned() {
                    out.extend(run_body(&e, ctx, host));
                }
            }
            _ => {}
        }
    }
    out
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
