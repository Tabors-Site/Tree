// ibp_http.rs — THE HTTP↔IBPA BRIDGE. IBP over plain HTTP for people / peers / curl with no open socket.
//
// It is a pure TRANSLATOR, nothing more: it turns the request into the SAME wire message the WebSocket
// speaks and hands it to the SAME `ibp::handle_wire_conn` — the one route. It rebuilds NO moment / act /
// auth / fold logic. The single HTTP-specific step is turning name+password into the key-proof the
// existing gate already verifies (curl cannot sign a moment; the story that already holds your encrypted
// key unlocks it server-side). Everything else — resolving the address, the open-moment session, the
// one-being-one-moment rule, ownership — happens in the shared path, exactly as it does for WS.
//
//   GET  /ibp/<url-encoded-address>   OPEN A MOMENT of the address (the RIGHT stance). Auth: `Authorization:
//                                     Basic name:password`. Returns the face + a MOMENT TOKEN (`moment`).
//   POST /ibp   body = one Word       ACT — it RIDES the open moment named by `X-Moment` (or `moment` in a
//                                     JSON body). No / dead token → the gate's "no open moment" warning.
//
// LEFT-stance overrides ride the envelope: `X-History` (and `X-Being` = the being you embody) when they
// diverge from the mirror. A moment is SINGLE-USE — its act spends it (moment → act → moment); act again
// = GET a fresh moment. The private key never leaves the story; only the password reaches the story that
// already stores your encrypted key.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock};

use treehash::Json;
use treeprotocol::{code, http_status_for, IbpError};

use crate::wire::Request;

type Resp = (&'static str, &'static str, String);
const JSON: &str = "application/json";
/// Cap so abandoned GET-moments (a GET that never POSTs) cannot leak the registry unbounded — no socket
/// closes them (unlike WS). Over the cap, one open moment is evicted (its borrowed conn + being freed).
const MAX_OPEN: usize = 4096;

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: &[(&str, Json)]) -> Json {
    Json::Obj(pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect())
}
fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    if let Json::Obj(e) = v {
        e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x)
    } else {
        None
    }
}
fn get_str(v: &Json, k: &str) -> Option<String> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ── the open-moment registry: token → the borrowed conn + who opened it (to rebuild the act's actor) ──
struct Open {
    conn: u64,
    name_id: String,
    name: String,
    being: Option<String>,
}
fn opens() -> &'static Mutex<HashMap<String, Open>> {
    static O: OnceLock<Mutex<HashMap<String, Open>>> = OnceLock::new();
    O.get_or_init(|| Mutex::new(HashMap::new()))
}
fn remember(token: String, open: Open) {
    let mut map = lock(opens());
    if map.len() >= MAX_OPEN {
        if let Some(k) = map.keys().next().cloned() {
            if let Some(old) = map.remove(&k) {
                crate::live::forget_conn(old.conn); // free the abandoned open moment's conn + being lock
            }
        }
    }
    map.insert(token, open);
}
/// Take (single-use) the open moment a token names — a moment is spent by its act.
fn take_open(token: &str) -> Option<Open> {
    lock(opens()).remove(token)
}

// ── GET /ibp/<address> : OPEN A MOMENT ───────────────────────────────────────
pub fn get_moment(req: &Request, root: &Path) -> Resp {
    let address = address_of(&req.path);
    let (name, password) = match basic_auth(req) {
        Some(c) => c,
        None => return err(401, "provide name + password (Authorization: Basic) to open a moment"),
    };
    let (seed, name_id, label) = match unlock(&name, &password, root) {
        Ok(u) => u,
        Err(e) => return err(401, &e),
    };
    let being = req.header("x-being").filter(|b| !b.is_empty()).map(str::to_string);
    // build the SAME moment message the WS speaks, then sign its proof with the unlocked key.
    let mut moment = obj(&[
        ("verb", jstr("moment")),
        ("address", jstr(&address)),
        ("history", jstr(req.header("x-history").unwrap_or("0"))),
        ("actor", actor(&name_id, &label, being.as_deref())),
    ]);
    let sig = treesign::sign_moment_proof(&seed, &name_id, &moment);
    if let Json::Obj(e) = &mut moment {
        e.push(("proof".to_string(), obj(&[("value", jstr(&sig))])));
    }
    // channel to THE route on a fresh conn — the gate authenticates it and locks the being.
    let conn = crate::live::next_conn_id();
    let reply = crate::ibp::handle_wire_conn(&treehash::stringify(&moment), root, conn);
    if let Some(status) = error_status(&reply) {
        crate::live::forget_conn(conn); // the moment did NOT open (bad proof / conflict / bad address)
        return (status, JSON, reply);
    }
    // the moment opened → mint a single-use token bound to it (unique conn + secret sig = unguessable).
    let token = treehash::sha256_hex(format!("{conn}:{sig}").as_bytes())[..32].to_string();
    remember(token.clone(), Open { conn, name_id, name: label, being });
    (status_str(200), JSON, with_moment(&reply, &token))
}

// ── POST /ibp : ACT (rides the open moment) ──────────────────────────────────
pub fn post_act(req: &Request, root: &Path) -> Resp {
    let token = req.header("x-moment").map(str::to_string).or_else(|| body_field(&req.body, "moment"));
    let open = match token.and_then(|t| take_open(&t)) {
        Some(o) => o,
        // no / dead token — a being acts ONLY through an open moment (moment → act → moment).
        None => return err(401, "no open moment — GET /ibp/<address> first, then POST the Word to ride it"),
    };
    let word = body_word(&req.body);
    if word.trim().is_empty() {
        crate::live::forget_conn(open.conn);
        return err(400, "the POST body must be one Word");
    }
    // the SAME act message, on the OPEN MOMENT's conn — gate_act rides the authenticated session it opened.
    let act = obj(&[
        ("verb", jstr("act")),
        ("word", jstr(word.trim())),
        ("history", jstr(req.header("x-history").unwrap_or("0"))),
        ("actor", actor(&open.name_id, &open.name, open.being.as_deref())),
    ]);
    let reply = crate::ibp::handle_wire_conn(&treehash::stringify(&act), root, open.conn);
    crate::live::forget_conn(open.conn); // the moment is SPENT: drop the conn + release the being lock
    (error_status(&reply).unwrap_or_else(|| status_str(200)), JSON, reply)
}

/// Unlock the Name's key SERVER-SIDE from name+password: the story already holds the encrypted blob
/// (`resolve::name_key`); the password decrypts it here, transiently. Reuses the exact Model-B crypto.
fn unlock(name: &str, password: &str, root: &Path) -> Result<([u8; 32], String, String), String> {
    let view = crate::resolve::name_key(name, root)?;
    let blob = get_str(&view, "privateKeyEnc")
        .filter(|b| !b.is_empty())
        .ok_or_else(|| format!("name '{name}' has no password set — open a moment with its key over WS"))?;
    let pem = treesign::decrypt_with_password(&blob, password).ok_or("wrong password")?;
    let seed = treesign::seed_from_pkcs8_pem(&pem).map_err(|_| "the stored key is malformed".to_string())?;
    let name_id = treesign::keypair_from_seed(&seed).name_id;
    let label = get_str(&view, "name").unwrap_or_else(|| name.to_string());
    Ok((seed, name_id, label))
}

/// The actor: the Name, embodying `being` if given. The SAME shape the WS client sends.
fn actor(name_id: &str, name: &str, being: Option<&str>) -> Json {
    let mut e = vec![("nameId".to_string(), jstr(name_id)), ("name".to_string(), jstr(name))];
    if let Some(b) = being.filter(|b| !b.is_empty()) {
        e.push(("beingId".to_string(), jstr(b)));
    }
    Json::Obj(e)
}

/// The RIGHT-stance address from the path: everything after `/ibp` (percent-decoded). A bare segment
/// (`/ibp/heaven`) becomes an absolute path (`/heaven`); a full IBP address (with `#`) is left as-is.
fn address_of(path: &str) -> String {
    let p = path.split('?').next().unwrap_or(path);
    let rest = p.strip_prefix("/ibp").unwrap_or(p);
    let rest = rest.strip_prefix('/').unwrap_or(rest);
    let decoded = pct_decode(rest);
    if decoded.trim().is_empty() {
        "/".to_string()
    } else if decoded.contains('#') || decoded.starts_with('/') {
        decoded
    } else {
        format!("/{decoded}")
    }
}

/// Parse `Authorization: Basic base64(name:password)` → (name, password).
fn basic_auth(req: &Request) -> Option<(String, String)> {
    let h = req.header("authorization")?;
    let b64 = h.strip_prefix("Basic ").or_else(|| h.strip_prefix("basic "))?;
    let bytes = b64_decode(b64.trim())?;
    let s = String::from_utf8(bytes).ok()?;
    let (name, password) = s.split_once(':')?;
    Some((name.to_string(), password.to_string()))
}

/// The POST body as ONE Word: `{"word":"…"}` if the body is that JSON, else the raw body text.
fn body_word(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body).into_owned();
    if let Ok(j) = treehash::parse(text.trim()) {
        if let Some(w) = get_str(&j, "word") {
            return w;
        }
    }
    text
}

/// A field from a JSON body (used to accept the `moment` token in the body as well as the header).
fn body_field(body: &[u8], key: &str) -> Option<String> {
    treehash::parse(String::from_utf8_lossy(body).trim()).ok().and_then(|j| get_str(&j, key))
}

/// Add the open-moment `token` to a moment reply so the client can ride it on the next act.
fn with_moment(reply: &str, token: &str) -> String {
    match treehash::parse(reply) {
        Ok(Json::Obj(mut e)) => {
            e.push(("moment".to_string(), jstr(token)));
            treehash::stringify(&Json::Obj(e))
        }
        _ => reply.to_string(),
    }
}

/// If the reply is an ERROR envelope — bare `{status:error}` or a moment whose `view` is one — the HTTP
/// status string for its code (via the ONE canonical `http_status_for`); else None (success → 200).
fn error_status(reply: &str) -> Option<&'static str> {
    let j = treehash::parse(reply).ok()?;
    let is_err = |v: &Json| get_str(v, "status").as_deref() == Some("error");
    let env = if is_err(&j) {
        j.clone()
    } else {
        get(&j, "view").filter(|v| is_err(v)).cloned()?
    };
    let code = get(&env, "error").and_then(|e| get_str(e, "code")).unwrap_or_else(|| code::INVALID_INPUT.to_string());
    Some(status_str(http_status_for(&code)))
}

/// An error envelope + its HTTP status — the SAME `{status:"error", error:{code,message}}` shape the gate
/// emits, so an HTTP caller and a WS caller read identical errors.
fn err(status: u16, msg: &str) -> Resp {
    let c = match status {
        401 => code::UNAUTHORIZED,
        403 => code::FORBIDDEN,
        404 => code::SPACE_NOT_FOUND,
        409 => code::RESOURCE_CONFLICT,
        _ => code::INVALID_INPUT,
    };
    (status_str(status), JSON, treehash::stringify(&IbpError::new(c, msg).envelope()))
}

fn status_str(code: u16) -> &'static str {
    match code {
        200 => "200 OK",
        400 => "400 Bad Request",
        401 => "401 Unauthorized",
        403 => "403 Forbidden",
        404 => "404 Not Found",
        409 => "409 Conflict",
        429 => "429 Too Many Requests",
        502 => "502 Bad Gateway",
        503 => "503 Service Unavailable",
        _ => "500 Internal Server Error",
    }
}

/// Percent-decode a URL path segment (`%2F` → `/`, `+` → space).
fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn hex(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Standard-alphabet base64 decode (for Basic auth). Streams 6-bit groups into bytes; ignores `=`/space.
fn b64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        })
    }
    let (mut acc, mut bits) = (0u32, 0u32);
    let mut out = Vec::new();
    for &c in s.as_bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        acc = (acc << 6) | val(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}
