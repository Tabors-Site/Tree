// views/map2d.rs — the 2D top-down map. Renders the current moment's scene face: beings, child spaces,
// and matter as labeled nodes on a faint grid. Positions use a `coord {x,y}` when the face carries one,
// else a ring layout. Click a node to take a moment of it (walk in / inspect). Generic over the face
// shape (a space fold, the reel index, …) so it draws whatever the moment gives.

use eframe::egui;
use treehash::Json;

use super::scene::collect_nodes;
use crate::wire::proto::get;
use crate::Portal;

pub fn show(ui: &mut egui::Ui, p: &mut Portal) {
    let face = match &p.st.moment {
        Some(m) => get(&m.raw, "view").cloned(),
        None => None,
    };
    let face = match face {
        Some(f) => f,
        None => {
            ui.add_space(20.0);
            ui.weak("taking a moment…");
            return;
        }
    };

    let size = ui.available_size();
    let (resp, painter) = ui.allocate_painter(size, egui::Sense::click());
    let rect = resp.rect;
    draw_grid(&painter, rect);

    // the place name at center (if the face names itself)
    let center = rect.center();
    if let Some(Json::Str(name)) = get(&face, "name") {
        painter.text(center, egui::Align2::CENTER_CENTER, name, egui::FontId::monospace(13.0), egui::Color32::from_gray(140));
    }

    let nodes = collect_nodes(&face);
    if nodes.is_empty() {
        painter.text(center + egui::vec2(0.0, 22.0), egui::Align2::CENTER_CENTER, "· empty place ·", egui::FontId::monospace(12.0), egui::Color32::from_gray(90));
        return;
    }

    let radius = (rect.width().min(rect.height()) * 0.34).max(70.0);
    let hover = resp.hover_pos();
    let mut clicked: Option<(String, String, String)> = None; // (kind, id, label)

    for (i, n) in nodes.iter().enumerate() {
        let pos = match n.coord {
            Some((x, y)) => center + egui::vec2(x as f32 * 58.0, y as f32 * 58.0),
            None => {
                let ang = i as f32 / nodes.len() as f32 * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
                center + egui::vec2(ang.cos() * radius, ang.sin() * radius)
            }
        };
        let (col, r) = match n.kind.as_str() {
            "being" => (egui::Color32::from_rgb(180, 140, 230), 15.0),
            "space" => (egui::Color32::from_rgb(90, 150, 230), 17.0),
            _ => (egui::Color32::from_rgb(110, 200, 140), 11.0),
        };
        let hovered = hover.map_or(false, |hp| hp.distance(pos) < r + 5.0);
        if n.kind == "space" {
            painter.rect_filled(egui::Rect::from_center_size(pos, egui::vec2(r * 2.0, r * 2.0)), 3.0, col);
        } else {
            painter.circle_filled(pos, r, col);
        }
        if hovered {
            painter.circle_stroke(pos, r + 4.0, egui::Stroke::new(1.5, egui::Color32::WHITE));
            if resp.clicked() && !n.label.is_empty() {
                clicked = Some((n.kind.clone(), n.id.clone(), n.label.clone()));
            }
        }
        painter.text(pos + egui::vec2(0.0, r + 11.0), egui::Align2::CENTER_CENTER, &n.label, egui::FontId::monospace(11.0), egui::Color32::from_gray(205));
        // a fresh utterance (folded from the being's chain) floats above it as a speech bubble
        if let Some(said) = n.fresh_said(p.st.now_ord) {
            bubble(&painter, pos - egui::vec2(0.0, r + 6.0), said);
        }
    }

    // click a SPACE -> walk into it (append its name to the path); a BEING -> ADDRESS it (set the RIGHT
    // @being, so a Word you say calls it). Driving a being is a separate act (its tab / the Rain panel).
    if let Some((kind, id, label)) = clicked {
        match kind.as_str() {
            "being" => p.select_being(&id, label.trim_start_matches('@')),
            _ => {
                let target = child_address(&p.st.address, &label);
                p.navigate(&target, true);
            }
        }
    }
}

/// Append a child space name to the current path (dropping any trailing @being).
fn child_address(current: &str, name: &str) -> String {
    let base = current.split('@').next().unwrap_or(current).trim_end_matches('/');
    format!("{base}/{name}")
}

/// A speech bubble above a being (the fresh utterance folded from its chain).
fn bubble(painter: &egui::Painter, anchor: egui::Pos2, text: &str) {
    let text = if text.len() > 60 { format!("{}…", &text[..57]) } else { text.to_string() };
    let galley = painter.layout_no_wrap(text, egui::FontId::proportional(12.0), egui::Color32::from_gray(20));
    let pad = egui::vec2(8.0, 5.0);
    let center = anchor - egui::vec2(0.0, galley.size().y * 0.5 + pad.y);
    let rect = egui::Rect::from_center_size(center, galley.size() + pad * 2.0);
    painter.rect_filled(rect, 7.0, egui::Color32::from_rgba_unmultiplied(238, 240, 245, 240));
    painter.add(egui::Shape::convex_polygon(
        vec![egui::pos2(center.x - 5.0, rect.bottom()), egui::pos2(center.x + 5.0, rect.bottom()), egui::pos2(center.x, rect.bottom() + 6.0)],
        egui::Color32::from_rgba_unmultiplied(238, 240, 245, 240),
        egui::Stroke::NONE,
    ));
    painter.galley(rect.min + pad, galley, egui::Color32::from_gray(20));
}

fn draw_grid(painter: &egui::Painter, rect: egui::Rect) {
    let step = 56.0;
    let col = egui::Color32::from_rgb(26, 28, 34);
    let stroke = egui::Stroke::new(1.0, col);
    let mut x = rect.left();
    while x <= rect.right() {
        painter.line_segment([egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())], stroke);
        x += step;
    }
    let mut y = rect.top();
    while y <= rect.bottom() {
        painter.line_segment([egui::pos2(rect.left(), y), egui::pos2(rect.right(), y)], stroke);
        y += step;
    }
}

