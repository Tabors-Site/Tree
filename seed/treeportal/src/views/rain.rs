// views/rain.rs — the RAIN viewer (philosophy/wordRain/rain.md + the Matrix image). One falling column
// of glyphs per being: the being's fact-chain as a SYMBOL chain (from the server's rain descriptor), each
// glyph a one-token Word. The head (newest fact) is brightest; the trail fades up. As a Name you see your
// beings; as I, story-wide. Click a column → the side panel (name + enter 2D/Story). Live pushes grow the
// head. Built with the egui painter; animates continuously.

use eframe::egui;
use treehash::Json;

use crate::wire::proto::get;
use crate::Portal;

const GLYPH_H: f32 = 20.0;

pub fn show(ui: &mut egui::Ui, p: &mut Portal) {
    let face = p.st.moment.as_ref().and_then(|m| get(&m.raw, "view").cloned());
    let beings: Vec<Json> = match face.as_ref().and_then(|f| get(f, "beings")) {
        Some(Json::Arr(a)) => a.clone(),
        _ => Vec::new(),
    };

    let size = ui.available_size();
    let (resp, painter) = ui.allocate_painter(size, egui::Sense::click());
    let rect = resp.rect;
    painter.rect_filled(rect, 0.0, egui::Color32::BLACK);

    if beings.is_empty() {
        painter.text(rect.center(), egui::Align2::CENTER_CENTER, "no beings raining yet", egui::FontId::monospace(13.0), egui::Color32::from_rgb(40, 120, 40));
        return;
    }

    let t = ui.input(|i| i.time) as f32;
    ui.ctx().request_repaint(); // animate

    let n = beings.len();
    let col_w = (rect.width() / n as f32).clamp(16.0, 60.0);
    let hover = resp.hover_pos();
    let mut clicked: Option<(String, String)> = None;

    for (i, being) in beings.iter().enumerate() {
        let chain: Vec<String> = match get(being, "chain") {
            Some(Json::Arr(a)) => a.iter().filter_map(|g| if let Json::Str(s) = g { Some(s.clone()) } else { None }).collect(),
            _ => Vec::new(),
        };
        if chain.is_empty() {
            continue;
        }
        let name = match get(being, "name") {
            Some(Json::Str(s)) => s.clone(),
            _ => String::new(),
        };
        let x = rect.left() + (i as f32 + 0.5) * col_w;

        // each column scrolls at its own speed; the leading drop wraps down the screen
        let speed = 34.0 + ((i * 37) % 40) as f32;
        let span = rect.height() + chain.len() as f32 * GLYPH_H;
        let lead = rect.top() + ((t * speed) % span);

        // draw the chain trailing UP from the leading drop; head (last fact) rides the lead, brightest
        for (j, glyph) in chain.iter().rev().enumerate() {
            let y = lead - j as f32 * GLYPH_H;
            if y < rect.top() - GLYPH_H || y > rect.bottom() {
                continue;
            }
            let fade = 1.0 - (j as f32 / chain.len().max(1) as f32);
            let g = (90.0 + 150.0 * fade) as u8;
            let col = if j == 0 { egui::Color32::from_rgb(200, 255, 200) } else { egui::Color32::from_rgb(0, g, 40) };
            painter.text(egui::pos2(x, y), egui::Align2::CENTER_CENTER, glyph, egui::FontId::monospace(15.0), col);
        }

        // the being's @name at the bottom of its column; hover/click column to open the side panel
        let col_rect = egui::Rect::from_min_max(egui::pos2(x - col_w / 2.0, rect.top()), egui::pos2(x + col_w / 2.0, rect.bottom()));
        let hot = hover.map_or(false, |hp| col_rect.contains(hp));
        painter.text(egui::pos2(x, rect.bottom() - 8.0), egui::Align2::CENTER_CENTER, format!("@{name}"), egui::FontId::monospace(10.0), if hot { egui::Color32::WHITE } else { egui::Color32::from_rgb(40, 140, 40) });
        if hot {
            painter.rect_stroke(col_rect, 0.0, egui::Stroke::new(1.0, egui::Color32::from_rgb(30, 90, 30)));
            if resp.clicked() {
                let id = match get(being, "beingId") {
                    Some(Json::Str(s)) => s.clone(),
                    _ => String::new(),
                };
                clicked = Some((id, name));
            }
        }
    }

    if let Some(sel) = clicked {
        p.st.side_being = Some(sel);
    }
}
