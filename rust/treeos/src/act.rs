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

const ABLES_DIR: &str = "seed/store/words/ables";
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

/// Run a raw Word as an act (genesis act / do-op): parse -> authorize -> rasterize -> stamp.
pub fn run_word(word: &str, actor: &Json, root: &Path, history: &str, basis: Option<f64>) -> Vec<treeibp::Outcome> {
    let ables_dir = Path::new(ABLES_DIR);
    let materials_dir = Path::new(MATERIALS_DIR);
    let store_words_dir = Path::new(STORE_WORDS_DIR);
    let signer = story_signer(actor);
    let sign_ref = signer.as_ref().map(|f| f as &dyn Fn(&Json, &[String]) -> Json);
    treeibp::act_via_fold(
        word,
        actor,
        root,
        history,
        |name| treeibp::fold_word_able(name, ables_dir),
        |op, noun| treeibp::op_word_file(op, noun, materials_dir, store_words_dir),
        basis,
        sign_ref,
    )
}

/// Invoke a MATERIALS op by name + a trigger ({target, field, value, merge, branch, …}). Loads the op's
/// `.word` body (the noun = the target's kind) and drives it through treeibp::run_op_word — the trigger
/// is seeded as bindings, the `see resolve-X` reads resolve through treehost, the `Return` builds the
/// do-fact, and it authorizes + seals on the one moment-seal path.
pub fn run_op(op: &str, trigger: &Json, actor: &Json, root: &Path, history: &str, basis: Option<f64>) -> Vec<treeibp::Outcome> {
    let ables_dir = Path::new(ABLES_DIR);
    let materials_dir = Path::new(MATERIALS_DIR);
    let store_words_dir = Path::new(STORE_WORDS_DIR);
    let noun = get(trigger, "target").and_then(|t| get_str(t, "kind"));
    let word = match treeibp::op_word_file(op, noun, materials_dir, store_words_dir) {
        Some(w) => w,
        None => return vec![treeibp::Outcome::Denied(format!("op '{op}' has no .word body"))],
    };
    let signer = story_signer(actor);
    let sign_ref = signer.as_ref().map(|f| f as &dyn Fn(&Json, &[String]) -> Json);
    treeibp::run_op_word(&word, actor, trigger, root, history, |name| treeibp::fold_word_able(name, ables_dir), basis, sign_ref)
}

/// One act outcome as a wire row (the stamped fact, or a denial reason).
pub fn outcome_json(o: &treeibp::Outcome) -> Json {
    match o {
        treeibp::Outcome::Authorized(fact) => Json::Obj(vec![("ok".to_string(), Json::Bool(true)), ("fact".to_string(), fact.clone())]),
        treeibp::Outcome::Denied(reason) => Json::Obj(vec![("ok".to_string(), Json::Bool(false)), ("reason".to_string(), Json::Str(reason.clone()))]),
    }
}
