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

mod chain;
mod wire;

use std::env;
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::thread;

use treefold::fold;
use treestore::{canonicalize, read_reel_file, verify_fact_chain, Json};

use chain::{health, json, num_field, read_proj, reel, reels, verdict_ok, FOLD_KINDS};
use wire::{read_request, respond, ws_handshake, ws_read_text, ws_send_text, Request};

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(String::as_str) == Some("serve") {
        let addr = args.get(2).cloned().unwrap_or_else(|| "127.0.0.1:7070".to_string());
        let root = args.get(3).cloned().unwrap_or_else(|| "store/past".to_string());
        serve(&addr, Path::new(&root));
    } else {
        let root = args.get(1).cloned().unwrap_or_else(|| "store/past".to_string());
        std::process::exit(boot_report(Path::new(&root)));
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
    println!("== treeos serving (pure Rust kernel) on http://{addr} ==");
    println!("   store: {}", root.display());
    println!("   GET  /health                          boot summary (counts + verify)");
    println!("   GET  /reels                           reel index");
    println!("   GET  /reel/<history>/<kind>/<id>      read + verify + fold one reel");
    println!("   POST /word                            WRITE seam -> delegates to the Word runtime (501 today)");
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

// The WRITE side. POST /word enters the Rust front door; the kernel does NOT run Words — it DELEGATES
// to the JS Word runtime (seed/present/word/word-worker.mjs): spawn node, pipe the request in, relay
// the JSON result. The worker does the real JS stamp (commitMoment today; runWordToStore plugs in at
// the same seam). The kernel owns the store + transport; Word stays a worker. This is the "Rust host,
// JS Word" microkernel shape — the on-ramp to dropping Node.
fn word_seam(body: &[u8], root: &Path) -> (&'static str, &'static str, String) {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let worker = "seed/present/word/word-worker.mjs"; // relative to the repo root (the serve cwd)
    let mut child = match Command::new("node")
        .arg(worker)
        .arg(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return ("502 Bad Gateway", "application/json", json(&err(&format!("word worker spawn failed ({e}); is node on PATH and the cwd the repo root?"))));
        }
    };
    if let Some(mut sin) = child.stdin.take() {
        let _ = sin.write_all(body);
    } // dropped → EOF, the worker reads the full request
    let out = match child.wait_with_output() {
        Ok(o) => o,
        Err(e) => return ("502 Bad Gateway", "application/json", json(&err(&format!("word worker failed: {e}")))),
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    match stdout.lines().map(str::trim).filter(|l| !l.is_empty()).last() {
        Some(line) => ("200 OK", "application/json", line.to_string()), // relay the worker's JSON verbatim
        None => {
            let serr: String = String::from_utf8_lossy(&out.stderr).chars().take(400).collect();
            ("502 Bad Gateway", "application/json", json(&err(&format!("word worker produced no output. stderr: {serr}"))))
        }
    }
}

fn ws_loop(stream: &mut TcpStream, root: &Path) {
    ws_send_text(stream, &json(&health(root))); // greet with the boot summary
    while let Some(msg) = ws_read_text(stream) {
        let segs: Vec<&str> = msg.trim().trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
        let reply = if segs == ["reels"] {
            json(&reels(root))
        } else if segs.len() == 3 {
            json(&reel(root, segs[0], segs[1], segs[2]))
        } else {
            json(&err("ws: send 'history/kind/id' or 'reels'"))
        };
        ws_send_text(stream, &reply);
    }
}

fn ok(body: String) -> (&'static str, &'static str, String) {
    ("200 OK", "application/json", body)
}
fn err(msg: &str) -> Json {
    Json::Obj(vec![("error".to_string(), Json::Str(msg.to_string()))])
}
