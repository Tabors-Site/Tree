// chrome/tabs.rs — the top identity bar. The signed-in NAME (the higher identity) on the left; the
// being TABS under it (a Name's avatars inside histories) — P3 wires connect-existing / be:birth. Sign
// out returns to the Name login gate.

use eframe::egui;

use crate::Portal;

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
                        let nm = p.vault.active_name().map(|n| n.label.clone()).unwrap_or_default();
                        p.st.left_stance = format!("@{nm}#{}", p.history);
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
            });
        });
        ui.add_space(3.0);
    });
}
