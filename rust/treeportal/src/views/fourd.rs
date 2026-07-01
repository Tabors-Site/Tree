// views/fourd.rs — the 4D view: every history/branch of the story drawn as a TREE from `0` (main). This
// is the timeline-of-timelines: navigate between branches and their past moments. It centres on the
// branch you're on (your being's history tip, or wherever you've rewound the history bar to), scroll to
// zoom out to the whole tree / in to see a branch clearly, drag to pan. Click a branch to SWITCH onto it
// (your acts land there); the moment dots under your current branch scrub the world to a past moment;
// "fork" makes a new branch here. All real ops (switch / fork / scrub) go through the same paths the
// branch menu uses. (Data today: path/label/parent + the CURRENT branch's moments. A time-accurate
// git-graph — fork ords, per-branch tips, every branch's moments — waits on the server sending those.)

use eframe::egui;
use std::collections::HashMap;

use crate::Portal;

pub fn show(ui: &mut egui::Ui, p: &mut Portal) {
    // snapshot what we draw so the painter closures don't hold a borrow while we apply clicks after.
    let branches = p.st.branches.clone();
    let cur = p.history.clone();
    let now = p.st.now_ord;
    let at = p.st.at_ord;
    let timeline = p.st.timeline.clone();

    // ── toolbar: real fork + honest-disabled affordances for the ops the Rust server doesn't have yet ──
    let mut fork = false;
    ui.horizontal(|ui| {
        if ui.button("⑂ fork a new branch here").clicked() {
            fork = true;
        }
        ui.separator();
        ui.weak(format!("on #{cur} · {} histories · scroll to zoom · drag to pan · click a branch to switch", branches.len().max(1)));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            for (name, why) in [
                ("pause", "pause/unpause a branch — needs the server act (in the JS seed, not yet in the Rust server)"),
                ("rename", "set a branch's pointer name — needs the server set-pointer act (JS seed → Rust)"),
            ] {
                ui.add_enabled(false, egui::Button::new(name)).on_hover_text(why);
            }
        });
    });

    let size = ui.available_size();
    let (resp, painter) = ui.allocate_painter(size, egui::Sense::click_and_drag());
    let rect = resp.rect;
    painter.rect_filled(rect, 0.0, egui::Color32::from_rgb(14, 15, 20));

    if branches.is_empty() {
        painter.text(rect.center(), egui::Align2::CENTER_CENTER, "taking a moment of the histories…", egui::FontId::monospace(13.0), egui::Color32::from_gray(120));
        return;
    }

    // ── zoom (scroll/pinch) + pan (drag), persisted per-view like the other canvases ──
    let (zoom_id, pan_id) = (egui::Id::new("fourd_zoom"), egui::Id::new("fourd_pan"));
    let mut zoom = ui.data(|d| d.get_temp::<f32>(zoom_id).unwrap_or(1.0));
    let mut pan = ui.data(|d| d.get_temp::<egui::Vec2>(pan_id).unwrap_or(egui::Vec2::ZERO));
    if resp.hovered() {
        let (scroll, pinch) = ui.input(|i| (i.raw_scroll_delta.y, i.zoom_delta()));
        if scroll != 0.0 {
            zoom *= 1.0 + scroll * 0.0015;
        }
        if pinch != 1.0 {
            zoom *= pinch;
        }
        zoom = zoom.clamp(0.25, 3.0);
    }
    if resp.dragged() {
        pan += resp.drag_delta();
    }
    ui.data_mut(|d| {
        d.insert_temp(zoom_id, zoom);
        d.insert_temp(pan_id, pan);
    });

    // ── tidy tree layout: x by leaf order, y by depth (parent → children below). ──
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    for b in &branches {
        if let Some(par) = &b.parent {
            children.entry(par.clone()).or_default().push(b.path.clone());
        }
    }
    let mut pos: HashMap<String, (f32, f32)> = HashMap::new();
    let mut xc = 0.0f32;
    layout_tree("0", 0.0, &children, &mut xc, &mut pos);
    for b in &branches {
        // any branch not reached from "0" (orphan / future branch-of-branch beyond the walk) still lays out
        if !pos.contains_key(&b.path) {
            layout_tree(&b.path, 0.0, &children, &mut xc, &mut pos);
        }
    }

    // centre the CURRENT branch (+ the user's pan). hs/vs are world→pixel at zoom 1.
    let cur_pos = pos.get(&cur).copied().unwrap_or((0.0, 0.0));
    let (hs, vs) = (168.0f32, 104.0f32);
    let to_screen = |tx: f32, ty: f32| rect.center() + pan + egui::vec2((tx - cur_pos.0) * hs, (ty - cur_pos.1) * vs) * zoom;

    // ── edges (parent → child) ──
    for b in &branches {
        if let (Some(par), Some(cp)) = (b.parent.as_ref(), pos.get(&b.path)) {
            if let Some(pp) = pos.get(par) {
                let a = to_screen(pp.0, pp.1) + egui::vec2(0.0, 16.0 * zoom);
                let z = to_screen(cp.0, cp.1) - egui::vec2(0.0, 16.0 * zoom);
                painter.line_segment([a, z], egui::Stroke::new(1.5, egui::Color32::from_gray(70)));
            }
        }
    }

    // ── branch nodes ──
    let hover = resp.hover_pos();
    let node_w = 120.0 * zoom.clamp(0.5, 1.5);
    let node_h = 34.0 * zoom.clamp(0.5, 1.5);
    let mut switch_to: Option<String> = None;
    for b in &branches {
        let tp = match pos.get(&b.path) {
            Some(v) => *v,
            None => continue,
        };
        let c = to_screen(tp.0, tp.1);
        if !rect.expand(80.0).contains(c) {
            continue;
        }
        let is_cur = b.path == cur;
        let nrect = egui::Rect::from_center_size(c, egui::vec2(node_w, node_h));
        let hovered = hover.map_or(false, |h| nrect.contains(h));
        let fill = if is_cur {
            egui::Color32::from_rgb(60, 52, 24)
        } else if hovered {
            egui::Color32::from_rgb(40, 46, 66)
        } else {
            egui::Color32::from_rgb(28, 32, 46)
        };
        painter.rect_filled(nrect, 6.0, fill);
        let border = if is_cur { egui::Color32::from_rgb(255, 214, 90) } else { egui::Color32::from_gray(80) };
        painter.rect_stroke(nrect, 6.0, egui::Stroke::new(if is_cur { 2.0 } else { 1.0 }, border));

        if zoom > 0.4 {
            let lcol = if is_cur { egui::Color32::from_rgb(255, 224, 150) } else { egui::Color32::from_gray(210) };
            painter.text(c - egui::vec2(0.0, 5.0), egui::Align2::CENTER_CENTER, &b.label, egui::FontId::proportional(12.0 * zoom.clamp(0.7, 1.3)), lcol);
            painter.text(c + egui::vec2(0.0, 9.0), egui::Align2::CENTER_CENTER, format!("#{}", b.path), egui::FontId::monospace(9.0 * zoom.clamp(0.7, 1.3)), egui::Color32::from_gray(130));
        }
        // "you are here" on the current branch: your position (tip, or where you've rewound to)
        if is_cur {
            let here = match at {
                Some(o) => format!("▸ you are here · rewound to ord {}", o as i64),
                None => format!("▸ you are here · tip · ord {}", now as i64),
            };
            painter.text(egui::pos2(c.x, nrect.top() - 6.0), egui::Align2::CENTER_BOTTOM, here, egui::FontId::proportional(11.0), egui::Color32::from_rgb(255, 214, 90));
        }
        if hovered && resp.clicked() && !is_cur {
            switch_to = Some(b.path.clone());
        }
    }

    // ── moment dots for the CURRENT branch: navigate its past moments (scrub the world) ──
    let mut scrub: Option<f64> = None;
    if zoom > 0.55 && !timeline.is_empty() {
        let cc = to_screen(cur_pos.0, cur_pos.1);
        let strip_y = cc.y + node_h * 0.5 + 22.0;
        let n = timeline.len();
        let span = (node_w * 2.4).min(rect.width() * 0.8);
        let x0 = cc.x - span * 0.5;
        for (i, (ord, phrase)) in timeline.iter().enumerate() {
            let x = if n > 1 { x0 + span * (i as f32 / (n - 1) as f32) } else { cc.x };
            let dp = egui::pos2(x, strip_y);
            // current position: the scrubbed ord (or now) sits on this dot
            let on = at.map_or(*ord >= now, |a| (a - *ord).abs() < 0.5);
            let col = if on { egui::Color32::from_rgb(255, 214, 90) } else { egui::Color32::from_gray(120) };
            let dot_hover = hover.map_or(false, |h| h.distance(dp) < 6.0);
            painter.circle_filled(dp, if dot_hover || on { 5.0 } else { 3.0 }, col);
            if dot_hover {
                painter.text(egui::pos2(x, strip_y + 12.0), egui::Align2::CENTER_TOP, phrase, egui::FontId::proportional(11.0), egui::Color32::from_gray(200));
                if resp.clicked() {
                    scrub = Some(*ord);
                }
            }
        }
        painter.line_segment([egui::pos2(x0, strip_y), egui::pos2(x0 + span, strip_y)], egui::Stroke::new(1.0, egui::Color32::from_gray(60)));
    }

    // ── apply the interactions (after the painter borrow) ──
    if let Some(path) = switch_to {
        p.switch_history(&path);
    } else if let Some(ord) = scrub {
        p.st.at_ord = if ord >= now { None } else { Some(ord) };
        let a = p.st.address.clone();
        p.navigate(&a, false);
    }
    if fork {
        let n = branches.len();
        p.create_branch(&format!("branch-{n}"));
    }
}

/// Assign each branch a tree position: `x` by leaf order (so subtrees don't overlap), `y` by depth.
/// Returns the node's own `x` (the centre of its subtree).
fn layout_tree(path: &str, depth: f32, children: &HashMap<String, Vec<String>>, xc: &mut f32, out: &mut HashMap<String, (f32, f32)>) -> f32 {
    match children.get(path) {
        Some(ch) if !ch.is_empty() => {
            let xs: Vec<f32> = ch.iter().map(|c| layout_tree(c, depth + 1.0, children, xc, out)).collect();
            let x = (xs.first().copied().unwrap_or(0.0) + xs.last().copied().unwrap_or(0.0)) * 0.5;
            out.insert(path.to_string(), (x, depth));
            x
        }
        _ => {
            let x = *xc;
            *xc += 1.0;
            out.insert(path.to_string(), (x, depth));
            x
        }
    }
}
