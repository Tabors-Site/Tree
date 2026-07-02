// chrome/ibp_bar.rs — the IBP address bar: the glue. Two stances, both shown as full chains (like a URL):
//   LEFT  = who you are / where you stand / on what branch  (@being#history/path) — editable: #history
//           switches your branch, @being the being you drive, the path your position.
//   RIGHT = what you perceive (story#history/space/space@being) — editable; Enter navigates.
// Plus browser nav: back ◄ / forward ►, / (jump to your story root), ~ (jump to your being's home),
// the view switcher, a connection dot, and a cross-history amber tint when LEFT history != RIGHT history.

use eframe::egui;

use crate::state::View;
use crate::wire::client::Status;
use crate::Portal;

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::TopBottomPanel::top("ibp").show(ctx, |ui| {
        ui.add_space(5.0);

        // row 1: connection dot · back/forward · / · ~ · view switcher
        ui.horizontal(|ui| {
            let (col, tip) = match p.wire.as_ref().map(|w| w.status()) {
                Some(Status::Open) => (egui::Color32::from_rgb(90, 200, 130), "connected".to_string()),
                Some(Status::Connecting) => (egui::Color32::from_rgb(220, 180, 70), "connecting…".to_string()),
                Some(Status::Closed(e)) => (egui::Color32::from_rgb(220, 90, 90), e),
                None => (egui::Color32::GRAY, "offline".to_string()),
            };
            ui.colored_label(col, "●").on_hover_text(tip);

            if ui.add_enabled(p.can_back(), egui::Button::new("◄").frame(false)).on_hover_text("back").clicked() {
                p.nav_back();
            }
            if ui.add_enabled(p.can_forward(), egui::Button::new("►").frame(false)).on_hover_text("forward").clicked() {
                p.nav_forward();
            }
            if ui.button("/").on_hover_text("your story root").clicked() {
                p.navigate("/", true);
            }
            if ui.button("~").on_hover_text("your being's home").clicked() {
                p.navigate("~", true);
            }
            // IBPA mode toggle — SIMPLE mirrors (default), ADVANCED is the dual cross-world bar (off for now).
            let (mode_lbl, mode_tip) = if p.st.advanced_ibpa {
                ("dual", "ADVANCED IBPA: enter both sides (cross-world). Click for SIMPLE mirrored.")
            } else {
                ("simple", "SIMPLE IBPA: LEFT + RIGHT mirror — @being #history :: /position. Click for the dual cross-world bar.")
            };
            if ui.button(mode_lbl).on_hover_text(mode_tip).clicked() {
                p.toggle_ibpa();
            }

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                // right-to-left layout → shown left-to-right: 2D, 3D, 4D, Story, Files, Rain
                for v in [View::Rain, View::Explorer, View::Story, View::FourD, View::World3d, View::Map2d] {
                    if ui.selectable_label(p.st.view == v, v.label()).clicked() {
                        p.st.view = v;
                    }
                }
            });
        });

        // row 2: LEFT :: RIGHT. SIMPLE = `@being #history :: /position` (mirrored — one story+history).
        // ADVANCED = the full dual chains; cross-history (LEFT #h != RIGHT #h) then tints :: amber.
        let cross = p.st.advanced_ibpa && cross_history(&p.st.left_stance, &p.st.address);
        let sep_col = if cross { egui::Color32::from_rgb(226, 197, 116) } else { egui::Color32::from_gray(110) };
        let right_hint = if p.st.advanced_ibpa { "story#history/space@being" } else { "/room · your position" };
        ui.horizontal(|ui| {
            // LEFT (actor) — editable; for now #history applies (being/position switching lands with tabs)
            let left = ui.add(
                egui::TextEdit::singleline(&mut p.st.left_stance)
                    .desired_width(ui.available_width() * 0.32)
                    .font(egui::TextStyle::Monospace)
                    .text_color(egui::Color32::from_rgb(120, 170, 230)),
            );
            if left.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                p.apply_left_stance();
            }

            ui.label(egui::RichText::new("::").color(sep_col).strong());

            // RIGHT (view) — editable; Enter navigates
            let right = ui.add(
                egui::TextEdit::singleline(&mut p.st.address)
                    .desired_width(ui.available_width())
                    .hint_text(right_hint)
                    .font(egui::TextStyle::Monospace),
            );
            if right.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                p.perceive_address();
            }
        });
        if cross {
            ui.label(egui::RichText::new("cross-history — you act on your branch while viewing another").color(egui::Color32::from_rgb(226, 197, 116)).small());
        }
        ui.add_space(5.0);
    });
}

/// True when the LEFT stance's #history differs from the RIGHT address's #history.
fn cross_history(left: &str, right: &str) -> bool {
    history_of(left) != history_of(right)
}

fn history_of(s: &str) -> String {
    // the segment between '#' and the next '/' or '@', else "0"
    if let Some(i) = s.find('#') {
        let rest = &s[i + 1..];
        let end = rest.find(['/', '@']).unwrap_or(rest.len());
        return rest[..end].to_string();
    }
    "0".to_string()
}
