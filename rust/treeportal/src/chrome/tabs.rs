// chrome/tabs.rs — per-being tabs (like browser tabs, but each is an identity). The active tab is the
// being you act AS (its key signs, its name is the LEFT stance). `+` opens the add-being panel: generate
// a fresh 24-word key, or import a phrase / PEM. Reads still go as I (browse freely); acts go as the
// active being.

use eframe::egui;

use crate::Portal;

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::TopBottomPanel::top("tabs").show(ctx, |ui| {
        ui.add_space(3.0);
        ui.horizontal(|ui| {
            if p.vault.beings.is_empty() {
                ui.label(egui::RichText::new("@I").monospace().color(egui::Color32::from_rgb(120, 170, 230)));
                ui.label(egui::RichText::new("no being loaded").weak().small());
            } else {
                for i in 0..p.vault.beings.len() {
                    let active = i == p.vault.active;
                    let name = p.vault.beings[i].name.clone();
                    if ui.selectable_label(active, egui::RichText::new(format!("@{name}")).monospace()).clicked() {
                        p.vault.active = i;
                    }
                }
            }
            if ui.small_button("+").on_hover_text("add a being — generate or import a key").clicked() {
                p.st.show_identity = true;
                p.st.add_msg.clear();
            }
        });
        ui.add_space(3.0);
    });

    if p.st.show_identity {
        add_being_window(ctx, p);
    }
}

fn add_being_window(ctx: &egui::Context, p: &mut Portal) {
    let mut open = p.st.show_identity;
    egui::Window::new("add a being")
        .open(&mut open)
        .collapsible(false)
        .resizable(false)
        .show(ctx, |ui| {
            ui.label(egui::RichText::new("name").small());
            ui.text_edit_singleline(&mut p.st.add_name);
            ui.add_space(6.0);

            if ui.button("generate  (new 24-word key)").clicked() {
                match p.vault.generate(p.st.add_name.trim()) {
                    Ok(()) => p.st.add_msg = "generated — write the 24 words below, then they vanish".into(),
                    Err(e) => p.st.add_msg = e,
                }
            }

            ui.separator();
            ui.label(egui::RichText::new("or import — 24 words, or a PKCS8 PEM").small());
            ui.add(egui::TextEdit::multiline(&mut p.st.add_import).desired_rows(2).font(egui::TextStyle::Monospace));
            if ui.button("import").clicked() {
                let name = p.st.add_name.trim().to_string();
                let imp = p.st.add_import.trim().to_string();
                let r = if imp.contains("BEGIN") {
                    p.vault.import_pem(&name, &imp)
                } else {
                    p.vault.import_mnemonic(&name, &imp)
                };
                match r {
                    Ok(()) => {
                        p.st.add_msg = "imported".into();
                        p.st.add_import.clear();
                    }
                    Err(e) => p.st.add_msg = e,
                }
            }

            // show the just-generated mnemonic ONCE
            if let Some(m) = p.vault.active_being().and_then(|b| b.mnemonic.clone()) {
                ui.separator();
                ui.label(egui::RichText::new("your 24 words — write these on paper:").small().color(egui::Color32::from_rgb(230, 170, 70)));
                ui.label(egui::RichText::new(m).monospace());
            }
            if !p.st.add_msg.is_empty() {
                ui.add_space(4.0);
                ui.colored_label(egui::Color32::from_rgb(120, 170, 230), egui::RichText::new(&p.st.add_msg).small());
            }
        });
    p.st.show_identity = open;
}
