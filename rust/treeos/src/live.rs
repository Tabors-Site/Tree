// live.rs — LIVE MOMENTS (open stampers). A being that opens a moment (perceives a reel) but has not
// yet acted is an OPEN STAMPER: the server holds that open perception and, whenever a LATER act changes
// the face it is looking at, RE-RASTERIZES and pushes a fresh moment down the same socket. The client
// auto-updates, and the server knows exactly who to notify (the open stampers), with no polling.
//
// The FIRST moment's ord is kept as the BASIS (per the user: "keeping ord on first") — staleness is
// measured from when the eyes opened, so the act the being eventually makes is "N events stale" against
// the world's now. A push fires only when the face actually CHANGED (canonical compare), so an
// unrelated act wakes nobody. The rasterize is one-shot re-perception (ibp::handle_wire on the stored
// moment request) — the same fold the first moment ran, so the pushed face matches a fresh perceive.

use std::collections::HashMap;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use treehash::Json;

use crate::wire::ws_send_text;

static CONN_SEQ: AtomicU64 = AtomicU64::new(1);

/// A fresh per-connection id (the open-stamper key).
pub fn next_conn_id() -> u64 {
    CONN_SEQ.fetch_add(1, Ordering::Relaxed)
}

// ── THE OPEN MOMENT AS THE SESSION (auth-at-moment) ──────────────────────────
//
// A Name opens a moment by proving its key AT THE MOMENT (a signature by the Name's key over the
// moment-request's identity payload). Once proven, the connection holds an OPEN AUTHENTICATED MOMENT for
// that Name — an in-memory session keyed on the connection. The Name's ACTS then RIDE the open moment:
// they are attributed to it WITHOUT re-checking the key (the key was checked at the moment). The session
// is EPHEMERAL: it lives only in this map, keyed on conn/Name, and dies when the socket closes (see
// `close_conn` / `forget_conn`). CLOCK-FREE: no wall-clock, no TTL — the open socket IS the lifetime.
//
// `I` (the story) never appears here: its custodial story key is verified at the edge's signer, the
// conn-less path (HTTP /word, federation hops, the legacy read) carries conn 0 and is exempt.

/// The session table: conn -> the set of authenticated Name ids that conn has an open moment for. A
/// connection may open moments for more than one Name (e.g. switching the active being in the portal);
/// each authenticated Name persists until the socket closes.
fn sessions() -> &'static Mutex<HashMap<u64, Vec<String>>> {
    static S: OnceLock<Mutex<HashMap<u64, Vec<String>>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Record an authenticated Name on a connection's open moment (the key was proven at THIS moment). The
/// open moment = the session: every later act by this Name on this conn rides it. Idempotent.
pub fn authenticate(conn: u64, name_id: &str) {
    let mut map = lock(sessions());
    let names = map.entry(conn).or_default();
    if !names.iter().any(|n| n == name_id) {
        names.push(name_id.to_string());
    }
}

/// True when this connection has an OPEN AUTHENTICATED MOMENT for the named actor (the key was checked
/// at the moment). An act with no such open moment is rejected — you cannot act without a moment.
pub fn is_authenticated(conn: u64, name_id: &str) -> bool {
    lock(sessions()).get(&conn).is_some_and(|names| names.iter().any(|n| n == name_id))
}

/// Drop a connection's whole session (its open authenticated moments). Called when the socket closes —
/// the session is in-memory and dies with the connection; NO chain write.
pub fn forget_conn(conn: u64) {
    lock(sessions()).remove(&conn);
    release_being_moments(conn); // the socket dropped -> free every being this conn held present
}

// ── ONE BEING, ONE OPEN MOMENT (presentism: a being IS a present; it cannot be present twice) ────────
//
// A being holds AT MOST ONE open moment at a time. Whoever opens it — a WS connection, or an HTTP
// moment's borrowed conn — HOLDS the being until that moment is SPENT (an act) or the conn drops. A
// second party opening a moment for an already-held being is REFUSED (the first keeps it). Enforced in
// gate_moment, so WebSocket and the HTTP bridge obey the SAME low-level rule (WS is the model; HTTP just
// rides it). The shared @arrival being is exempt — many beingless visitors ride it at once — and the
// gate passes it through before reaching here.

fn being_moments() -> &'static Mutex<HashMap<String, u64>> {
    static B: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    B.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Open (or keep) `being`'s single moment for connection `conn`. True if `conn` now holds it — it was
/// free, or `conn` already held it (re-opening on the SAME conn is ordinary navigation, not a conflict).
/// False if ANOTHER conn holds it: the caller must REFUSE the moment (the being is present elsewhere).
pub fn open_being_moment(being_id: &str, conn: u64) -> bool {
    let mut map = lock(being_moments());
    match map.get(being_id) {
        Some(&owner) if owner != conn => false, // held elsewhere — one being, one open moment
        _ => {
            map.insert(being_id.to_string(), conn);
            true
        }
    }
}

/// Free every being `conn` held — its moment was spent by an act, or the conn dropped. The being is
/// immediately available to the next opener.
pub fn release_being_moments(conn: u64) {
    lock(being_moments()).retain(|_, &mut owner| owner != conn);
}

struct Stamper {
    conn: u64,
    writer: Arc<Mutex<TcpStream>>,
    request: String, // the original moment message, re-run to re-rasterize the face
    basis_ord: f64,  // the FIRST moment's ord — kept across pushes
    root: PathBuf,
    last: Mutex<String>, // last face (canonical) — push only on a real change
}

fn registry() -> &'static Mutex<Vec<Arc<Stamper>>> {
    static R: OnceLock<Mutex<Vec<Arc<Stamper>>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(Vec::new()))
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// After a connection's message: register an open moment, or — on an act — close this connection's
/// open moments (it acted on the face it saw) and wake everyone whose face changed. Called by ws_loop
/// with the raw message + the reply already sent.
pub fn after_message(conn: u64, writer: &Arc<Mutex<TcpStream>>, msg: &str, root: &Path, reply: &str) {
    let req = match treehash::parse(msg.trim()) {
        Ok(r) => r,
        Err(_) => return,
    };
    let verb = field_str(&req, "verb");
    if verb.as_deref() == Some("moment") && field(&req, "id").is_some() && field(&req, "op").is_none() {
        // a reel perceive with no act yet -> an open stamper. basis = the world's now at the open.
        let basis = treestore::read_ord(root);
        let s = Arc::new(Stamper {
            conn,
            writer: writer.clone(),
            request: msg.to_string(),
            basis_ord: basis,
            root: root.to_path_buf(),
            last: Mutex::new(reply_face(reply)),
        });
        lock(registry()).push(s);
    } else if verb.as_deref() == Some("act") && reply.contains("\"ok\":true") {
        // the being ACTED -> its own open moments close; the new fact may change OTHER stampers' faces.
        close_conn(conn);
        notify_change();
    }
}

/// Drop a connection's open moments (it acted, or it disconnected). On a true disconnect the caller
/// ALSO calls `forget_conn` to drop the authenticated session; an act-close keeps the session (the Name
/// is still authenticated, only its perceive closes).
pub fn close_conn(conn: u64) {
    lock(registry()).retain(|s| s.conn != conn);
}

/// A fact landed: re-rasterize every open moment; push a fresh, basis-stamped moment to any whose face
/// changed. One rasterize per stamper (the same perceive the first moment ran).
pub fn notify_change() {
    let stampers: Vec<Arc<Stamper>> = lock(registry()).clone();
    for s in stampers {
        let fresh = crate::ibp::handle_wire(&s.request, &s.root);
        let face = reply_face(&fresh);
        {
            let mut last = lock(&s.last);
            if *last == face {
                continue; // unchanged -> nobody woken
            }
            *last = face;
        }
        let pushed = annotate_live(&fresh, s.basis_ord);
        if let Ok(mut w) = s.writer.lock() {
            ws_send_text(&mut w, &pushed);
        }
    }
}

/// The perceived face, canonicalized for change-compare (the `view` of a moment reply).
fn reply_face(reply: &str) -> String {
    match treehash::parse(reply) {
        Ok(r) => match field(&r, "view") {
            Some(v) => treehash::canonicalize(v),
            None => treehash::canonicalize(&r),
        },
        Err(_) => reply.to_string(),
    }
}

/// Mark a pushed reply as a LIVE update carrying the first moment's ord as its basis.
fn annotate_live(reply: &str, basis_ord: f64) -> String {
    match treehash::parse(reply) {
        Ok(Json::Obj(mut e)) => {
            e.push(("live".to_string(), Json::Bool(true)));
            e.push(("basis".to_string(), Json::Num(basis_ord)));
            treehash::stringify(&Json::Obj(e))
        }
        _ => reply.to_string(),
    }
}

fn field<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn field_str(v: &Json, k: &str) -> Option<String> {
    match field(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}
