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
    // the RUNTIME window/taskbar icon — DISTINCT from the exe file's resource icon (build.rs/windres).
    // eframe shows a default box ("E") until we set this, so the taskbar didn't match the exe. Load it
    // from the SAME portal.ico art (its 256px layer, exported to assets/icon.png) so both icons match.
    let mut viewport = egui::ViewportBuilder::default();
    match eframe::icon_data::from_png_bytes(include_bytes!("../assets/icon.png")) {
        Ok(icon) => viewport = viewport.with_icon(icon),
        Err(e) => eprintln!("portal icon: {e}"),
    }
    let opts = eframe::NativeOptions { viewport, ..Default::default() };
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
        // settle the bar. SIMPLE mode shows only the POSITION on the RIGHT (story+history are mirrored,
        // shown once on the LEFT); ADVANCED shows the full chain `storyDomain#history/space@being`.
        let shown = canonical_display(&self.story, &self.history, address);
        let display = if self.st.advanced_ibpa { shown } else { path_of(&shown) };
        self.st.address = display.clone();
        if push {
            self.st.nav_stack.truncate(self.st.nav_index + 1); // trim the forward future
            if self.st.nav_stack.last() != Some(&display) {
                self.st.nav_stack.push(display.clone());
                self.st.nav_index = self.st.nav_stack.len() - 1;
            }
        }
        // the LEFT stance FOLLOWS what you perceive — clicking a space (2D/3D) or perceiving re-settles it
        // to the new path, so the IBPA always shows where you are.
        self.rebuild_left();
    }

    /// The LEFT stance (who you are), canonical + mirroring the RIGHT: `storyDomain#history/@being` when
    /// you drive a being, else the minimum `storyDomain#history/`. Rebuilt whenever the actor changes.
    pub fn left_stance_str(&self) -> String {
        if !self.st.advanced_ibpa {
            // SIMPLE (mirrored): identity + branch only. story + history are shared with the RIGHT and the
            // position lives on the RIGHT, so the LEFT is just WHO you are and WHICH branch.
            return match &self.active_being {
                Some((_, name)) => format!("@{} #{}", name, self.history),
                None => format!("#{}", self.history),
            };
        }
        // ADVANCED: the full LEFT chain, carrying its own position (the dual bar, for cross-world).
        let path = path_of(&self.st.address);
        match &self.active_being {
            Some((_, name)) => format!("{}#{}{}@{}", self.story, self.history, path, name),
            None => format!("{}#{}{}", self.story, self.history, path),
        }
    }

    /// Re-render the editable LEFT-stance buffer to its canonical form (after login / drive / branch).
    pub fn rebuild_left(&mut self) {
        self.st.left_stance = self.left_stance_str();
    }

    /// Flip SIMPLE ↔ ADVANCED IBPA. Re-settles both bar buffers to the new mode's form (bare position vs
    /// full dual chain) WITHOUT re-fetching — the position and branch are unchanged, only how they show.
    pub fn toggle_ibpa(&mut self) {
        self.st.advanced_ibpa = !self.st.advanced_ibpa;
        let full = canonical_display(&self.story, &self.history, &path_of(&self.st.address));
        self.st.address = if self.st.advanced_ibpa { full } else { path_of(&full) };
        self.rebuild_left();
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
        self.active_being = None;
        self.vault.active = None; // DESELECT the Name → all the way back to the start screen (not the
        // just-generated-key view, which is gated on an active Name's pending mnemonic).
        self.st.left_stance = "@I#0".to_string();
        // clear every transient login field so the start screen is clean.
        self.st.login_name.clear();
        self.st.login_password.clear();
        self.st.set_password.clear();
        self.st.add_name.clear();
        self.st.add_import.clear();
        self.st.add_msg.clear();
        self.st.pending_password = None;
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
        match &self.wire {
            Some(w) => {
                w.send(wire::proto::moment_name_key(&name));
                self.st.pending_password = Some(pw); // set ONLY once sent — else a disconnected sign-in
                self.st.add_msg = "unlocking…".into(); // would leave it stuck (a false "unlocking…")
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
                let num = |k: &str| match wire::proto::get(h, k) {
                    Some(Json::Num(v)) => Some(*v),
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
                    fork_ord: num("forkOrd"),
                    tip: num("tip"),
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
        // ADVANCED: the LEFT carries its own position, so its path re-perceives that room (the dual bar).
        // SIMPLE: the LEFT is identity + branch only — the position is the RIGHT — so a LEFT edit just
        // switches branch (a branch switch re-folds the mirrored view).
        if self.st.advanced_ibpa {
            let new_path = path_of(&s);
            if new_path != path_of(&self.st.address) || branch_changed {
                self.navigate(&new_path, true);
                return;
            }
        } else if branch_changed {
            self.reperceive_current();
        }
        self.rebuild_left(); // settle the buffer to canonical
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
    /// Take ANOTHER moment of where you are — the post-act step of the moment→act→moment model. The old
    /// moment is dead; this asks for the fresh face of the SAME place (same address, same actor). No
    /// re-navigation, no nav-stack push, no view switch — nothing that could drift you elsewhere.
    fn refresh_moment(&mut self) {
        let msg = self.moment_msg(&self.st.address.clone());
        if let Some(w) = &self.wire {
            w.send(msg);
        }
    }

    /// Show a server error WHERE THE USER IS LOOKING, and never hang. The server answers every failure
    /// with an error envelope; until now the portal buried them, so a bad sign-in sat forever on
    /// "unlocking…" and a denied act looked like nothing happened. On the login screen (or mid sign-in)
    /// the error lands in the login message AND releases the pending-password wait; in the world it lands
    /// in the word bar's hint. Always logged.
    fn report_error(&mut self, err: String) {
        self.st.log.push(format!("✕ {err}"));
        if !self.logged_in || self.st.pending_password.is_some() {
            self.st.pending_password = None; // release the "unlocking…" wait — no more hang
            self.st.add_msg = err;
        } else {
            self.st.hint = err;
        }
    }

    /// True while you have no being of your OWN — bodiless, or only riding the shared @arrival stance.
    /// You are locked here (birth-only) until you speak your own being into existence.
    fn needs_own_being(&self) -> bool {
        match &self.active_being {
            None => true,
            Some((_, name)) => name == "arrival",
        }
    }

    /// Find @arrival in the current scene and drive it — the beingless-Name entry stance. Once you birth
    /// your own being (`I am X`), embodiment switches you off arrival. Server-enforced too; this is the
    /// client reaction that shows @arrival in the left stance.
    fn auto_arrival(&mut self) {
        let arrival = self
            .st
            .moment
            .as_ref()
            .and_then(|m| wire::proto::get(&m.raw, "view"))
            .and_then(|v| wire::proto::get(v, "beings"))
            .and_then(|b| if let Json::Arr(a) = b { Some(a.clone()) } else { None })
            .and_then(|a| {
                a.iter().find_map(|n| {
                    let name = if let Some(Json::Str(s)) = wire::proto::get(n, "being") { s.clone() } else { return None };
                    if name == "arrival" {
                        let id = if let Some(Json::Str(s)) = wire::proto::get(n, "id") { s.clone() } else { String::new() };
                        (!id.is_empty()).then_some((id, name))
                    } else {
                        None
                    }
                })
            });
        if let Some((id, name)) = arrival {
            self.drive_being(&id, &name);
        }
    }

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
            // ERRORS FIRST: the server answers every failure with an error envelope that the render path
            // and the op-handlers below can't show — so surface it here, before anything buries it. This
            // is what makes a bad sign-in ("name not found" / "wrong password") or a denied act SPEAK
            // instead of hanging. report_error routes it to the login screen (releasing "unlocking…") or
            // to the in-world hint.
            if let Some(err) = envelope_error(&rx.raw) {
                self.report_error(err);
                continue;
            }
            // a name+password sign-in reply (the SUCCESS view — the error view was caught above): decrypt
            // the fetched key locally, then enter.
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
                    // AUTO-@ARRIVAL: a fresh Name with no being of its own IS @arrival — the shared entry
                    // stance. Drive it so the LEFT IBPA shows @arrival and you're locked to it (the server
                    // also enforces this); the only way out is to be born your own being through @cherub.
                    if self.logged_in && self.active_being.is_none() {
                        self.auto_arrival();
                    }
                }
                wire::proto::RxKind::Act => {
                    // the act envelope is ALWAYS ok:true at the top (a bare error envelope was caught
                    // above); the truth is whether any FACT sealed. Zero facts = a denied result (auth, a
                    // seal conflict like "name already exists", a do-op fault) OR a Word that said nothing.
                    if act_sealed_count(&rx.raw) == 0 {
                        let msg = act_denied_reason(&rx.raw).unwrap_or_else(|| {
                            if self.needs_own_being() {
                                "that Word did nothing. Say  I am <Name>.  — a Capital name and a period (e.g. I am Tabor.)".into()
                            } else {
                                "that Word sealed nothing — it wasn't a statement the world knows yet".into()
                            }
                        });
                        self.report_error(msg); // never silent
                    } else {
                        self.st.hint.clear();
                        self.st.log.push("act ok".into());
                        self.perceive_timeline(); // a new moment landed — refresh the history bar dots
                        // EMBODIMENT: "I am Tabor" (a be:birth/connect) puts you IN that being — drive it,
                        // so your next "I" is the being (first-person). The sealed fact carries its id+name.
                        if let Some((bid, name)) = act_being_fact(&rx.raw) {
                            self.drive_being(&bid, &name);
                        }
                        // THE MODEL IS MOMENT → ACT → MOMENT: once you've acted, the old moment is past, so
                        // you take ANOTHER moment of where you are. No re-navigation, no drift — just the
                        // fresh face of the same place (now showing you MOVED, the new space, …).
                        self.refresh_moment();
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
        // you have no being OF YOUR OWN yet (bodiless, or riding shared @arrival) — guide the birth.
        if self.logged_in && self.needs_own_being() {
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
            View::Map2d => views::map2d::show(ui, self),
            View::World3d => views::world3d::show(ui, self),
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

fn str_of(v: &Json) -> Option<String> {
    if let Json::Str(s) = v {
        Some(s.clone())
    } else {
        None
    }
}

/// Pull the human message out of a server ERROR ENVELOPE, or None if this reply isn't one. The server
/// speaks two error-envelope shapes and the portal used to surface NEITHER (they fell through as "Other"
/// and vanished — the silent "hang"):
///   (1) a BARE envelope `{status:"error", error:{code, message}}` — a federation/cognize/malformed-act
///       failure, or a create-branch fault;
///   (2) a MOMENT whose `view` IS that envelope `{verb:"moment", [op], view:{status:"error", …}}` — a
///       name-key "name not found", a scene "space not found", a story fault.
/// Returns the real `error.message` (falling back to the `code`) so the user sees the ACTUAL reason.
fn envelope_error(raw: &Json) -> Option<String> {
    fn of(env: &Json) -> Option<String> {
        match wire::proto::get(env, "status") {
            Some(Json::Str(s)) if s == "error" => {
                let e = wire::proto::get(env, "error");
                let msg = e.and_then(|e| wire::proto::get(e, "message")).and_then(str_of);
                let code = e.and_then(|e| wire::proto::get(e, "code")).and_then(str_of);
                Some(msg.or(code).unwrap_or_else(|| "error".into()))
            }
            _ => None,
        }
    }
    of(raw).or_else(|| wire::proto::get(raw, "view").and_then(of))
}

/// How many FACTS an act reply sealed. `ok:true` with zero facts means the Word parsed to NOTHING (an
/// unrecognized/empty statement) — the act "succeeded" but changed nothing. We surface that instead of
/// letting it fail silently (the trap behind "I type I am tabor and nothing happens": a lowercase name
/// or a missing period reads as no act).
fn act_sealed_count(raw: &Json) -> usize {
    match wire::proto::get(raw, "results") {
        Some(Json::Arr(rs)) => rs.iter().filter(|o| wire::proto::get(o, "fact").is_some()).count(),
        _ => 0,
    }
}

/// The DENIAL reason from an act reply, if a result was refused. The act envelope is ALWAYS `ok:true` at
/// the top (act.rs wraps every outcome that way); the truth is per-result `{ok:false, reason}` — an
/// authorization refusal, a seal conflict ("name already exists"), a do-op fault. This digs it out so a
/// denied act stops reading as success.
fn act_denied_reason(raw: &Json) -> Option<String> {
    let Some(Json::Arr(rs)) = wire::proto::get(raw, "results") else { return None };
    rs.iter()
        .find(|r| matches!(wire::proto::get(r, "ok"), Some(Json::Bool(false))))
        .and_then(|r| wire::proto::get(r, "reason").and_then(str_of))
}

/// If an act reply sealed a `be:birth`/`be:connect` of a being, return its (beingId, displayName) — the
/// being you just became. Used to EMBODY you after "I am Tabor" (drive it → first-person).
fn act_being_fact(raw: &Json) -> Option<(String, String)> {
    let s = |v: &Json| -> Option<String> {
        if let Json::Str(x) = v {
            Some(x.clone())
        } else {
            None
        }
    };
    let Json::Arr(results) = wire::proto::get(raw, "results")? else { return None };
    for o in results {
        let Some(f) = wire::proto::get(o, "fact") else { continue };
        if wire::proto::get(f, "verb").and_then(s) != Some("be".into()) {
            continue;
        }
        let act = wire::proto::get(f, "act").and_then(s);
        if !matches!(act.as_deref(), Some("birth") | Some("connect")) {
            continue;
        }
        let of = wire::proto::get(f, "of")?;
        if wire::proto::get(of, "kind").and_then(s) != Some("being".into()) {
            continue;
        }
        let id = wire::proto::get(of, "id").and_then(s)?;
        let name = wire::proto::get(f, "params").and_then(|p| wire::proto::get(p, "name")).and_then(s).unwrap_or_else(|| id.clone());
        return Some((id, name));
    }
    None
}

/// Render an address to the canonical IBP display form `storyDomain#history/space@being` — history is
/// ALWAYS shown (unlike a URL's omitted default), per the bar's spec. Parses + expands against the
/// ambient story/branch; falls back to the raw text while it's mid-edit or unparseable.
/// The room PATH of a canonical IBP address `storyDomain#history<path>@being` — the part between the
/// history and the `@being`, always starting with `/` (defaults to `/`). Used to read the position out
/// of the LEFT stance / RIGHT address so one drives the other.
fn path_of(addr: &str) -> String {
    let after_hash = addr.split_once('#').map(|(_, r)| r).unwrap_or(addr);
    let path_start = after_hash.find(['/', '@']).unwrap_or(after_hash.len());
    let rest = &after_hash[path_start..];
    let path_end = rest.find('@').unwrap_or(rest.len());
    let p = &rest[..path_end];
    if p.is_empty() { "/".to_string() } else { p.to_string() }
}

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
