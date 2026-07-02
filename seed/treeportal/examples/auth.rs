// auth: prove the portal's name auth aligns with the server gate. A fresh Name (1) acts before any
// moment -> REJECTED; (2) opens a SIGNED moment -> authenticated + the scene; (3) acts -> rides the
// session. Run: cargo run --example auth ws://127.0.0.1:7799/ws
use std::io::ErrorKind;
use std::time::Duration;
use treehash::Json;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message};

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn send(s: &mut tungstenite::WebSocket<MaybeTlsStream<std::net::TcpStream>>, t: &str) {
    s.send(Message::Text(t.to_string())).unwrap();
}
fn read(s: &mut tungstenite::WebSocket<MaybeTlsStream<std::net::TcpStream>>) -> String {
    for _ in 0..8 {
        match s.read() {
            Ok(Message::Text(t)) => return t,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => {}
            Err(_) => return String::new(),
        }
    }
    String::new()
}
fn cut(s: &str) -> String {
    s.chars().take(140).collect()
}

fn main() {
    let url = std::env::args().nth(1).unwrap_or_else(|| "ws://127.0.0.1:7799/ws".into());
    let m = treesign::generate_mnemonic().unwrap();
    let seed = treesign::mnemonic_to_seed(&m, None).unwrap();
    let name_id = treesign::keypair_from_seed(&seed).name_id;
    println!("Name {name_id}");

    let (mut s, _) = connect(url.as_str()).expect("connect");
    if let MaybeTlsStream::Plain(t) = s.get_ref() {
        t.set_read_timeout(Some(Duration::from_millis(600))).ok();
    }
    read(&mut s); // greeting

    let actor = obj(vec![("nameId", jstr(&name_id)), ("name", jstr("tester"))]);
    let act = obj(vec![("verb", jstr("act")), ("word", jstr("i am")), ("actor", actor.clone()), ("history", jstr("0"))]);

    // 1) act before any moment -> rejected
    send(&mut s, &treehash::stringify(&act));
    println!("1 act-before-moment : {}", cut(&read(&mut s)));

    // 2) a signed moment -> authenticates
    let mut req = obj(vec![("verb", jstr("moment")), ("actor", actor.clone()), ("address", jstr("/")), ("history", jstr("0"))]);
    let sig = treesign::sign_moment_proof(&seed, &name_id, &req);
    if let Json::Obj(e) = &mut req {
        e.push(("proof".to_string(), obj(vec![("value", jstr(&sig))])));
    }
    send(&mut s, &treehash::stringify(&req));
    println!("2 signed-moment     : {}", cut(&read(&mut s)));

    // 3) act now rides the open authenticated moment
    send(&mut s, &treehash::stringify(&act));
    println!("3 act-after-moment  : {}", cut(&read(&mut s)));
}
