// act.rs — the ACT primitive at the edge. Two invocation shapes, both signing the story's own (I) acts
// with the custodial story key (a being's key is client-side, so a being's acts stay unsigned):
//
//   run_word(word)        — a raw Word (a genesis act "I make x.", a do-op) -> treeibp::act_via_fold.
//   run_op(op, trigger)   — a MATERIALS op (set-being / set-space / create-matter / …) invoked by name +
//                           a trigger {target, field, value, merge, branch} -> treeibp::run_op_word, which
//                           seeds the trigger bindings + drives the op's `.word` through the host see-op
//                           resolver (treehost). This is the channel act(word) lacks.
//
// Shared by the WS act handler (ibp.rs) + the cognition loop (cognize.rs). Mirrors /word's setup.

use std::path::Path;

use treehash::Json;

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

const MATERIALS_DIR: &str = "seed/materials";
const STORE_WORDS_DIR: &str = "seed/store/words";

/// The story signer: `I`'s acts are signed with the custodial story key (.story/story.key); any other
/// actor's key is client-side, so this returns None (the act stays unsigned here).
fn story_signer(actor: &Json) -> Option<impl Fn(&Json, &[String]) -> Json> {
    let actor_is_story = get_str(actor, "nameId") == Some("I") || get_str(actor, "beingId") == Some("I");
    if !actor_is_story {
        return None;
    }
    let seed = treesign::load_story_seed(Path::new(".story")).ok()?;
    Some(move |opening: &Json, fids: &[String]| -> Json {
        let payload = treesign::build_act_sig_payload(opening, fids);
        let value = treesign::sign_value(&seed, &payload);
        Json::Obj(vec![("alg".to_string(), Json::Str("ed25519".to_string())), ("by".to_string(), Json::Str("I".to_string())), ("value".to_string(), Json::Str(value))])
    })
}

/// Run a raw Word as an act (genesis act / do-op): parse -> authorize -> rasterize -> stamp. After the
/// seal, the PRESENT-LOOP Phase-2 hook fires (subscription wakes + inbox eviction) over the sealed facts.
pub fn run_word(word: &str, actor: &Json, root: &Path, history: &str, basis: Option<f64>) -> Vec<treeibp::Outcome> {
    let ables_dir = crate::config::ables_dir();
    let ables_dir = ables_dir.as_path();
    let materials_dir = Path::new(MATERIALS_DIR);
    let store_words_dir = Path::new(STORE_WORDS_DIR);
    let signer = story_signer(actor);
    let sign_ref = signer.as_ref().map(|f| f as &dyn Fn(&Json, &[String]) -> Json);
    let outcomes = treeibp::act_via_fold(
        word,
        actor,
        root,
        history,
        |name| treeibp::fold_word_able(name, ables_dir),
        |op, noun| treeibp::op_word_file(op, noun, materials_dir, store_words_dir),
        basis,
        sign_ref,
    );
    after_seal(&outcomes, root);
    outcomes
}

/// THE PRESENT-LOOP Phase-2 emit hook. After an act seals, walk its AUTHORIZED facts and:
///   1. EVICT any inbox row an answering act closed (params.answers: <correlation> -> scheduler::evict).
///   2. WAKE every subscriber whose attention covers each fact (subscriptions::emit_facts) — ORD-DRIVEN
///      (the wake's basis IS the fact's append ord; NO timer, NO clock, NO sleep).
/// The chain is the truth; both the inbox queue and the subscription registry are projections this hook
/// keeps current. CLOCK-FREE end to end. Idempotent: a settled replay re-emits the same wakes/evictions.
fn after_seal(outcomes: &[treeibp::Outcome], root: &Path) {
    let facts: Vec<Json> = outcomes
        .iter()
        .filter_map(|o| match o {
            treeibp::Outcome::Authorized(fact) => Some(fact.clone()),
            _ => None,
        })
        .collect();
    if facts.is_empty() {
        return;
    }
    // 1. inbox eviction: an answering act carries `params.answers` (the correlation it closes).
    for fact in &facts {
        if let Some(corr) = answered_correlation(fact) {
            crate::scheduler::evict(&corr);
        }
    }
    // 2. subscription wakes: each sealed fact may match a being's standing attention.
    crate::subscriptions::emit_facts(&facts, root);
}

/// The correlation an act answers (closeInboxOnAnswer): the sealed fact's `params.answers`, when present.
/// None = not an answering act. A pure read, no clock.
fn answered_correlation(fact: &Json) -> Option<String> {
    let params = get(fact, "params")?;
    match get(params, "answers") {
        Some(Json::Str(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// Invoke a MATERIALS op by name + a trigger ({target, field, value, merge, branch, …}). Loads the op's
/// `.word` body (the noun = the target's kind) and drives it through treeibp::run_op_word — the trigger
/// is seeded as bindings, the `see resolve-X` reads resolve through treehost, the `Return` builds the
/// do-fact, and it authorizes + seals on the one moment-seal path.
pub fn run_op(op: &str, trigger: &Json, actor: &Json, root: &Path, history: &str, basis: Option<f64>) -> Vec<treeibp::Outcome> {
    let ables_dir = crate::config::ables_dir();
    let ables_dir = ables_dir.as_path();
    let materials_dir = Path::new(MATERIALS_DIR);
    let store_words_dir = Path::new(STORE_WORDS_DIR);
    let noun = get(trigger, "target").and_then(|t| get_str(t, "kind"));
    let word = match treeibp::op_word_file(op, noun, materials_dir, store_words_dir) {
        Some(w) => w,
        None => return vec![treeibp::Outcome::Denied(format!("op '{op}' has no .word body"))],
    };
    let signer = story_signer(actor);
    let sign_ref = signer.as_ref().map(|f| f as &dyn Fn(&Json, &[String]) -> Json);
    let outcomes = treeibp::run_op_word(&word, actor, trigger, root, history, |name| treeibp::fold_word_able(name, ables_dir), basis, sign_ref);
    after_seal(&outcomes, root);
    outcomes
}

/// Register a Name (name:declare) or set/change its password (name:set-password) — seal a `name`
/// fact onto the LIBRARY reel via the general moment seal (the same path genesis uses; NO exemption).
/// Name creation is an I act, signed by the custodial story key. `spec` carries `{ name, privateKeyEnc,
/// parentNameId?, soulType? }`; `privateKeyEnc` is the `pw:` blob (the key, password-encrypted — the
/// portal made it locally; the plaintext key + password never reached the server).
pub fn declare_name(op: &str, nid: &str, _name: &str, spec: &Json, root: &Path, story_domain: &str) -> Vec<treeibp::Outcome> {
    if nid.is_empty() {
        return vec![treeibp::Outcome::Denied("name:declare needs a nameId".into())];
    }
    let act_kind = if op == "name-set-password" { "set-password" } else { "declare" };
    // the lone fact (one act -> one word -> one fact -> one reel), of:{kind:library, id:storyDomain}.
    let fact = Json::Obj(vec![
        ("verb".into(), Json::Str("name".into())),
        ("act".into(), Json::Str(act_kind.into())),
        ("through".into(), Json::Str("I".into())),
        ("of".into(), Json::Obj(vec![("kind".into(), Json::Str("library".into())), ("id".into(), Json::Str(story_domain.into()))])),
        ("params".into(), Json::Obj(vec![("nameId".into(), Json::Str(nid.into())), ("spec".into(), spec.clone())])),
        ("history".into(), Json::Str("0".into())),
    ]);
    // the act opening (I signs; the act-chain keys by "I"), carrying the fact in deltaF.
    let act = Json::Obj(vec![
        ("by".into(), Json::Str("I".into())),
        ("through".into(), Json::Str("I".into())),
        ("to".into(), Json::Str(nid.into())),
        ("story".into(), Json::Str(story_domain.into())),
        ("history".into(), Json::Str("0".into())),
        ("deltaF".into(), Json::Arr(vec![fact.clone()])),
    ]);
    let i_actor = Json::Obj(vec![("nameId".into(), Json::Str("I".into())), ("name".into(), Json::Str("I".into()))]);
    let signer = match story_signer(&i_actor) {
        Some(s) => s,
        None => return vec![treeibp::Outcome::Denied("no story key to sign the name declare".into())],
    };
    let sign_ref: &dyn Fn(&Json, &[String]) -> Json = &signer;
    let ord = treestore::next_ord(root);
    match treestore::commit_moment_signed(root, &act, ord, sign_ref) {
        Ok(_committed) => vec![treeibp::Outcome::Authorized(fact)],
        Err(e) => vec![treeibp::Outcome::Denied(format!("name:{act_kind} seal failed: {e:?}"))],
    }
}

/// One act outcome as a wire row (the stamped fact, or a denial reason).
pub fn outcome_json(o: &treeibp::Outcome) -> Json {
    match o {
        treeibp::Outcome::Authorized(fact) => Json::Obj(vec![("ok".to_string(), Json::Bool(true)), ("fact".to_string(), fact.clone())]),
        treeibp::Outcome::Denied(reason) => Json::Obj(vec![("ok".to_string(), Json::Bool(false)), ("reason".to_string(), Json::Str(reason.clone()))]),
    }
}
