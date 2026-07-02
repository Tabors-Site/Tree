// views/world3d.rs — the FIRST-PERSON 3D view. You stand IN the world (not orbiting a box). The flat
// ground is a perspective grid; every being / space / matter has a BODY at its coord; you look around
// with the mouse (local, not an act) and move with W/A/S/D — each keypress is a MOVE WORD (one act =
// one moment, the stamp-mode test) that also steps the camera locally for immediate feel. No z axis
// (the world is flat); mouse-look is yaw only. Click a being → address it (@being); click a child
// space → walk in. Built with egui's painter — a real 3D engine can replace the renderer later without
// changing the coord / movement / selection model.

use eframe::egui;
use treehash::Json;

use super::scene::collect_nodes;
use crate::wire::proto::get;
use crate::Portal;

const CELL: f32 = 1.6; // world units between grid coords
const EYE: f32 = 1.15; // eye height above the ground

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
    // sky→ground gradient: a dim horizon so the flat world reads as a space you stand in.
    painter.rect_filled(rect, 0.0, egui::Color32::from_rgb(9, 11, 16));
    let horizon = rect.center().y;
    painter.rect_filled(
        egui::Rect::from_min_max(egui::pos2(rect.left(), horizon), rect.right_bottom()),
        0.0,
        egui::Color32::from_rgb(13, 15, 21),
    );

    // ── the scene: every being/space/matter stands at its REAL folded coord (coord.x, coord.y) in the
    //    space's grid. Moving is a Word → position folds → the body is drawn at the new coord. Nothing is
    //    faked client-side. ──
    let nodes = collect_nodes(&face);
    let world_of = |n: &super::scene::Node| -> Option<(f32, f32)> { n.coord.map(|(x, y)| (x as f32 * CELL, y as f32 * CELL)) };

    // the centre of everything placed — the default vantage when you have no body yet (a new Name at
    // @arrival looks in on the space from just outside the crowd).
    let mut sum = (0.0f32, 0.0f32, 0.0f32);
    for n in &nodes {
        if let Some((x, z)) = world_of(n) {
            sum = (sum.0 + x, sum.1 + z, sum.2 + 1.0);
        }
    }
    let centre = if sum.2 > 0.0 { (sum.0 / sum.2, sum.1 / sum.2) } else { (0.0, 0.0) };

    // every node's ground position: its coord, else a ring around the crowd centre — so child spaces /
    // matter that carry NO folded coord still stand in the scene instead of vanishing (they used to be
    // skipped, which is why spaces didn't render in 3D).
    let ncount = nodes.len().max(1) as f32;
    let place = |i: usize, n: &super::scene::Node| -> (f32, f32) {
        match world_of(n) {
            Some(c) => c,
            None => {
                let ang = i as f32 / ncount * std::f32::consts::TAU;
                (centre.0 + ang.cos() * CELL * 3.0, centre.1 + ang.sin() * CELL * 3.0)
            }
        }
    };

    // ── the camera: FIRST-PERSON at your driven being's coord (you look out of its eyes); else a vantage
    //    pulled back from the centre, looking in. Only YAW is local (the mouse turns your head); your
    //    ground position IS your being's folded position — walk by saying the move Word. ──
    let cam_id = egui::Id::new("fp_yaw");
    let mut yaw = ui.data(|d| d.get_temp::<f32>(cam_id).unwrap_or(0.0));
    if resp.dragged() {
        yaw += resp.drag_delta().x * 0.005;
    }
    ui.data_mut(|d| d.insert_temp(cam_id, yaw));

    let my_id = p.active_being.as_ref().map(|(bid, _)| bid.clone());
    let my_coord = my_id.as_ref().and_then(|bid| nodes.iter().find(|n| &n.id == bid)).and_then(world_of);
    let (px, pz) = match my_coord {
        Some((x, z)) => (x, z),           // stand in your body
        None => (centre.0, centre.1 - 12.0), // hover back from the crowd, looking toward it (+z)
    };
    let cam = FpCam { px, pz, yaw, focal: rect.height() * 1.05, center: rect.center() };

    draw_grid(&painter, &cam, 12);

    let mut placed: Vec<(f32, egui::Pos2, egui::Pos2, &super::scene::Node)> = Vec::new();
    for (i, node) in nodes.iter().enumerate() {
        // don't draw the body you're looking OUT of (first-person)
        if my_coord.is_some() && my_id.as_deref() == Some(node.id.as_str()) {
            continue;
        }
        let (wx, wz) = place(i, node);
        let h = body_height(&node.kind);
        if let (Some((base, depth)), Some((top, _))) = (cam.project(wx, 0.0, wz), cam.project(wx, h, wz)) {
            placed.push((depth, base, top, node));
        }
    }
    placed.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)); // far first

    let hover = resp.hover_pos();
    let now = p.st.now_ord;
    let mut click_being: Option<(String, String)> = None;
    let mut click_space: Option<String> = None;
    for (depth, base, top, node) in &placed {
        let hit = draw_body(&painter, *base, *top, node, *depth, hover);
        // a fresh utterance floats above the head as a speech bubble (folded from the being's chain).
        if let Some(said) = node.fresh_said(now) {
            draw_bubble(&painter, *top, said);
        }
        if hit && resp.clicked() && !node.id.is_empty() {
            match node.kind.as_str() {
                "being" => click_being = Some((node.id.clone(), strip_at(&node.label))),
                "space" => click_space = Some(node.id.clone()),
                _ => {}
            }
        }
    }

    // ── HUD: crosshair, the place name, the controls, the active target ──
    let cross = rect.center();
    let cc = egui::Color32::from_gray(90);
    painter.line_segment([cross - egui::vec2(6.0, 0.0), cross + egui::vec2(6.0, 0.0)], egui::Stroke::new(1.0, cc));
    painter.line_segment([cross - egui::vec2(0.0, 6.0), cross + egui::vec2(0.0, 6.0)], egui::Stroke::new(1.0, cc));
    if let Some(Json::Str(name)) = get(&face, "name") {
        painter.text(rect.center_top() + egui::vec2(0.0, 16.0), egui::Align2::CENTER_CENTER, name, egui::FontId::monospace(13.0), egui::Color32::from_gray(150));
    }
    // your coord — first-person means you never see your OWN body, so the ticking (x,y) is the proof you
    // moved. "not in this place" if your body isn't in the perceived scene (a stale address).
    if let Some((_, nm)) = &p.active_being {
        let my_grid = my_id.as_ref().and_then(|bid| nodes.iter().find(|n| &n.id == bid)).and_then(|n| n.coord);
        let txt = match my_grid {
            Some((x, y)) => format!("@{nm}  ({}, {})", x as i64, y as i64),
            None => format!("@{nm}  · not in this place"),
        };
        painter.text(rect.right_top() + egui::vec2(-12.0, 16.0), egui::Align2::RIGHT_CENTER, txt, egui::FontId::monospace(12.0), egui::Color32::from_rgb(255, 214, 90));
    }
    let hud = match &p.st.target_being {
        Some((_, nm)) => format!("drag to look · say the Word (bottom bar) · calling @{nm}"),
        None => "drag to look · say the Word in the bar below · click a being to address it".to_string(),
    };
    painter.text(rect.left_bottom() + egui::vec2(10.0, -8.0), egui::Align2::LEFT_BOTTOM, hud, egui::FontId::proportional(11.0), egui::Color32::from_gray(100));

    // apply clicks after the draw borrow ends
    if let Some((bid, name)) = click_being {
        p.select_being(&bid, &name);
    } else if let Some(sid) = click_space {
        p.st.address = format!("space/{sid}");
        p.perceive_address();
    }
}

/// A speech bubble floating above a being's head — the fresh utterance folded from its chain.
fn draw_bubble(painter: &egui::Painter, head_top: egui::Pos2, text: &str) {
    let text = if text.len() > 60 { format!("{}…", &text[..57]) } else { text.to_string() };
    let fid = egui::FontId::proportional(12.0);
    let galley = painter.layout_no_wrap(text, fid, egui::Color32::from_gray(20));
    let pad = egui::vec2(8.0, 5.0);
    let anchor = head_top - egui::vec2(0.0, 20.0);
    let rect = egui::Rect::from_center_size(anchor, galley.size() + pad * 2.0);
    painter.rect_filled(rect, 7.0, egui::Color32::from_rgba_unmultiplied(238, 240, 245, 240));
    // a little tail pointing down to the head
    let tip = egui::pos2(anchor.x, rect.bottom() + 6.0);
    painter.add(egui::Shape::convex_polygon(
        vec![egui::pos2(anchor.x - 5.0, rect.bottom()), egui::pos2(anchor.x + 5.0, rect.bottom()), tip],
        egui::Color32::from_rgba_unmultiplied(238, 240, 245, 240),
        egui::Stroke::NONE,
    ));
    painter.galley(rect.min + pad, galley, egui::Color32::from_gray(20));
}

fn body_height(kind: &str) -> f32 {
    match kind {
        "being" => 1.7,
        "space" => 2.2, // a doorway/pillar you can walk toward
        _ => 0.8,       // matter squats on the ground
    }
}

fn strip_at(label: &str) -> String {
    label.trim_start_matches('@').to_string()
}

/// The first-person pinhole camera. Ground plane is (x,z); up is y. Yaw only (flat world, no pitch).
struct FpCam {
    px: f32,
    pz: f32,
    yaw: f32,
    focal: f32,
    center: egui::Pos2,
}

impl FpCam {
    /// Project a world point to the screen. Returns (screen, forward-depth) or None if behind the eye.
    fn project(&self, wx: f32, wy: f32, wz: f32) -> Option<(egui::Pos2, f32)> {
        let dx = wx - self.px;
        let dz = wz - self.pz;
        let (s, c) = self.yaw.sin_cos();
        let fwd = dx * s + dz * c; // into the screen
        if fwd <= 0.12 {
            return None; // behind (or on) the eye plane
        }
        let rightc = dx * c - dz * s;
        let up = wy - EYE;
        let sx = self.center.x + self.focal * rightc / fwd;
        let sy = self.center.y - self.focal * up / fwd;
        Some((egui::pos2(sx, sy), fwd))
    }
}

/// The ground grid, drawn in perspective. Each line is sampled and only in-front sub-segments are drawn
/// (a cheap near-plane clip), so lines running toward/behind the camera don't smear.
fn draw_grid(painter: &egui::Painter, cam: &FpCam, half: i32) {
    let col = egui::Color32::from_rgb(30, 34, 44);
    let stroke = egui::Stroke::new(1.0, col);
    // centre the grid on the camera's ground cell, so it always spans where you (and the beings) stand —
    // coords live in a big space (0..100), far from the origin.
    let cgx = (cam.px / CELL).round() as i32;
    let cgz = (cam.pz / CELL).round() as i32;
    let steps = 24;
    for i in -half..=half {
        let a = (cgx + i) as f32 * CELL;
        let b = (cgz + i) as f32 * CELL;
        // a line of constant world-x running along z (spanning the camera's z window)
        polyline_ground(painter, cam, stroke, steps, |t| {
            let z = ((cgz - half) as f32 + t * (2 * half) as f32) * CELL;
            (a, z)
        });
        // a line of constant world-z running along x
        polyline_ground(painter, cam, stroke, steps, |t| {
            let x = ((cgx - half) as f32 + t * (2 * half) as f32) * CELL;
            (x, b)
        });
    }
}

fn polyline_ground(painter: &egui::Painter, cam: &FpCam, stroke: egui::Stroke, steps: usize, at: impl Fn(f32) -> (f32, f32)) {
    let mut prev: Option<egui::Pos2> = None;
    for k in 0..=steps {
        let t = k as f32 / steps as f32;
        let (x, z) = at(t);
        let cur = cam.project(x, 0.0, z).map(|(p, _)| p);
        if let (Some(a), Some(b)) = (prev, cur) {
            painter.line_segment([a, b], stroke);
        }
        prev = cur;
    }
}

/// Draw one body as a simple billboard figure (head + torso) between its projected ground point and top.
/// Returns whether the cursor is over it (for click selection).
fn draw_body(painter: &egui::Painter, base: egui::Pos2, top: egui::Pos2, node: &super::scene::Node, depth: f32, hover: Option<egui::Pos2>) -> bool {
    let (col, is_being) = match node.kind.as_str() {
        "being" => (egui::Color32::from_rgb(190, 150, 235), true),
        "space" => (egui::Color32::from_rgb(95, 155, 235), false),
        _ => (egui::Color32::from_rgb(115, 205, 145), false),
    };
    let h = (base.y - top.y).abs().max(6.0);
    let w = (h * 0.28).clamp(3.0, 60.0);
    let bbox = egui::Rect::from_min_max(egui::pos2(top.x - w, top.y), egui::pos2(top.x + w, base.y));
    let hovered = hover.map_or(false, |hp| bbox.expand(4.0).contains(hp));
    let shade = (1.0 - (depth * 0.02)).clamp(0.35, 1.0);
    let body = egui::Color32::from_rgb((col.r() as f32 * shade) as u8, (col.g() as f32 * shade) as u8, (col.b() as f32 * shade) as u8);
    let edge = if hovered { egui::Color32::WHITE } else { body };

    if is_being {
        // torso (rounded) + head — a standing figure
        let torso = egui::Rect::from_min_max(egui::pos2(top.x - w * 0.6, top.y + h * 0.28), egui::pos2(top.x + w * 0.6, base.y));
        painter.rect_filled(torso, w * 0.35, body);
        painter.circle_filled(egui::pos2(top.x, top.y + h * 0.16), w * 0.5, body);
        if hovered {
            painter.rect_stroke(bbox.expand(2.0), 3.0, egui::Stroke::new(1.0, edge));
        }
    } else if node.kind == "space" {
        // a doorway you walk into: a lit archway
        painter.rect_filled(bbox, w * 0.2, body.linear_multiply(0.4));
        painter.rect_stroke(bbox, w * 0.2, egui::Stroke::new(2.0, edge));
    } else {
        // matter: a low crate
        painter.rect_filled(bbox, 2.0, body);
    }

    // label (shrinks with distance)
    let fs = (h * 0.22).clamp(9.0, 15.0);
    let lc = if hovered { egui::Color32::WHITE } else { egui::Color32::from_gray(210) };
    painter.text(egui::pos2(top.x, top.y - 4.0), egui::Align2::CENTER_BOTTOM, &node.label, egui::FontId::monospace(fs), lc);
    hovered
}
