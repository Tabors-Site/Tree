// cognize.rs — the EDGE wiring of the cognition loop: POST /cognize runs a being's MOMENT in the
// binary. moment(face) -> cognize::decide (routes default/scripted/llm by the able's mode) -> on an Act,
// seal the decided Word through the SAME act path /word uses (treeibp::act_via_fold + the story signer).
// The routing + the deciders live in treecognition (pure); this module only supplies the seams.
//
// Runnable today for SCRIPTED + DEFAULT beings: the perceived inner-face is provided in the request
// body (`face`), since the in-binary face projection is the other lane's work-in-progress. LLM mode is
// reached but its transport is not wired here yet (it needs a native HTTPS client at the edge + the live
// face); it returns a clear Internal failure until then. When the projection + HTTPS land, the only
// change is reading the face internally and injecting a real transport — the loop itself is unchanged.

use std::path::Path;

use treecognition::{cognize, FailShape};
use treecognition::Cognition;
use treehash::Json;

use crate::chain::{json, num_field};

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
fn jstr(x: &str) -> Json {
    Json::Str(x.to_string())
}
fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn ok(body: String) -> (&'static str, &'static str, String) {
    ("200 OK", "application/json", body)
}
fn bad(msg: &str) -> (&'static str, &'static str, String) {
    ("400 Bad Request", "application/json", json(&obj(vec![("error", jstr(msg))])))
}

/// POST /cognize  { actor, able, history?, basis?, face } -> run one moment for this being.
pub fn cognize_seam(body: &[u8], root: &Path) -> (&'static str, &'static str, String) {
    let req = match treehash::parse(&String::from_utf8_lossy(body)) {
        Ok(r) => r,
        Err(_) => return bad("invalid JSON body"),
    };
    let actor = get(&req, "actor").cloned().unwrap_or(Json::Null);
    let able = match get_str(&req, "able") {
        Some(a) => a.to_string(),
        None => return bad("missing 'able'"),
    };
    let history = get_str(&req, "history").unwrap_or("0");
    let basis = num_field(&req, "basis");
    let face = get(&req, "face").cloned().unwrap_or(Json::Null);

    let ables_dir = Path::new("seed/store/words/ables");
    // the able's folded SPEC (mode + granted vocabulary) and its `.word` flows (the scripted rules).
    let spec = treeibp::fold_word_able(&able, ables_dir).unwrap_or(Json::Null);
    let flows = std::fs::read_to_string(ables_dir.join(format!("{able}.word"))).map(|t| treeword::parse(&t)).unwrap_or_default();
    let identity = build_identity(&actor, &able, &face);

    // fail-closed domain predicates (the see-op host for scripted triggers is a later wiring).
    let host = |_: &str, _: &[Json]| false;
    // the LLM transport: a connection from the request `llm:{baseUrl,model,key?}` (http only), run
    // through the failover policy. The connection-store -> chain resolution + HTTPS are follow-ups; the
    // shape is already right (call_with_failover over a connection list).
    let conn = build_conn(&req);
    let transport = |prompt: &str| -> Result<String, (FailShape, String)> {
        match &conn {
            Some(c) => {
                let mut call = |_id: &str| crate::llm_http::call_connection(c, prompt);
                treecognition::call::call_with_failover(&["primary".to_string()], &mut call)
            }
            None => Err((FailShape::Internal, "llm mode needs `llm:{baseUrl,model,key?}` in the request (http only); HTTPS + connection-store chain resolution are follow-ups".to_string())),
        }
    };

    let mode = format!("{:?}", cognize::mode_of(&spec)).to_lowercase();
    let decision = cognize::decide(&spec, &flows, &face, &identity, &host, &transport);

    let resp = match decision {
        Cognition::Act { content } => {
            // seal the decided Word through the act path (the same one /word uses).
            let outcomes = seal_word(&content, &actor, root, history, basis);
            let results: Vec<Json> = outcomes.iter().map(outcome_json).collect();
            obj(vec![
                ("ok", Json::Bool(true)),
                ("engine", jstr("rust")),
                ("mode", jstr(&mode)),
                ("decided", jstr("act")),
                ("word", jstr(&content)),
                ("results", Json::Arr(results)),
            ])
        }
        Cognition::See => obj(vec![("ok", Json::Bool(true)), ("engine", jstr("rust")), ("mode", jstr(&mode)), ("decided", jstr("see"))]),
        Cognition::Failure { shape, reason } => obj(vec![
            ("ok", Json::Bool(false)),
            ("engine", jstr("rust")),
            ("mode", jstr(&mode)),
            ("decided", jstr("failure")),
            ("shape", jstr(&format!("{shape:?}").to_lowercase())),
            ("reason", jstr(&reason)),
        ]),
    };
    ok(json(&resp))
}

/// Seal a decided Word through the act path — mirrors /word's setup (the story key signs `I`'s own acts;
/// a being's own key is client-side, so a being's acts stay unsigned here).
fn seal_word(word: &str, actor: &Json, root: &Path, history: &str, basis: Option<f64>) -> Vec<treeibp::Outcome> {
    let ables_dir = Path::new("seed/store/words/ables");
    let materials_dir = Path::new("seed/materials");
    let store_words_dir = Path::new("seed/store/words");

    let actor_is_story = get_str(actor, "nameId") == Some("I") || get_str(actor, "beingId") == Some("I");
    let story_seed = if actor_is_story { treesign::load_story_seed(Path::new(".story")).ok() } else { None };
    let signer = story_seed.map(|seed| {
        move |opening: &Json, fids: &[String]| -> Json {
            let payload = treesign::build_act_sig_payload(opening, fids);
            let value = treesign::sign_value(&seed, &payload);
            Json::Obj(vec![("alg".to_string(), Json::Str("ed25519".to_string())), ("by".to_string(), Json::Str("I".to_string())), ("value".to_string(), Json::Str(value))])
        }
    });
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

fn outcome_json(o: &treeibp::Outcome) -> Json {
    match o {
        treeibp::Outcome::Authorized(fact) => obj(vec![("ok", Json::Bool(true)), ("fact", fact.clone())]),
        treeibp::Outcome::Denied(reason) => obj(vec![("ok", Json::Bool(false)), ("reason", jstr(reason))]),
    }
}

/// The LLM connection from the request `llm:{baseUrl,model,key?}` (http only, for now).
fn build_conn(req: &Json) -> Option<crate::llm_http::Conn> {
    let llm = get(req, "llm")?;
    Some(crate::llm_http::Conn {
        base_url: get_str(llm, "baseUrl")?.to_string(),
        model: get_str(llm, "model")?.to_string(),
        key: get_str(llm, "key").map(|s| s.to_string()),
    })
}

/// The llm prompt identity `{name, able, space}` from the actor + the perceived face.
fn build_identity(actor: &Json, able: &str, face: &Json) -> Json {
    let name = get_str(actor, "nameId").or_else(|| get_str(actor, "beingId")).unwrap_or("I");
    // the face's current position name, if the projection carried one
    let space = get(face, "position").and_then(|p| get_str(p, "name")).unwrap_or("");
    obj(vec![("name", jstr(name)), ("able", jstr(able)), ("space", jstr(space))])
}
