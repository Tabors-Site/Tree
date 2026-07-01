// chrome/history_bar.rs — the shared time+branch bar (all views). The TIMELINE is real: a dot per
// moment (act), folded from the chains; hover reads it, click scrubs the world to that moment. Viewing
// the past is a "ghost" state (amber) — acts always land at now. The BRANCH switcher lists main + every
// history; you can switch onto a branch (your acts land there) or fork a NEW one at the scrubbed moment.

use eframe::egui;

use crate::Portal;

const AMBER: egui::Color32 = egui::Color32::from_rgb(226, 197, 116);
const ACCENT: egui::Color32 = egui::Color32::from_rgb(120, 170, 230);

pub fn show(ctx: &egui::Context, p: &mut Portal) {
    egui::TopBottomPanel::bottom("history").show(ctx, |ui| {
        ui.add_space(3.0);
        ui.horizontal(|ui| {
            let ghost = p.st.at_ord.is_some();
            let now = p.st.now_ord.max(1.0);
            let mut pos = p.st.at_ord.unwrap_or(now).clamp(0.0, now);

            // step back / return-to-now / step forward
            if ui.small_button("⏮").on_hover_text("step back a moment").clicked() {
                pos = step(&p.st.timeline, pos, -1, now);
                seek(p, pos, now);
            }
            if ui.small_button(if ghost { "⏭" } else { "●" }).on_hover_text(if ghost { "return to now" } else { "you are at now" }).clicked() {
                p.st.at_ord = None;
                reperceive(p);
            }
            if ui.small_button("⏵").on_hover_text("step forward a moment").clicked() {
                pos = step(&p.st.timeline, pos, 1, now);
                seek(p, pos, now);
            }

            // ── the MOMENT TIMELINE: a dot per act; hover to read it, click to scrub ──────────────────
            let want = egui::vec2((ui.available_width() - 210.0).max(120.0), 22.0);
            let (rect, tl) = ui.allocate_exact_size(want, egui::Sense::click());
            let painter = ui.painter().with_clip_rect(rect);
            let rail_y = rect.center().y;
            let lo = p.st.timeline.first().map(|(o, _)| *o).unwrap_or(0.0);
            let span = (now - lo).max(1.0);
            let x_of = |o: f64| rect.left() + ((o - lo) / span).clamp(0.0, 1.0) as f32 * rect.width();
            painter.line_segment([egui::pos2(rect.left(), rail_y), egui::pos2(rect.right(), rail_y)], egui::Stroke::new(1.0, egui::Color32::from_gray(55)));
            painter.line_segment([egui::pos2(rect.left(), rail_y), egui::pos2(x_of(pos), rail_y)], egui::Stroke::new(2.0, ACCENT.gamma_multiply(0.7)));

            let hover = tl.hover_pos();
            let mut tip: Option<(egui::Pos2, String)> = None;
            let mut clicked: Option<f64> = None;
            for (o, phrase) in &p.st.timeline {
                let x = x_of(*o);
                let near = hover.map_or(false, |h| (h.x - x).abs() < 4.0);
                let col = if *o <= pos + 0.5 { ACCENT } else { egui::Color32::from_gray(105) };
                painter.circle_filled(egui::pos2(x, rail_y), if near { 4.5 } else { 2.5 }, if near { egui::Color32::WHITE } else { col });
                if near {
                    tip = Some((egui::pos2(x, rail_y), phrase.clone()));
                    if tl.clicked() {
                        clicked = Some(*o);
                    }
                }
            }
            // the cursor
            painter.line_segment([egui::pos2(x_of(pos), rect.top()), egui::pos2(x_of(pos), rect.bottom())], egui::Stroke::new(1.5, if ghost { AMBER } else { ACCENT }));
            // a click on empty rail seeks to that fraction
            if tl.clicked() && clicked.is_none() {
                if let Some(h) = hover {
                    let frac = ((h.x - rect.left()) / rect.width()).clamp(0.0, 1.0) as f64;
                    clicked = Some(lo + frac * span);
                }
            }
            if let Some((c, phrase)) = tip {
                let text = if phrase.len() > 64 { format!("{}…", &phrase[..61]) } else { phrase };
                painter.text(egui::pos2(c.x, rect.top() - 1.0), egui::Align2::CENTER_BOTTOM, text, egui::FontId::proportional(11.0), egui::Color32::from_gray(225));
            }
            if let Some(o) = clicked {
                seek(p, o, now);
            }

            // status
            if ghost {
                ui.colored_label(AMBER, egui::RichText::new(format!("⏸ ord {}", pos as i64)).small());
            } else {
                ui.label(egui::RichText::new(format!("● now {}", now as i64)).small().weak());
            }

            // ── the BRANCH switcher + fork ───────────────────────────────────────────────────────────
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                // fork a new branch at the scrubbed moment (or now)
                if ui.small_button("⑂ branch").on_hover_text("fork a NEW history here — your acts diverge from this moment").clicked() {
                    let n = p.st.branches.len();
                    p.create_branch(&format!("branch-{n}"));
                }
                // the branch you stand on + a switcher of all histories
                let cur = p.history.clone();
                let cur_label = p.st.branches.iter().find(|b| b.path == cur).map(|b| b.label.clone()).unwrap_or_else(|| cur.clone());
                let mut switch_to: Option<String> = None;
                egui::ComboBox::from_id_source("branch_switch")
                    .selected_text(egui::RichText::new(format!("#{cur} {cur_label}")).monospace().small().color(ACCENT))
                    .show_ui(ui, |ui| {
                        for b in &p.st.branches {
                            let on = b.path == cur;
                            let tag = if b.path == "0" { b.label.clone() } else { format!("{} (off #{})", b.label, b.parent.clone().unwrap_or_default()) };
                            if ui.selectable_label(on, egui::RichText::new(format!("#{}  {tag}", b.path)).monospace()).clicked() && !on {
                                switch_to = Some(b.path.clone());
                            }
                        }
                    })
                    .response
                    .on_hover_text("the branch you act on — switch to view/act on another history");
                if let Some(path) = switch_to {
                    p.switch_history(&path);
                }
            });
        });
        ui.add_space(3.0);
    });
}

/// Move the scrubber to the previous/next real moment (dir -1/+1); falls back to a coarse ord step when
/// the timeline is empty.
fn step(timeline: &[(f64, String)], pos: f64, dir: i32, now: f64) -> f64 {
    if timeline.is_empty() {
        return (pos + dir as f64 * (now / 40.0).max(1.0)).clamp(0.0, now);
    }
    if dir < 0 {
        timeline.iter().map(|(o, _)| *o).filter(|o| *o < pos - 0.5).next_back().unwrap_or(0.0)
    } else {
        timeline.iter().map(|(o, _)| *o).find(|o| *o > pos + 0.5).unwrap_or(now)
    }
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
