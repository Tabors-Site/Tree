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
        let msg = self.moment_msg(address);
        if let Some(w) = &self.wire {
            w.send(msg);
        }
        self.st.address = address.to_string();
        if push {
            self.st.nav_stack.truncate(self.st.nav_index + 1); // trim the forward future
            if self.st.nav_stack.last().map(String::as_str) != Some(address) {
                self.st.nav_stack.push(address.to_string());
                self.st.nav_index = self.st.nav_stack.len() - 1;
            }
        }
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
        if let Some(n) = self.vault.active_name() {
            self.st.left_stance = format!("@{}#{}", n.label, self.history);
        }
        self.navigate("/", true);
    }

    /// Sign out of the active Name — back to the login gate.
    pub fn sign_out(&mut self) {
        self.logged_in = false;
        self.st.left_stance = "@I#0".to_string();
    }

    /// Apply the edited LEFT stance: `#history` switches the branch you act on now. (@being switches the
    /// being you drive and the path moves your position — both wired with the being tabs in P3.)
    pub fn apply_left_stance(&mut self) {
        let s = self.st.left_stance.clone();
        if let Some(i) = s.find('#') {
            let rest = &s[i + 1..];
            let end = rest.find(['/', '@']).unwrap_or(rest.len());
            let h = &rest[..end];
            if !h.is_empty() {
                self.history = h.to_string();
            }
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

    /// Drive a being the active Name owns (pull it / be:connect). Its acts are signed by the Name.
    pub fn drive_being(&mut self, being_id: &str, name: &str) {
        self.active_being = Some((being_id.to_string(), name.to_string()));
        self.st.left_stance = format!("@{name}#{}", self.history);
        self.st.log.push(format!("driving @{name}"));
    }

    /// Build a moment message for an address, SIGNED with the active Name's key-proof so the server
    /// authenticates it at the moment (anonymous/I moments carry no proof and need none).
    fn moment_msg(&self, address: &str) -> String {
        let actor = self.actor();
        let mut req = wire::proto::moment_req(address, &self.history, &actor);
        if let Some(name_id) = wire::proto::actor_name_id(&actor) {
            if let Some(sig) = self.vault.sign_moment(&name_id, &req) {
                if let Json::Obj(e) = &mut req {
                    e.push(("proof".to_string(), Json::Obj(vec![("value".to_string(), Json::Str(sig))])));
                }
            }
        }
        treehash::stringify(&req)
    }

    /// Speak one Word (act) AS the active being. The result returns as the live re-rasterized moment.
    pub fn say_word(&mut self, word: &str) {
        let actor = self.actor();
        if let Some(w) = &self.wire {
            w.send(wire::proto::act_word(word, &self.history, &actor));
        }
        self.st.log.push(format!("→ {word}"));
    }

    /// Take a STORY moment — the kernel's render of a name's Words. Of the addressed being, else I.
    pub fn perceive_story(&mut self) {
        let a = self.st.address.trim().to_string();
        let actor = wire::proto::actor_i();
        let (kind, id) = match a.split_once('/') {
            Some((k, i)) if !i.is_empty() => (k.to_string(), i.to_string()),
            _ => ("being".to_string(), "i-am".to_string()),
        };
        if let Some(w) = &self.wire {
            w.send(wire::proto::moment_story(&kind, &id, &self.history, &actor));
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
            match rx.kind {
                wire::proto::RxKind::Moment => self.st.moment = Some(rx),
                wire::proto::RxKind::Act => {
                    let ok = matches!(wire::proto::get(&rx.raw, "ok"), Some(Json::Bool(true)));
                    self.st.log.push(if ok { "act ok".into() } else { format!("act: {}", short_reason(&rx.raw)) });
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

        // switching to the Story view takes a story moment (the kernel render of a name's Words)
        if self.st.view != self.last_view {
            if self.st.view == View::Story {
                self.perceive_story();
            }
            self.last_view = self.st.view;
        }

        chrome::tabs::show(ctx, self); // per-being tabs, topmost
        chrome::ibp_bar::show(ctx, self);
        chrome::word_bar::show(ctx, self); // very bottom
        chrome::history_bar::show(ctx, self); // above the word bar

        egui::CentralPanel::default().show(ctx, |ui| match self.st.view {
            View::Map2d => views::map2d::show(ui, self),
            View::Story => views::story::show(ui, self),
            View::World3d => views::world3d::show(ui, self),
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
