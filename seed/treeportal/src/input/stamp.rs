// input/stamp.rs — STAMP mode: the court-keyboard model. There is NO client keymap — the portal just
// sends acts. Keys held together accumulate into a chord while down; on RELEASE (all up) the chord is
// STAMPED and sent to the server as an act (e.g. "w", "wa", "asd"). The SERVER interprets it — that's
// how a power user "makes their own system" (a chord's meaning is a server-side fact, not a client map).
// Manual mode and stamp mode differ only in how the keyboard functions; both just send acts.

use eframe::egui::Key;

#[derive(Default)]
pub struct Stamp {
    /// the chord accumulated while keys are held (sent + cleared on release).
    acc: Vec<char>,
}

impl Stamp {
    /// Feed the currently-held keys. Accumulates the chord while held; on RELEASE (none held) returns
    /// the chord string to send as an act (None if nothing was held).
    pub fn resolve(&mut self, down: &[Key]) -> Option<String> {
        if down.is_empty() {
            if self.acc.is_empty() {
                return None;
            }
            let chord: String = self.acc.iter().collect();
            self.acc.clear();
            return Some(chord);
        }
        for k in down {
            if let Some(c) = key_char(*k) {
                if !self.acc.contains(&c) {
                    self.acc.push(c);
                }
            }
        }
        None
    }
}

/// Map a held key to the char the chord carries (letters + digits; others ignored).
fn key_char(k: Key) -> Option<char> {
    use Key::*;
    Some(match k {
        A => 'a', B => 'b', C => 'c', D => 'd', E => 'e', F => 'f', G => 'g', H => 'h', I => 'i',
        J => 'j', K => 'k', L => 'l', M => 'm', N => 'n', O => 'o', P => 'p', Q => 'q', R => 'r',
        S => 's', T => 't', U => 'u', V => 'v', W => 'w', X => 'x', Y => 'y', Z => 'z',
        Num0 => '0', Num1 => '1', Num2 => '2', Num3 => '3', Num4 => '4',
        Num5 => '5', Num6 => '6', Num7 => '7', Num8 => '8', Num9 => '9',
        _ => return None,
    })
}
