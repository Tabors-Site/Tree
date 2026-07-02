// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The DERIVED INDEX — the inverted lookup over the .proj snapshots, ported from fileStore.js
// indexDir/indexPath/loadIndex/saveIndex/updateIndexFromSlot + the find* reads. A facet file is a
// plain JSON map `index/<history>/<kind>.<facet>.json`; its values are either a single id string
// (name, heavenSpace — unique per scoped key) or an id-array (position, parent, type — many per key).
// It is REBUILDABLE (a pure function of the snapshots, which are a pure fold of the reels), never
// truth. Single-writer (the commit mutex) so no lock is taken. The on-disk shape is wire-compatible
// with the JS store: same path, same `JSON.stringify(map) + "\n"` line, same facet semantics.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use treehash::{parse, stringify, Json};

use crate::snapshot::load_snapshot;

// ── path-safety (fileStore.js pathSafe) ─────────────────────────────────────
/// Sanitize a segment so a hostile history/kind/facet can never escape the index root.
fn path_safe(s: &str) -> String {
    let mut out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() {
        out.push('_');
    }
    out
}

// ── the facet store (indexDir / indexPath / loadIndex / saveIndex) ──────────
/// `index/<history>/<kind>.<facet>.json` — the inverted-index file for one facet of one kind.
pub fn index_path(root: &Path, history: &str, kind: &str, facet: &str) -> PathBuf {
    root.join("index").join(path_safe(history)).join(format!(
        "{}.{}.json",
        path_safe(kind),
        path_safe(facet)
    ))
}

/// loadIndex: the facet map, or an empty object if missing or corrupt (rebuildable).
pub fn load_index(root: &Path, history: &str, kind: &str, facet: &str) -> Json {
    let p = index_path(root, history, kind, facet);
    match fs::read_to_string(&p) {
        Ok(text) => match parse(text.trim()) {
            Ok(v @ Json::Obj(_)) => v,
            _ => empty_obj(),
        },
        Err(_) => empty_obj(),
    }
}

/// saveIndex: a durable (fsync'd) write of the facet map, `stringify(map) + "\n"`.
pub fn save_index(root: &Path, history: &str, kind: &str, facet: &str, map: &Json) -> io::Result<()> {
    let p = index_path(root, history, kind, facet);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&p)?;
    f.write_all((stringify(map) + "\n").as_bytes())?;
    f.sync_all()?;
    Ok(())
}

// ── map helpers (mutating a Json::Obj in place, preserving insertion order) ──
fn empty_obj() -> Json {
    Json::Obj(Vec::new())
}

fn obj_get<'a>(m: &'a Json, key: &str) -> Option<&'a Json> {
    match m {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).map(|(_, v)| v),
        _ => None,
    }
}

/// `m[key] = value` — overwrite in place if present (keep position), else append (insertion order).
fn obj_set(m: &mut Json, key: &str, value: Json) {
    if let Json::Obj(e) = m {
        for (k, v) in e.iter_mut() {
            if k == key {
                *v = value;
                return;
            }
        }
        e.push((key.to_string(), value));
    }
}

/// `delete m[key]`.
fn obj_del(m: &mut Json, key: &str) {
    if let Json::Obj(e) = m {
        e.retain(|(k, _)| k != key);
    }
}

/// JS `state?.<field>` as a String, or None when absent/null/non-string.
fn state_str(state: &Json, field: &str) -> Option<String> {
    match obj_get(state, field) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

// ── scoping (nameKey / parentOf) ────────────────────────────────────────────
/// Scope the name key so per-kind name uniqueness matches the Mongo partial indexes: beings are
/// global per history; spaces are scoped by their parent space; matter is scoped by (spaceId,
/// parentMatterId) folder. NUL (byte 0x00) joins the scope segments. `state?.x ?? ""`.
fn name_key(kind: &str, state: &Json) -> String {
    let name = state_str(state, "name").unwrap_or_else(|| js_undefined_name(state));
    if kind == "space" {
        let parent = state_str(state, "parent").unwrap_or_default();
        return format!("{}\0{}", parent, name);
    }
    if kind == "matter" {
        let space_id = state_str(state, "spaceId").unwrap_or_default();
        let parent_matter = state_str(state, "parentMatterId").unwrap_or_default();
        return format!("{}\0{}\0{}", space_id, parent_matter, name);
    }
    name
}

/// JS `String(state?.name)` when name is absent/null: matches `"undefined"` / `"null"`. nameKey is
/// only called by updateIndexFromSlot under a `state.name != null` guard, so this is never the live
/// path; kept faithful so a probe with a missing name stringifies the JS way rather than panicking.
fn js_undefined_name(state: &Json) -> String {
    match obj_get(state, "name") {
        None => "undefined".to_string(),
        Some(Json::Null) => "null".to_string(),
        Some(Json::Str(s)) => s.clone(),
        Some(other) => stringify(other),
    }
}

/// The parent key per kind (being -> parentBeingId, space -> parent, matter -> parentMatterId).
fn parent_of(kind: &str, state: &Json) -> Option<String> {
    match kind {
        "being" => state_str(state, "parentBeingId"),
        "space" => state_str(state, "parent"),
        "matter" => state_str(state, "parentMatterId"),
        _ => None,
    }
}

// ── set facets (setRemove / setAdd over an id-array value) ───────────────────
fn set_remove(map: &mut Json, key: Option<&str>, id: &str) {
    let key = match key {
        Some(k) => k,
        None => return,
    };
    let arr = match obj_get(map, key) {
        Some(Json::Arr(a)) => a.clone(),
        _ => return,
    };
    let next: Vec<Json> = arr
        .into_iter()
        .filter(|x| !matches!(x, Json::Str(s) if s == id))
        .collect();
    if next.is_empty() {
        obj_del(map, key);
    } else {
        obj_set(map, key, Json::Arr(next));
    }
}

fn set_add(map: &mut Json, key: Option<&str>, id: &str) {
    let key = match key {
        Some(k) => k,
        None => return,
    };
    let mut arr = match obj_get(map, key) {
        Some(Json::Arr(a)) => a.clone(),
        _ => Vec::new(),
    };
    if !arr.iter().any(|x| matches!(x, Json::Str(s) if s == id)) {
        arr.push(Json::Str(id.to_string()));
    }
    obj_set(map, key, Json::Arr(arr));
}

// ── slot accessors ──────────────────────────────────────────────────────────
/// `slot.state || {}`.
fn slot_state(slot: Option<&Json>) -> Json {
    match slot.and_then(|s| obj_get(s, "state")) {
        Some(v @ Json::Obj(_)) => v.clone(),
        _ => empty_obj(),
    }
}

/// `slot.position ?? null` — the folded position string, or None.
fn slot_position(slot: Option<&Json>) -> Option<String> {
    match slot.and_then(|s| obj_get(s, "position")) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

/// `slot.tombstoned` truthiness — a non-null-non-false `tombstoned` field.
fn slot_tombstoned(slot: &Json) -> bool {
    matches!(obj_get(slot, "tombstoned"), Some(Json::Bool(true)))
}

/// `!slot || slot.tombstoned` — the JS deadness test (absent slot or tombstoned == dead).
fn is_dead(slot: Option<&Json>) -> bool {
    match slot {
        None => true,
        Some(s) => slot_tombstoned(s),
    }
}

// ── updateIndexFromSlot — the 5-facet diff (fileStore.js:948-997) ───────────
/// Diff old -> new slot and re-bucket `id` across every facet index. Called by save_snapshot so the
/// index tracks the .proj snapshots. A tombstoned (or absent) slot is REMOVED from every live index
/// (so tombstones never leak into a find); a live slot is (re-)added at its new keys.
pub fn update_index_from_slot(
    root: &Path,
    history: &str,
    kind: &str,
    id: &str,
    old_slot: Option<&Json>,
    new_slot: Option<&Json>,
) -> io::Result<()> {
    let old_state = slot_state(old_slot);
    let new_state = slot_state(new_slot);
    let old_dead = is_dead(old_slot);
    let new_dead = is_dead(new_slot);

    // name (unique per scoped key -> single id value)
    {
        let mut m = load_index(root, history, kind, "name");
        if !old_dead && state_str(&old_state, "name").is_some() {
            let k = name_key(kind, &old_state);
            if matches!(obj_get(&m, &k), Some(Json::Str(s)) if s == id) {
                obj_del(&mut m, &k);
            }
        }
        if !new_dead && state_str(&new_state, "name").is_some() {
            obj_set(&mut m, &name_key(kind, &new_state), Json::Str(id.to_string()));
        }
        save_index(root, history, kind, "name", &m)?;
    }
    // position (space/being/matter -> many occupants). slot.position is the spaceId.
    {
        let mut m = load_index(root, history, kind, "position");
        if !old_dead {
            set_remove(&mut m, slot_position(old_slot).as_deref(), id);
        }
        if !new_dead {
            if let Some(pos) = slot_position(new_slot) {
                set_add(&mut m, Some(&pos), id);
            }
        }
        save_index(root, history, kind, "position", &m)?;
    }
    // parent (parentBeingId / parent / parentMatterId -> many children)
    {
        let mut m = load_index(root, history, kind, "parent");
        if !old_dead {
            set_remove(&mut m, parent_of(kind, &old_state).as_deref(), id);
        }
        if !new_dead {
            set_add(&mut m, parent_of(kind, &new_state).as_deref(), id);
        }
        save_index(root, history, kind, "parent", &m)?;
    }
    // type (kind -> all live ids of this kind). Tombstoned ids drop out.
    {
        let mut m = load_index(root, history, kind, "type");
        if new_dead {
            set_remove(&mut m, Some(kind), id);
        } else {
            set_add(&mut m, Some(kind), id);
        }
        save_index(root, history, kind, "type", &m)?;
    }
    // heavenSpace (state.heavenSpace -> the one space id; singleton per kind/key)
    {
        let mut m = load_index(root, history, kind, "heavenSpace");
        if !old_dead {
            if let Some(hs) = state_str(&old_state, "heavenSpace") {
                if matches!(obj_get(&m, &hs), Some(Json::Str(s)) if s == id) {
                    obj_del(&mut m, &hs);
                }
            }
        }
        if !new_dead {
            if let Some(hs) = state_str(&new_state, "heavenSpace") {
                obj_set(&mut m, &hs, Json::Str(id.to_string()));
            }
        }
        save_index(root, history, kind, "heavenSpace", &m)?;
    }
    Ok(())
}

// ── find* reads (own-history; lineage inheritance is a follow-up, as in the JS) ──
/// `{ id, ...slot }` — the slot merged with its id, mirroring the JS spread. id is set first so a
/// slot carrying its own `id` would not shadow it (matching `{ id, ...slot }`'s right-wins spread).
fn merge_id(id: &str, slot: &Json) -> Json {
    let mut out: Vec<(String, Json)> = vec![("id".to_string(), Json::Str(id.to_string()))];
    if let Json::Obj(e) = slot {
        for (k, v) in e {
            if k == "id" {
                // right side of {id, ...slot} wins — overwrite the seeded id.
                if let Some(slot_pair) = out.iter_mut().find(|(kk, _)| kk == "id") {
                    slot_pair.1 = v.clone();
                }
            } else {
                out.push((k.clone(), v.clone()));
            }
        }
    }
    Json::Obj(out)
}

/// `{ kind, id, ...slot }` — used by findByPosition/findByParent which tag the kind.
fn merge_kind_id(kind: &str, id: &str, slot: &Json) -> Json {
    let mut out: Vec<(String, Json)> = vec![
        ("kind".to_string(), Json::Str(kind.to_string())),
        ("id".to_string(), Json::Str(id.to_string())),
    ];
    if let Json::Obj(e) = slot {
        for (k, v) in e {
            if k == "kind" || k == "id" {
                if let Some(p) = out.iter_mut().find(|(kk, _)| kk == k) {
                    p.1 = v.clone();
                }
            } else {
                out.push((k.clone(), v.clone()));
            }
        }
    }
    Json::Obj(out)
}

/// findByName(history, kind, name, scope) -> the live slot (with id), or None. Probes the scoped key,
/// then the bare name, then (for non-being kinds) the parent-agnostic NUL-trailing-segment scan.
/// `scope` carries the optional disambiguating fields (parent / spaceId / parentMatterId) for a
/// scoped kind; pass an empty object for a bare-name lookup.
pub fn find_by_name(
    root: &Path,
    history: &str,
    kind: &str,
    name: &str,
    scope: &Json,
) -> Option<Json> {
    let m = load_index(root, history, kind, "name");
    // Most callers pass a bare name; for scoped kinds we honor the optional scope to disambiguate.
    let probe = if kind == "being" {
        name.to_string()
    } else {
        let mut scoped = scope.clone();
        obj_set(&mut scoped, "name", Json::Str(name.to_string()));
        name_key(kind, &scoped)
    };
    let mut id: Option<String> = match obj_get(&m, &probe) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => match obj_get(&m, name) {
            Some(Json::Str(s)) => Some(s.clone()),
            _ => None,
        },
    };
    // Parent-agnostic fallback: the scoped key is "<parent...>\0<name>", so a bare-name caller (no
    // scope) misses it. Scan for the first key whose trailing NUL-segment is `name` (sibling-unique
    // means at most one per parent; a globally unique name resolves cleanly).
    if id.is_none() && kind != "being" {
        if let Json::Obj(e) = &m {
            for (k, v) in e {
                if k.rsplit('\0').next() == Some(name) {
                    if let Json::Str(s) = v {
                        id = Some(s.clone());
                        break;
                    }
                }
            }
        }
    }
    let id = id?;
    let slot = load_snapshot(root, history, kind, &id)?;
    if slot_tombstoned(&slot) {
        return None;
    }
    Some(merge_id(&id, &slot))
}

/// findByPosition(history, spaceId) -> the live occupants across kinds (being/space/matter).
pub fn find_by_position(root: &Path, history: &str, space_id: &str) -> Vec<Json> {
    let mut out = Vec::new();
    for kind in ["being", "space", "matter"] {
        let m = load_index(root, history, kind, "position");
        let ids = match obj_get(&m, space_id) {
            Some(Json::Arr(a)) => a.clone(),
            _ => continue,
        };
        for id_val in ids {
            let id = match id_val {
                Json::Str(s) => s,
                _ => continue,
            };
            if let Some(slot) = load_snapshot(root, history, kind, &id) {
                if !slot_tombstoned(&slot) {
                    out.push(merge_kind_id(kind, &id, &slot));
                }
            }
        }
    }
    out
}

/// findByParent(history, parentId, kind) -> the live children of parentId in this kind.
pub fn find_by_parent(root: &Path, history: &str, parent_id: &str, kind: &str) -> Vec<Json> {
    let m = load_index(root, history, kind, "parent");
    let ids = match obj_get(&m, parent_id) {
        Some(Json::Arr(a)) => a.clone(),
        _ => return Vec::new(),
    };
    let mut out = Vec::new();
    for id_val in ids {
        let id = match id_val {
            Json::Str(s) => s,
            _ => continue,
        };
        if let Some(slot) = load_snapshot(root, history, kind, &id) {
            if !slot_tombstoned(&slot) {
                out.push(merge_kind_id(kind, &id, &slot));
            }
        }
    }
    out
}

/// listByType(history, kind) -> the live ids of this kind (tombstoned excluded — they fell off the
/// type index at cease). Returns the id strings, mirroring the JS `Array.slice()`.
pub fn list_by_type(root: &Path, history: &str, kind: &str) -> Vec<String> {
    let m = load_index(root, history, kind, "type");
    match obj_get(&m, kind) {
        Some(Json::Arr(a)) => a
            .iter()
            .filter_map(|x| match x {
                Json::Str(s) => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// findByHeavenSpace(history, heavenSpaceKind) -> the singleton seed-space slot, or None. The marker
/// is the `state.heavenSpace` value (config/heaven/threads/...); always a `space` kind.
pub fn find_by_heaven_space(root: &Path, history: &str, heaven_space_kind: &str) -> Option<Json> {
    let m = load_index(root, history, "space", "heavenSpace");
    let id = match obj_get(&m, heaven_space_kind) {
        Some(Json::Str(s)) => s.clone(),
        _ => return None,
    };
    let slot = load_snapshot(root, history, "space", &id)?;
    if slot_tombstoned(&slot) {
        return None;
    }
    Some(merge_id(&id, &slot))
}
