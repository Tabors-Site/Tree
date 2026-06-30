// chrome/history_bar.rs — the history bar. It IS just a moment on the LIBRARY reel (which folds to the
// histories/branches). A thin strip: the current history, and a tap on the library to take that moment
// (the histories then render in the main view). Rewind/branch are acts, wired with the input fix.

use eframe::egui;

use crate::Portal;

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::TopBottomPanel::bottom("history").show(ctx, |ui| {
        ui.add_space(3.0);
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new("history").weak().small());
            ui.label(egui::RichText::new(format!("#{}", p.history)).monospace().small().color(egui::Color32::from_rgb(120, 170, 230)));

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.small_button("library ↗").on_hover_text("take a moment of the library reel — it folds to the histories").clicked() {
                    p.perceive_library();
                }
            });
        });
        ui.add_space(3.0);
    });
}
