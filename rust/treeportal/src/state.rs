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
}

impl View {
    pub fn label(self) -> &'static str {
        match self {
            View::Map2d => "2D",
            View::Story => "Story",
            View::World3d => "3D",
            View::Rain => "Rain",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Stamp,
    Manual,
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
    /// the history scrubber: `at_ord` = a past global ord being viewed (None = live/now); `now_ord` = the
    /// world's now (the timeline's right edge), read from each scene. Shared across all views.
    pub at_ord: Option<f64>,
    pub now_ord: f64,
    /// the being whose Rain column is selected (beingId, name) — opens the side panel.
    pub side_being: Option<(String, String)>,
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
            at_ord: None,
            now_ord: 1.0,
            side_being: None,
            composer: Composer::default(),
            per_word: true,
            moment: None,
            hint: String::new(),
            log: Vec::new(),
            last_act: String::new(),
            show_identity: false,
            add_name: String::new(),
            add_import: String::new(),
            add_msg: String::new(),
        }
    }
}
