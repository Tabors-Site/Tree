// views/explorer.rs — the FILES view: the place rendered as a Windows-7-style file explorer (the user's
// favourite). SPACES are folders, MATTER are files, BEINGS are the new living thing. A breadcrumb address
// bar, a Favorites nav pane, an icon grid, and a status bar — the familiar Aero look, in egui's painter.
// It browses the same scene moment the 2D/3D views do; double-click a folder to walk in, click a being to
// address it. The projection as a desktop you already know.

use eframe::egui;
use egui::Color32;
use treehash::Json;

use super::scene::collect_nodes;
use crate::wire::proto::get;
use crate::Portal;

// ── the Windows 7 Aero palette ───────────────────────────────────────────────────────────────────────
const WHITE: Color32 = Color32::from_rgb(255, 255, 255);
const NAV_BG: Color32 = Color32::from_rgb(240, 244, 250);
const BAR_BG: Color32 = Color32::from_rgb(248, 250, 252);
const BORDER: Color32 = Color32::from_rgb(212, 222, 232);
const SEL_FILL: Color32 = Color32::from_rgb(205, 232, 255);
const SEL_BORDER: Color32 = Color32::from_rgb(120, 194, 245);
const HOV_FILL: Color32 = Color32::from_rgb(232, 244, 254);
const TEXT: Color32 = Color32::from_rgb(30, 34, 40);
const LINK: Color32 = Color32::from_rgb(23, 111, 194);

pub fn show(ui: &mut egui::Ui, p: &mut Portal) {
    let face = match p.st.moment.as_ref().and_then(|m| get(&m.raw, "view").cloned()) {
        Some(f) => f,
        None => {
            ui.add_space(20.0);
            ui.weak("opening…");
            return;
        }
    };

    // paint the whole view white (Win7 explorer canvas) + local light widget theme
    let full = ui.available_rect_before_wrap();
    ui.painter().rect_filled(full, 0.0, WHITE);
    let vis = ui.visuals_mut();
    vis.override_text_color = Some(TEXT);
    vis.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, BORDER);

    let nodes = collect_nodes(&face);
    let (mut spaces, mut beings, mut matters) = (Vec::new(), Vec::new(), Vec::new());
    for n in &nodes {
        match n.kind.as_str() {
            "space" => spaces.push(n),
            "being" => beings.push(n),
            _ => matters.push(n),
        }
    }

    // ── the breadcrumb address bar ──────────────────────────────────────────────────────────────────
    let bar = egui::Rect::from_min_size(full.min, egui::vec2(full.width(), 34.0));
    ui.painter().rect_filled(bar, 0.0, BAR_BG);
    ui.painter().line_segment([bar.left_bottom(), bar.right_bottom()], egui::Stroke::new(1.0, BORDER));
    let mut nav_to: Option<String> = None;
    ui.allocate_ui_with_layout(bar.size(), egui::Layout::left_to_right(egui::Align::Center), |ui| {
        ui.add_space(8.0);
        if ui.add(egui::Button::new(egui::RichText::new("⬆").size(15.0)).frame(false)).on_hover_text("up one level").clicked() {
            nav_to = Some(parent_address(&p.st.address));
        }
        ui.add_space(4.0);
        // 🖥 story  ▸ seg ▸ seg …
        let story = p.story.clone();
        if ui.add(egui::Button::new(egui::RichText::new(format!("🖥 {story}")).color(LINK)).frame(false)).clicked() {
            nav_to = Some("/".to_string());
        }
        let mut acc = String::new();
        for seg in path_segments(&face) {
            ui.label(egui::RichText::new("▸").weak());
            acc = format!("{acc}/{seg}");
            let addr = format!("{story}#{}{acc}", p.history);
            if ui.add(egui::Button::new(egui::RichText::new(&seg).color(LINK)).frame(false)).clicked() {
                nav_to = Some(addr);
            }
        }
    });

    // ── the body: Favorites nav pane | content grid ─────────────────────────────────────────────────
    let status_h = 26.0;
    let body = egui::Rect::from_min_max(egui::pos2(full.left(), bar.bottom()), egui::pos2(full.right(), full.bottom() - status_h));
    let nav_w = 168.0;
    let nav_rect = egui::Rect::from_min_size(body.min, egui::vec2(nav_w, body.height()));
    let content_rect = egui::Rect::from_min_max(egui::pos2(body.left() + nav_w, body.top()), body.max);
    ui.painter().rect_filled(nav_rect, 0.0, NAV_BG);
    ui.painter().line_segment([nav_rect.right_top(), nav_rect.right_bottom()], egui::Stroke::new(1.0, BORDER));

    // Favorites / places
    ui.allocate_ui_with_layout(nav_rect.size(), egui::Layout::top_down(egui::Align::Min), |ui| {
        // (the nav pane paints over the same rect)
        let _ = ui.allocate_at_least(egui::vec2(nav_w, 0.0), egui::Sense::hover());
        ui.add_space(10.0);
        ui.horizontal(|ui| {
            ui.add_space(12.0);
            ui.label(egui::RichText::new("Favorites").size(11.0).color(Color32::from_rgb(90, 110, 130)).strong());
        });
        for (icon, name, addr) in [("🗀", "Story root", "/"), ("👤", "Home", "~")] {
            ui.horizontal(|ui| {
                ui.add_space(16.0);
                if ui.add(egui::Button::new(egui::RichText::new(format!("{icon}  {name}")).color(TEXT)).frame(false)).clicked() {
                    nav_to = Some(addr.to_string());
                }
            });
        }
        ui.add_space(12.0);
        ui.horizontal(|ui| {
            ui.add_space(12.0);
            ui.label(egui::RichText::new("Branch").size(11.0).color(Color32::from_rgb(90, 110, 130)).strong());
        });
        ui.horizontal(|ui| {
            ui.add_space(16.0);
            ui.label(egui::RichText::new(format!("⑂ #{}", p.history)).color(Color32::from_rgb(70, 90, 110)));
        });
    });

    // the content grid (icons)
    let sel_id = egui::Id::new("explorer_sel");
    let mut selected: String = ui.data(|d| d.get_temp(sel_id).unwrap_or_default());
    let mut open_space: Option<String> = None;
    let mut pick_being: Option<(String, String)> = None;

    let mut child = ui.child_ui(content_rect, egui::Layout::top_down(egui::Align::Min), None);
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(&mut child, |ui| {
        ui.add_space(8.0);
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
            // folders first (spaces), then files (matter), then the beings (the new living things)
            for n in spaces.iter().chain(matters.iter()).chain(beings.iter()) {
                let cell = cell(ui, n, &selected);
                if cell.clicked() {
                    selected = n.id.clone();
                    if n.kind == "being" {
                        pick_being = Some((n.id.clone(), n.label.trim_start_matches('@').to_string()));
                    }
                }
                if cell.double_clicked() {
                    match n.kind.as_str() {
                        "space" => open_space = Some(n.label.clone()),
                        "being" => pick_being = Some((n.id.clone(), n.label.trim_start_matches('@').to_string())),
                        _ => {}
                    }
                }
            }
        });
        ui.add_space(10.0);
    });

    // ── status bar ──────────────────────────────────────────────────────────────────────────────────
    let status = egui::Rect::from_min_max(egui::pos2(full.left(), full.bottom() - status_h), full.max);
    ui.painter().rect_filled(status, 0.0, BAR_BG);
    ui.painter().line_segment([status.left_top(), status.right_top()], egui::Stroke::new(1.0, BORDER));
    let count = format!("{} folders · {} files · {} beings", spaces.len(), matters.len(), beings.len());
    ui.painter().text(status.left_center() + egui::vec2(12.0, 0.0), egui::Align2::LEFT_CENTER, count, egui::FontId::proportional(12.0), Color32::from_rgb(70, 80, 92));

    // ── apply interactions (after the borrows end) ──────────────────────────────────────────────────
    ui.data_mut(|d| d.insert_temp(sel_id, selected));
    if let Some(name) = open_space {
        let target = child_address(&p.st.address, &name);
        p.navigate(&target, true);
    } else if let Some((id, name)) = pick_being {
        p.select_being(&id, &name);
    } else if let Some(addr) = nav_to {
        p.navigate(&addr, true);
    }
}

/// One item cell: an icon + a (wrapped) label, with Win7 hover/selection highlight.
fn cell(ui: &mut egui::Ui, n: &super::scene::Node, selected: &str) -> egui::Response {
    let size = egui::vec2(92.0, 88.0);
    let (rect, resp) = ui.allocate_exact_size(size, egui::Sense::click());
    let is_sel = n.id == selected;
    if is_sel {
        ui.painter().rect(rect.shrink(2.0), 3.0, SEL_FILL, egui::Stroke::new(1.0, SEL_BORDER));
    } else if resp.hovered() {
        ui.painter().rect(rect.shrink(2.0), 3.0, HOV_FILL, egui::Stroke::new(1.0, SEL_BORDER.gamma_multiply(0.5)));
    }
    let icon_c = egui::pos2(rect.center().x, rect.top() + 28.0);
    match n.kind.as_str() {
        "space" => folder_icon(ui.painter(), icon_c),
        "being" => being_icon(ui.painter(), icon_c),
        _ => file_icon(ui.painter(), icon_c),
    }
    // label (up to two short lines)
    let label = clip_label(&n.label);
    ui.painter().text(egui::pos2(rect.center().x, rect.top() + 54.0), egui::Align2::CENTER_TOP, label, egui::FontId::proportional(11.5), TEXT);
    resp
}

fn folder_icon(painter: &egui::Painter, c: egui::Pos2) {
    let back = Color32::from_rgb(228, 178, 63);
    let front = Color32::from_rgb(251, 214, 116);
    let edge = Color32::from_rgb(196, 150, 46);
    // tab
    let tab = egui::Rect::from_min_size(egui::pos2(c.x - 20.0, c.y - 15.0), egui::vec2(20.0, 8.0));
    painter.rect(tab, 2.0, back, egui::Stroke::new(1.0, edge));
    // body
    let body = egui::Rect::from_min_size(egui::pos2(c.x - 22.0, c.y - 10.0), egui::vec2(44.0, 30.0));
    painter.rect(body, 2.5, back, egui::Stroke::new(1.0, edge));
    // front flap (lighter)
    let flap = egui::Rect::from_min_size(egui::pos2(c.x - 22.0, c.y - 3.0), egui::vec2(44.0, 23.0));
    painter.rect(flap, 2.5, front, egui::Stroke::new(1.0, edge));
}

fn file_icon(painter: &egui::Painter, c: egui::Pos2) {
    let page = Color32::from_rgb(252, 253, 255);
    let edge = Color32::from_rgb(176, 188, 200);
    let body = egui::Rect::from_min_size(egui::pos2(c.x - 15.0, c.y - 18.0), egui::vec2(30.0, 38.0));
    painter.rect(body, 1.5, page, egui::Stroke::new(1.0, edge));
    // folded corner
    let fold = vec![egui::pos2(c.x + 6.0, c.y - 18.0), egui::pos2(c.x + 15.0, c.y - 18.0), egui::pos2(c.x + 15.0, c.y - 9.0)];
    painter.add(egui::Shape::convex_polygon(fold, Color32::from_rgb(222, 230, 238), egui::Stroke::new(1.0, edge)));
    // text lines
    for i in 0..4 {
        let y = c.y - 6.0 + i as f32 * 6.0;
        painter.line_segment([egui::pos2(c.x - 9.0, y), egui::pos2(c.x + 9.0, y)], egui::Stroke::new(1.2, Color32::from_rgb(200, 210, 220)));
    }
}

/// A being — the "new" living thing: a friendly avatar (head + shoulders) with a soft alive-ring.
fn being_icon(painter: &egui::Painter, c: egui::Pos2) {
    let skin = Color32::from_rgb(91, 155, 213);
    painter.circle_filled(c, 21.0, Color32::from_rgb(224, 238, 250)); // alive disc
    painter.circle_stroke(c, 21.0, egui::Stroke::new(1.0, Color32::from_rgb(150, 195, 235)));
    // shoulders
    let sh = egui::Rect::from_min_size(egui::pos2(c.x - 13.0, c.y + 2.0), egui::vec2(26.0, 16.0));
    painter.rect(sh, 8.0, skin, egui::Stroke::NONE);
    // head
    painter.circle_filled(egui::pos2(c.x, c.y - 6.0), 8.5, skin);
}

fn clip_label(s: &str) -> String {
    let s = s.trim_start_matches('@');
    if s.chars().count() > 22 {
        format!("{}…", s.chars().take(21).collect::<String>())
    } else {
        s.to_string()
    }
}

/// The child-space address: append the folder name to the current path (dropping any @being).
fn child_address(current: &str, name: &str) -> String {
    let base = current.split('@').next().unwrap_or(current).trim_end_matches('/');
    format!("{base}/{name}")
}

/// The parent address: drop the last path segment (walk up one folder).
fn parent_address(current: &str) -> String {
    let base = current.split('@').next().unwrap_or(current);
    match base.rfind('/') {
        Some(i) if i + 1 < base.len() => base[..i + 1].to_string(),
        _ => "/".to_string(),
    }
}

/// The path segments (folder names) from the scene face's `address.pathByNames` ("/a/b" → ["a","b"]).
fn path_segments(face: &Json) -> Vec<String> {
    match get(face, "address").and_then(|a| get(a, "pathByNames")) {
        Some(Json::Str(p)) => p.split('/').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect(),
        _ => Vec::new(),
    }
}
