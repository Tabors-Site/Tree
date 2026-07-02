// wire/proto.rs — the message shapes. It is ONLY moment and act. The client takes a MOMENT of an
// address (perceive) or speaks one Word (act), and receives moments back (replies + live pushes).
//
// NOTE: the wire still carries `verb:"moment"|"act"` because that's what today's treeos server matches;
// that is a hidden transport detail. The API here is moment/act-framed (the user's framing), and the
// server's verb->by-shape cleanup is a small follow-up. Receiving a moment = a face; nothing else.

use treehash::Json;

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn jobj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// The actor identity for a moment/act. P0: the I-Am read bypass (`beingId:"I"`); a being's own key
/// + client-side signing arrives in P4.
pub fn actor_i() -> Json {
    jobj(vec![("beingId", jstr("I")), ("name", jstr("I"))])
}


/// The actor for the active NAME (no being yet): `{nameId, name}`. The server reads `nameId` to gate.
pub fn actor_name(name_id: &str, label: &str) -> Json {
    jobj(vec![("nameId", jstr(name_id)), ("name", jstr(label))])
}

/// The actor for a Name DRIVING a being: `{beingId, nameId, name}`. The being holds no key; the Name
/// (nameId) signs + authenticates; the beingId rides for attribution.
pub fn actor_being(being_id: &str, name_id: &str, name: &str) -> Json {
    jobj(vec![("beingId", jstr(being_id)), ("nameId", jstr(name_id)), ("name", jstr(name))])
}

/// The Name id of an actor (None for the anonymous I-Am actor — which needs no key-proof).
pub fn actor_name_id(actor: &Json) -> Option<String> {
    match get(actor, "nameId") {
        Some(Json::Str(s)) if s != "I" => Some(s.clone()),
        _ => None,
    }
}

/// A moment request as Json (so the caller can sign it before stringifying).
pub fn moment_req(address: &str, history: &str, actor: &Json) -> Json {
    jobj(vec![
        ("verb", jstr("moment")),
        ("address", jstr(address)),
        ("history", jstr(history)),
        ("actor", actor.clone()),
    ])
}

/// Take a moment of a stored reel — a place (a `space`), a `being`, `matter`, … : perceive + the face.
pub fn moment_reel(kind: &str, id: &str, history: &str, actor: &Json) -> String {
    treehash::stringify(&jobj(vec![
        ("verb", jstr("moment")),
        ("kind", jstr(kind)),
        ("id", jstr(id)),
        ("history", jstr(history)),
        ("actor", actor.clone()),
    ]))
}



/// Take a STORY moment of a name — the kernel's special render that gets the Words for that name. The
/// `render:"story"` hint asks the kernel for the woven narrative face (it returns the plain being face
/// until that render is wired).
pub fn moment_story(kind: &str, id: &str, history: &str, lang: &str, actor: &Json) -> String {
    treehash::stringify(&jobj(vec![
        ("verb", jstr("moment")),
        ("kind", jstr(kind)),
        ("id", jstr(id)),
        ("history", jstr(history)),
        ("actor", actor.clone()),
        ("render", jstr("story")),
        ("lang", jstr(lang)),
    ]))
}

/// Take a moment of the LIBRARY reel (the history bar IS this) — it folds to the histories/branches.
pub fn moment_library(domain: &str, history: &str, actor: &Json) -> String {
    moment_reel("library", domain, history, actor)
}

/// Fetch a Name's ENCRYPTED key blob for name+password sign-in (Model B). The server returns the
/// `pw:…` blob unredacted (it is password-locked, useless without the password); the portal decrypts it
/// CLIENT-SIDE — the password never touches the wire.
pub fn moment_name_key(name: &str) -> String {
    treehash::stringify(&jobj(vec![
        ("verb", jstr("moment")),
        ("op", jstr("name-key")),
        ("args", jobj(vec![("name", jstr(name))])),
    ]))
}

/// Fetch the branch tree — main + every live history — for the history bar's switcher.
pub fn moment_branches() -> String {
    treehash::stringify(&jobj(vec![("verb", jstr("moment")), ("op", jstr("branches"))]))
}

/// Fork a new history off main at `at` (None = now), labelled `label`. An I act.
pub fn act_create_branch(label: &str, at: Option<f64>, actor: &Json) -> String {
    let mut f = vec![("verb", jstr("act")), ("op", jstr("create-branch")), ("label", jstr(label)), ("actor", actor.clone())];
    if let Some(a) = at {
        f.push(("at", Json::Num(a)));
    }
    treehash::stringify(&jobj(f))
}

/// Fetch the history's TIMELINE — one moment (dot) per act — for the history bar's scrubber.
pub fn moment_timeline(history: &str) -> String {
    treehash::stringify(&jobj(vec![
        ("verb", jstr("moment")),
        ("op", jstr("timeline")),
        ("history", jstr(history)),
    ]))
}

/// Register a Name (declare) or set/change its password — writes `{ nameId, name, privateKeyEnc }` to
/// the library reel. Sent AS the I (name creation is an I act); `op` = "name-declare" | "name-set-password".
pub fn act_name_declare(op: &str, name_id: &str, name: &str, private_key_enc: &str, actor: &Json) -> String {
    treehash::stringify(&jobj(vec![
        ("verb", jstr("act")),
        ("op", jstr(op)),
        ("nameId", jstr(name_id)),
        ("name", jstr(name)),
        ("spec", jobj(vec![
            ("nameId", jstr(name_id)),
            ("name", jstr(name)),
            ("privateKeyEnc", jstr(private_key_enc)),
        ])),
        ("actor", actor.clone()),
    ]))
}

/// Speak one Word (act). P0: unsigned (read/explore + I-Am acts); client-signing lands in P4.
pub fn act_word(word: &str, history: &str, actor: &Json) -> String {
    treehash::stringify(&jobj(vec![
        ("verb", jstr("act")),
        ("word", jstr(word)),
        ("history", jstr(history)),
        ("actor", actor.clone()),
    ]))
}

/// A message received from the server: a moment (a face, or a live push) or an act result.
pub struct Received {
    pub raw: Json,
    pub pretty: String,
    pub live: bool,
    pub kind: RxKind,
}

pub enum RxKind {
    Moment,
    Act,
    Other,
}

pub fn parse_received(text: &str) -> Received {
    match treehash::parse(text) {
        Ok(raw) => {
            let live = matches!(get(&raw, "live"), Some(Json::Bool(true)));
            let kind = match get(&raw, "verb") {
                Some(Json::Str(s)) if s == "moment" => RxKind::Moment,
                Some(Json::Str(s)) if s == "act" => RxKind::Act,
                _ => RxKind::Other,
            };
            let pretty = pretty(&raw, 0);
            Received { raw, pretty, live, kind }
        }
        Err(_) => Received { raw: Json::Str(text.to_string()), pretty: text.to_string(), live: false, kind: RxKind::Other },
    }
}

pub fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}

/// A readable indented pretty-print of a face (P0 "show raw face").
pub fn pretty(v: &Json, indent: usize) -> String {
    let pad = "  ".repeat(indent);
    let pad1 = "  ".repeat(indent + 1);
    match v {
        Json::Null => "null".into(),
        Json::Bool(b) => b.to_string(),
        Json::Num(n) => {
            if n.fract() == 0.0 {
                format!("{}", *n as i64)
            } else {
                n.to_string()
            }
        }
        Json::Str(s) => format!("\"{s}\""),
        Json::Arr(a) => {
            if a.is_empty() {
                return "[]".into();
            }
            let items: Vec<String> = a.iter().map(|x| format!("{pad1}{}", pretty(x, indent + 1))).collect();
            format!("[\n{}\n{pad}]", items.join(",\n"))
        }
        Json::Obj(o) => {
            if o.is_empty() {
                return "{}".into();
            }
            let items: Vec<String> = o.iter().map(|(k, x)| format!("{pad1}{k}: {}", pretty(x, indent + 1))).collect();
            format!("{{\n{}\n{pad}}}", items.join(",\n"))
        }
    }
}
