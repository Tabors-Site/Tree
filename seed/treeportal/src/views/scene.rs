// views/scene.rs — the shared scene model both the 2D map and the 3D view render. A moment's face is
// reduced to a list of placed Nodes (beings / spaces / matter), each with an optional grid coord. Pure
// over the face shape, so it works for a space fold, the reel index, anything the moment gives.

use treehash::Json;

use crate::wire::proto::get;

pub struct Node {
    pub kind: String,
    pub id: String,
    pub label: String,
    pub coord: Option<(f64, f64)>,
    /// the being's freshest utterance/deed (folded from its chain) + the ord it landed at — rendered as
    /// a speech bubble, shown only while recent relative to the world's now. None for spaces/matter.
    pub said: Option<String>,
    pub said_ord: Option<f64>,
}

/// How many ords a said-bubble stays visible — the clock-free stand-in for "spoken within the last
/// minute": a being's bubble shows only while its utterance is within this window of the world's now.
pub const BUBBLE_WINDOW: f64 = 12.0;

impl Node {
    /// The utterance to float as a speech bubble, iff it's still fresh relative to the world's now.
    pub fn fresh_said(&self, now_ord: f64) -> Option<&str> {
        match (&self.said, self.said_ord) {
            (Some(s), Some(o)) if now_ord - o < BUBBLE_WINDOW => Some(s.as_str()),
            _ => None,
        }
    }
}

/// Collect the placeable entities from a face.
pub fn collect_nodes(face: &Json) -> Vec<Node> {
    let mut out = Vec::new();
    match face {
        Json::Arr(items) => {
            for it in items {
                if let Some(n) = node_from(it, "") {
                    out.push(n);
                }
            }
        }
        Json::Obj(fields) => {
            for (k, v) in fields {
                if let Json::Arr(items) = v {
                    let kind = infer_kind(k);
                    for it in items {
                        if let Some(n) = node_from(it, &kind) {
                            out.push(n);
                        }
                    }
                }
            }
        }
        _ => {}
    }
    out
}

fn infer_kind(key: &str) -> String {
    match key {
        "beings" | "occupants" => "being",
        "children" | "spaces" => "space",
        "matter" | "matters" => "matter",
        other => other,
    }
    .to_string()
}

fn node_from(it: &Json, default_kind: &str) -> Option<Node> {
    match it {
        Json::Str(s) => Some(Node { kind: default_kind.to_string(), id: s.clone(), label: short(s), coord: None, said: None, said_ord: None }),
        Json::Obj(_) => {
            let kind = sget(it, "kind").unwrap_or_else(|| default_kind.to_string());
            let id = sget(it, "id")
                .or_else(|| sget(it, "beingId"))
                .or_else(|| sget(it, "spaceId"))
                .or_else(|| sget(it, "matterId"))
                .unwrap_or_default();
            let label = sget(it, "being")
                .map(|b| format!("@{b}"))
                .or_else(|| sget(it, "name"))
                .or_else(|| sget(it, "label"))
                .unwrap_or_else(|| short(&id));
            let coord = get(it, "coord").and_then(coord_xy);
            let said = sget(it, "said").filter(|s| !s.is_empty());
            let said_ord = match get(it, "saidOrd") {
                Some(Json::Num(n)) => Some(*n),
                _ => None,
            };
            Some(Node { kind, id, label, coord, said, said_ord })
        }
        _ => None,
    }
}

fn sget(v: &Json, k: &str) -> Option<String> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

fn coord_xy(c: &Json) -> Option<(f64, f64)> {
    let x = match get(c, "x") {
        Some(Json::Num(n)) => *n,
        _ => return None,
    };
    let y = match get(c, "y") {
        Some(Json::Num(n)) => *n,
        _ => return None,
    };
    Some((x, y))
}

pub fn short(id: &str) -> String {
    if id.len() > 8 {
        format!("{}…", &id[..6])
    } else {
        id.to_string()
    }
}
