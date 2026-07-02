// views/story.rs — the STORY view. Story is the kernel's special render that gets the Words for a name:
// the portal takes a story moment and PAINTS the woven narrative the kernel returns (it does not render
// Words itself — that's the kernel's job). Until that render is wired the face has no narrative, so the
// view shows a clean placeholder. A date is clickable to rewind (perceive-at) once history lands.

use eframe::egui;
use treehash::Json;

use crate::wire::proto::get;
use crate::Portal;

pub fn show(ui: &mut egui::Ui, p: &mut Portal) {
    let face = p.st.moment.as_ref().and_then(|m| get(&m.raw, "view").cloned());
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        ui.add_space(8.0);
        match face.as_ref().and_then(narrative) {
            Some(lines) if !lines.is_empty() => {
                for (date, line) in lines {
                    ui.horizontal_wrapped(|ui| {
                        if !date.is_empty() {
                            ui.label(egui::RichText::new(format!("{date}  ")).monospace().small().color(egui::Color32::from_gray(120)));
                        }
                        ui.label(egui::RichText::new(line).size(15.0));
                    });
                    ui.add_space(6.0);
                }
            }
            _ => {
                ui.weak("no story yet for this name.");
                ui.add_space(4.0);
                ui.label(
                    egui::RichText::new(
                        "Story is the kernel's render of a name's Words — it appears here once the kernel's \
                         story render (and the Word runtime) lands.",
                    )
                    .small()
                    .color(egui::Color32::from_gray(120)),
                );
            }
        }
    });
}

/// Pull a narrative from a face: a `story`/`acts` array of `{date,line}`, or a `words` array of strings.
fn narrative(face: &Json) -> Option<Vec<(String, String)>> {
    for key in ["story", "acts", "narrative"] {
        if let Some(Json::Arr(items)) = get(face, key) {
            return Some(items.iter().map(row).collect());
        }
    }
    if let Some(Json::Arr(words)) = get(face, "words") {
        return Some(words.iter().filter_map(|w| str_of(w).map(|s| (String::new(), s))).collect());
    }
    None
}

fn row(it: &Json) -> (String, String) {
    let date = str_field(it, "date").or_else(|| str_field(it, "at")).unwrap_or_default();
    let line = str_field(it, "line").or_else(|| str_field(it, "text")).or_else(|| str_of(it)).unwrap_or_default();
    (date, line)
}

fn str_field(v: &Json, k: &str) -> Option<String> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}
fn str_of(v: &Json) -> Option<String> {
    match v {
        Json::Str(s) => Some(s.clone()),
        _ => None,
    }
}
