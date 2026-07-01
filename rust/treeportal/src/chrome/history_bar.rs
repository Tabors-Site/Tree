// chrome/history_bar.rs — the shared time bar (all views). Scrub the global timeline 0..now to go BACK
// IN TIME (perceive the place as of a past ord), fast-forward, or return to the PRESENT. Viewing the
// past is a "ghost" state (amber) — acts always land at now. Branch / change-branch: the branch is a
// Word you type; changing branch is the LEFT stance's #history. (Library-scoped history is unbuilt.)

use eframe::egui;

use crate::Portal;

const AMBER: egui::Color32 = egui::Color32::from_rgb(226, 197, 116);

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::TopBottomPanel::bottom("history").show(ctx, |ui| {
        ui.add_space(3.0);
        ui.horizontal(|ui| {
            let ghost = p.st.at_ord.is_some();
            let now = p.st.now_ord.max(1.0);
            let mut pos = p.st.at_ord.unwrap_or(now).clamp(0.0, now);

            // step back / play-to-present / step forward
            if ui.small_button("⏮").on_hover_text("step back in time").clicked() {
                pos = (pos - (now / 40.0).max(1.0)).max(0.0);
                seek(p, pos, now);
            }
            if ui.small_button(if ghost { "⏭" } else { "●" }).on_hover_text(if ghost { "return to now" } else { "you are at now" }).clicked() {
                p.st.at_ord = None;
                reperceive(p);
            }
            if ui.small_button("⏵").on_hover_text("step forward in time").clicked() {
                pos = (pos + (now / 40.0).max(1.0)).min(now);
                seek(p, pos, now);
            }

            // the scrubber
            let resp = ui.add(egui::Slider::new(&mut pos, 0.0..=now).show_value(false).trailing_fill(true));
            if resp.changed() {
                seek(p, pos, now);
            }

            // status
            if ghost {
                ui.colored_label(AMBER, egui::RichText::new(format!("⏸ past · ord {}", pos as i64)).small());
            } else {
                ui.label(egui::RichText::new(format!("● now · ord {}", now as i64)).small().weak());
            }

            // branch + change-branch (right)
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(egui::RichText::new(format!("#{}", p.history)).monospace().small().color(egui::Color32::from_rgb(120, 170, 230)))
                    .on_hover_text("your branch — change it in the LEFT stance (#history); branching is a Word you type");
            });
        });
        ui.add_space(3.0);
    });
}

/// Set the scrubber to `pos` and re-perceive the place as of that ord (None when at/after now).
fn seek(p: &mut Portal, pos: f64, now: f64) {
    p.st.at_ord = if pos >= now { None } else { Some(pos) };
    reperceive(p);
}

/// Re-perceive the current address at the current time (no nav-stack push).
fn reperceive(p: &mut Portal) {
    let a = p.st.address.clone();
    p.navigate(&a, false);
}
