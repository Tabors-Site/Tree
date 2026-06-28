// treeproj v2: the DERIVED INDEX over the .proj snapshots. Rust stamps real reels (treestore, the
// same stamp path as treefold's write-half), refold reads + folds + caches the full slot
// ({state, foldedSeq, position, tombstoned}) AND re-buckets the inverted index. This proves, with NO
// Node in the loop:
//   - the .proj slot carries the right position / foldedSeq / tombstoned;
//   - the index facet files bucket ids correctly (name -> id, position/parent -> id-arrays, type -> ids);
//   - find_by_name / find_by_position / find_by_parent / list_by_type / find_by_heaven_space return
//     the right LIVE slots;
//   - after a cease fact lands qualities.dead, the refold yields tombstoned: true AND the aggregate
//     DROPS OUT of every find (name freed, off the type list, off position/parent).
// tombstoned strictly = state.qualities.dead present (the v2 cease-doctrine marker, not isGone).

use treeproj::{
    find_by_heaven_space, find_by_name, find_by_parent, find_by_position, index_path, list_by_type,
    load_index, load_snapshot, refold, Json,
};
use treestore::{read_reel_head, seal_moment, write_fact_doc, FactSpec};

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn sval(v: &Json, k: &str) -> String {
    match get(v, k) {
        Some(Json::Str(s)) => s.clone(),
        _ => String::new(),
    }
}
fn nval(v: &Json, k: &str) -> Option<f64> {
    match get(v, k) {
        Some(Json::Num(n)) => Some(*n),
        _ => None,
    }
}
fn bval(v: &Json, k: &str) -> bool {
    matches!(get(v, k), Some(Json::Bool(true)))
}
fn state_of(slot: &Json) -> &Json {
    get(slot, "state").expect("state in slot")
}

// The single-id value of a name/heavenSpace facet key, or None.
fn index_single(root: &std::path::Path, kind: &str, facet: &str, key: &str) -> Option<String> {
    let m = load_index(root, "0", kind, facet);
    match get(&m, key) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}
// The id-array of a position/parent/type facet key, as Strings.
fn index_set(root: &std::path::Path, kind: &str, facet: &str, key: &str) -> Vec<String> {
    let m = load_index(root, "0", kind, facet);
    match get(&m, key) {
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

// Seal ONE moment (one act = one fact = one reel) onto (history "0", kind, id), threading the reel
// head — exactly as the v1 cache test stamps. Then refold caches the slot + re-buckets the index.
fn stamp(dir: &std::path::Path, kind: &str, id: &str, spec: &Json, ord: f64) {
    let seal = seal_moment(
        &[FactSpec { history: "0", kind, id, spec }],
        Some(ord),
        |h, k, i| read_reel_head(dir, h, k, i),
    );
    for f in &seal.facts {
        write_fact_doc(dir, &f.history, &f.kind, &f.id, &f.doc).expect("write_fact_doc");
    }
}

// ── fact shapes ─────────────────────────────────────────────────────────────
// being birth: name + homeSpace (-> position) + parentBeingId (-> the parent facet).
fn birth_being(id: &str, name: &str, home_space: &str, parent_being: &str) -> Json {
    obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        (
            "params",
            obj(vec![
                ("name", jstr(name)),
                ("homeSpace", jstr(home_space)),
                ("parentBeingId", jstr(parent_being)),
            ]),
        ),
    ])
}
// being kill: be:kill folds qualities.dead = {byActor} (and position -> null).
fn kill_being(id: &str) -> Json {
    obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("kill")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        ("params", obj(vec![])),
    ])
}
// space create: name + parent (-> position) + heavenSpace marker.
fn create_space(id: &str, name: &str, parent: &str, heaven_space: Option<&str>) -> Json {
    let mut params = vec![
        ("name", jstr(name)),
        ("type", jstr("plot")),
        ("owner", jstr("be1")),
        ("parent", jstr(parent)),
    ];
    if let Some(hs) = heaven_space {
        params.push(("heavenSpace", jstr(hs)));
    }
    obj(vec![
        ("through", jstr("be1")),
        ("verb", jstr("do")),
        ("act", jstr("create-space")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr(id))])),
        ("params", obj(params)),
    ])
}
// space delete: do:delete folds parent/position -> "deleted" + qualities.dead.
fn delete_space(id: &str) -> Json {
    obj(vec![
        ("through", jstr("be1")),
        ("verb", jstr("do")),
        ("act", jstr("delete")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr(id))])),
        ("params", obj(vec![])),
    ])
}
// matter create: name + spaceId (-> position) + parentMatterId (-> the parent facet).
fn create_matter(id: &str, name: &str, space_id: &str, parent_matter: &str) -> Json {
    obj(vec![
        ("through", jstr("be1")),
        ("verb", jstr("do")),
        ("act", jstr("create-matter")),
        ("of", obj(vec![("kind", jstr("matter")), ("id", jstr(id))])),
        (
            "params",
            obj(vec![
                ("name", jstr(name)),
                ("content", jstr("hello")),
                ("type", jstr("text")),
                ("spaceId", jstr(space_id)),
                ("parentMatterId", jstr(parent_matter)),
            ]),
        ),
    ])
}
// matter delete: do:delete folds spaceId/beingId -> "deleted" + qualities.dead.
fn delete_matter(id: &str) -> Json {
    obj(vec![
        ("through", jstr("be1")),
        ("verb", jstr("do")),
        ("act", jstr("delete")),
        ("of", obj(vec![("kind", jstr("matter")), ("id", jstr(id))])),
        ("params", obj(vec![])),
    ])
}

#[test]
fn index_layer_buckets_live_aggregates_and_drops_tombstones() {
    let dir = std::env::temp_dir().join("treeproj-index-layer");
    let _ = std::fs::remove_dir_all(&dir);

    // ── stamp three aggregates at space "sp1" (one of each kind), then refold each ──
    // being be1: @Alice, position sp1, parent be0.
    stamp(&dir, "being", "be1", &birth_being("be1", "Alice", "sp1", "be0"), 1.0);
    // space sp9: @Garden, position sp1, heavenSpace marker "config".
    stamp(&dir, "space", "sp9", &create_space("sp9", "Garden", "sp1", Some("config")), 1.0);
    // matter mt9: @note, position sp1, parentMatter mt0.
    stamp(&dir, "matter", "mt9", &create_matter("mt9", "note", "sp1", "mt0"), 1.0);

    let be_slot = refold(&dir, "0", "being", "be1").expect("refold being");
    let sp_slot = refold(&dir, "0", "space", "sp9").expect("refold space");
    let mt_slot = refold(&dir, "0", "matter", "mt9").expect("refold matter");

    // ── (1) the .proj slot carries the right position / foldedSeq / tombstoned ──
    assert_eq!(sval(&be_slot, "position"), "sp1", "being slot.position = folded state.position");
    assert_eq!(nval(&be_slot, "foldedSeq"), Some(1.0), "being foldedSeq = the reel tip");
    assert!(!bval(&be_slot, "tombstoned"), "live being not tombstoned");
    assert_eq!(sval(&sp_slot, "position"), "sp1", "space slot.position = parent");
    assert_eq!(sval(&mt_slot, "position"), "sp1", "matter slot.position = spaceId");
    assert!(!bval(&mt_slot, "tombstoned"), "live matter not tombstoned");
    // the slot reloads from disk identically (the .proj cache, fsync'd).
    let be_disk = load_snapshot(&dir, "0", "being", "be1").expect("being .proj on disk");
    assert_eq!(sval(&be_disk, "position"), "sp1", "being slot persisted to .proj");
    assert_eq!(sval(state_of(&be_disk), "name"), "Alice", "the cache holds the folded state");

    // ── (2) the index facet files bucket the ids correctly ──
    // name -> id (being is a bare name; space/matter keys are NUL-scoped).
    assert_eq!(index_single(&dir, "being", "name", "Alice").as_deref(), Some("be1"), "being name -> id");
    assert_eq!(
        index_single(&dir, "space", "name", "sp1\0Garden").as_deref(),
        Some("sp9"),
        "space name key is <parent>\\0<name> -> id"
    );
    assert_eq!(
        index_single(&dir, "matter", "name", "sp1\0mt0\0note").as_deref(),
        Some("mt9"),
        "matter name key is <spaceId>\\0<parentMatterId>\\0<name> -> id"
    );
    // position/parent/type -> id-arrays.
    assert_eq!(index_set(&dir, "being", "position", "sp1"), vec!["be1"], "being at position sp1");
    assert_eq!(index_set(&dir, "space", "position", "sp1"), vec!["sp9"], "space at position sp1");
    assert_eq!(index_set(&dir, "matter", "position", "sp1"), vec!["mt9"], "matter at position sp1");
    assert_eq!(index_set(&dir, "being", "parent", "be0"), vec!["be1"], "being child of be0");
    assert_eq!(index_set(&dir, "matter", "parent", "mt0"), vec!["mt9"], "matter child of mt0");
    assert_eq!(index_set(&dir, "being", "type", "being"), vec!["be1"], "being on the type list");
    assert_eq!(index_set(&dir, "space", "type", "space"), vec!["sp9"], "space on the type list");
    assert_eq!(index_set(&dir, "matter", "type", "matter"), vec!["mt9"], "matter on the type list");
    // heavenSpace -> singleton (keyed by the state.heavenSpace VALUE).
    assert_eq!(
        index_single(&dir, "space", "heavenSpace", "config").as_deref(),
        Some("sp9"),
        "space heavenSpace marker 'config' -> sp9"
    );

    // ── (3) the find* reads return the right LIVE slots ──
    let by_name = find_by_name(&dir, "0", "being", "Alice", &obj(vec![])).expect("find Alice");
    assert_eq!(sval(&by_name, "id"), "be1", "find_by_name(being) merges id");
    assert_eq!(sval(state_of(&by_name), "name"), "Alice", "find_by_name returns the slot");
    // space/matter: the parent-agnostic bare-name fallback (the NUL-trailing-segment scan).
    let sp_by_name = find_by_name(&dir, "0", "space", "Garden", &obj(vec![])).expect("find Garden bare");
    assert_eq!(sval(&sp_by_name, "id"), "sp9", "find_by_name(space) bare-name fallback");
    let mt_by_name = find_by_name(&dir, "0", "matter", "note", &obj(vec![])).expect("find note bare");
    assert_eq!(sval(&mt_by_name, "id"), "mt9", "find_by_name(matter) bare-name fallback");
    // find_by_name with an explicit scope hits the scoped key directly.
    let sp_scoped = find_by_name(&dir, "0", "space", "Garden", &obj(vec![("parent", jstr("sp1"))]))
        .expect("find Garden scoped");
    assert_eq!(sval(&sp_scoped, "id"), "sp9", "find_by_name(space) scoped key");

    // find_by_position unions all three kinds at sp1.
    let here = find_by_position(&dir, "0", "sp1");
    let mut here_ids: Vec<String> = here.iter().map(|x| sval(x, "id")).collect();
    here_ids.sort();
    assert_eq!(here_ids, vec!["be1", "mt9", "sp9"], "find_by_position unions being/space/matter at sp1");
    assert!(here.iter().all(|x| !sval(x, "kind").is_empty()), "find_by_position tags kind");

    // find_by_parent (per kind).
    let be_children = find_by_parent(&dir, "0", "be0", "being");
    assert_eq!(be_children.iter().map(|x| sval(x, "id")).collect::<Vec<_>>(), vec!["be1"], "be0's children");
    let mt_children = find_by_parent(&dir, "0", "mt0", "matter");
    assert_eq!(mt_children.iter().map(|x| sval(x, "id")).collect::<Vec<_>>(), vec!["mt9"], "mt0's children");

    // list_by_type (per kind).
    assert_eq!(list_by_type(&dir, "0", "being"), vec!["be1"], "live beings");
    assert_eq!(list_by_type(&dir, "0", "space"), vec!["sp9"], "live spaces");
    assert_eq!(list_by_type(&dir, "0", "matter"), vec!["mt9"], "live matter");

    // find_by_heaven_space.
    let heaven = find_by_heaven_space(&dir, "0", "config").expect("find heaven space");
    assert_eq!(sval(&heaven, "id"), "sp9", "find_by_heaven_space('config') -> sp9");

    // ── (4) cease: a kill/delete fact lands qualities.dead -> tombstoned + DROP OUT of every find ──
    stamp(&dir, "being", "be1", &kill_being("be1"), 2.0);
    stamp(&dir, "space", "sp9", &delete_space("sp9"), 2.0);
    stamp(&dir, "matter", "mt9", &delete_matter("mt9"), 2.0);

    let be_dead = refold(&dir, "0", "being", "be1").expect("refold killed being");
    let sp_dead = refold(&dir, "0", "space", "sp9").expect("refold deleted space");
    let mt_dead = refold(&dir, "0", "matter", "mt9").expect("refold deleted matter");

    // tombstoned strictly = state.qualities.dead present (the v2 cease-doctrine marker).
    assert!(bval(&be_dead, "tombstoned"), "killed being tombstoned (qualities.dead, v2: kill tombstones)");
    assert!(bval(&sp_dead, "tombstoned"), "deleted space tombstoned (qualities.dead)");
    assert!(bval(&mt_dead, "tombstoned"), "deleted matter tombstoned (qualities.dead)");
    assert!(get(get(state_of(&be_dead), "qualities").unwrap(), "dead").is_some(), "be qualities.dead folded");

    // name FREED (off the name index for every kind).
    assert_eq!(index_single(&dir, "being", "name", "Alice"), None, "killed being frees its name");
    assert_eq!(index_single(&dir, "space", "name", "sp1\0Garden"), None, "deleted space frees its name");
    assert_eq!(index_single(&dir, "matter", "name", "sp1\0mt0\0note"), None, "deleted matter frees its name");
    // off the type list.
    assert!(list_by_type(&dir, "0", "being").is_empty(), "killed being off the type list");
    assert!(list_by_type(&dir, "0", "space").is_empty(), "deleted space off the type list");
    assert!(list_by_type(&dir, "0", "matter").is_empty(), "deleted matter off the type list");
    // off position (sp1 empties — the being's position folded to null anyway; space/matter were at sp1).
    assert!(index_set(&dir, "being", "position", "sp1").is_empty(), "killed being off position sp1");
    assert!(index_set(&dir, "space", "position", "sp1").is_empty(), "deleted space off position sp1");
    assert!(index_set(&dir, "matter", "position", "sp1").is_empty(), "deleted matter off position sp1");
    // off parent.
    assert!(index_set(&dir, "being", "parent", "be0").is_empty(), "killed being off parent be0");
    assert!(index_set(&dir, "matter", "parent", "mt0").is_empty(), "deleted matter off parent mt0");
    // off heavenSpace.
    assert_eq!(index_single(&dir, "space", "heavenSpace", "config"), None, "deleted space frees heavenSpace");

    // and every find now returns nothing for the dead aggregates.
    assert!(find_by_name(&dir, "0", "being", "Alice", &obj(vec![])).is_none(), "find_by_name skips the dead being");
    assert!(find_by_name(&dir, "0", "space", "Garden", &obj(vec![])).is_none(), "find_by_name skips the dead space");
    assert!(find_by_name(&dir, "0", "matter", "note", &obj(vec![])).is_none(), "find_by_name skips the dead matter");
    assert!(find_by_position(&dir, "0", "sp1").is_empty(), "find_by_position empty after cease");
    assert!(find_by_parent(&dir, "0", "be0", "being").is_empty(), "find_by_parent(being) empty after cease");
    assert!(find_by_parent(&dir, "0", "mt0", "matter").is_empty(), "find_by_parent(matter) empty after cease");
    assert!(find_by_heaven_space(&dir, "0", "config").is_none(), "find_by_heaven_space empty after cease");

    // the index files were actually written to the wire-compatible path.
    let name_path = index_path(&dir, "0", "being", "name");
    assert!(name_path.exists(), "index/<history>/<kind>.<facet>.json exists at {:?}", name_path);

    let _ = std::fs::remove_dir_all(&dir);
    println!(
        "  treeproj v2: stamp -> refold(full slot {{state,foldedSeq,position,tombstoned}}) -> derived index; \
         find_by_name/position/parent/type/heavenSpace return live slots; cease (qualities.dead) tombstones \
         + drops out of every find  OK (no Node)"
    );
}
