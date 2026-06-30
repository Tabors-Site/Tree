// views/world3d.rs — the simple 3D view: the tangibility test ("easy to feel and see it's stable").
// The same scene face as the 2D map, but in an isometric 3D world: a ground grid, a box per entity
// (beings/spaces/matter) standing on it, and a name billboard above each. Drag to orbit. Built simple
// with egui's painter — no glow/three-d context-sharing (a real three-d renderer is a drop-in later,
// and the generative face replaces this renderer per GenerativeMode.md). Click a box to take its moment.

use eframe::egui;
use treehash::Json;

use super::scene::collect_nodes;
use crate::wire::proto::get;
use crate::Portal;

pub fn show(ui: &mut egui::Ui, p: &mut Portal) {
    let face = match p.st.moment.as_ref().and_then(|m| get(&m.raw, "view").cloned()) {
        Some(f) => f,
        None => {
            ui.add_space(20.0);
            ui.weak("taking a moment…");
            return;
        }
    };

    let size = ui.available_size();
    let (resp, painter) = ui.allocate_painter(size, egui::Sense::click_and_drag());
    let rect = resp.rect;
    painter.rect_filled(rect, 0.0, egui::Color32::from_rgb(10, 11, 14));

    // orbit angle from horizontal drag (persisted in egui memory)
    let yaw_id = egui::Id::new("world3d_yaw");
    let mut yaw = ui.data(|d| d.get_temp::<f32>(yaw_id).unwrap_or(0.6));
    if resp.dragged() {
        yaw += resp.drag_delta().x * 0.006;
    }
    ui.data_mut(|d| d.insert_temp(yaw_id, yaw));

    let center = rect.center() + egui::vec2(0.0, rect.height() * 0.18);
    let scale = (rect.width().min(rect.height()) * 0.5 / 8.0).max(14.0);
    let cam = Camera { center, scale, yaw, tilt: 0.5 };

    draw_ground(&painter, &cam, 5);

    let nodes = collect_nodes(&face);
    // place nodes by coord, else a ring on the ground
    let n = nodes.len().max(1);
    let mut placed: Vec<(egui::Pos2, &super::scene::Node, f32)> = Vec::new();
    for (i, node) in nodes.iter().enumerate() {
        let (wx, wz) = match node.coord {
            Some((x, y)) => (x as f32, y as f32),
            None => {
                let a = i as f32 / n as f32 * std::f32::consts::TAU;
                (a.cos() * 3.0, a.sin() * 3.0)
            }
        };
        let ground = cam.project(wx, 0.0, wz);
        placed.push((ground, node, wx + wz)); // depth key ~ wx+wz
    }
    // painter's algorithm: far boxes first
    placed.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));

    let hover = resp.hover_pos();
    let mut clicked: Option<(String, String)> = None;
    for (ground, node, _) in &placed {
        let (wx, wz) = cam.unproject_ground(*ground); // recover for the top point
        let (col, h) = match node.kind.as_str() {
            "being" => (egui::Color32::from_rgb(180, 140, 230), 1.4),
            "space" => (egui::Color32::from_rgb(90, 150, 230), 1.0),
            _ => (egui::Color32::from_rgb(110, 200, 140), 0.7),
        };
        let top = cam.project(wx, h, wz);
        let hovered = hover.map_or(false, |hp| hp.distance(*ground) < 22.0 || hp.distance(top) < 22.0);
        draw_box(&painter, &cam, wx, wz, h, col, hovered);
        painter.text(top + egui::vec2(0.0, -10.0), egui::Align2::CENTER_CENTER, &node.label, egui::FontId::monospace(11.0), egui::Color32::from_gray(215));
        if hovered && resp.clicked() && !node.id.is_empty() {
            clicked = Some((node.kind.clone(), node.id.clone()));
        }
    }

    if let Some(Json::Str(name)) = get(&face, "name") {
        painter.text(rect.center_top() + egui::vec2(0.0, 16.0), egui::Align2::CENTER_CENTER, name, egui::FontId::monospace(13.0), egui::Color32::from_gray(150));
    }
    painter.text(rect.left_bottom() + egui::vec2(10.0, -8.0), egui::Align2::LEFT_BOTTOM, "drag to orbit", egui::FontId::proportional(11.0), egui::Color32::from_gray(90));

    if let Some((kind, id)) = clicked {
        p.st.address = format!("{kind}/{id}");
        p.perceive_address();
    }
}

struct Camera {
    center: egui::Pos2,
    scale: f32,
    yaw: f32,
    tilt: f32,
}

impl Camera {
    /// Project a world point (x right, y up, z forward) to the screen — a yaw-rotated isometric.
    fn project(&self, wx: f32, wy: f32, wz: f32) -> egui::Pos2 {
        let (s, c) = self.yaw.sin_cos();
        let rx = wx * c - wz * s;
        let rz = wx * s + wz * c;
        let sx = rx * self.scale;
        let sy = (rz * self.tilt - wy) * self.scale;
        self.center + egui::vec2(sx, sy)
    }

    /// Inverse of project for a ground point (wy=0) — used to recover (x,z) for the box top.
    fn unproject_ground(&self, p: egui::Pos2) -> (f32, f32) {
        let d = p - self.center;
        let rx = d.x / self.scale;
        let rz = (d.y / self.scale) / self.tilt;
        let (s, c) = self.yaw.sin_cos();
        // rotate back by -yaw
        let wx = rx * c + rz * s;
        let wz = -rx * s + rz * c;
        (wx, wz)
    }
}

fn draw_ground(painter: &egui::Painter, cam: &Camera, n: i32) {
    let col = egui::Color32::from_rgb(28, 30, 38);
    let stroke = egui::Stroke::new(1.0, col);
    for i in -n..=n {
        let f = i as f32;
        painter.line_segment([cam.project(f, 0.0, -n as f32), cam.project(f, 0.0, n as f32)], stroke);
        painter.line_segment([cam.project(-n as f32, 0.0, f), cam.project(n as f32, 0.0, f)], stroke);
    }
}

fn draw_box(painter: &egui::Painter, cam: &Camera, wx: f32, wz: f32, h: f32, col: egui::Color32, hovered: bool) {
    let s = 0.42;
    // four ground corners + four top corners
    let g = [
        cam.project(wx - s, 0.0, wz - s),
        cam.project(wx + s, 0.0, wz - s),
        cam.project(wx + s, 0.0, wz + s),
        cam.project(wx - s, 0.0, wz + s),
    ];
    let t = [
        cam.project(wx - s, h, wz - s),
        cam.project(wx + s, h, wz - s),
        cam.project(wx + s, h, wz + s),
        cam.project(wx - s, h, wz + s),
    ];
    let side = col.linear_multiply(0.55);
    // two visible side faces + the top
    painter.add(egui::Shape::convex_polygon(vec![g[0], g[1], t[1], t[0]], side, egui::Stroke::NONE));
    painter.add(egui::Shape::convex_polygon(vec![g[1], g[2], t[2], t[1]], col.linear_multiply(0.75), egui::Stroke::NONE));
    let top_col = if hovered { egui::Color32::WHITE } else { col };
    painter.add(egui::Shape::convex_polygon(vec![t[0], t[1], t[2], t[3]], top_col, egui::Stroke::new(1.0, col.linear_multiply(1.2))));
}
