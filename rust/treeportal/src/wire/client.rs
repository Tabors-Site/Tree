// wire/client.rs — the WS client on a background thread. One socket, one event loop: drain outbound
// moment/act requests, then a timed read for incoming moments (replies + live pushes). Each inbound
// message wakes the egui frame (request_repaint) so the active view re-renders live.

use std::io::ErrorKind;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use eframe::egui;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message};

#[derive(Clone)]
pub enum Status {
    Connecting,
    Open,
    Closed(String),
}

pub struct Wire {
    out: Sender<String>,
    pub inbox: Receiver<String>,
    status: Arc<Mutex<Status>>,
}

impl Wire {
    /// Queue a moment/act request; the background thread sends it on the socket.
    pub fn send(&self, msg: String) {
        let _ = self.out.send(msg);
    }
    pub fn status(&self) -> Status {
        self.status.lock().map(|s| s.clone()).unwrap_or(Status::Closed("lock poisoned".into()))
    }
}

/// Connect to a treeos `/ws` endpoint and run the event loop on a thread. `ctx` is woken on each
/// inbound message and on status changes.
pub fn spawn(url: String, ctx: egui::Context) -> Wire {
    let (out_tx, out_rx) = channel::<String>();
    let (in_tx, in_rx) = channel::<String>();
    let status = Arc::new(Mutex::new(Status::Connecting));
    let st = status.clone();
    let wake = ctx.clone();
    let set = move |st: &Arc<Mutex<Status>>, s: Status| {
        if let Ok(mut g) = st.lock() {
            *g = s;
        }
        wake.request_repaint();
    };

    std::thread::spawn(move || {
        let (mut sock, _resp) = match connect(url.as_str()) {
            Ok(x) => x,
            Err(e) => {
                set(&st, Status::Closed(format!("connect {url}: {e}")));
                return;
            }
        };
        // a short read timeout lets us interleave sends with reads on the one socket.
        if let MaybeTlsStream::Plain(s) = sock.get_ref() {
            let _ = s.set_read_timeout(Some(Duration::from_millis(40)));
        }
        set(&st, Status::Open);

        loop {
            while let Ok(req) = out_rx.try_recv() {
                if sock.send(Message::Text(req)).is_err() {
                    set(&st, Status::Closed("send failed".into()));
                    return;
                }
            }
            match sock.read() {
                Ok(Message::Text(t)) => {
                    let _ = in_tx.send(t);
                    ctx.request_repaint();
                }
                Ok(Message::Close(_)) => {
                    set(&st, Status::Closed("server closed".into()));
                    return;
                }
                Ok(_) => {}
                Err(tungstenite::Error::Io(e)) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => {}
                Err(e) => {
                    set(&st, Status::Closed(format!("{e}")));
                    return;
                }
            }
        }
    });

    Wire { out: out_tx, inbox: in_rx, status }
}
