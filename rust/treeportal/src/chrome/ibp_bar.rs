// chrome/ibp_bar.rs — the IBP address bar: the glue. Connection dot, back/forward, the full-chain
// RIGHT address (like a URL), and the view switcher. Editing the address + Enter takes a moment.

use eframe::egui;

use crate::state::View;
use crate::wire::client::Status;
use crate::Portal;

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::TopBottomPanel::top("ibp").show(ctx, |ui| {
        ui.add_space(5.0);
        ui.horizontal(|ui| {
            // connection dot
            let (col, tip) = match p.wire.as_ref().map(|w| w.status()) {
                Some(Status::Open) => (egui::Color32::from_rgb(90, 200, 130), "connected".to_string()),
                Some(Status::Connecting) => (egui::Color32::from_rgb(220, 180, 70), "connecting…".to_string()),
                Some(Status::Closed(e)) => (egui::Color32::from_rgb(220, 90, 90), e),
                None => (egui::Color32::GRAY, "offline".to_string()),
            };
            ui.colored_label(col, "●").on_hover_text(tip);
            ui.add_enabled(false, egui::Button::new("◄").frame(false));
            ui.add_enabled(false, egui::Button::new("►").frame(false));

            // view switcher, right-aligned
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                for v in [View::World3d, View::Story, View::Map2d] {
                    if ui.selectable_label(p.st.view == v, v.label()).clicked() {
                        p.st.view = v;
                    }
                }
            });
        });

        // LEFT stance (who you are) :: RIGHT (what you perceive) — the full chain, like a URL bar
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new(p.actor_label()).monospace().color(egui::Color32::from_rgb(120, 170, 230)));
            ui.label(egui::RichText::new("::").weak());
            let resp = ui.add(
                egui::TextEdit::singleline(&mut p.st.address)
                    .hint_text("kind/id   (e.g. space/<id> · being/<id>) — empty = the index")
                    .desired_width(ui.available_width())
                    .font(egui::TextStyle::Monospace),
            );
            if resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                p.perceive_address();
            }
        });
        ui.add_space(5.0);
    });
}
