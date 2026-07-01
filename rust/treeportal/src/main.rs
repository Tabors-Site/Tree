// treeportal — the native Rust moment/act browser. A thin renderer of the current moment: it holds
// only which view + input mode you're in; everything substantive IS the moment, taken from treeos
// over WebSocket. P0: connect, take a moment of a place, show the raw face; the IBP bar + word bar;
// acting auto-updates the face via the live (open-stamper) push.

// On Windows, hide the console window in release builds (keep it in debug for logs/panics).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chrome;
mod identity;
mod input;
mod state;
mod views;
mod wire;

use eframe::egui;
use treehash::Json;

use state::{Mode, PortalState, View};

fn main() -> eframe::Result<()> {
    // point at any treeos /ws:  treeportal [ws://host:port/ws]   (or TREEPORTAL_URL=…)
    let url = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("TREEPORTAL_URL").ok())
        .unwrap_or_else(|| "ws://127.0.0.1:7070/ws".into());
    let opts = eframe::NativeOptions::default();
    eframe::run_native(
        "TreeOS Portal",
        opts,
        Box::new(move |cc| {
            style::install(&cc.egui_ctx);
            let mut p = Portal::default();
            p.url = url.clone();
            Ok(Box::new(p))
        }),
    )
}

pub struct Portal {
    pub st: PortalState,
    pub wire: Option<wire::client::Wire>,
    pub vault: identity::vault::Vault,
    stamp: input::stamp::Stamp,
    url: String,
    pub history: String,
    /// the connected Story's domain (the library reel id, e.g. "localhost") — learned from each scene's
    /// address; used to render the canonical IBP bar `storyDomain#history/space@being`.
    pub story: String,
    started: bool,
    last_view: View,
    /// false until a Name is signed in — the login gate blocks the world until then.
    pub logged_in: bool,
    /// the being the active Name is driving (beingId, name) — None = bodiless (acts as the bare Name).
    /// A being holds no key; its acts are signed by the Name (nameId) it expresses.
    pub active_being: Option<(String, String)>,
}

impl Default for Portal {
    fn default() -> Self {
        Self {
            st: PortalState::default(),
            wire: None,
            vault: identity::vault::Vault::default(),
            stamp: input::stamp::Stamp::default(),
            url: "ws://127.0.0.1:7070/ws".into(),
            history: "0".into(),
            story: "localhost".into(),
            started: false,
            last_view: View::Map2d,
            logged_in: false,
            active_being: None,
        }
    }
}

impl Portal {
    /// Navigate to a real IBP address (the RIGHT stance): take a moment of it → the server resolves the
    /// path to a SCENE. `push` adds it to the back/forward stack (false for back/forward themselves).
    pub fn navigate(&mut self, address: &str, push: bool) {
        let address = if address.trim().is_empty() { "/" } else { address.trim() };
        let msg = self.moment_msg(address); // the raw address always resolves (shorthands included)
        if let Some(w) = &self.wire {
            w.send(msg);
        }
        // settle the bar to the canonical IBP form `storyDomain#history/space@being`.
        let shown = canonical_display(&self.story, &self.history, address);
        self.st.address = shown.clone();
        if push {
            self.st.nav_stack.truncate(self.st.nav_index + 1); // trim the forward future
            if self.st.nav_stack.last() != Some(&shown) {
                self.st.nav_stack.push(shown.clone());
                self.st.nav_index = self.st.nav_stack.len() - 1;
            }
        }
    }

    /// The LEFT stance (who you are), canonical + mirroring the RIGHT: `storyDomain#history/@being` when
    /// you drive a being, else the minimum `storyDomain#history/`. Rebuilt whenever the actor changes.
    pub fn left_stance_str(&self) -> String {
        match &self.active_being {
            Some((_, name)) => format!("{}#{}/@{}", self.story, self.history, name),
            None => format!("{}#{}/", self.story, self.history),
        }
    }

    /// Re-render the editable LEFT-stance buffer to its canonical form (after login / drive / branch).
    pub fn rebuild_left(&mut self) {
        self.st.left_stance = self.left_stance_str();
    }

    /// Navigate the RIGHT address field (Enter in the IBP bar).
    pub fn perceive_address(&mut self) {
        let a = self.st.address.clone();
        self.navigate(&a, true);
    }

    pub fn nav_back(&mut self) {
        if self.st.nav_index == 0 {
            return;
        }
        self.st.nav_index -= 1;
        let a = self.st.nav_stack[self.st.nav_index].clone();
        self.navigate(&a, false);
    }
    pub fn nav_forward(&mut self) {
        if self.st.nav_index + 1 >= self.st.nav_stack.len() {
            return;
        }
        self.st.nav_index += 1;
        let a = self.st.nav_stack[self.st.nav_index].clone();
        self.navigate(&a, false);
    }
    pub fn can_back(&self) -> bool {
        self.st.nav_index > 0
    }
    pub fn can_forward(&self) -> bool {
        self.st.nav_index + 1 < self.st.nav_stack.len()
    }

    /// Connect an existing vault Name (sign in) and enter the world.
    pub fn activate_name(&mut self, i: usize) {
        self.vault.active = Some(i);
        self.finish_login();
    }

    /// Enter the world after a Name is active (declare/import already set it; this confirms login). The
    /// first navigate sends a key-proven moment that authenticates the Name on the connection.
    pub fn finish_login(&mut self) {
        self.logged_in = true;
        self.st.add_msg.clear();
        self.rebuild_left();
        self.navigate("/", true);
        self.perceive_timeline();
        self.perceive_branches();
    }

    /// Sign out of the active Name — back to the login gate.
    pub fn sign_out(&mut self) {
        self.logged_in = false;
        self.st.left_stance = "@I#0".to_string();
    }

    /// Sign in with a Name + PASSWORD (Model B): ask the story for the Name's ENCRYPTED key blob; the
    /// reply (handle_name_key) decrypts it LOCALLY with the password. The password never goes on the wire.
    pub fn sign_in_password(&mut self) {
        let name = self.st.login_name.trim().to_string();
        let pw = self.st.login_password.clone();
        if name.is_empty() || pw.is_empty() {
            self.st.add_msg = "enter a name and a password".into();
            return;
        }
        self.st.pending_password = Some(pw);
        match &self.wire {
            Some(w) => {
                w.send(wire::proto::moment_name_key(&name));
                self.st.add_msg = "unlocking…".into();
            }
            None => self.st.add_msg = "not connected".into(),
        }
    }

    /// A name-key moment arrived: decrypt the blob CLIENT-SIDE with the pending password, unlock the
    /// vault, and enter. Wrong password or no registration → a local message (nothing leaks to the server).
    fn handle_name_key(&mut self, raw: &Json) {
        let pw = match self.st.pending_password.take() {
            Some(p) => p,
            None => return,
        };
        let view = wire::proto::get(raw, "view");
        let blob = view
            .and_then(|v| wire::proto::get(v, "privateKeyEnc"))
            .and_then(|b| if let Json::Str(s) = b { Some(s.clone()) } else { None });
        let label = view
            .and_then(|v| wire::proto::get(v, "name"))
            .and_then(|b| if let Json::Str(s) = b { Some(s.clone()) } else { None })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| self.st.login_name.trim().to_string());
        match blob {
            Some(b) if !b.is_empty() => match self.vault.unlock_with_password(&label, &b, &pw) {
                Ok(()) => {
                    self.st.login_password.clear();
                    self.st.add_msg.clear();
                    self.finish_login();
                }
                Err(e) => self.st.add_msg = e,
            },
            _ => self.st.add_msg = "no such name, or it has no password set".into(),
        }
    }

    /// Fill the history bar's timeline from a `timeline` moment reply (the history's moments).
    fn handle_timeline(&mut self, raw: &Json) {
        let moments = wire::proto::get(raw, "view").and_then(|v| wire::proto::get(v, "moments"));
        let mut out = Vec::new();
        if let Some(Json::Arr(items)) = moments {
            for m in items {
                let ord = match wire::proto::get(m, "ord") {
                    Some(Json::Num(n)) => *n,
                    _ => continue,
                };
                let phrase = match wire::proto::get(m, "phrase") {
                    Some(Json::Str(s)) => s.clone(),
                    _ => String::new(),
                };
                out.push((ord, phrase));
            }
        }
        self.st.timeline = out;
    }

    /// Fill the branch tree from a `branches` moment reply.
    fn handle_branches(&mut self, raw: &Json) {
        let hs = wire::proto::get(raw, "view").and_then(|v| wire::proto::get(v, "histories"));
        let mut out = Vec::new();
        if let Some(Json::Arr(items)) = hs {
            for h in items {
                let s = |k: &str| match wire::proto::get(h, k) {
                    Some(Json::Str(v)) => Some(v.clone()),
                    _ => None,
                };
                let path = match s("path") {
                    Some(p) => p,
                    None => continue,
                };
                out.push(crate::state::Branch {
                    label: s("label").unwrap_or_else(|| path.clone()),
                    parent: s("parent"),
                    path,
                    fork_ord: None,
                });
            }
        }
        self.st.branches = out;
    }

    /// Set or change the active Name's password: encrypt its key with the password and write it to the
    /// story (name:declare on the library reel, AS the I). Also registers a freshly-generated Name.
    pub fn set_name_password(&mut self) {
        let pw = self.st.set_password.clone();
        if pw.len() < 6 {
            self.st.add_msg = "choose a password of at least 6 characters".into();
            return;
        }
        let (nid, label) = match self.vault.active_name() {
            Some(n) => (n.name_id.clone(), n.label.clone()),
            None => {
                self.st.add_msg = "load a key first".into();
                return;
            }
        };
        let blob = match self.vault.encrypted_blob(&pw) {
            Some(b) => b,
            None => {
                self.st.add_msg = "could not encrypt the key".into();
                return;
            }
        };
        // AS the I — name creation/registration is an I act (custodial).
        let actor = wire::proto::actor_i();
        if let Some(w) = &self.wire {
            w.send(wire::proto::act_name_declare("name-declare", &nid, &label, &blob, &actor));
            self.st.set_password.clear();
            self.st.add_msg = format!("password set for @{label} — stored in the story");
        }
    }

    /// Apply the edited LEFT stance: `#history` switches the branch you act on now. (@being switches the
    /// being you drive and the path moves your position — both wired with the being tabs in P3.)
    pub fn apply_left_stance(&mut self) {
        let s = self.st.left_stance.clone();
        let mut branch_changed = false;
        if let Some(i) = s.find('#') {
            let rest = &s[i + 1..];
            let end = rest.find(['/', '@']).unwrap_or(rest.len());
            let h = &rest[..end];
            if !h.is_empty() && h != self.history {
                self.history = h.to_string();
                branch_changed = true;
            }
        }
        self.rebuild_left(); // settle the buffer to canonical
        if branch_changed {
            self.reperceive_current(); // the RIGHT view re-folds on the new branch
        }
    }

    /// The actor: the active Name driving a being `{beingId, nameId, name}`, else the bare Name
    /// `{nameId, name}`, else I (anonymous). The Name's key signs/authenticates either way.
    fn actor(&self) -> Json {
        match (self.vault.active_name(), &self.active_being) {
            (Some(n), Some((bid, bname))) => wire::proto::actor_being(bid, &n.name_id, bname),
            (Some(n), None) => wire::proto::actor_name(&n.name_id, &n.label),
            (None, _) => wire::proto::actor_i(),
        }
    }

    /// The LEFT-stance label (who you are): @being (driving), else @name, else @I.
    pub fn actor_label(&self) -> String {
        if let Some((_, bname)) = &self.active_being {
            return format!("@{bname}");
        }
        match self.vault.active_name() {
            Some(n) => format!("@{}", n.label),
            None => "@I".to_string(),
        }
    }

    /// The beingless-Name banner: a new Name has no body, so it guides you to be born through @cherub.
    /// Birth is an I act (`I make <name>` → a be:birth) spoken THROUGH the being that's present — cherub
    /// as mother, @arrival as father. It's not cherub logic; cherub is just who you address. The hint
    /// shows the Word to say and a button that targets @cherub so the word bar calls it.
    fn birth_hint(&mut self, ctx: &egui::Context) {
        // find @cherub in the current scene (the being present to be born through)
        let cherub = self
            .st
            .moment
            .as_ref()
            .and_then(|m| wire::proto::get(&m.raw, "view"))
            .and_then(|v| wire::proto::get(v, "beings"))
            .and_then(|b| if let Json::Arr(a) = b { Some(a.clone()) } else { None })
            .and_then(|a| {
                a.iter().find_map(|n| {
                    let name = if let Some(Json::Str(s)) = wire::proto::get(n, "being") { s.clone() } else { return None };
                    if name == "cherub" {
                        let id = if let Some(Json::Str(s)) = wire::proto::get(n, "id") { s.clone() } else { String::new() };
                        Some((id, name))
                    } else {
                        None
                    }
                })
            });
        let mut target_cherub = false;
        egui::TopBottomPanel::top("birth_hint").show(ctx, |ui| {
            ui.add_space(4.0);
            ui.horizontal_wrapped(|ui| {
                ui.label(egui::RichText::new("✦ you have no being yet").color(egui::Color32::from_rgb(226, 197, 116)).strong());
                ui.label("— give yourself a being: say, in the word bar below (\"I\" = you, your Name):");
                ui.code("I am <YourBeingName>.");
                if cherub.is_some() {
                    if ui.button("talk to @cherub").on_hover_text("address cherub so your Word calls it").clicked() {
                        target_cherub = true;
                    }
                } else {
                    ui.label(egui::RichText::new("(no @cherub in view — go to /)").small().weak());
                }
            });
            ui.add_space(4.0);
        });
        if target_cherub {
            if let Some((id, name)) = cherub {
                self.select_being(&id, &name);
            }
        }
    }

    /// Select a being as the RIGHT-stance TARGET (click-being): a Word typed in the word bar then CALLS
    /// it (`@being hello`). Sets the address's `@being` so the IBP bar mirrors the selection.
    pub fn select_being(&mut self, being_id: &str, name: &str) {
        self.st.target_being = Some((being_id.to_string(), name.to_string()));
        // reflect the target in the RIGHT address (…@being) — replace any existing @segment.
        let base = self.st.address.split('@').next().unwrap_or("/").to_string();
        self.st.address = format!("{base}@{name}");
        self.st.log.push(format!("target @{name}"));
    }

    /// Drive a being the active Name owns (pull it / be:connect). Its acts are signed by the Name.
    pub fn drive_being(&mut self, being_id: &str, name: &str) {
        self.active_being = Some((being_id.to_string(), name.to_string()));
        self.rebuild_left();
        self.st.log.push(format!("driving @{name}"));
    }

    /// Build a moment message for an address, SIGNED with the active Name's key-proof so the server
    /// authenticates it at the moment (anonymous/I moments carry no proof and need none).
    /// Sign a moment req (if a Name is active — the server verifies the key-proof at the moment) + stringify.
    fn finalize_moment(&self, mut req: Json) -> String {
        if let Some(name_id) = wire::proto::actor_name_id(&self.actor()) {
            if let Some(sig) = self.vault.sign_moment(&name_id, &req) {
                if let Json::Obj(e) = &mut req {
                    e.push(("proof".to_string(), Json::Obj(vec![("value".to_string(), Json::Str(sig))])));
                }
            }
        }
        treehash::stringify(&req)
    }

    fn moment_msg(&self, address: &str) -> String {
        let mut req = wire::proto::moment_req(address, &self.history, &self.actor());
        // time-travel: perceive the place AS OF a past ord (the history scrubber).
        if let Some(at) = self.st.at_ord {
            if let Json::Obj(e) = &mut req {
                e.push(("at".to_string(), Json::Num(at)));
            }
        }
        self.finalize_moment(req)
    }

    /// Fetch the history's TIMELINE (the moments the history bar scrubs). Read as I (a plain read).
    pub fn perceive_timeline(&mut self) {
        if let Some(w) = &self.wire {
            w.send(wire::proto::moment_timeline(&self.history));
        }
    }

    /// Fetch the branch tree (main + every live history) for the history bar's switcher.
    pub fn perceive_branches(&mut self) {
        if let Some(w) = &self.wire {
            w.send(wire::proto::moment_branches());
        }
    }

    /// Switch the branch you stand on: your acts now land on `path`, and every view re-folds through it.
    pub fn switch_history(&mut self, path: &str) {
        if self.history == path {
            return;
        }
        self.history = path.to_string();
        self.st.at_ord = None; // a fresh branch view starts live
        self.rebuild_left();
        let a = self.st.address.clone();
        self.navigate(&a, false);
        self.perceive_timeline();
        self.st.log.push(format!("on branch #{path}"));
    }

    /// Fork a NEW history off main at the current scrubber position (None = now) and switch onto it.
    pub fn create_branch(&mut self, label: &str) {
        let at = self.st.at_ord;
        let actor = wire::proto::actor_i(); // branching is an I act
        if let Some(w) = &self.wire {
            w.send(wire::proto::act_create_branch(label, at, &actor));
            self.st.log.push(format!("forking branch '{label}'…"));
        }
    }

    /// Perceive the RAIN: your Name's beings (as a driven being → its Name via trueName), else story-wide.
    pub fn perceive_rain(&mut self) {
        let addr = match &self.active_being {
            Some((_, name)) => format!("@{name}"),
            None => "/".to_string(),
        };
        let mut req = wire::proto::moment_req(&addr, &self.history, &self.actor());
        if let Json::Obj(e) = &mut req {
            e.push(("rain".to_string(), Json::Bool(true)));
        }
        let msg = self.finalize_moment(req);
        if let Some(w) = &self.wire {
            w.send(msg);
        }
    }

    /// Speak one Word (act) AS the active being. The result returns as the live re-rasterized moment.
    pub fn say_word(&mut self, word: &str) {
        let actor = self.actor();
        if let Some(w) = &self.wire {
            w.send(wire::proto::act_word(word, &self.history, &actor));
        }
        self.st.log.push(format!("→ {word}"));
    }

    /// Take a STORY moment — the past written as Word, of the active being (else the genesis I-Am being),
    /// projected into the active language. Read as I (anonymous read, no proof).
    pub fn perceive_story(&mut self) {
        let (kind, id) = match &self.active_being {
            Some((bid, _)) => ("being".to_string(), bid.clone()),
            None => ("being".to_string(), "i-am".to_string()),
        };
        let actor = wire::proto::actor_i();
        if let Some(w) = &self.wire {
            w.send(wire::proto::moment_story(&kind, &id, &self.history, &self.st.lang, &actor));
        }
    }

    /// Re-perceive whatever the active view needs (after a language change, etc.).
    pub fn reperceive_current(&mut self) {
        match self.st.view {
            View::Story => self.perceive_story(),
            View::Rain => self.perceive_rain(),
            View::FourD => self.perceive_branches(),
            View::Map2d | View::World3d | View::Explorer => {
                let a = self.st.address.clone();
                self.navigate(&a, false);
            }
        }
    }

    /// Take a moment of the library reel (the history bar) — it folds to the histories.
    pub fn perceive_library(&mut self) {
        let domain = "localhost"; // the story domain (from config later)
        let actor = wire::proto::actor_i();
        if let Some(w) = &self.wire {
            w.send(wire::proto::moment_library(domain, &self.history, &actor));
        }
        self.st.address = format!("library/{domain}");
    }
}

impl eframe::App for Portal {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // connect once + take a moment of the story root (the scene)
        if !self.started {
            self.started = true;
            self.wire = Some(wire::client::spawn(self.url.clone(), ctx.clone()));
            // no pre-login read — the world opens only after a Name signs in (finish_login navigates).
        }

        // drain inbound moments (replies + live pushes)
        let mut incoming = Vec::new();
        if let Some(w) = &self.wire {
            while let Ok(t) = w.inbox.try_recv() {
                incoming.push(t);
            }
        }
        for t in incoming {
            let rx = wire::proto::parse_received(&t);
            // a name+password sign-in reply: decrypt the fetched key locally, then enter.
            if matches!(wire::proto::get(&rx.raw, "op"), Some(Json::Str(s)) if s == "name-key") {
                self.handle_name_key(&rx.raw);
                continue;
            }
            // a timeline reply: fill the history bar's dots.
            if matches!(wire::proto::get(&rx.raw, "op"), Some(Json::Str(s)) if s == "timeline") {
                self.handle_timeline(&rx.raw);
                continue;
            }
            // a branches reply: fill the history bar's branch tree.
            if matches!(wire::proto::get(&rx.raw, "op"), Some(Json::Str(s)) if s == "branches") {
                self.handle_branches(&rx.raw);
                continue;
            }
            // a create-branch result: switch onto the fresh branch + refresh the tree.
            if matches!(wire::proto::get(&rx.raw, "op"), Some(Json::Str(s)) if s == "create-branch") {
                if let Some(path) = wire::proto::get(&rx.raw, "history").and_then(|h| wire::proto::get(h, "path")).and_then(|p| if let Json::Str(s) = p { Some(s.clone()) } else { None }) {
                    self.switch_history(&path);
                }
                self.perceive_branches();
                continue;
            }
            match rx.kind {
                wire::proto::RxKind::Moment => {
                    // read the timeline's right edge (now) from the scene, for the history scrubber
                    if let Some(v) = wire::proto::get(&rx.raw, "view") {
                        if let Some(Json::Num(o)) = wire::proto::get(v, "ord") {
                            self.st.now_ord = *o;
                        }
                        // learn the Story's domain from the scene address, for the canonical IBP bar
                        if let Some(addr) = wire::proto::get(v, "address") {
                            if let Some(Json::Str(dom)) = wire::proto::get(addr, "story") {
                                if !dom.is_empty() {
                                    self.story = dom.clone();
                                }
                            }
                        }
                    }
                    self.st.moment = Some(rx);
                }
                wire::proto::RxKind::Act => {
                    let ok = matches!(wire::proto::get(&rx.raw, "ok"), Some(Json::Bool(true)));
                    self.st.log.push(if ok { "act ok".into() } else { format!("act: {}", short_reason(&rx.raw)) });
                    if ok {
                        self.perceive_timeline(); // a new moment landed — refresh the history bar dots
                    }
                }
                wire::proto::RxKind::Other => {
                    self.st.log.push(format!("· {}", rx.pretty.lines().next().unwrap_or("")));
                }
            }
        }

        // THE NAME GATE: no Name signed in -> the full-screen login blocks the world entirely.
        if !self.logged_in {
            chrome::login::show(ctx, self);
            return;
        }

        // Escape toggles input mode
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.st.mode = match self.st.mode {
                Mode::Manual => Mode::Stamp,
                Mode::Stamp => Mode::Manual,
            };
        }

        // MANUAL mode: capture typed keys into the composer (the keyboard ACT/FACT model) — but only
        // when no text field (the address bar) is focused, so editing the address still works.
        if self.st.mode == Mode::Manual {
            let typing_in_field = ctx.memory(|m| m.focused().is_some());
            if !typing_in_field {
                let mut sends: Vec<String> = Vec::new();
                let mut ended = false;
                ctx.input(|i| {
                    for ev in &i.events {
                        match ev {
                            egui::Event::Text(t) => {
                                for ch in t.chars() {
                                    let o = self.st.composer.feed(ch);
                                    if let Some(w) = o.send {
                                        sends.push(w);
                                    }
                                    ended |= o.end;
                                }
                            }
                            egui::Event::Key { key: egui::Key::Enter, pressed: true, .. } => {
                                let o = self.st.composer.enter();
                                if let Some(w) = o.send {
                                    sends.push(w);
                                }
                                ended |= o.end;
                            }
                            egui::Event::Key { key: egui::Key::Backspace, pressed: true, .. } => self.st.composer.backspace(),
                            _ => {}
                        }
                    }
                });
                if self.st.per_word {
                    for w in sends {
                        self.say_word(&w);
                    }
                } else if ended {
                    let stmt = self.st.composer.statement();
                    if !stmt.trim().is_empty() {
                        self.say_word(stmt.trim());
                    }
                }
                if ended {
                    self.st.composer.end_clear();
                }
            }
        }

        // STAMP mode: keys held form a chord; on release the chord is sent to the server as an act.
        // No client keymap — the server interprets the chord. Paused while editing the address.
        if self.st.mode == Mode::Stamp {
            let typing_in_field = ctx.memory(|m| m.focused().is_some());
            let down = ctx.input(|i| i.keys_down.iter().cloned().collect::<Vec<_>>());
            if !typing_in_field {
                if let Some(chord) = self.stamp.resolve(&down) {
                    self.say_word(&chord);
                    self.st.last_act = chord;
                }
            }
        }

        // switching view re-perceives what that view needs (story render / rain / the place scene)
        if self.st.view != self.last_view {
            match self.st.view {
                View::Story => self.perceive_story(),
                View::Rain => self.perceive_rain(),
                View::FourD => self.perceive_branches(),
                View::Map2d | View::World3d | View::Explorer => {
                    let a = self.st.address.clone();
                    self.navigate(&a, false);
                }
            }
            self.last_view = self.st.view;
        }

        chrome::tabs::show(ctx, self); // per-being tabs, topmost
        chrome::ibp_bar::show(ctx, self);
        // a new Name has no being yet — guide them to be born through @cherub (the I births; cherub is
        // just the being present to speak the birth Word through — as mother, @arrival as father).
        if self.logged_in && self.active_being.is_none() {
            self.birth_hint(ctx);
        }
        chrome::word_bar::show(ctx, self); // very bottom
        chrome::history_bar::show(ctx, self); // above the word bar

        // the Rain side panel: a clicked being's column → name + jump into 2D/Story or drive it
        if let Some((bid, bname)) = self.st.side_being.clone() {
            egui::SidePanel::right("rain_side").resizable(false).default_width(230.0).show(ctx, |ui| {
                ui.add_space(8.0);
                ui.label(egui::RichText::new(format!("@{bname}")).size(18.0).strong());
                ui.label(egui::RichText::new(&bid[..bid.len().min(16)]).monospace().small().weak());
                ui.separator();
                ui.label(egui::RichText::new("its projection in your language lands with the story render.").small().weak());
                ui.add_space(8.0);
                if ui.button("drive this being").clicked() {
                    self.drive_being(&bid, &bname);
                }
                if ui.button("enter Story").clicked() {
                    self.drive_being(&bid, &bname); // so the story is THIS being's
                    self.st.view = View::Story;
                    self.st.side_being = None;
                }
                if ui.button("enter 2D").clicked() {
                    self.drive_being(&bid, &bname);
                    self.st.view = View::Map2d;
                    self.st.side_being = None;
                }
                ui.add_space(6.0);
                if ui.button("close").clicked() {
                    self.st.side_being = None;
                }
            });
        }

        egui::CentralPanel::default().show(ctx, |ui| match self.st.view {
            // the spatial view: 2D map (follow-cam) on the LEFT, 3D first-person on the RIGHT, side by side.
            View::Map2d | View::World3d => {
                ui.columns(2, |c| {
                    views::map2d::show(&mut c[0], self);
                    views::world3d::show(&mut c[1], self);
                });
            }
            View::Story => views::story::show(ui, self),
            View::Rain => views::rain::show(ui, self),
            View::Explorer => views::explorer::show(ui, self),
            View::FourD => views::fourd::show(ui, self),
        });
    }
}

/// The raw-face debug render (kept as a fallback; the three views now have real renderers).
#[allow(dead_code)]
fn raw_face(ui: &mut egui::Ui, p: &Portal) {
    egui::ScrollArea::both().auto_shrink([false, false]).show(ui, |ui| {
        match &p.st.moment {
            Some(m) => {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new(format!("{} view", p.st.view.label())).weak().small());
                    if m.live {
                        ui.label(egui::RichText::new("· live").color(egui::Color32::from_rgb(90, 200, 130)).small());
                    }
                });
                let face = wire::proto::get(&m.raw, "view")
                    .map(|v| wire::proto::pretty(v, 0))
                    .unwrap_or_else(|| m.pretty.clone());
                ui.add(egui::Label::new(egui::RichText::new(face).monospace()).selectable(true));
            }
            None => {
                ui.add_space(20.0);
                ui.weak("taking a moment…");
            }
        }
        if !p.st.log.is_empty() {
            ui.add_space(12.0);
            ui.separator();
            for l in p.st.log.iter().rev().take(8) {
                ui.label(egui::RichText::new(l).weak().small().monospace());
            }
        }
    });
}

/// Pull `results[0].reason` from a failed act reply for the log.
fn short_reason(raw: &Json) -> String {
    if let Some(Json::Arr(rs)) = wire::proto::get(raw, "results") {
        if let Some(first) = rs.first() {
            if let Some(Json::Str(r)) = wire::proto::get(first, "reason") {
                return r.clone();
            }
        }
    }
    "?".into()
}

/// Render an address to the canonical IBP display form `storyDomain#history/space@being` — history is
/// ALWAYS shown (unlike a URL's omitted default), per the bar's spec. Parses + expands against the
/// ambient story/branch; falls back to the raw text while it's mid-edit or unparseable.
fn canonical_display(story: &str, history: &str, address: &str) -> String {
    let ctx = treeaddress::Ctx {
        current_story: Some(story.to_string()),
        current_history: Some(history.to_string()),
        ..Default::default()
    };
    match treeaddress::parse(address, &ctx) {
        Ok(a) => {
            let s = treeaddress::expand(&a, &ctx).right;
            let st = s.story.clone().unwrap_or_else(|| story.to_string());
            let h = s.history.clone().unwrap_or_else(|| history.to_string());
            let p = s.path.clone().unwrap_or_else(|| "/".to_string());
            let b = s.being.as_ref().map(|b| format!("@{b}")).unwrap_or_default();
            format!("{st}#{h}{p}{b}")
        }
        Err(_) => address.to_string(),
    }
}

mod style {
    use eframe::egui;

    /// The sleek, words-first look: near-black canvas, one accent, quiet flat chrome — not default egui.
    pub fn install(ctx: &egui::Context) {
        let mut v = egui::Visuals::dark();
        v.panel_fill = egui::Color32::from_rgb(12, 12, 14);
        v.window_fill = egui::Color32::from_rgb(12, 12, 14);
        v.extreme_bg_color = egui::Color32::from_rgb(8, 8, 10);
        v.override_text_color = Some(egui::Color32::from_rgb(222, 222, 228));
        v.widgets.noninteractive.bg_stroke.color = egui::Color32::from_rgb(30, 30, 36);
        v.widgets.inactive.bg_fill = egui::Color32::from_rgb(22, 22, 26);
        v.selection.bg_fill = egui::Color32::from_rgb(50, 90, 170);
        ctx.set_visuals(v);

        let mut style = (*ctx.style()).clone();
        style.spacing.item_spacing = egui::vec2(8.0, 6.0);
        ctx.set_style(style);
    }
}
