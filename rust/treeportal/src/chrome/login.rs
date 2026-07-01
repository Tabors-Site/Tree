// chrome/login.rs — the full-screen NAME gate. A Name is your identity (an ed25519 key); you can't enter
// the world without one. Centered, spaced, clear sections:
//   SIGN IN  — name + password, the everyday way (Model B: the key lives in the story, password-encrypted;
//              the portal fetches the blob and decrypts it LOCALLY — the password never touches the wire).
//   ON THIS DEVICE — one-click reconnect to a key already in the local vault.
//   NEW NAME — generate a fresh key (your 24 words); a password is OPTIONAL convenience.
//   HAVE A KEY — import 24 words / a PKCS8 PEM.
// Beings come AFTER, as tabs under the signed-in Name.

use eframe::egui;

use crate::Portal;

const AMBER: egui::Color32 = egui::Color32::from_rgb(226, 197, 116);
const ACCENT: egui::Color32 = egui::Color32::from_rgb(120, 170, 230);
const MUTE: egui::Color32 = egui::Color32::from_rgb(120, 128, 140);
const W: f32 = 400.0;

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::CentralPanel::default().show(ctx, |ui| {
        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space((ui.available_height() * 0.12).max(24.0));
                ui.label(egui::RichText::new("TreeOS").size(46.0).strong());
                ui.add_space(2.0);
                ui.label(egui::RichText::new("your Name is your identity — one key, every world").color(MUTE));
                ui.add_space(28.0);

                let pending_mnemonic = p.vault.active_name().and_then(|n| n.mnemonic.clone());

                ui.allocate_ui_with_layout(egui::vec2(W, 0.0), egui::Layout::top_down(egui::Align::Min), |ui| {
                    ui.set_max_width(W);
                    ui.spacing_mut().item_spacing.y = 6.0;

                    // ── a just-generated Name: reveal the 24 words, offer a password, then enter ──────────
                    if let Some(m) = pending_mnemonic {
                        key_reveal(ui, p, &m);
                        return;
                    }

                    // ── SIGN IN — name + password ────────────────────────────────────────────────────────
                    section(ui, "SIGN IN");
                    field(ui, &mut p.st.login_name, "your name");
                    let pw = ui.add(pw_edit(&mut p.st.login_password, "password"));
                    let enter = pw.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                    ui.add_space(3.0);
                    if primary(ui, "sign in  ›") || enter {
                        p.sign_in_password();
                    }
                    help(ui, "name + password — the everyday way in. (The key lives in the story, encrypted; your password unlocks it here and never leaves this machine.)");

                    // ── ON THIS DEVICE — reconnect a locally-held key ────────────────────────────────────
                    if !p.vault.names.is_empty() {
                        gap(ui);
                        section(ui, "ON THIS DEVICE");
                        for i in 0..p.vault.names.len() {
                            let label = p.vault.names[i].label.clone();
                            let id = p.vault.names[i].name_id.clone();
                            let text = if label.is_empty() { short(&id) } else { format!("@{label}    {}", short(&id)) };
                            if ui.add(egui::Button::new(egui::RichText::new(text).monospace()).min_size(egui::vec2(W, 30.0))).clicked() {
                                p.activate_name(i);
                            }
                        }
                    }

                    // ── NEW NAME — generate a key ────────────────────────────────────────────────────────
                    gap(ui);
                    section(ui, "NEW NAME");
                    ui.horizontal(|ui| {
                        ui.add(egui::TextEdit::singleline(&mut p.st.add_name).hint_text("a handle (optional)").desired_width(W - 108.0));
                        if ui.add(egui::Button::new("create").min_size(egui::vec2(96.0, 26.0))).clicked() {
                            if let Err(e) = p.vault.generate(p.st.add_name.trim()) {
                                p.st.add_msg = e;
                            }
                        }
                    });
                    help(ui, "generates your key (24 words). A PASSWORD is OPTIONAL — just a convenience so you don't paste the key each time. Your 24 WORDS are the root: save them on paper. Lose them and the Name is gone — there is no reset.");

                    // ── HAVE A KEY — import ──────────────────────────────────────────────────────────────
                    gap(ui);
                    section(ui, "HAVE A KEY");
                    ui.add(egui::TextEdit::multiline(&mut p.st.add_import).desired_rows(2).desired_width(W).hint_text("paste 24 words, or a PKCS8 PEM").font(egui::TextStyle::Monospace));
                    ui.add_space(3.0);
                    if ui.add(egui::Button::new("import").min_size(egui::vec2(W, 26.0))).clicked() {
                        let name = p.st.add_name.trim().to_string();
                        let imp = p.st.add_import.trim().to_string();
                        let r = if imp.contains("BEGIN") { p.vault.import_pem(&name, &imp) } else { p.vault.import_mnemonic(&name, &imp) };
                        match r {
                            Ok(()) => p.st.add_import.clear(),
                            Err(e) => p.st.add_msg = e,
                        }
                    }
                    help(ui, "your key never leaves this machine — it signs your acts locally. Words OR key are interchangeable proof; a password is optional on top.");

                    msg(ui, p);
                    ui.add_space(24.0);
                });
            });
        });
    });
}

/// The one-time key reveal after `create`: the 24 words + an optional password + enter.
fn key_reveal(ui: &mut egui::Ui, p: &mut Portal, mnemonic: &str) {
    ui.label(egui::RichText::new("✦ your Name is born").size(20.0).strong().color(ACCENT));
    ui.add_space(6.0);
    ui.colored_label(AMBER, egui::RichText::new("SAVE THESE 24 WORDS — they ARE your Name. Write them on paper now. A password cannot recover them; nothing can. This is the only time they are shown.").strong());
    ui.add_space(10.0);
    egui::Frame::none()
        .fill(egui::Color32::from_rgb(18, 20, 26))
        .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(60, 66, 78)))
        .inner_margin(egui::Margin::same(12.0))
        .rounding(6.0)
        .show(ui, |ui| {
            ui.set_width(W - 24.0);
            ui.label(egui::RichText::new(mnemonic).monospace().size(15.0).line_height(Some(24.0)));
        });
    gap(ui);
    section(ui, "SET A PASSWORD  ·  optional");
    ui.horizontal(|ui| {
        ui.add(pw_edit(&mut p.st.set_password, "password").desired_width(W - 108.0));
        if ui.add(egui::Button::new("set").min_size(egui::vec2(96.0, 26.0))).on_hover_text("encrypt the key with this password + register it in the story").clicked() {
            p.set_name_password();
        }
    });
    help(ui, "a password lets you sign in with name + password on any device (the key is stored in the story, encrypted). Optional — your 24 words are the real key.");
    ui.add_space(10.0);
    if primary(ui, "I've saved my words  —  enter  ›") {
        p.finish_login();
    }
    msg(ui, p);
    ui.add_space(24.0);
}

fn section(ui: &mut egui::Ui, title: &str) {
    ui.label(egui::RichText::new(title).size(12.0).strong().color(MUTE));
    ui.add_space(2.0);
}

fn help(ui: &mut egui::Ui, text: &str) {
    ui.add_space(3.0);
    ui.label(egui::RichText::new(text).size(11.5).color(MUTE));
}

fn gap(ui: &mut egui::Ui) {
    ui.add_space(14.0);
    ui.separator();
    ui.add_space(10.0);
}

fn field(ui: &mut egui::Ui, buf: &mut String, hint: &str) {
    ui.add(egui::TextEdit::singleline(buf).hint_text(hint).desired_width(W));
    ui.add_space(3.0);
}

fn pw_edit<'a>(buf: &'a mut String, hint: &str) -> egui::TextEdit<'a> {
    egui::TextEdit::singleline(buf).password(true).hint_text(hint).desired_width(W)
}

fn primary(ui: &mut egui::Ui, label: &str) -> bool {
    ui.add(egui::Button::new(egui::RichText::new(label).strong().color(egui::Color32::WHITE)).min_size(egui::vec2(W, 32.0)).fill(ACCENT.gamma_multiply(0.55)))
        .clicked()
}

fn msg(ui: &mut egui::Ui, p: &Portal) {
    if !p.st.add_msg.is_empty() {
        ui.add_space(8.0);
        ui.colored_label(AMBER, egui::RichText::new(&p.st.add_msg).small());
    }
}

fn short(id: &str) -> String {
    if id.len() > 14 {
        format!("{}…{}", &id[..8], &id[id.len() - 4..])
    } else {
        id.to_string()
    }
}
