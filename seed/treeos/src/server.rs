// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treeos — a standalone Rust boot of the on-disk chain, now with a front door. NO Node, NO napi, NO
// FFI: treestore reads the reels, treeverify proves them, treefold folds them, and a tiny zero-dep
// HTTP/WS server exposes that read side. The WRITE side (acts / Word execution) is a marked SEAM
// (POST /word): the kernel does not run Words — it will hand the request to the Word runtime (JS
// today, behind the seam), receive the produced facts, and stamp them via treestore. This is the
// microkernel shape of "anyone can boot": Rust owns the store + chain + transport; Word stays a worker.
//
//   cargo run -p treeos                         # one-shot boot report (read+fold+verify store/past)
//   cargo run -p treeos -- serve 127.0.0.1:7070 store/past   # serve the chain over http + ws

use std::env;
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::path::Path;
use std::thread;

use treefold::fold;
use treestore::{canonicalize, read_reel_file, verify_fact_chain, Json};

use crate::chain::{self, health, json, num_field, read_proj, reel, reels, verdict_ok, FOLD_KINDS};
use crate::wire::{read_request, respond, ws_handshake, ws_read_text, ws_send_text, Request};
use crate::{cognize, federation, ibp, live};

pub fn run() {
    load_dotenv(); // first-boot settings (STORY_DOMAIN = the story's name/alias, PORT, …) reach the runtime
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(String::as_str) == Some("serve") {
        // arg wins, else the .env defaults (PORT, STORE_NAME), else the built-ins.
        let addr = args.get(2).cloned().unwrap_or_else(default_addr);
        let root = args.get(3).cloned().unwrap_or_else(default_store);
        // advertise this reality on the LAN (dns.md phase 1) — best-effort; keep the daemon alive for the
        // serve loop so peers can discover us by name, no DNS. The self-pin is a `peer-pin` act on this
        // store's library reel, so `reality` MUST be the same alias the fold reads (story_alias).
        let reality = crate::config::story_alias();
        let port = addr.rsplit(':').next().and_then(|p| p.parse().ok()).unwrap_or(7070);
        let _mdns = crate::mdns::advertise(Path::new(&root), &reality, port);
        serve(&addr, Path::new(&root));
    } else if args.get(1).map(String::as_str) == Some("discover") {
        // find TreeOS realities on the LAN, verify each signed address-fact, pin the verified ones:
        //   treeos discover [seconds]
        let secs = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);
        let store = default_store();
        let peers = crate::mdns::discover(Path::new(&store), secs, true);
        if peers.is_empty() {
            println!("no TreeOS realities found on the LAN");
        }
        for p in &peers {
            println!("{}", treehash::stringify(p));
        }
    } else if args.get(1).map(String::as_str) == Some("peers") {
        // show the folded Peering directory (verified claimants per alias, collisions and all): treeos peers
        println!("{}", treehash::stringify(&crate::federation::peering_cache(Path::new(&default_store()))));
    } else if args.get(1).map(String::as_str) == Some("whois") {
        // resolve an alias against MY library reel's peering: where does it land, or is it ambiguous?
        //   treeos whois <alias>
        let alias = args.get(2).cloned().unwrap_or_default();
        match crate::federation::resolve_verified(Path::new(&default_store()), &alias) {
            Ok(addr) => println!("{alias} -> {addr}"),
            Err(e) => {
                println!("{e}");
                std::process::exit(1);
            }
        }
    } else if args.get(1).map(String::as_str) == Some("handshake") {
        // LIVE HANDSHAKE (dns.md Phase 2): exchange signed identities with a peer; both cache each other.
        //   treeos handshake <host:port>
        let peer = args.get(2).cloned().unwrap_or_default();
        if peer.is_empty() {
            eprintln!("usage: treeos handshake <host:port>");
            std::process::exit(1);
        }
        let alias = crate::config::story_alias();
        let my_host = crate::mdns::local_ip();
        let my_port: u16 = env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(7070);
        match crate::federation::handshake(Path::new(&default_store()), &peer, &alias, &my_host, my_port) {
            Ok(claimants) => {
                println!("handshook with {peer} — introduced myself as '{alias}', pinned {} peer(s):", claimants.len());
                for c in claimants {
                    println!("  {c}");
                }
            }
            Err(e) => {
                eprintln!("treeos handshake: {e}");
                std::process::exit(1);
            }
        }
    } else if args.get(1).map(String::as_str) == Some("pin") {
        // resolve an alias COLLISION by choosing which claimant pubkey to trust:
        //   treeos pin <alias> <pubkey>
        let (alias, pubkey) = (args.get(2).cloned().unwrap_or_default(), args.get(3).cloned().unwrap_or_default());
        if alias.is_empty() || pubkey.is_empty() {
            eprintln!("usage: treeos pin <alias> <pubkey>");
            std::process::exit(1);
        }
        match crate::federation::pin_choice(Path::new(&default_store()), &alias, &pubkey) {
            Ok(()) => println!("pinned '{alias}' -> {pubkey}"),
            Err(e) => {
                eprintln!("treeos pin: {e}");
                std::process::exit(1);
            }
        }
    } else if args.get(1).map(String::as_str) == Some("resolve") {
        // FORWARDING (dns.md Phase 6): ask a KNOWN peer who an alias is; verify + pin the reply:
        //   treeos resolve <alias> via <host:port>
        let alias = args.get(2).cloned().unwrap_or_default();
        let via = if args.get(3).map(String::as_str) == Some("via") { args.get(4).cloned() } else { args.get(3).cloned() };
        match (alias.is_empty(), via) {
            (false, Some(peer)) => match crate::federation::resolve_via_peer(Path::new(&default_store()), &peer, &alias) {
                Ok(claimants) => {
                    println!("'{alias}' resolved via {peer} — pinned {} claimant(s):", claimants.len());
                    for c in claimants {
                        println!("  {c}");
                    }
                }
                Err(e) => {
                    eprintln!("treeos resolve: {e}");
                    std::process::exit(1);
                }
            },
            _ => {
                eprintln!("usage: treeos resolve <alias> via <host:port>");
                std::process::exit(1);
            }
        }
    } else if args.get(1).map(String::as_str) == Some("genesis") {
        // (RE)PLANT A FRESH WORLD from the embedded store:  treeos genesis [store-dir]
        // The store is gitignored, so a delete is recovered here — the I reads the whole book (vocabulary
        // coined, spaces + delegates born, grants run) via treebook::full_genesis. This is pure EDGE: the
        // CLI wiring the genesis WORDS (genesis-spaces/-delegates/-home.word) to disk; it decides nothing.
        let store = args.get(2).cloned().unwrap_or_else(default_store);
        std::process::exit(plant_world(Path::new(&store)));
    } else if args.get(1).map(String::as_str) == Some("peer-fact") {
        // emit THIS reality's signed address-fact for a peer to pin in its Peering cache:
        //   treeos peer-fact <reality-domain> <host> <port> [transport]
        let reality = args.get(2).cloned().unwrap_or_else(|| "localhost".to_string());
        let host = args.get(3).cloned().unwrap_or_else(|| "127.0.0.1".to_string());
        let port: u16 = args.get(4).and_then(|p| p.parse().ok()).unwrap_or(7070);
        let transport = args.get(5).cloned().unwrap_or_else(|| "ws".to_string());
        match federation::publish_address_fact(&reality, &host, port, &transport) {
            Ok(fact) => println!("{}", treehash::stringify(&fact)),
            Err(e) => {
                eprintln!("treeos peer-fact: {e}");
                std::process::exit(1);
            }
        }
    } else {
        let root = args.get(1).cloned().unwrap_or_else(|| "store/past".to_string());
        std::process::exit(boot_report(Path::new(&root)));
    }
}

/// Load `KEY=VALUE` lines from a `.env` file into the process env (only keys not already set), so the
/// first-boot settings reach the runtime. A tiny native reader — no dotenv crate. Silent if there's no
/// `.env`. This is the ONE place `.env` is read; everything downstream reads `std::env`. Path override:
/// `TREEOS_ENV`. (The story's name/alias — STORY_DOMAIN — is NOT a DNS requirement; per philosophy/dns.md
/// a reality is its I key + a chosen alias, resolved by Peering, so this is just "whatever name they want".)
fn load_dotenv() {
    let path = env::var("TREEOS_ENV").unwrap_or_else(|_| ".env".to_string());
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return,
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let (k, v) = (k.trim(), v.trim().trim_matches('"'));
            if !k.is_empty() && env::var(k).is_err() {
                env::set_var(k, v);
            }
        }
    }
}

/// The serve address when no CLI arg: `127.0.0.1:<PORT>` (PORT from `.env`, default 7070).
fn default_addr() -> String {
    let port = env::var("PORT").ok().filter(|p| !p.is_empty()).unwrap_or_else(|| "7070".to_string());
    format!("127.0.0.1:{port}")
}

/// The store dir when no CLI arg: `store/<STORE_NAME>` (STORE_NAME from `.env`, default "past").
fn default_store() -> String {
    let name = env::var("STORE_NAME").ok().filter(|n| !n.is_empty()).unwrap_or_else(|| "past".to_string());
    format!("store/{name}")
}

// ── genesis: (re)plant a fresh world from the seed's genesis book ─────────────
fn plant_world(store: &Path) -> i32 {
    if store.exists() {
        eprintln!("treeos genesis: {} already exists — remove it first to replant", store.display());
        return 1;
    }
    match treebook::full_genesis(store) {
        Ok(b) => {
            println!(
                "world born at {}: I={} vocabulary={} spaces={} delegates={}",
                store.display(),
                b.i_name,
                b.vocabulary_coined,
                b.spaces.len(),
                b.delegates.len()
            );
            0
        }
        Err(e) => {
            eprintln!("treeos genesis failed: {e:?}");
            1
        }
    }
}

// ── one-shot boot: read + verify + fold + match the JS .proj snapshots ───────
fn boot_report(root: &Path) -> i32 {
    println!("== treeos boot (pure Rust: read . fold . verify . match-JS) ==");
    println!("   store: {}", root.display());
    let (mut facts, mut verified, mut broken, mut folded) = (0usize, 0usize, 0usize, 0usize);
    let (mut snaps, mut smatch, mut sdiff) = (0usize, 0usize, 0usize);
    let mut sample: Option<(String, String)> = None;

    let reels = chain::list_reels(root);
    for (h, k, id) in &reels {
        let f = read_reel_file(root, h, k, id, None, None);
        facts += f.len();
        if verdict_ok(&verify_fact_chain(&f)) {
            verified += 1;
        } else {
            broken += 1;
            println!("   BROKEN {h}/{k}/{id}");
        }
        if !FOLD_KINDS.contains(&k.as_str()) {
            continue;
        }
        folded += 1;
        if h != "0" {
            continue; // own-history only: a branch .proj folds a lineage this read does not union
        }
        if let Some(proj) = read_proj(root, h, k, id) {
            if let (Some(js), false) = (chain::get(&proj, "state"), chain::is_true(&proj, "tombstoned")) {
                let fseq = num_field(&proj, "foldedSeq").unwrap_or(f64::INFINITY);
                let upto: Vec<Json> = f.iter().filter(|x| num_field(x, "seq").map_or(true, |s| s <= fseq)).cloned().collect();
                let rust = fold(k, &upto);
                snaps += 1;
                if canonicalize(&rust) == canonicalize(js) {
                    smatch += 1;
                } else {
                    sdiff += 1;
                    if sdiff <= 3 {
                        println!("   FOLD DIFF {k}/{id}\n     rust: {}\n     js:   {}", canonicalize(&rust), canonicalize(js));
                    }
                }
                if sample.is_none() && k == "being" {
                    sample = Some((format!("{k}/{id}"), canonicalize(&rust)));
                }
            }
        }
    }

    println!("   reels: {}   facts: {facts}   verified: {verified}   broken: {broken}   folded: {folded}", reels.len());
    println!("   fold vs JS .proj snapshots: {smatch}/{snaps} match   ({sdiff} diff)");
    if let Some((who, st)) = sample {
        let preview: String = st.chars().take(180).collect();
        println!("   sample Rust-folded state [{who}]:\n     {preview}{}", if st.chars().count() > 180 { " ..." } else { "" });
    }
    println!("== booted on Rust alone: no Node, no FFI ==");
    if broken > 0 || sdiff > 0 {
        1
    } else {
        0
    }
}

// ── the front door: a zero-dep HTTP/WS server over the read side ─────────────
fn serve(addr: &str, root: &Path) {
    let listener = match TcpListener::bind(addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("treeos: cannot bind {addr}: {e}");
            std::process::exit(1);
        }
    };
    // PRESENT-LOOP Phase 2: rehydrate the subscription registry from the fact chain (the chain is the
    // truth of liveness; the registry is its boot-time projection). CLOCK-FREE — a chain-order fold.
    let restored = crate::subscriptions::rehydrate_at_boot(root);
    println!("== treeos serving (pure Rust kernel) on http://{addr} ==");
    println!("   store: {}", root.display());
    println!("   subscriptions rehydrated from chain: {restored}");
    println!("   GET  /health                          boot summary (counts + verify)");
    println!("   GET  /reels                           reel index");
    println!("   GET  /reel/<history>/<kind>/<id>      read + verify + fold one reel");
    println!("   POST /word  {{word,actor,history,basis?}}  WRITE -> runs the Word in Rust (treeibp::act), no Node");
    println!("   WS   /ws                              send 'history/kind/id' or 'reels', get JSON back");
    for stream in listener.incoming().flatten() {
        let root = root.to_path_buf();
        thread::spawn(move || handle(stream, &root));
    }
}

fn handle(mut stream: TcpStream, root: &Path) {
    let req = match read_request(&mut stream) {
        Some(r) => r,
        None => return,
    };
    // WebSocket upgrade on /ws
    if req.path.split('?').next() == Some("/ws") {
        if let Some(key) = req.ws_key.clone() {
            ws_handshake(&mut stream, &key);
            ws_loop(&mut stream, root);
            return;
        }
    }
    let (status, ctype, body) = route(&req, root);
    respond(&mut stream, status, ctype, &body);
}

fn route(req: &Request, root: &Path) -> (&'static str, &'static str, String) {
    let path = req.path.split('?').next().unwrap_or("");
    let segs: Vec<&str> = path.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    let get = req.method == "GET";

    if req.method == "POST" && segs == ["word"] {
        return word_seam(&req.body, root);
    }
    if req.method == "POST" && segs == ["cognize"] {
        return cognize::cognize_seam(&req.body, root);
    }
    // IBP OVER HTTP (the bridge): a GET opens a moment of the address (the RIGHT stance), a POST acts one
    // Word on the open moment it returned. A pure translator over the SAME route (`handle_wire_conn`); no
    // logic rebuilt. `GET /ibp/<address>` · `POST /ibp` (body = one Word, `X-Moment` = the moment token).
    if segs.first() == Some(&"ibp") {
        if get {
            return crate::ibp_http::get_moment(req, root);
        }
        if req.method == "POST" && segs.len() == 1 {
            return crate::ibp_http::post_act(req, root);
        }
    }
    // SEE ops are MOMENTS now, not REST routes — reach classify-matter / address over WS:
    //   {"verb":"moment","op":"classify-matter","args":{…}}
    if get && (segs.is_empty() || segs == ["health"]) {
        return ok(json(&health(root)));
    }
    if get && segs == ["reels"] {
        return ok(json(&reels(root)));
    }
    if get && segs.len() == 4 && segs[0] == "reel" {
        return ok(json(&reel(root, segs[1], segs[2], segs[3])));
    }
    ("404 Not Found", "application/json", json(&err("not found")))
}

// The WRITE side, PURE RUST. POST /word runs the Word IN the binary — treeibp::act (parse → authorize
// → rasterize → stamp), NO Node, NO subprocess. The request is { word, actor, history }; each act's
// outcome (the stamped fact, or a denial) is relayed. Able SPECS fold from the seed .word vocabulary
// in Rust (foldAbleNoun via treeibp::fold_word_able), so GRANTED ables authorize too — no Node anywhere.
fn word_seam(body: &[u8], root: &Path) -> (&'static str, &'static str, String) {
    let req = match treehash::parse(&String::from_utf8_lossy(body)) {
        Ok(r) => r,
        Err(_) => return ("400 Bad Request", "application/json", json(&err("invalid JSON body"))),
    };
    let word = match get_str(&req, "word") {
        Some(w) => w,
        None => return ("400 Bad Request", "application/json", json(&err("missing 'word'"))),
    };
    let actor = get(&req, "actor").cloned().unwrap_or(Json::Null);
    let history = get_str(&req, "history").unwrap_or("0");
    let basis = num_field(&req, "basis"); // the global ord the client perceived from (its last moment)

    // able SPECS fold from the seed .word vocabulary via treeibp::fold_word_able (foldAbleNoun, in
    // Rust) — so GRANTED ables authorize, not just i-am + owner. The vocabulary is read from
    // `seed/store/words/ables` relative to the cwd (the repo root, where `treeos serve` is launched).
    let ables_dir = std::path::Path::new("seed/store/words/ables");
    // The WORD-SOLE ops (set-being / set-space / end-space / set-matter / create-* / set-owner / …) carry
    // NO inline body in the act; their body is their co-located `.word`. THE KEYSTONE: an act naming an op
    // resolves that op's DESCRIPTOR from the CHAIN FOLD of declare-word facts (treewordfold, read through
    // treeibp::act_via_fold) — NOT a hardcoded op list. The fold says "this is a kind:op word"; the host
    // then loads its `.word` body off disk (op_word_file, the bottom-turtle path map). ANY declared op
    // resolves, not just a fixed set. Read from `seed/materials/<noun>/<op>.word` + `seed/store/words/…`.
    let materials_dir = std::path::Path::new("seed/materials");
    let store_words_dir = std::path::Path::new("seed/store/words");

    // SIGNING (the EDGE holds the key). The STORY signs its own acts (I) with the custodial story key
    // (.story/story.key, cwd-relative — the canonical key the on-disk acts verify against). A being
    // signs its OWN acts with ITS key, which the binary does NOT hold (client-side, presented when the
    // being takes its moment) — so non-story actors stay unsigned here. Key absent -> unsigned. treeibp
    // stays crypto-free; the closure is injected.
    let actor_is_story =
        get_str(&actor, "nameId") == Some("I") || get_str(&actor, "beingId") == Some("I");
    let story_seed = if actor_is_story {
        treesign::load_story_seed(std::path::Path::new(".story")).ok()
    } else {
        None
    };
    let signer = story_seed.map(|seed| {
        move |opening: &Json, fids: &[String]| -> Json {
            let payload = treesign::build_act_sig_payload(opening, fids);
            let value = treesign::sign_value(&seed, &payload);
            Json::Obj(vec![
                ("alg".to_string(), Json::Str("ed25519".to_string())),
                ("by".to_string(), Json::Str("I".to_string())),
                ("value".to_string(), Json::Str(value)),
            ])
        }
    });
    let sign_ref = signer.as_ref().map(|f| f as &dyn Fn(&Json, &[String]) -> Json);
    let outcomes = treeibp::act_via_fold(
        word,
        &actor,
        root,
        history,
        |name| treeibp::fold_word_able(name, ables_dir),
        |op, noun| treeibp::op_word_file(op, noun, materials_dir, store_words_dir),
        basis,
        sign_ref,
    );
    let results: Vec<Json> = outcomes
        .iter()
        .map(|o| match o {
            treeibp::Outcome::Authorized(fact) => Json::Obj(vec![
                ("ok".to_string(), Json::Bool(true)),
                ("fact".to_string(), fact.clone()),
                // the fact carries its landing `ord`; echo the declared `basis` so the client reads the
                // causal-staleness gap (ord - basis) straight off the response.
                ("basis".to_string(), basis.map(Json::Num).unwrap_or(Json::Null)),
            ]),
            treeibp::Outcome::Denied(reason) => Json::Obj(vec![
                ("ok".to_string(), Json::Bool(false)),
                ("reason".to_string(), Json::Str(reason.clone())),
            ]),
        })
        .collect();
    let resp = Json::Obj(vec![
        ("ok".to_string(), Json::Bool(true)),
        ("engine".to_string(), Json::Str("rust".to_string())),
        ("results".to_string(), Json::Arr(results)),
    ]);
    ok(json(&resp))
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

// The WS lane carries the TWO IBP primitives: a `moment` (perceive — SEE ops + reads) and an `act`
// (one Word). ibp::handle_wire dispatches; a non-JSON line falls back to the legacy read. The socket
// is also a LIVE channel: a `writer` clone (behind a mutex) lets the open-stampers registry (live.rs)
// push a fresh moment when a later act changes the face — replies and pushes serialize on the mutex.
fn ws_loop(stream: &mut TcpStream, root: &Path) {
    let conn = live::next_conn_id();
    let writer = match stream.try_clone() {
        Ok(w) => Arc::new(Mutex::new(w)),
        Err(_) => return,
    };
    {
        let mut w = writer.lock().unwrap_or_else(|e| e.into_inner());
        ws_send_text(&mut w, &json(&health(root))); // greet with the boot summary
    }
    while let Some(msg) = ws_read_text(stream) {
        // AUTH-AT-MOMENT: this conn IS the open-moment session. A moment proves the Name's key (then the
        // session opens); an act must ride an open authenticated moment for its actor. (ibp::handle_wire,
        // the conn-less custodial path, is for HTTP /word + federation + the live re-rasterize.)
        let reply = ibp::handle_wire_conn(&msg, root, conn);
        {
            let mut w = writer.lock().unwrap_or_else(|e| e.into_inner());
            ws_send_text(&mut w, &reply);
        }
        live::after_message(conn, &writer, &msg, root, &reply);
    }
    live::close_conn(conn); // the eyes closed — drop its open moments
    live::forget_conn(conn); // the socket closed — drop the ephemeral session (no chain write)
}

fn ok(body: String) -> (&'static str, &'static str, String) {
    ("200 OK", "application/json", body)
}
fn err(msg: &str) -> Json {
    Json::Obj(vec![("error".to_string(), Json::Str(msg.to_string()))])
}
