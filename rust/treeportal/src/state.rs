// state.rs — the ONLY UI state the portal holds: which view + which input mode (+ the transient word
// buffer, the edited address, the latest received moment to render, a small log). Everything
// substantive is the moment, taken from the server. No world state lives here.

use crate::input::manual::Composer;
use crate::wire::proto::Received;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum View {
    Map2d,
    Story,
    World3d,
    Rain,
    Explorer,
    /// the branch/timeline tree — every history as a tree from `0`, navigate branches + past moments.
    FourD,
}

impl View {
    pub fn label(self) -> &'static str {
        match self {
            View::Map2d => "2D",
            View::Story => "Story",
            View::World3d => "3D",
            View::Rain => "Rain",
            View::Explorer => "Files",
            View::FourD => "4D",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Stamp,
    Manual,
}

/// A history/branch as the portal knows it: its canonical path (`0`, `1`, `1a2`…), a display label, its
/// parent path, and the ord it forked at (None for the root `0`).
#[derive(Clone)]
pub struct Branch {
    pub path: String,
    pub label: String,
    pub parent: Option<String>,
    pub fork_ord: Option<f64>,
    /// the branch's own head ord (its tip on the ord axis) — placed with fork_ord in the 4D git-graph.
    pub tip: Option<f64>,
}

pub struct PortalState {
    pub view: View,
    pub mode: Mode,
    /// the RIGHT view address (what you perceive) — a real IBP address `story#history/space/space@being`.
    /// Edited in the IBP bar; Enter navigates.
    pub address: String,
    /// the back/forward navigation stack of addresses + the current index.
    pub nav_stack: Vec<String>,
    pub nav_index: usize,
    /// the LEFT stance buffer (who you are: `@being#history/path`) — editable; editing #history switches
    /// your branch, @being switches the being you drive, the path moves your position.
    pub left_stance: String,
    /// IBPA mode: false = SIMPLE (default) — LEFT and RIGHT MIRROR (same story+history+space, since you
    /// stand in the place you perceive), so the bar reads `@being #history :: /position` and editing
    /// either side moves you + your view together. true = ADVANCED — the full dual
    /// `story#history/path@being` on BOTH sides (cross-world / through a portal, where they diverge). One
    /// at a time; advanced is off until portals + cross-world land.
    pub advanced_ibpa: bool,
    /// the history scrubber: `at_ord` = a past global ord being viewed (None = live/now); `now_ord` = the
    /// world's now (the timeline's right edge), read from each scene. Shared across all views.
    pub at_ord: Option<f64>,
    pub now_ord: f64,
    /// the being whose Rain column is selected (beingId, name) — opens the side panel.
    pub side_being: Option<(String, String)>,
    /// the active display language (the projection). "en" is the canonical Word's own form; other langs
    /// go through the derived translate() seam (LLM-activated) — never a hand-maintained map.
    pub lang: String,
    /// the MANUAL-mode composer (the keyboard ACT/FACT model — words matter most).
    pub composer: Composer,
    /// word-at-a-time sending (the user's preference): each sealed word is its own act. False batches
    /// the whole statement on the sentence-end.
    pub per_word: bool,
    /// the latest received moment — the face to render.
    pub moment: Option<Received>,
    pub hint: String,
    pub log: Vec<String>,
    /// the last act fired in STAMP mode (feedback in the bar).
    pub last_act: String,
    // identity (add-being) UI — transient
    pub show_identity: bool,
    pub add_name: String,
    pub add_import: String,
    pub add_msg: String,
    // login form (transient): the name+password fields, a set/change password field, and the password
    // held while a name-key moment is in flight (decrypted on arrival — never persisted).
    pub login_name: String,
    pub login_password: String,
    pub set_password: String,
    pub pending_password: Option<String>,
    /// the RIGHT-stance TARGET being (beingId, name): what a Word typed in the word bar CALLS. Set by
    /// clicking a being (in 3D/2D) or typing `@being`. None = you address the place, not a being.
    pub target_being: Option<(String, String)>,
    /// the history's MOMENTS (ord, phrase) — one per act, folded from the chains — drawn as dots on the
    /// history bar; clicking a dot scrubs the world to that ord.
    pub timeline: Vec<(f64, String)>,
    /// the known branches/histories (path, label, parentPath, forkOrd) for the history tree + switcher.
    pub branches: Vec<crate::state::Branch>,
}

impl Default for PortalState {
    fn default() -> Self {
        Self {
            view: View::Map2d,
            mode: Mode::Manual,
            address: "/".to_string(),
            nav_stack: vec!["/".to_string()],
            nav_index: 0,
            left_stance: "@I#0".to_string(),
            advanced_ibpa: false, // SIMPLE mirrored bar by default
            at_ord: None,
            now_ord: 1.0,
            side_being: None,
            lang: "en".to_string(),
            composer: Composer::default(),
            per_word: false, // the PERIOD groups the statement: "I make Tabor." sends as ONE act that
            // reads together (the user's doctrine), not word-by-word. Space just separates words.
            moment: None,
            hint: String::new(),
            log: Vec::new(),
            last_act: String::new(),
            show_identity: false,
            add_name: String::new(),
            add_import: String::new(),
            add_msg: String::new(),
            login_name: String::new(),
            login_password: String::new(),
            set_password: String::new(),
            pending_password: None,
            target_being: None,
            timeline: Vec::new(),
            branches: Vec::new(),
        }
    }
}
