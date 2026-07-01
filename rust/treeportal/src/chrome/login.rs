// chrome/login.rs — the full-screen NAME login gate. A Name is the higher identity (an ed25519 key);
// you cannot enter the world without one. Three paths:
//   1) NAME + PASSWORD — the everyday path. The key is held in the STORY, password-encrypted; the portal
//      fetches the encrypted blob and DECRYPTS IT LOCALLY (Model B) — the password never touches the wire.
//   2) YOUR NAMES (this device) — connect a key already in the local vault (no password; in-memory).
//   3) NEW / IMPORT — generate a fresh 24-word key or import one; then optionally set a password, which
//      encrypts the key and registers it in the story so you can sign in with name+password anywhere.
// Beings come AFTER, as tabs under the signed-in Name. Words-first, sleek.

use eframe::egui;

use crate::Portal;

const AMBER: egui::Color32 = egui::Color32::from_rgb(226, 197, 116);
const ACCENT: egui::Color32 = egui::Color32::from_rgb(120, 170, 230);

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::CentralPanel::default().show(ctx, |ui| {
        ui.vertical_centered(|ui| {
            ui.add_space(ui.available_height() * 0.10);
            ui.label(egui::RichText::new("TreeOS").size(40.0).strong());
            ui.label(egui::RichText::new("a Name is the higher identity — sign in or declare one").weak());
            ui.add_space(20.0);

            let pending_mnemonic = p.vault.active_name().and_then(|n| n.mnemonic.clone());

            ui.allocate_ui_with_layout(egui::vec2(460.0, 0.0), egui::Layout::top_down(egui::Align::Min), |ui| {
                ui.set_max_width(460.0);

                // ── a just-generated/imported Name: show the 24 words, offer a password, then enter ──────
                if let Some(m) = pending_mnemonic {
                    ui.label(egui::RichText::new("your 24 words — write these on paper (they vanish):").color(AMBER));
                    ui.add_space(4.0);
                    ui.label(egui::RichText::new(m).monospace());
                    ui.add_space(12.0);
                    ui.label(egui::RichText::new("set a password (optional) — lets you sign in with name+password anywhere").small().weak());
                    ui.horizontal(|ui| {
                        ui.add(egui::TextEdit::singleline(&mut p.st.set_password).password(true).hint_text("password").desired_width(300.0));
                        if ui.button("set + store").on_hover_text("encrypt the key with this password and register it in the story").clicked() {
                            p.set_name_password();
                        }
                    });
                    ui.add_space(10.0);
                    if ui.button(egui::RichText::new("I've saved them — enter ›").strong()).clicked() {
                        p.finish_login();
                    }
                    msg(ui, p);
                    return;
                }

                // ── 1) NAME + PASSWORD (the everyday path) ───────────────────────────────────────────────
                ui.label(egui::RichText::new("SIGN IN — name + password").small().weak());
                ui.add(egui::TextEdit::singleline(&mut p.st.login_name).hint_text("your name").desired_width(460.0));
                ui.add_space(4.0);
                let pw = ui.add(egui::TextEdit::singleline(&mut p.st.login_password).password(true).hint_text("password").desired_width(460.0));
                let go = pw.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                ui.add_space(6.0);
                if ui.add(egui::Button::new(egui::RichText::new("sign in ›").strong()).min_size(egui::vec2(460.0, 30.0))).clicked() || go {
                    p.sign_in_password();
                }

                ui.add_space(16.0);

                // ── 2) YOUR NAMES (this device) — connect a locally-held key, no password ─────────────────
                if !p.vault.names.is_empty() {
                    ui.label(egui::RichText::new("YOUR NAMES · this device").small().weak());
                    for i in 0..p.vault.names.len() {
                        let label = p.vault.names[i].label.clone();
                        let id = p.vault.names[i].name_id.clone();
                        if ui.add(egui::Button::new(format!("@{label}    {}", short(&id))).min_size(egui::vec2(460.0, 26.0))).clicked() {
                            p.activate_name(i);
                        }
                    }
                    ui.add_space(16.0);
                }

                // ── 3) NEW / IMPORT ──────────────────────────────────────────────────────────────────────
                ui.label(egui::RichText::new("NEW NAME").small().weak());
                ui.horizontal(|ui| {
                    ui.add(egui::TextEdit::singleline(&mut p.st.add_name).hint_text("a handle (optional)").desired_width(300.0));
                    if ui.button("declare").on_hover_text("generate a fresh 24-word key").clicked() {
                        if let Err(e) = p.vault.generate(p.st.add_name.trim()) {
                            p.st.add_msg = e;
                        }
                    }
                });

                ui.add_space(10.0);
                ui.label(egui::RichText::new("OR IMPORT A KEY — 24 words, or a PKCS8 PEM").small().weak());
                ui.add(egui::TextEdit::multiline(&mut p.st.add_import).desired_rows(2).desired_width(460.0).font(egui::TextStyle::Monospace));
                if ui.button("import").clicked() {
                    let name = p.st.add_name.trim().to_string();
                    let imp = p.st.add_import.trim().to_string();
                    let r = if imp.contains("BEGIN") {
                        p.vault.import_pem(&name, &imp)
                    } else {
                        p.vault.import_mnemonic(&name, &imp)
                    };
                    match r {
                        Ok(()) => p.st.add_import.clear(),
                        Err(e) => p.st.add_msg = e,
                    }
                }

                msg(ui, p);
                ui.add_space(8.0);
                ui.label(egui::RichText::new("with name+password your key is stored in the story, encrypted — decrypted only here, never sent").small().color(ACCENT));
            });
        });
    });
}

fn msg(ui: &mut egui::Ui, p: &Portal) {
    if !p.st.add_msg.is_empty() {
        ui.add_space(6.0);
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
