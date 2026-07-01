// views/fourd.rs — the 4D view: the story's histories drawn as a time-accurate GIT-GRAPH. The vertical
// axis is ord (genesis at top, now at the bottom); each branch is a lane, drawn as a segment from where
// it FORKED off its parent (forkOrd) down to its own TIP, with an elbow back to the parent lane at the
// fork. It centres on the branch you're on at your current position (your tip, or where you've rewound
// the history bar to), so you always start "where your being is". Scroll to zoom the ord axis (out =
// the whole tree, in = moments clear), drag to pan. Click a branch to SWITCH onto it; the moment dots on
// your current lane scrub the world to a past moment; "fork" makes a new branch here. forkOrd + tip come
// from the server's branches() reply. (Per-branch moment dots load for the branch you're ON; other
// branches show their span — fetch-on-focus for every branch's moments is the next refinement.)

use eframe::egui;
use std::collections::HashMap;

use crate::Portal;

const GOLD: egui::Color32 = egui::Color32::from_rgb(255, 214, 90);

pub fn show(ui: &mut egui::Ui, p: &mut Portal) {
    let branches = p.st.branches.clone();
    let cur = p.history.clone();
    let now = p.st.now_ord;
    let at = p.st.at_ord;
    let timeline = p.st.timeline.clone();
    let cur_ord = at.unwrap_or(now);

    // ── toolbar: real fork + honest-disabled ops the Rust server doesn't have yet ──
    let mut fork = false;
    ui.horizontal(|ui| {
        if ui.button("⑂ fork a new branch here").clicked() {
            fork = true;
        }
        ui.separator();
        ui.weak(format!("on #{cur} · {} histories · scroll = zoom time · drag = pan · click a branch to switch", branches.len().max(1)));
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

    // ── zoom (scroll/pinch) + pan (drag), persisted per-view ──
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
        zoom = zoom.clamp(0.2, 6.0);
    }
    if resp.dragged() {
        pan += resp.drag_delta();
    }
    ui.data_mut(|d| {
        d.insert_temp(zoom_id, zoom);
        d.insert_temp(pan_id, pan);
    });

    // ── lanes: main "0" at lane 0, every other branch its own lane in listing order ──
    let mut lane: HashMap<String, f32> = HashMap::new();
    lane.insert("0".to_string(), 0.0);
    let mut li = 1.0;
    for b in &branches {
        if b.path != "0" {
            lane.entry(b.path.clone()).or_insert_with(|| {
                let v = li;
                li += 1.0;
                v
            });
        }
    }
    let cur_lane = lane.get(&cur).copied().unwrap_or(0.0);

    // the ord axis: fit [0, max tip] to ~80% of the height at zoom 1, then zoom spreads it.
    let max_ord = branches.iter().filter_map(|b| b.tip).fold(now, f64::max).max(1.0);
    let ord_px = (rect.height() * 0.8) / max_ord as f32;
    let y = |ord: f64| rect.center().y + pan.y + (ord as f32 - cur_ord as f32) * ord_px * zoom;
    let x = |ln: f32| rect.center().x + pan.x + (ln - cur_lane) * 132.0 * zoom.clamp(0.4, 2.2);

    // a faint "you are now here" horizontal line across time
    let now_y = y(cur_ord);
    painter.line_segment([egui::pos2(rect.left(), now_y), egui::pos2(rect.right(), now_y)], egui::Stroke::new(1.0, egui::Color32::from_rgb(40, 38, 22)));

    let hover = resp.hover_pos();
    let mut switch_to: Option<String> = None;
    for b in &branches {
        let ln = match lane.get(&b.path) {
            Some(v) => *v,
            None => continue,
        };
        let fo = b.fork_ord.unwrap_or(0.0);
        let tp = b.tip.unwrap_or(if b.path == "0" { now } else { fo });
        let bx = x(ln);
        let (y0, y1) = (y(fo), y(tp).max(y(fo) + 2.0));
        let is_cur = b.path == cur;
        let col = if is_cur { GOLD } else { egui::Color32::from_rgb(120, 150, 220) };
        let w = if is_cur { 3.5 } else { 2.0 };

        // the fork elbow back to the parent lane, then the branch's own segment
        if let Some(par) = &b.parent {
            if let Some(pl) = lane.get(par) {
                painter.line_segment([egui::pos2(x(*pl), y0), egui::pos2(bx, y0)], egui::Stroke::new(1.5, egui::Color32::from_gray(95)));
            }
        }
        painter.line_segment([egui::pos2(bx, y0), egui::pos2(bx, y1)], egui::Stroke::new(w, col));
        painter.circle_filled(egui::pos2(bx, y0), w * 0.9, col); // fork point
        painter.circle_filled(egui::pos2(bx, y1), w * 1.1, col); // tip

        if zoom > 0.3 {
            let lcol = if is_cur { egui::Color32::from_rgb(255, 224, 150) } else { egui::Color32::from_gray(205) };
            painter.text(egui::pos2(bx + 9.0, y1), egui::Align2::LEFT_CENTER, format!("{}  #{}", b.label, b.path), egui::FontId::proportional(12.0 * zoom.clamp(0.7, 1.3)), lcol);
        }

        // click anywhere along the lane to switch onto that branch
        let near = hover.map_or(false, |h| (h.x - bx).abs() < 10.0 && h.y > y0 - 6.0 && h.y < y1 + 6.0);
        if near && resp.clicked() && !is_cur {
            switch_to = Some(b.path.clone());
        }
    }

    // ── you-are-here marker on the current lane at your position ──
    let (me_x, me_y) = (x(cur_lane), y(cur_ord));
    painter.circle_stroke(egui::pos2(me_x, me_y), 7.0, egui::Stroke::new(2.0, GOLD));
    let here = match at {
        Some(o) => format!("▸ you · rewound to ord {}", o as i64),
        None => format!("▸ you · tip · ord {}", now as i64),
    };
    painter.text(egui::pos2(me_x + 12.0, me_y - 12.0), egui::Align2::LEFT_CENTER, here, egui::FontId::proportional(11.0), GOLD);

    // ── moment dots along the CURRENT lane: click one to scrub the world to that moment ──
    let mut scrub: Option<f64> = None;
    if zoom > 0.45 && !timeline.is_empty() {
        for (ord, phrase) in &timeline {
            let dp = egui::pos2(me_x, y(*ord));
            let on = at.map_or(*ord >= now, |a| (a - *ord).abs() < 0.5);
            let col = if on { GOLD } else { egui::Color32::from_gray(150) };
            let dh = hover.map_or(false, |h| h.distance(dp) < 6.0);
            painter.circle_filled(dp, if dh || on { 5.0 } else { 3.0 }, col);
            if dh {
                painter.text(egui::pos2(me_x - 12.0, y(*ord)), egui::Align2::RIGHT_CENTER, phrase, egui::FontId::proportional(11.0), egui::Color32::from_gray(215));
                if resp.clicked() {
                    scrub = Some(*ord);
                }
            }
        }
    }

    // ── apply interactions after the painter borrow ──
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
