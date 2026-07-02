// chrome/word_bar.rs — the bottom word bar. Words matter most: this is the visual center. In MANUAL
// mode it reflects the composer directly (the keyboard ACT/FACT model — not a plain text field): sealed
// words dim, the word being built bright, a caret. In STAMP mode every key is an act (P2). The mode
// indicator shows which you're in; Esc switches.

use eframe::egui;

use crate::state::Mode;
use crate::Portal;

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::TopBottomPanel::bottom("word").show(ctx, |ui| {
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            let (txt, col) = match p.st.mode {
                Mode::Manual => ("MANUAL", egui::Color32::from_rgb(90, 150, 230)),
                Mode::Stamp => ("STAMP", egui::Color32::from_rgb(230, 170, 70)),
            };
            ui.colored_label(col, egui::RichText::new(txt).monospace().small());
            ui.add_space(8.0);

            // the RIGHT-stance TARGET (a clicked being): a Word you say CALLS it. Shown as `@name ›`.
            if let Some((_, name)) = &p.st.target_being {
                ui.colored_label(egui::Color32::from_rgb(180, 140, 230), egui::RichText::new(format!("@{name} ›")).monospace().small())
                    .on_hover_text("your Word calls this being — release the being tab (✕) to clear");
                ui.add_space(4.0);
            }

            match p.st.mode {
                Mode::Manual => {
                    if p.st.composer.is_empty() {
                        ui.label(egui::RichText::new("say the Word…    space seals · . or Enter sends · Esc → stamp").weak());
                    } else {
                        let sealed = p.st.composer.words.join(" ");
                        if !sealed.is_empty() {
                            ui.label(egui::RichText::new(format!("{sealed} ")).monospace().color(egui::Color32::from_gray(150)));
                        }
                        if !p.st.composer.current.is_empty() {
                            ui.label(egui::RichText::new(&p.st.composer.current).monospace().strong());
                        }
                        ui.label(egui::RichText::new("▏").monospace().color(egui::Color32::from_rgb(90, 150, 230)));
                    }
                }
                Mode::Stamp => {
                    // NOT a separate area — the pressed key shows RIGHT HERE in the same word slot a said
                    // Word uses, and the next key replaces it (the "reset after every key" feel). Each key
                    // is one act; the server reads it. Esc → type Words.
                    if p.st.last_act.is_empty() {
                        ui.label(egui::RichText::new("press a key — each keypress is one act    ·    Esc → type Words").weak());
                    } else {
                        let amber = egui::Color32::from_rgb(230, 170, 70);
                        ui.label(egui::RichText::new(&p.st.last_act).monospace().strong().color(amber));
                        ui.label(egui::RichText::new("▏").monospace().color(amber));
                    }
                }
            }
        });
        if !p.st.hint.is_empty() {
            ui.colored_label(egui::Color32::from_rgb(230, 170, 70), egui::RichText::new(&p.st.hint).small());
        }
        ui.add_space(6.0);
    });
}
