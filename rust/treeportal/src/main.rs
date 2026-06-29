// treeportal — the native Rust moment/act browser (P0 smoke: prove the GUI stack builds + runs).
// Expands into the thin moment-renderer per the plan; this first cut just opens a styled window.

fn main() -> eframe::Result<()> {
    let opts = eframe::NativeOptions::default();
    eframe::run_native(
        "TreeOS Portal",
        opts,
        Box::new(|cc| {
            style::install(&cc.egui_ctx);
            Ok(Box::new(Portal::default()))
        }),
    )
}

#[derive(Default)]
struct Portal {}

impl eframe::App for Portal {
    fn update(&mut self, ctx: &eframe::egui::Context, _frame: &mut eframe::Frame) {
        use eframe::egui;
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(ui.available_height() * 0.4);
                ui.label(egui::RichText::new("TreeOS").size(34.0).strong());
                ui.label(egui::RichText::new("the moment / act browser").size(14.0).weak());
            });
        });
    }
}

mod style {
    use eframe::egui;

    /// The sleek, words-first look: near-black canvas, one accent, quiet flat chrome — not default egui.
    pub fn install(ctx: &egui::Context) {
        let mut v = egui::Visuals::dark();
        v.panel_fill = egui::Color32::from_rgb(12, 12, 14);
        v.window_fill = egui::Color32::from_rgb(12, 12, 14);
        v.override_text_color = Some(egui::Color32::from_rgb(225, 225, 230));
        v.widgets.noninteractive.bg_stroke.color = egui::Color32::from_rgb(34, 34, 40);
        v.selection.bg_fill = egui::Color32::from_rgb(60, 110, 200);
        ctx.set_visuals(v);
    }
}
