// chrome/tabs.rs — the top identity bar. The signed-in NAME (the higher identity) on the left; the
// being TABS under it (a Name's avatars inside histories) — P3 wires connect-existing / be:birth. Sign
// out returns to the Name login gate.

use eframe::egui;

use crate::Portal;

fn lang_label(code: &str) -> &'static str {
    match code {
        "es" => "Spanish",
        "zh" => "Chinese",
        "fr" => "French",
        _ => "English",
    }
}

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::TopBottomPanel::top("tabs").show(ctx, |ui| {
        ui.add_space(3.0);
        ui.horizontal(|ui| {
            let name = p.vault.active_name().map(|n| n.label.clone()).unwrap_or_else(|| "I".to_string());
            ui.label(egui::RichText::new(format!("✦ {name}")).monospace().color(egui::Color32::from_rgb(120, 170, 230)))
                .on_hover_text("your Name — the higher identity that signs your acts");
            ui.separator();

            // BEING tabs: the being the Name is driving (click a being in the 2D view to drive it).
            ui.label(egui::RichText::new("beings").small().weak());
            match p.active_being.clone() {
                Some((_, name)) => {
                    let _ = ui.selectable_label(true, egui::RichText::new(format!("@{name}")).monospace());
                    if ui.small_button("✕").on_hover_text("release this being (go bodiless)").clicked() {
                        p.active_being = None;
                        p.st.target_being = None;
                        p.rebuild_left();
                    }
                }
                None => {
                    ui.label(egui::RichText::new("· click a being in the 2D view to drive it").small().weak());
                }
            }

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("sign out").on_hover_text("sign out of your Name").clicked() {
                    p.sign_out();
                }
                // the display language (the projection). en is the canonical Word; others go through the
                // derived translate() seam (LLM-activated) — no hand-maintained map.
                let mut changed = false;
                egui::ComboBox::from_id_source("lang")
                    .selected_text(lang_label(&p.st.lang))
                    .width(96.0)
                    .show_ui(ui, |ui| {
                        for (code, label) in [("en", "English"), ("es", "Spanish"), ("zh", "Chinese"), ("fr", "French")] {
                            if ui.selectable_value(&mut p.st.lang, code.to_string(), label).clicked() {
                                changed = true;
                            }
                        }
                    });
                if changed {
                    p.reperceive_current();
                }
            });
        });
        ui.add_space(3.0);
    });
}
