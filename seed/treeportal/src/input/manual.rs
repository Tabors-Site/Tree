// input/manual.rs — the MANUAL-mode composer: the keyboard ACT/FACT model (philosophy/623/6.png).
// Word keys build the current word; a STAMP key seals it. Space seals a word (and emits it to send);
// a sentence-ender (. ! ?) or Enter seals + ends the statement. Words matter most: there is no plain
// text field — the bar reflects this composer directly.
//
// Word-at-a-time: each sealed word is emitted to send as its own act (the user's preferred model — the
// world can change per word once the server accumulates the utterance; harmless no-op until then). A
// caller may instead batch the whole statement on `end` (per_word=false).

#[derive(Default)]
pub struct Composer {
    /// the sealed words of the in-progress statement (for display).
    pub words: Vec<String>,
    /// the word currently being built.
    pub current: String,
}

/// What feeding one char produced.
pub struct Out {
    /// a freshly sealed word to send (word-at-a-time), if any.
    pub send: Option<String>,
    /// this char ended the statement (a sentence-ender or Enter).
    pub end: bool,
}

impl Out {
    fn none() -> Self {
        Out { send: None, end: false }
    }
}

impl Composer {
    /// Feed one typed char.
    pub fn feed(&mut self, ch: char) -> Out {
        match ch {
            ' ' | '\t' => self.seal(false),
            '.' | '!' | '?' => self.seal(true),
            c if c.is_control() => Out::none(),
            c => {
                self.current.push(c);
                Out::none()
            }
        }
    }

    /// Enter = hard end: seal the current word and end the statement.
    pub fn enter(&mut self) -> Out {
        self.seal(true)
    }

    fn seal(&mut self, end: bool) -> Out {
        let w = self.current.trim().to_string();
        self.current.clear();
        let send = if w.is_empty() {
            None
        } else {
            self.words.push(w.clone());
            Some(w)
        };
        Out { send, end }
    }

    pub fn backspace(&mut self) {
        if !self.current.is_empty() {
            self.current.pop();
        } else if let Some(w) = self.words.pop() {
            self.current = w; // un-seal the last word to edit it
        }
    }

    /// The whole statement so far (sealed words + the word being built).
    pub fn statement(&self) -> String {
        let mut parts = self.words.clone();
        if !self.current.is_empty() {
            parts.push(self.current.clone());
        }
        parts.join(" ")
    }

    pub fn is_empty(&self) -> bool {
        self.words.is_empty() && self.current.is_empty()
    }

    /// Clear after a statement ends (the next word starts fresh).
    pub fn end_clear(&mut self) {
        self.words.clear();
        self.current.clear();
    }
}
