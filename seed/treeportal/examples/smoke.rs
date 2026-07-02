// smoke: prove tungstenite (the portal's WS client) handshakes with the treeos WS server, reads the
// greeting, takes a moment of the index, and reads the face back. Run: cargo run --example smoke <url>
use std::io::ErrorKind;
use std::time::Duration;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message};

fn main() {
    let url = std::env::args().nth(1).unwrap_or_else(|| "ws://127.0.0.1:7799/ws".into());
    let (mut sock, _r) = connect(url.as_str()).expect("ws connect/handshake");
    if let MaybeTlsStream::Plain(s) = sock.get_ref() {
        s.set_read_timeout(Some(Duration::from_millis(600))).ok();
    }
    if let Ok(Message::Text(t)) = sock.read() {
        println!("GREET  {}", &t[..t.len().min(90)]);
    }
    sock.send(Message::Text("{\"verb\":\"moment\"}".into())).unwrap();
    for _ in 0..6 {
        match sock.read() {
            Ok(Message::Text(t)) => {
                println!("MOMENT {}", &t[..t.len().min(220)]);
                return;
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => {}
            Err(e) => {
                println!("ERR {e}");
                return;
            }
        }
    }
}
