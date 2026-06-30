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
}

impl View {
    pub fn label(self) -> &'static str {
        match self {
            View::Map2d => "2D",
            View::Story => "Story",
            View::World3d => "3D",
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
    /// the RIGHT address shown/edited (P0: a `kind/id` to take a moment of; empty = the index).
    pub address: String,
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
            address: String::new(),
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
