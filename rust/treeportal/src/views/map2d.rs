// views/map2d.rs — the 2D top-down map, RPG-style. Renders the current moment's scene face (beings,
// child spaces, matter) at their real folded `coord {x,y}` on a scrolling grid. The camera FOLLOWS your
// driven being (p.active_being): your body stays centred and the world slides under it as you move, like
// an old top-down RPG. Scroll to zoom in/out. Beings float a speech bubble while their word is fresh
// (within BUBBLE_WINDOW of the world's now — "the last minute of their word"). Click a being to address
// it, a space to walk in. Coordless nodes ring the origin so a face with no positions still draws.

use eframe::egui;
use treehash::Json;

use super::scene::{collect_nodes, Node};
use crate::wire::proto::get;
use crate::Portal;

/// World grid unit → pixels at zoom 1.0 (one `coord` step).
const CELL: f32 = 58.0;

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
    let center = rect.center();

    // ── zoom (scroll wheel / pinch), persisted per-view in egui's temp store like world3d's yaw ──
    let zoom_id = egui::Id::new("map2d_zoom");
    let mut zoom = ui.data(|d| d.get_temp::<f32>(zoom_id).unwrap_or(1.0));
    if resp.hovered() {
        let (scroll, pinch) = ui.input(|i| (i.raw_scroll_delta.y, i.zoom_delta()));
        if scroll != 0.0 {
            zoom *= 1.0 + scroll * 0.0015;
        }
        if pinch != 1.0 {
            zoom *= pinch;
        }
        zoom = zoom.clamp(0.35, 4.0);
    }
    ui.data_mut(|d| d.insert_temp(zoom_id, zoom));
    let cell = CELL * zoom;

    let nodes = collect_nodes(&face);
    let n = nodes.len().max(1);

    // Every node's WORLD position: its folded coord, else a stable ring around the origin (by index, so a
    // coordless face still lays out and doesn't jitter frame-to-frame).
    let world_of = |i: usize, node: &Node| -> (f32, f32) {
        match node.coord {
            Some((x, y)) => (x as f32, y as f32),
            None => {
                let ang = i as f32 / n as f32 * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
                (ang.cos() * 2.6, ang.sin() * 2.6)
            }
        }
    };

    // ── the camera FOLLOWS your driven being: centre on its world position, so it sits at screen centre
    //    and the rest of the place slides around it. No body yet → centre on the origin (look in). ──
    let my_id = p.active_being.as_ref().map(|(bid, _)| bid.clone());
    let cam = my_id
        .as_ref()
        .and_then(|bid| nodes.iter().enumerate().find(|(_, node)| &node.id == bid))
        .map(|(i, node)| world_of(i, node))
        .unwrap_or((0.0, 0.0));
    let to_screen = |wx: f32, wy: f32| center + egui::vec2((wx - cam.0) * cell, (wy - cam.1) * cell);

    draw_grid(&painter, rect, cell, to_screen(0.0, 0.0));

    let hover = resp.hover_pos();
    let now = p.st.now_ord;
    let mut clicked: Option<(String, String, String)> = None; // (kind, id, label)

    for (i, node) in nodes.iter().enumerate() {
        let (wx, wy) = world_of(i, node);
        let pos = to_screen(wx, wy);
        // cull well off-screen so a big place stays cheap
        if !rect.expand(60.0).contains(pos) {
            continue;
        }
        let is_me = my_id.as_deref() == Some(node.id.as_str());
        let (base_col, base_r) = match node.kind.as_str() {
            "being" => (egui::Color32::from_rgb(180, 140, 230), 15.0),
            "space" => (egui::Color32::from_rgb(90, 150, 230), 17.0),
            _ => (egui::Color32::from_rgb(110, 200, 140), 11.0),
        };
        let r = base_r * zoom.clamp(0.5, 1.7);
        let col = if is_me { egui::Color32::from_rgb(210, 180, 255) } else { base_col };
        let hovered = hover.map_or(false, |hp| hp.distance(pos) < r + 5.0);

        if node.kind == "space" {
            painter.rect_filled(egui::Rect::from_center_size(pos, egui::vec2(r * 2.0, r * 2.0)), 3.0, col);
        } else {
            painter.circle_filled(pos, r, col);
        }
        // your own body: a gold ring so you always know which one is you (it stays centred as you move)
        if is_me {
            painter.circle_stroke(pos, r + 4.0, egui::Stroke::new(2.0, egui::Color32::from_rgb(255, 214, 90)));
        }
        if hovered {
            painter.circle_stroke(pos, r + 4.0, egui::Stroke::new(1.5, egui::Color32::WHITE));
            if resp.clicked() && !node.label.is_empty() {
                clicked = Some((node.kind.clone(), node.id.clone(), node.label.clone()));
            }
        }
        // labels: always for you/hovered, otherwise only when not zoomed way out (keeps it legible)
        if is_me || hovered || zoom > 0.5 {
            let lcol = if is_me { egui::Color32::from_rgb(255, 224, 150) } else { egui::Color32::from_gray(205) };
            painter.text(pos + egui::vec2(0.0, r + 11.0), egui::Align2::CENTER_CENTER, &node.label, egui::FontId::monospace(11.0), lcol);
        }
        // a fresh utterance (folded from the being's chain) floats above it as a speech bubble
        if let Some(said) = node.fresh_said(now) {
            bubble(&painter, pos - egui::vec2(0.0, r + 6.0), said);
        }
    }

    // ── HUD: the place name (top) + a hint. ──
    if let Some(Json::Str(name)) = get(&face, "name") {
        painter.text(rect.center_top() + egui::vec2(0.0, 16.0), egui::Align2::CENTER_CENTER, name, egui::FontId::monospace(13.0), egui::Color32::from_gray(150));
    }
    if nodes.is_empty() {
        painter.text(center + egui::vec2(0.0, 22.0), egui::Align2::CENTER_CENTER, "· empty place ·", egui::FontId::monospace(12.0), egui::Color32::from_gray(90));
    }
    let hint = match &p.active_being {
        Some((_, nm)) => format!("following @{nm} · scroll to zoom · click a being to address, a space to enter"),
        None => "scroll to zoom · click a being to address, a space to enter · drive a being to follow it".to_string(),
    };
    painter.text(rect.left_bottom() + egui::vec2(10.0, -8.0), egui::Align2::LEFT_BOTTOM, hint, egui::FontId::proportional(11.0), egui::Color32::from_gray(100));

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

/// A faint grid that SCROLLS with the camera (its lines are pinned to world origin `origin`), so moving
/// reads as the world sliding under your centred body.
fn draw_grid(painter: &egui::Painter, rect: egui::Rect, step: f32, origin: egui::Pos2) {
    if step < 6.0 {
        return; // too dense to be anything but noise when fully zoomed out
    }
    let stroke = egui::Stroke::new(1.0, egui::Color32::from_rgb(26, 28, 34));
    let mut x = rect.left() + (origin.x - rect.left()).rem_euclid(step);
    while x <= rect.right() {
        painter.line_segment([egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())], stroke);
        x += step;
    }
    let mut y = rect.top() + (origin.y - rect.top()).rem_euclid(step);
    while y <= rect.bottom() {
        painter.line_segment([egui::pos2(rect.left(), y), egui::pos2(rect.right(), y)], stroke);
        y += step;
    }
}
