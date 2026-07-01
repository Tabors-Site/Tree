// chrome/login.rs — the full-screen NAME login gate. A Name is the higher identity (an ed25519 key);
// you cannot enter the world without one. Three paths: CONNECT an existing Name (from the local vault),
// DECLARE a new one (generate a 24-word key — shown once), or IMPORT (24 words / PKCS8 PEM). Beings come
// AFTER, as tabs under the signed-in Name. Words-first, sleek.

use eframe::egui;

use crate::Portal;

const AMBER: egui::Color32 = egui::Color32::from_rgb(226, 197, 116);
const ACCENT: egui::Color32 = egui::Color32::from_rgb(120, 170, 230);

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::CentralPanel::default().show(ctx, |ui| {
        ui.vertical_centered(|ui| {
            ui.add_space(ui.available_height() * 0.16);
            ui.label(egui::RichText::new("TreeOS").size(40.0).strong());
            ui.label(egui::RichText::new("a Name is the higher identity — sign in or declare one").weak());
            ui.add_space(22.0);

            let pending_mnemonic = p.vault.active_name().and_then(|n| n.mnemonic.clone());

            ui.allocate_ui_with_layout(egui::vec2(460.0, 0.0), egui::Layout::top_down(egui::Align::Min), |ui| {
                ui.set_max_width(460.0);

                // a just-generated/imported Name: show the 24 words, confirm, enter
                if let Some(m) = pending_mnemonic {
                    ui.label(egui::RichText::new("your 24 words — write these on paper (they vanish):").color(AMBER));
                    ui.add_space(4.0);
                    ui.label(egui::RichText::new(m).monospace());
                    ui.add_space(10.0);
                    if ui.button(egui::RichText::new("I've saved them — enter ›").strong()).clicked() {
                        p.finish_login();
                    }
                    return;
                }

                // CONNECT an existing Name
                if !p.vault.names.is_empty() {
                    ui.label(egui::RichText::new("YOUR NAMES").small().weak());
                    for i in 0..p.vault.names.len() {
                        let label = p.vault.names[i].label.clone();
                        let id = p.vault.names[i].name_id.clone();
                        if ui.add(egui::Button::new(format!("@{label}    {}", short(&id))).min_size(egui::vec2(460.0, 28.0))).clicked() {
                            p.activate_name(i);
                        }
                    }
                    ui.add_space(12.0);
                }

                // DECLARE a new Name
                ui.label(egui::RichText::new("DECLARE A NEW NAME").small().weak());
                ui.horizontal(|ui| {
                    ui.add(egui::TextEdit::singleline(&mut p.st.add_name).hint_text("a handle (optional)").desired_width(300.0));
                    if ui.button("declare").clicked() {
                        if let Err(e) = p.vault.generate(p.st.add_name.trim()) {
                            p.st.add_msg = e;
                        }
                    }
                });

                ui.add_space(12.0);

                // IMPORT
                ui.label(egui::RichText::new("OR IMPORT — 24 words, or a PKCS8 PEM").small().weak());
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

                if !p.st.add_msg.is_empty() {
                    ui.add_space(6.0);
                    ui.colored_label(AMBER, egui::RichText::new(&p.st.add_msg).small());
                }
                ui.add_space(8.0);
                ui.label(egui::RichText::new("your key never leaves this machine — it signs your acts locally").small().color(ACCENT));
            });
        });
    });
}

fn short(id: &str) -> String {
    if id.len() > 14 {
        format!("{}…{}", &id[..8], &id[id.len() - 4..])
    } else {
        id.to_string()
    }
}
