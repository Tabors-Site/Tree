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
        Json::Str(s) => Some(Node { kind: default_kind.to_string(), id: s.clone(), label: short(s), coord: None }),
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
            Some(Node { kind, id, label, coord })
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
