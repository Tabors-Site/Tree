// treehost: the host SEE-OP BRIDGE resolvers, driven end-to-end against a REAL on-disk store. Each
// test PLANTS rows the same way treeproj/treefold's write-half tests do — stamp a reel (treestore
// seal_moment + write_fact_doc), then REFOLD it into a .proj snapshot (treeproj refold, which also
// builds the inverted index the name-uniqueness walk reads) — so the toolkit's find/fold/cas reads
// see the genuine store. No mocks. Then it drives each resolver and asserts:
//   - the happy-path spec is correct (byte-compatible with the JS host's factParams / enriched spec);
//   - the gate FIRES: name-collision -> err, coord-out-of-bounds -> err, CAS-missing -> err,
//     already-deleted -> err, unknown-type -> err, unknown-field -> err.

use std::path::Path;

use treecas::{put_content, Meta};
use treehash::{canonicalize, Json};
use treehost::toolkit::{get, get_str};
use treehost::{
    may_set_model, parse_signal_value, resolve_config_delete, resolve_config_set,
    resolve_containing_space, resolve_create_matter, resolve_create_space, resolve_end_matter,
    resolve_end_space_spec, resolve_grant, resolve_inheritation, resolve_kill, resolve_model_block,
    resolve_move, resolve_owner, resolve_purge, resolve_rename_matter, resolve_set_being_flow_spec,
    resolve_set_being_spec, resolve_set_matter_spec, resolve_set_space_spec, resolve_switch,
    resolve_truename, signal_fact, signal_field, story_root, validate_render_block, AuthCtx,
    HostResolver, Reason, Resolvers,
};
use treeproj::refold;
use treestore::{read_reel_head, seal_moment, write_fact_doc, FactSpec};

// ── plumbing (the proven plant pattern) ─────────────────────────────────────────────────────────────
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn jnum(n: f64) -> Json {
    Json::Num(n)
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// Stamp one fact (act WRAPS fact via seal_moment) onto a reel + write it. ord is the moment ordinal.
fn stamp(dir: &Path, kind: &str, id: &str, spec: &Json, ord: f64) {
    let seal = seal_moment(
        &[FactSpec { history: "0", kind, id, spec }],
        Some(ord),
        |h, k, i| read_reel_head(dir, h, k, i),
    );
    for f in &seal.facts {
        write_fact_doc(dir, &f.history, &f.kind, &f.id, &f.doc).expect("write_fact_doc");
    }
}

/// Plant a being: birth (name, homeSpace, optional position) -> stamp + refold (builds the index).
fn plant_being(dir: &Path, id: &str, name: &str, home_space: &str, position: Option<&str>) {
    let mut params = vec![("name", jstr(name)), ("homeSpace", jstr(home_space))];
    if let Some(p) = position {
        params.push(("position", jstr(p)));
    }
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        ("params", obj(params)),
    ]);
    stamp(dir, "being", id, &birth, 1.0);
    refold(dir, "0", "being", id).expect("refold being");
}

/// Plant a space: create-space (name, parent, optional size, optional heavenSpace) -> stamp + refold.
fn plant_space(
    dir: &Path,
    id: &str,
    name: &str,
    parent: &str,
    size: Option<Json>,
    heaven: Option<&str>,
    ord: f64,
) {
    let mut params = vec![("name", jstr(name)), ("parent", jstr(parent))];
    if let Some(s) = size {
        params.push(("size", s));
    }
    if let Some(h) = heaven {
        params.push(("heavenSpace", jstr(h)));
    }
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("do")),
        ("act", jstr("create-space")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr(id))])),
        ("params", obj(params)),
    ]);
    stamp(dir, "space", id, &birth, ord);
    refold(dir, "0", "space", id).expect("refold space");
}

/// Plant a matter: create-matter (name, spaceId, optional content) -> stamp + refold.
fn plant_matter(dir: &Path, id: &str, name: &str, space_id: &str, content: Option<Json>, ord: f64) {
    let mut params = vec![("name", jstr(name)), ("spaceId", jstr(space_id))];
    if let Some(c) = content {
        params.push(("content", c));
    }
    let birth = obj(vec![
        ("through", jstr("be-creator")),
        ("verb", jstr("do")),
        ("act", jstr("create-matter")),
        ("of", obj(vec![("kind", jstr("matter")), ("id", jstr(id))])),
        ("params", obj(params)),
    ]);
    stamp(dir, "matter", id, &birth, ord);
    refold(dir, "0", "matter", id).expect("refold matter");
}

/// Soft-delete a space (do:delete -> the reducer folds parent->DELETED) + refold.
fn delete_space(dir: &Path, id: &str, deleter: &str, ord: f64) {
    let del = obj(vec![
        ("through", jstr(deleter)),
        ("verb", jstr("do")),
        ("act", jstr("delete")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr(id))])),
        ("params", obj(vec![])),
    ]);
    stamp(dir, "space", id, &del, ord);
    refold(dir, "0", "space", id).expect("refold deleted space");
}

fn fresh(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("treehost-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// args helper: an arg vec.
fn args(v: Vec<Json>) -> Vec<Json> {
    v
}
/// `{kind:"being"|"space"|"matter", id}` target.
fn target(kind: &str, id: &str) -> Json {
    obj(vec![("kind", jstr(kind)), ("id", jstr(id))])
}
/// The factParams sub-object of a returned block.
fn fp<'a>(block: &'a Json) -> &'a Json {
    get(block, "factParams").expect("factParams in block")
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// set-being
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn set_being_name_happy_and_collision() {
    let dir = fresh("set-being-name");
    // a space (for the coord test later) + two beings.
    plant_space(&dir, "sp1", "room", "space-root", Some(obj(vec![("x", jnum(10.0)), ("y", jnum(10.0))])), None, 1.0);
    plant_being(&dir, "be1", "Alice", "sp1", None);
    plant_being(&dir, "be2", "Bob", "sp1", None);

    // happy path: rename be1 to a free name.
    let block = resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![target("being", "be1"), jstr("name"), jstr("Alicia"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .expect("set-being name happy");
    assert_eq!(get_str(&block, "beingId"), Some("be1"));
    // factParams is EXACTLY { field, value } (merge absent — byte-identity with the JS host).
    let want = obj(vec![("field", jstr("name")), ("value", jstr("Alicia"))]);
    assert_eq!(canonicalize(fp(&block)), canonicalize(&want), "set-being name factParams byte-shape");

    // collision: rename be1 to be2's name -> NameTaken.
    let err = resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![target("being", "be1"), jstr("name"), jstr("Bob"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!(err.reason == Reason::NameCollision, "name collision -> NameTaken, got {err:?}");

    // renaming be1 to ITS OWN name is NOT a collision (exclude-self).
    resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![target("being", "be1"), jstr("name"), jstr("Alice"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .expect("renaming to own name is free");
}

#[test]
fn set_being_field_required_and_unknown() {
    let dir = fresh("set-being-field");
    plant_being(&dir, "be1", "Alice", "sp1", None);

    // no field -> the type-half guard fires (the .word's `If no field` gate is the first half).
    let err = resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![target("being", "be1"), Json::Null, jstr("x"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("`field` is required")));

    // unknown field -> Invalid with the supported-list message.
    let err = resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![target("being", "be1"), jstr("bogus"), jstr("x"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("unknown field")));
}

#[test]
fn set_being_coord_bounds() {
    let dir = fresh("set-being-coord");
    // a 10x10 space; the being is positioned in it.
    plant_space(&dir, "sp1", "room", "space-root", Some(obj(vec![("x", jnum(10.0)), ("y", jnum(10.0))])), None, 1.0);
    plant_being(&dir, "be1", "Alice", "sp1", Some("sp1"));

    // in bounds: (9,9) is the max cell of a size-10 axis.
    let block = resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![
            target("being", "be1"),
            jstr("coord"),
            obj(vec![("x", jnum(9.0)), ("y", jnum(9.0))]),
            Json::Null,
            Json::Null,
        ]),
        &AuthCtx::caller("be1"),
    )
    .expect("coord in bounds");
    // the fact records the ORIGINAL coord value (the gate ran but did not rewrite it).
    let coord_val = get(fp(&block), "value").expect("coord value");
    assert_eq!(canonicalize(coord_val), canonicalize(&obj(vec![("x", jnum(9.0)), ("y", jnum(9.0))])));

    // out of bounds: cell 10 does not exist in a size-10 axis.
    let err = resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![
            target("being", "be1"),
            jstr("coord"),
            obj(vec![("x", jnum(10.0)), ("y", jnum(0.0))]),
            Json::Null,
            Json::Null,
        ]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::CoordOutOfBounds && err.message.contains("coord.x=")), "x=10 OOB, got {err:?}");
}

#[test]
fn set_being_position_carries_from_position() {
    let dir = fresh("set-being-position");
    plant_space(&dir, "sp1", "room1", "space-root", None, None, 1.0);
    plant_space(&dir, "sp2", "room2", "space-root", None, None, 2.0);
    plant_being(&dir, "be1", "Alice", "sp1", Some("sp1")); // currently in sp1

    // move to sp2 -> fromPosition: sp1 rides the fact (the being actually moved).
    let block = resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![target("being", "be1"), jstr("position"), jstr("sp2"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .expect("position move");
    assert_eq!(get_str(fp(&block), "fromPosition"), Some("sp1"), "fromPosition rides the move");
    assert_eq!(get_str(fp(&block), "value"), Some("sp2"));
}

#[test]
fn set_being_merge_only_when_passed() {
    let dir = fresh("set-being-merge");
    plant_being(&dir, "be1", "Alice", "sp1", None);

    // merge passed (true) -> it rides the factParams.
    let block = resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![
            target("being", "be1"),
            jstr("qualities.profile"),
            obj(vec![("bio", jstr("hi"))]),
            Json::Bool(true),
            Json::Null,
        ]),
        &AuthCtx::caller("be1"),
    )
    .expect("qualities write with merge");
    assert!(matches!(get(fp(&block), "merge"), Some(Json::Bool(true))), "merge rides when passed");

    // merge absent -> it stays ABSENT (byte-identity: the reducers default merge !== false).
    let block2 = resolve_set_being_spec(
        &dir,
        "0",
        &args(vec![
            target("being", "be1"),
            jstr("qualities.profile"),
            obj(vec![("bio", jstr("hi"))]),
            Json::Null,
            Json::Null,
        ]),
        &AuthCtx::caller("be1"),
    )
    .expect("qualities write no merge");
    assert!(get(fp(&block2), "merge").is_none(), "merge absent when not passed");
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// set-space
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn set_space_name_collision_and_heaven_immutability() {
    let dir = fresh("set-space-name");
    // two sibling spaces under space-root + a heaven space.
    plant_space(&dir, "sp1", "alpha", "space-root", None, None, 1.0);
    plant_space(&dir, "sp2", "beta", "space-root", None, None, 2.0);
    plant_space(&dir, "sph", "config", "space-root", None, Some("config"), 3.0);

    // happy: rename sp1 to a free sibling name.
    let block = resolve_set_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "sp1"), jstr("name"), jstr("gamma"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .expect("set-space name happy");
    assert_eq!(get_str(&block, "spaceId"), Some("sp1"));

    // collision: rename sp1 to sp2's name (same parent) -> NameTaken.
    let err = resolve_set_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "sp1"), jstr("name"), jstr("beta"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!(err.reason == Reason::NameCollision, "sibling collision -> NameTaken, got {err:?}");

    // heaven-space immutability: renaming a heaven space refuses.
    let err = resolve_set_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "sph"), jstr("name"), jstr("whatever"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("heaven")), "heaven rename refused, got {err:?}");
}

#[test]
fn set_space_size_cap_and_coord_parent_bounds() {
    let dir = fresh("set-space-size");
    // parent with a 20x20 size; a child inside it.
    plant_space(&dir, "par", "parent", "space-root", Some(obj(vec![("x", jnum(20.0)), ("y", jnum(20.0))])), None, 1.0);
    plant_space(&dir, "kid", "child", "par", None, None, 2.0);

    // size: a valid cap.
    resolve_set_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "kid"), jstr("size"), obj(vec![("x", jnum(5.0)), ("y", jnum(5.0))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .expect("size valid");

    // size: above the max cap -> Invalid.
    let err = resolve_set_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "kid"), jstr("size"), obj(vec![("x", jnum(99999.0))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("max space size")), "oversize -> Invalid, got {err:?}");

    // coord: in bounds against the PARENT (20x20) -> (19,19) ok.
    resolve_set_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "kid"), jstr("coord"), obj(vec![("x", jnum(19.0)), ("y", jnum(19.0))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .expect("coord in parent bounds");

    // coord: out of bounds against the parent -> CoordOutOfBounds.
    let err = resolve_set_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "kid"), jstr("coord"), obj(vec![("x", jnum(20.0))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!(err.reason == Reason::CoordOutOfBounds, "coord OOB vs parent, got {err:?}");
}

#[test]
fn set_space_field_required_and_unknown_type() {
    let dir = fresh("set-space-field");
    plant_space(&dir, "sp1", "alpha", "space-root", None, None, 1.0);

    // no field.
    let err = resolve_set_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "sp1"), Json::Null, jstr("x"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("`field` is required")));

    // bad type.
    let err = resolve_set_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "sp1"), jstr("type"), jstr("nonsense-type"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("unknown space type")));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// create-space (resolve-birth-space)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn create_space_happy_and_sibling_collision_and_no_caller() {
    let dir = fresh("create-space");
    plant_space(&dir, "par", "parent", "space-root", None, None, 1.0);
    plant_space(&dir, "sib", "taken", "par", None, None, 2.0); // an existing sibling name

    // happy: a fresh child of par with a free name -> { enrichedSpec, spaceId }.
    let block = resolve_create_space(
        &dir,
        "0",
        &args(vec![target("space", "par"), jstr("space"), obj(vec![("name", jstr("fresh"))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be-creator"),
    )
    .expect("create-space happy");
    let space_id = get_str(&block, "spaceId").expect("spaceId minted").to_string();
    assert!(space_id.starts_with("sp-"), "minted a positional id, got {space_id}");
    let spec = get(&block, "enrichedSpec").expect("enrichedSpec");
    assert_eq!(get_str(spec, "parent"), Some("par"), "parent resolved");
    assert_eq!(get_str(spec, "beingId"), Some("be-creator"), "creator stamped");
    assert_eq!(get_str(spec, "name"), Some("fresh"));

    // sibling collision: the name "taken" already exists under par.
    let err = resolve_create_space(
        &dir,
        "0",
        &args(vec![target("space", "par"), jstr("space"), obj(vec![("name", jstr("taken"))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be-creator"),
    )
    .unwrap_err();
    assert!(err.reason == Reason::NameCollision, "sibling collision -> NameTaken, got {err:?}");

    // no caller -> Unauthorized (the .word's `If no caller` gate, enforced here too).
    let err = resolve_create_space(
        &dir,
        "0",
        &args(vec![target("space", "par"), jstr("space"), obj(vec![("name", jstr("x"))]), Json::Null, Json::Null]),
        &AuthCtx::default(), // no actor_being_id
    )
    .unwrap_err();
    assert!(err.reason == Reason::Unauthorized, "no caller -> Unauthorized, got {err:?}");
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// end-space (resolve-end-space-spec)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn end_space_happy_and_already_deleted_and_unauthorized() {
    let dir = fresh("end-space");
    plant_space(&dir, "sp1", "doomed", "space-root", None, None, 1.0);

    // happy: ending a live space -> { spaceId } (no factParams; the reducer derives the fold).
    let block = resolve_end_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "sp1"), Json::Null]),
        &AuthCtx::caller("owner-be"),
    )
    .expect("end-space happy");
    assert_eq!(get_str(&block, "spaceId"), Some("sp1"));
    assert!(get(&block, "factParams").is_none(), "end-space carries NO factParams");

    // now actually soft-delete it on the chain, then re-end -> AlreadyDeleted.
    delete_space(&dir, "sp1", "owner-be", 2.0);
    let err = resolve_end_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "sp1"), Json::Null]),
        &AuthCtx::caller("owner-be"),
    )
    .unwrap_err();
    assert!(err.reason == Reason::AlreadyDeleted, "already deleted -> refusal, got {err:?}");

    // unauthorized (the caller's owner/not-root verdict is false, and the actor is not I) -> Unauthorized.
    plant_space(&dir, "sp2", "guarded", "space-root", None, None, 3.0);
    let err = resolve_end_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "sp2"), Json::Null]),
        &AuthCtx { actor_being_id: Some("intruder".into()), authorized: false, is_i: false },
    )
    .unwrap_err();
    assert!(err.reason == Reason::Unauthorized, "unauthorized end -> refusal, got {err:?}");

    // I bypasses the authority gate (genesis / boot mirror): an unauthorized=false but is_i ctx passes.
    plant_space(&dir, "sp3", "iowned", "space-root", None, None, 4.0);
    resolve_end_space_spec(
        &dir,
        "0",
        &args(vec![target("space", "sp3"), Json::Null]),
        &AuthCtx { actor_being_id: Some("I".into()), authorized: false, is_i: true },
    )
    .expect("I bypasses the end-space authority gate");
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// set-matter
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn set_matter_content_cas_existence() {
    let dir = fresh("set-matter-content");
    plant_space(&dir, "sp1", "room", "space-root", None, None, 1.0);
    plant_matter(&dir, "mt1", "note", "sp1", None, 2.0);

    // put real bytes into the CAS -> a valid ref.
    let bytes_ref = put_content(&dir, b"hello world", &Meta::for_bytes(None, None, Some("utf8".into()))).expect("put_content");
    let ref_json = obj(vec![
        ("kind", jstr("cas")),
        ("hash", jstr(&bytes_ref.hash)),
        ("size", jnum(bytes_ref.size as f64)),
        ("encoding", jstr("utf8")),
    ]);

    // happy: the bytes exist -> the spec carries the ref verbatim.
    let block = resolve_set_matter_spec(
        &dir,
        "0",
        &args(vec![target("matter", "mt1"), jstr("content"), ref_json.clone(), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .expect("set-matter content happy");
    assert_eq!(canonicalize(get(fp(&block), "value").unwrap()), canonicalize(&ref_json));

    // CAS-missing: a well-formed ref to bytes that are NOT in the store -> UnknownContent.
    let absent_hash = "a".repeat(64);
    let absent_ref = obj(vec![("kind", jstr("cas")), ("hash", jstr(&absent_hash))]);
    let err = resolve_set_matter_spec(
        &dir,
        "0",
        &args(vec![target("matter", "mt1"), jstr("content"), absent_ref, Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!(err.reason == Reason::UnknownContent, "CAS-missing -> UnknownContent, got {err:?}");

    // not a cas ref at all -> Invalid.
    let err = resolve_set_matter_spec(
        &dir,
        "0",
        &args(vec![target("matter", "mt1"), jstr("content"), jstr("just a string"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("CAS ref")));
}

#[test]
fn set_matter_coord_bounds_and_deleted_sentinels() {
    let dir = fresh("set-matter-coord");
    plant_space(&dir, "sp1", "room", "space-root", Some(obj(vec![("x", jnum(8.0)), ("y", jnum(8.0))])), None, 1.0);
    plant_matter(&dir, "mt1", "note", "sp1", None, 2.0);

    // coord in bounds.
    resolve_set_matter_spec(
        &dir,
        "0",
        &args(vec![target("matter", "mt1"), jstr("coord"), obj(vec![("x", jnum(7.0)), ("y", jnum(7.0))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .expect("matter coord in bounds");

    // coord out of bounds.
    let err = resolve_set_matter_spec(
        &dir,
        "0",
        &args(vec![target("matter", "mt1"), jstr("coord"), obj(vec![("x", jnum(8.0))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!(err.reason == Reason::CoordOutOfBounds, "matter coord OOB, got {err:?}");

    // present-but-garbage axis -> refused (the clamp-lie guard).
    let err = resolve_set_matter_spec(
        &dir,
        "0",
        &args(vec![target("matter", "mt1"), jstr("coord"), obj(vec![("x", jstr("nope"))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("finite number")));

    // spaceId = the DELETED sentinel is accepted (a soft-delete marker).
    resolve_set_matter_spec(
        &dir,
        "0",
        &args(vec![target("matter", "mt1"), jstr("spaceId"), jstr("deleted"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .expect("spaceId DELETED sentinel accepted");

    // beingId only accepts the DELETED sentinel (the creator is fixed at birth).
    let err = resolve_set_matter_spec(
        &dir,
        "0",
        &args(vec![target("matter", "mt1"), jstr("beingId"), jstr("some-other-being"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("DELETED sentinel")));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// create-matter (resolve-birth-spec)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn create_matter_happy_type_gate_and_content_id() {
    let dir = fresh("create-matter");
    plant_space(&dir, "sp1", "room", "space-root", None, None, 1.0);

    // happy: a generic note (text content) -> { enrichedSpec, matterId, spaceId, parentMatterId }.
    let block = resolve_create_matter(
        &dir,
        "0",
        &args(vec![
            target("space", "sp1"),
            jstr("space"),
            obj(vec![("name", jstr("hello")), ("type", jstr("generic")), ("content", jstr("hi there"))]),
            Json::Null,
            Json::Null,
        ]),
        &AuthCtx::caller("be-creator"),
    )
    .expect("create-matter happy");
    let matter_id = get_str(&block, "matterId").expect("matterId").to_string();
    assert_eq!(matter_id.len(), 64, "content-addressed id is a 64-hex sha256");
    assert_eq!(get_str(&block, "spaceId"), Some("sp1"));
    let spec = get(&block, "enrichedSpec").expect("enrichedSpec");
    assert_eq!(get_str(spec, "type"), Some("generic"));
    assert_eq!(get_str(spec, "beingId"), Some("be-creator"));
    assert_eq!(get_str(spec, "name"), Some("hello"));

    // the matterId IS the content hash of the enriched spec (verify the bridge mint matches the toolkit).
    let recomputed = treehost::toolkit::matter_content_id(spec);
    assert_eq!(matter_id, recomputed, "matterId == matterContentId(enrichedSpec)");

    // type gate: an http type cannot carry TEXT content -> Invalid (typeAllowsContentKind false).
    let err = resolve_create_matter(
        &dir,
        "0",
        &args(vec![
            target("space", "sp1"),
            jstr("space"),
            obj(vec![("name", jstr("page")), ("type", jstr("http")), ("content", jstr("inline text"))]),
            Json::Null,
            Json::Null,
        ]),
        &AuthCtx::caller("be-creator"),
    )
    .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("does not carry text")), "http+text -> Invalid, got {err:?}");

    // unknown type -> UnknownType.
    let err = resolve_create_matter(
        &dir,
        "0",
        &args(vec![
            target("space", "sp1"),
            jstr("space"),
            obj(vec![("name", jstr("x")), ("type", jstr("ext:nope")), ("content", Json::Null)]),
            Json::Null,
            Json::Null,
        ]),
        &AuthCtx::caller("be-creator"),
    )
    .unwrap_err();
    assert!(err.reason == Reason::UnknownType, "unknown type -> UnknownType, got {err:?}");

    // no caller -> Unauthorized.
    let err = resolve_create_matter(
        &dir,
        "0",
        &args(vec![target("space", "sp1"), jstr("space"), obj(vec![("content", jstr("x"))]), Json::Null, Json::Null]),
        &AuthCtx::default(),
    )
    .unwrap_err();
    assert!(err.reason == Reason::Unauthorized, "no caller -> Unauthorized");
}

#[test]
fn create_matter_cas_existence_gate() {
    let dir = fresh("create-matter-cas");
    plant_space(&dir, "sp1", "room", "space-root", None, None, 1.0);

    // a file matter with a cas ref to bytes NOT in the store -> UnknownContent.
    let absent = obj(vec![("kind", jstr("cas")), ("hash", jstr(&"b".repeat(64))), ("encoding", jstr("utf8"))]);
    let err = resolve_create_matter(
        &dir,
        "0",
        &args(vec![
            target("space", "sp1"),
            jstr("space"),
            obj(vec![("name", jstr("f")), ("type", jstr("file")), ("content", absent)]),
            Json::Null,
            Json::Null,
        ]),
        &AuthCtx::caller("be-creator"),
    )
    .unwrap_err();
    assert!(err.reason == Reason::UnknownContent, "create-matter CAS-missing -> UnknownContent, got {err:?}");

    // put the bytes, then it passes (file allows binary; a utf8-encoded cas ref is "text", which file
    // also allows).
    let r = put_content(&dir, b"file bytes", &Meta::for_bytes(None, None, Some("utf8".into()))).expect("put");
    let present = obj(vec![("kind", jstr("cas")), ("hash", jstr(&r.hash)), ("encoding", jstr("utf8"))]);
    resolve_create_matter(
        &dir,
        "0",
        &args(vec![
            target("space", "sp1"),
            jstr("space"),
            obj(vec![("name", jstr("f")), ("type", jstr("file")), ("content", present)]),
            Json::Null,
            Json::Null,
        ]),
        &AuthCtx::caller("be-creator"),
    )
    .expect("create-matter with present CAS bytes");
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the dispatch SEAM (HostResolver / Resolvers)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn dispatch_table_routes_and_rejects_unknown() {
    let dir = fresh("dispatch");
    plant_being(&dir, "be1", "Alice", "sp1", None);

    let table = Resolvers;
    // a known op routes to its resolver.
    let block = table
        .resolve(
            "resolve-set-being-spec",
            &args(vec![target("being", "be1"), jstr("name"), jstr("Renamed"), Json::Null, Json::Null]),
            &dir,
            "0",
            &AuthCtx::caller("be1"),
        )
        .expect("dispatch routes resolve-set-being-spec");
    assert_eq!(get_str(&block, "beingId"), Some("be1"));

    // an unknown op -> the SEE_FLOOR reject-unknown refusal.
    let err = table
        .resolve("resolve-bogus", &[], &dir, "0", &AuthCtx::default())
        .unwrap_err();
    assert!((err.reason == Reason::InvalidInput && err.message.contains("unknown see-op")));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// extra planters for the new resolvers (parentMatterId / owner / inheritation points / name catalog /
// history rows) — same proven plant pattern (stamp a reel + refold).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/// Plant a matter with an explicit parentMatterId (a sub-matter in a folder) -> stamp + refold.
fn plant_submatter(dir: &Path, id: &str, name: &str, space_id: &str, parent_matter_id: &str, ord: f64) {
    let birth = obj(vec![
        ("through", jstr("be-creator")),
        ("verb", jstr("do")),
        ("act", jstr("create-matter")),
        ("of", obj(vec![("kind", jstr("matter")), ("id", jstr(id))])),
        ("params", obj(vec![
            ("name", jstr(name)),
            ("spaceId", jstr(space_id)),
            ("parentMatterId", jstr(parent_matter_id)),
        ])),
    ]);
    stamp(dir, "matter", id, &birth, ord);
    refold(dir, "0", "matter", id).expect("refold submatter");
}

/// Plant a matter whose content IS a given cas ref (a real referent on a hash) -> stamp + refold.
fn plant_matter_with_author(dir: &Path, id: &str, name: &str, space_id: &str, author: &str, content: Option<Json>, ord: f64) {
    let mut params = vec![("name", jstr(name)), ("spaceId", jstr(space_id)), ("beingId", jstr(author))];
    if let Some(c) = content {
        params.push(("content", c));
    }
    let birth = obj(vec![
        ("through", jstr(author)),
        ("verb", jstr("do")),
        ("act", jstr("create-matter")),
        ("of", obj(vec![("kind", jstr("matter")), ("id", jstr(id))])),
        ("params", obj(params)),
    ]);
    stamp(dir, "matter", id, &birth, ord);
    refold(dir, "0", "matter", id).expect("refold authored matter");
}

/// Plant a space with an explicit owner field (create-space reads params.owner) -> stamp + refold.
fn plant_owned_space(dir: &Path, id: &str, name: &str, parent: &str, owner: &str, ord: f64) {
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("do")),
        ("act", jstr("create-space")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr(id))])),
        ("params", obj(vec![("name", jstr(name)), ("parent", jstr(parent)), ("owner", jstr(owner))])),
    ]);
    stamp(dir, "space", id, &birth, ord);
    refold(dir, "0", "space", id).expect("refold owned space");
}

/// Plant a being with a trueName (the owner Name) + an optional parentBeingId -> stamp + refold.
fn plant_being_owned(dir: &Path, id: &str, name: &str, true_name: &str, parent_being: Option<&str>, ord: f64) {
    let mut params = vec![("name", jstr(name)), ("trueName", jstr(true_name))];
    if let Some(p) = parent_being {
        params.push(("parentBeingId", jstr(p)));
    }
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(id))])),
        ("params", obj(params)),
    ]);
    stamp(dir, "being", id, &birth, ord);
    refold(dir, "0", "being", id).expect("refold owned being");
}

/// Stamp an inheritation grant / revoke fact on the POSITION being's reel (params.name = granted Name).
fn plant_inheritation(dir: &Path, position: &str, act_name: &str, granted_name: &str, actor: &str, ord: f64) {
    let f = obj(vec![
        ("through", jstr(actor)),
        ("verb", jstr("do")),
        ("act", jstr(act_name)),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(position))])),
        ("params", obj(vec![("name", jstr(granted_name))])),
    ]);
    stamp(dir, "being", position, &f, ord);
    refold(dir, "0", "being", position).expect("refold inheritation point");
}

/// Plant a Name into the library catalog (name:declare on the library reel), optionally banished.
fn plant_name(dir: &Path, domain: &str, name_id: &str, banished: bool, ord_base: f64) {
    let declare = obj(vec![
        ("through", jstr(name_id)),
        ("verb", jstr("name")),
        ("act", jstr("declare")),
        ("of", obj(vec![("kind", jstr("library")), ("id", jstr(domain))])),
        ("params", obj(vec![("nameId", jstr(name_id)), ("parentNameId", Json::Null)])),
    ]);
    stamp(dir, "library", domain, &declare, ord_base);
    if banished {
        let banish = obj(vec![
            ("through", jstr("i-am")),
            ("verb", jstr("name")),
            ("act", jstr("banish")),
            ("of", obj(vec![("kind", jstr("library")), ("id", jstr(domain))])),
            ("params", obj(vec![("nameId", jstr(name_id))])),
        ]);
        stamp(dir, "library", domain, &banish, ord_base + 1.0);
    }
    refold(dir, "0", "library", domain).expect("refold library");
}

/// Write a history row directly (treestore::write_history_row) so the cherub switch reads see it. The
/// switch resolver reads only `paused` / `deleted` off the row (the JS `loadHistory` row), so a plain
/// row with those fields is the faithful plant (no branchPoint-map ceremony needed for the read).
fn plant_history(dir: &Path, path: &str, paused: bool, deleted: bool) {
    let row = obj(vec![
        ("_id", jstr(path)),
        ("path", jstr(path)),
        ("parent", jstr("0")),
        ("paused", Json::Bool(paused)),
        ("deleted", Json::Bool(deleted)),
    ]);
    treestore::write_history_row(dir, path, &row).expect("write history row");
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PART 1 — the refined Reason enum (round-trip code())
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn reason_code_round_trips() {
    use Reason::*;
    let all = [
        Unauthorized, Forbidden, InvalidInput, BeingNotFound, SpaceNotFound, NameNotFound,
        NameCollision, AlreadyDeleted, CoordOutOfBounds, UnknownType, UnknownContent, MissingTarget,
        ResourceConflict, StoryPaused, BranchNotFound, Internal,
    ];
    // every variant's code() parses back to itself (the stable wire/.word reason string).
    for r in all {
        assert_eq!(Reason::from_code(r.code()), r, "round-trip {:?}", r);
        assert!(!r.code().is_empty());
        assert!(r.code().chars().all(|c| c.is_ascii_lowercase() || c == '-'), "kebab: {}", r.code());
    }
    // the exact kebab strings match the JS `as <reason>` / IBP_ERR names.
    assert_eq!(Unauthorized.code(), "unauthorized");
    assert_eq!(Forbidden.code(), "forbidden");
    assert_eq!(InvalidInput.code(), "invalid-input");
    assert_eq!(BeingNotFound.code(), "being-not-found");
    assert_eq!(NameCollision.code(), "name-collision");
    assert_eq!(CoordOutOfBounds.code(), "coord-out-of-bounds");
    assert_eq!(StoryPaused.code(), "story-paused");
    assert_eq!(BranchNotFound.code(), "branch-not-found");
    // an unknown code falls back to Internal (the JS `code || INTERNAL`).
    assert_eq!(Reason::from_code("not-a-real-code"), Reason::Internal);
    // a HostError carries the reason + a human message; code() is the reason's kebab.
    let e = treehost::HostError::name_taken("set-being", "Bob", "0");
    assert_eq!(e.reason, Reason::NameCollision);
    assert_eq!(e.code(), "name-collision");
    assert!(e.message.contains("Bob") && e.to_string().contains("already taken"));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// move (resolve-source)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn move_resolves_source_and_gates() {
    let dir = fresh("move");
    // a 10x10 container with a child space + a matter in it; a destination space.
    plant_space(&dir, "src", "container", "space-root", Some(obj(vec![("x", jnum(10.0)), ("y", jnum(10.0))])), None, 1.0);
    plant_space(&dir, "child", "kid", "src", None, None, 2.0);
    plant_space(&dir, "dest", "elsewhere", "space-root", None, None, 3.0);
    plant_matter(&dir, "mt1", "note", "src", None, 4.0);

    // container-mode: move the child to dest -> fromSpaceId is the child's parent ("src").
    let from = resolve_move(
        &dir, "0",
        &args(vec![target("space", "child"), Json::Null, jstr("dest"), Json::Null]),
        &AuthCtx::caller("be1"),
    ).expect("move space happy");
    assert_eq!(canonicalize(&from), canonicalize(&jstr("src")), "fromSpaceId is the moved space's parent");

    // matter coord-mode: a coord inside the container (10x10) -> fromSpaceId is the matter's space.
    let from = resolve_move(
        &dir, "0",
        &args(vec![target("matter", "mt1"), obj(vec![("x", jnum(5.0)), ("y", jnum(5.0))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    ).expect("move matter happy");
    assert_eq!(canonicalize(&from), canonicalize(&jstr("src")), "fromSpaceId is the matter's containing space");

    // gate: container-mode to a NON-existent dest -> SpaceNotFound.
    let err = resolve_move(
        &dir, "0",
        &args(vec![target("space", "child"), Json::Null, jstr("ghost"), Json::Null]),
        &AuthCtx::caller("be1"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::SpaceNotFound, "missing dest -> SpaceNotFound, got {err:?}");

    // gate: coord-mode OUT of the container bounds (cell 10 in a size-10 axis) -> CoordOutOfBounds.
    let err = resolve_move(
        &dir, "0",
        &args(vec![target("matter", "mt1"), obj(vec![("x", jnum(10.0)), ("y", jnum(0.0))]), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::CoordOutOfBounds, "coord OOB -> refusal, got {err:?}");
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// rename-matter (resolve-rename-spec)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn rename_matter_happy_and_folder_collision() {
    let dir = fresh("rename-matter");
    plant_space(&dir, "sp1", "room", "space-root", None, None, 1.0);
    plant_matter(&dir, "mt1", "draft", "sp1", None, 2.0);
    plant_matter(&dir, "mt2", "final", "sp1", None, 3.0); // a sibling in the SAME folder
    // a matter in a DIFFERENT folder (under mt2 as a parent) named "buried" — NOT a sibling of mt1.
    plant_submatter(&dir, "mt3", "buried", "sp1", "mt2", 4.0);

    // happy: rename mt1 to a free folder name -> { matterId, name }.
    let block = resolve_rename_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), jstr("revised"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    ).expect("rename happy");
    assert_eq!(get_str(&block, "matterId"), Some("mt1"));
    assert_eq!(get_str(&block, "name"), Some("revised"));

    // collision: rename mt1 to mt2's name (same folder, case-insensitive) -> InvalidInput (name-in-use).
    let err = resolve_rename_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), jstr("FINAL"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::InvalidInput);
    assert!(err.message.contains("already in use"), "folder collision, got {err:?}");

    // rename-to-self (mt1 -> its own current name) is NOT a collision (exclude-self).
    resolve_rename_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), jstr("draft"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    ).expect("rename to own name is free");

    // FOLDER-SCOPED: "buried" lives only in mt2's folder (a different folder), so renaming mt1 (a
    // top-level matter) to "buried" is FREE — the uniqueness is per (spaceId, parentMatterId).
    resolve_rename_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), jstr("buried"), Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    ).expect("a name from a different folder does not collide");

    // allowReplace=true bypasses the collision gate.
    resolve_rename_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), jstr("final"), Json::Bool(true), Json::Null]),
        &AuthCtx::caller("be1"),
    ).expect("allowReplace bypasses collision");

    // no name -> InvalidInput.
    let err = resolve_rename_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), Json::Null, Json::Null, Json::Null]),
        &AuthCtx::caller("be1"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::InvalidInput);
    assert!(err.message.contains("`name` is required"));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// purge-content (resolve-purge)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn purge_content_auth_and_shared_fate() {
    let dir = fresh("purge");
    plant_space(&dir, "sp1", "room", "space-root", None, None, 1.0);

    // put real bytes; author a matter on that hash.
    let r = put_content(&dir, b"secret bytes", &Meta::for_bytes(None, None, Some("utf8".into()))).expect("put");
    let cas = obj(vec![("kind", jstr("cas")), ("hash", jstr(&r.hash)), ("encoding", jstr("utf8"))]);
    plant_matter_with_author(&dir, "mt1", "leak", "sp1", "author-be", Some(cas.clone()), 2.0);

    // happy: the AUTHOR purges -> { matterId, hash, sharedReferents:0, factParams }.
    let block = resolve_purge(
        &dir, "0",
        &args(vec![jstr("mt1"), Json::Null, Json::Null, jstr("author-be")]),
        &AuthCtx::caller("author-be"),
    ).expect("author purge happy");
    assert_eq!(get_str(&block, "matterId"), Some("mt1"));
    assert_eq!(get_str(&block, "hash"), Some(r.hash.as_str()));
    assert!(matches!(get(&block, "sharedReferents"), Some(Json::Num(n)) if *n == 0.0), "no other referents");
    let fp = get(&block, "factParams").expect("factParams");
    assert_eq!(get_str(fp, "hash"), Some(r.hash.as_str()));
    assert!(matches!(get(fp, "force"), Some(Json::Bool(false))));

    // auth gate: a NON-author, NON-owner caller -> Forbidden.
    let err = resolve_purge(
        &dir, "0",
        &args(vec![jstr("mt1"), Json::Null, Json::Null, jstr("rando")]),
        &AuthCtx::caller("rando"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::Forbidden, "non-author/owner -> Forbidden, got {err:?}");

    // shared-fate: a SECOND live matter on the same hash -> ResourceConflict without force.
    plant_matter_with_author(&dir, "mt2", "copy", "sp1", "author-be", Some(cas.clone()), 3.0);
    let err = resolve_purge(
        &dir, "0",
        &args(vec![jstr("mt1"), Json::Null, Json::Null, jstr("author-be")]),
        &AuthCtx::caller("author-be"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::ResourceConflict, "shared bytes -> ResourceConflict, got {err:?}");

    // ... but force=true purges anyway (and reports the referent count).
    let block = resolve_purge(
        &dir, "0",
        &args(vec![jstr("mt1"), Json::Null, Json::Bool(true), jstr("author-be")]),
        &AuthCtx::caller("author-be"),
    ).expect("force purge");
    assert!(matches!(get(&block, "sharedReferents"), Some(Json::Num(n)) if *n == 1.0), "one shared referent");

    // no caller -> Unauthorized; no target -> MissingTarget.
    let err = resolve_purge(&dir, "0", &args(vec![jstr("mt1"), Json::Null, Json::Null, Json::Null]), &AuthCtx::default()).unwrap_err();
    assert_eq!(err.reason, Reason::Unauthorized);
    let err = resolve_purge(&dir, "0", &args(vec![Json::Null, Json::Null, Json::Null, jstr("author-be")]), &AuthCtx::caller("author-be")).unwrap_err();
    assert_eq!(err.reason, Reason::MissingTarget);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// grant/revoke inheritation (resolve-inheritation)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn inheritation_authority_and_name_gates() {
    let dir = fresh("inheritation");
    let domain = "localhost";
    // the granted Name "delegate" is declared; "banned" is banished.
    plant_name(&dir, domain, "delegate", false, 1.0);
    plant_name(&dir, domain, "banned", true, 10.0);
    // a position being OWNED by Name "owner-name" (its trueName), and a child under it.
    plant_being_owned(&dir, "pos", "Root", "owner-name", None, 20.0);

    // grant by the OWNER (has authority over the position it owns) -> { position, factParams:{name}, grantedBy }.
    let block = resolve_inheritation(
        &dir, "0",
        &args(vec![jstr("delegate"), jstr("pos"), jstr("grant")]),
        &AuthCtx::caller("owner-name"),
    ).expect("grant by owner");
    assert_eq!(get_str(&block, "position"), Some("pos"));
    assert_eq!(get_str(&block, "grantedBy"), Some("owner-name"));
    assert_eq!(get_str(fp(&block), "name"), Some("delegate"), "factParams carries the granted Name");

    // I always has authority (universal).
    resolve_inheritation(
        &dir, "0",
        &args(vec![jstr("delegate"), jstr("pos"), jstr("grant")]),
        &AuthCtx::i_am(),
    ).expect("I grants anywhere");

    // authority gate: a Name with NO authority over the position -> Forbidden.
    let err = resolve_inheritation(
        &dir, "0",
        &args(vec![jstr("delegate"), jstr("pos"), jstr("grant")]),
        &AuthCtx::caller("stranger"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::Forbidden, "no authority -> Forbidden, got {err:?}");

    // grant of an UNDECLARED Name -> InvalidInput.
    let err = resolve_inheritation(
        &dir, "0",
        &args(vec![jstr("ghost-name"), jstr("pos"), jstr("grant")]),
        &AuthCtx::caller("owner-name"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::InvalidInput);
    assert!(err.message.contains("declared Name"), "undeclared, got {err:?}");

    // grant of a BANISHED Name -> Forbidden.
    let err = resolve_inheritation(
        &dir, "0",
        &args(vec![jstr("banned"), jstr("pos"), jstr("grant")]),
        &AuthCtx::caller("owner-name"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::Forbidden);
    assert!(err.message.contains("banished"), "banished, got {err:?}");

    // a delegated point grants authority: grant "delegate" a point at "pos", then "delegate" can act there.
    plant_inheritation(&dir, "pos", "grant-inheritation", "delegate", "owner-name", 30.0);
    let block = resolve_inheritation(
        &dir, "0",
        &args(vec![jstr("delegate"), jstr("pos"), jstr("revoke")]),
        &AuthCtx::caller("delegate"),
    ).expect("delegate (holds a live point) may revoke at the position");
    assert_eq!(get_str(&block, "revokedBy"), Some("delegate"));

    // revoke does NOT run the declared/banished gate (it removes regardless): a banished Name's point
    // can still be revoked by an authority. The owner revokes "banned" -> ok (no name-declared gate).
    resolve_inheritation(
        &dir, "0",
        &args(vec![jstr("banned"), jstr("pos"), jstr("revoke")]),
        &AuthCtx::caller("owner-name"),
    ).expect("revoke skips the grantable-Name gate");

    // no name -> InvalidInput; no acting Name -> Unauthorized.
    let err = resolve_inheritation(&dir, "0", &args(vec![Json::Null, jstr("pos"), jstr("grant")]), &AuthCtx::caller("owner-name")).unwrap_err();
    assert_eq!(err.reason, Reason::InvalidInput);
    let err = resolve_inheritation(&dir, "0", &args(vec![jstr("delegate"), jstr("pos"), jstr("grant")]), &AuthCtx::default()).unwrap_err();
    assert_eq!(err.reason, Reason::Unauthorized);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// owner (space-id-of / may-set-owner / may-remove-owner)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn owner_gates() {
    let dir = fresh("owner");
    // a parent space OWNED by "boss"; an unowned child + an owned child under it.
    plant_owned_space(&dir, "par", "parent", "space-root", "boss", 1.0);
    plant_space(&dir, "kid", "child", "par", None, None, 2.0);          // unowned
    plant_owned_space(&dir, "kid2", "child2", "par", "alice", 3.0);     // owned by alice
    plant_space(&dir, "heaven", "config", "space-root", None, Some("config"), 4.0);

    // space-id-of(target) -> the id.
    let id = resolve_owner("space-id-of", &dir, "0", &args(vec![target("space", "kid")]), &AuthCtx::default()).expect("space-id-of");
    assert_eq!(canonicalize(&id), canonicalize(&jstr("kid")));

    // may-set-owner: the PARENT's owner ("boss") may claim the unowned child -> true.
    let yes = resolve_owner("may-set-owner", &dir, "0", &args(vec![jstr("kid"), jstr("alice"), jstr("boss")]), &AuthCtx::default()).expect("may-set-owner claim");
    assert_eq!(canonicalize(&yes), canonicalize(&Json::Bool(true)), "parent owner approves a claim");

    // may-set-owner: a non-parent-owner may NOT claim the unowned child -> false.
    let no = resolve_owner("may-set-owner", &dir, "0", &args(vec![jstr("kid"), jstr("alice"), jstr("rando")]), &AuthCtx::default()).expect("may-set-owner");
    assert_eq!(canonicalize(&no), canonicalize(&Json::Bool(false)), "a stranger cannot claim");

    // may-set-owner: reassign an OWNED child requires the CURRENT owner ("alice"), not the parent owner.
    let yes = resolve_owner("may-set-owner", &dir, "0", &args(vec![jstr("kid2"), jstr("carol"), jstr("alice")]), &AuthCtx::default()).expect("reassign by current owner");
    assert_eq!(canonicalize(&yes), canonicalize(&Json::Bool(true)));
    let no = resolve_owner("may-set-owner", &dir, "0", &args(vec![jstr("kid2"), jstr("carol"), jstr("boss")]), &AuthCtx::default()).expect("reassign by non-owner");
    assert_eq!(canonicalize(&no), canonicalize(&Json::Bool(false)), "only the current owner reassigns");

    // may-set-owner: setting to the SAME owner -> false (no-op).
    let no = resolve_owner("may-set-owner", &dir, "0", &args(vec![jstr("kid2"), jstr("alice"), jstr("alice")]), &AuthCtx::default()).expect("same owner");
    assert_eq!(canonicalize(&no), canonicalize(&Json::Bool(false)), "already that owner");

    // may-set-owner: a HEAVEN space -> false.
    let no = resolve_owner("may-set-owner", &dir, "0", &args(vec![jstr("heaven"), jstr("alice"), jstr("boss")]), &AuthCtx::default()).expect("heaven");
    assert_eq!(canonicalize(&no), canonicalize(&Json::Bool(false)), "heaven refuses ownership");

    // may-remove-owner: the parent owner ("boss") may clear the owned child's owner -> true.
    let yes = resolve_owner("may-remove-owner", &dir, "0", &args(vec![jstr("kid2"), jstr("boss")]), &AuthCtx::default()).expect("may-remove-owner");
    assert_eq!(canonicalize(&yes), canonicalize(&Json::Bool(true)), "parent owner clears a child owner");

    // may-remove-owner: a stranger may NOT -> false; an UNOWNED child -> false (nothing to remove).
    let no = resolve_owner("may-remove-owner", &dir, "0", &args(vec![jstr("kid2"), jstr("rando")]), &AuthCtx::default()).expect("may-remove-owner");
    assert_eq!(canonicalize(&no), canonicalize(&Json::Bool(false)));
    let no = resolve_owner("may-remove-owner", &dir, "0", &args(vec![jstr("kid"), jstr("boss")]), &AuthCtx::default()).expect("unowned");
    assert_eq!(canonicalize(&no), canonicalize(&Json::Bool(false)), "no removable owner");

    // space-id-of on an unresolvable target -> SpaceNotFound.
    let err = resolve_owner("space-id-of", &dir, "0", &args(vec![Json::Null]), &AuthCtx::default()).unwrap_err();
    assert_eq!(err.reason, Reason::SpaceNotFound);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// grant-able (able-exists)
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn grant_able_exists_shape_gate() {
    let dir = fresh("grant");
    // a well-formed kebab able -> true.
    let yes = resolve_grant("able-exists", &dir, "0", &args(vec![jstr("place-manager")]), &AuthCtx::default()).expect("able-exists");
    assert_eq!(canonicalize(&yes), canonicalize(&Json::Bool(true)));
    // empty / malformed -> false.
    for bad in ["", "-bad", "bad-", "Bad", "a--b", "has space"] {
        let no = resolve_grant("able-exists", &dir, "0", &args(vec![jstr(bad)]), &AuthCtx::default()).expect("able-exists");
        assert_eq!(canonicalize(&no), canonicalize(&Json::Bool(false)), "malformed able {bad:?} -> false");
    }
    // unknown grant op -> InvalidInput.
    let err = resolve_grant("bogus", &dir, "0", &[], &AuthCtx::default()).unwrap_err();
    assert_eq!(err.reason, Reason::InvalidInput);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// cherub kill / switch / truename
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn cherub_kill_resolves_target() {
    let dir = fresh("cherub-kill");
    plant_being(&dir, "be1", "Victim", "sp1", None);

    // resolve-target-being by name -> the id.
    let id = resolve_kill("resolve-target-being", &dir, "0", &args(vec![jstr("Victim")]), &AuthCtx::caller("killer")).expect("kill resolve");
    assert_eq!(canonicalize(&id), canonicalize(&jstr("be1")));
    // an unknown name -> Null (the .word turns that into being-not-found).
    let none = resolve_kill("resolve-target-being", &dir, "0", &args(vec![jstr("Ghost")]), &AuthCtx::caller("killer")).expect("kill resolve miss");
    assert!(matches!(none, Json::Null), "unknown name -> Null");
}

#[test]
fn cherub_switch_destination_reads() {
    let dir = fresh("cherub-switch");
    plant_being(&dir, "be1", "Traveler", "sp1", None);
    plant_history(&dir, "1", false, false);   // a live history
    plant_history(&dir, "2", true, false);    // a PAUSED history
    plant_history(&dir, "3", false, true);    // a DELETED history

    // main is never missing / never paused.
    assert_eq!(canonicalize(&resolve_switch("destination-missing", &dir, "0", &args(vec![jstr("0")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(false)));
    assert_eq!(canonicalize(&resolve_switch("destination-paused", &dir, "0", &args(vec![jstr("0")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(false)));
    // a live history exists + is not paused.
    assert_eq!(canonicalize(&resolve_switch("destination-missing", &dir, "0", &args(vec![jstr("1")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(false)));
    assert_eq!(canonicalize(&resolve_switch("destination-paused", &dir, "0", &args(vec![jstr("1")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(false)));
    // a non-existent history -> missing.
    assert_eq!(canonicalize(&resolve_switch("destination-missing", &dir, "0", &args(vec![jstr("99")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(true)));
    // a paused history -> paused.
    assert_eq!(canonicalize(&resolve_switch("destination-paused", &dir, "0", &args(vec![jstr("2")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(true)));
    // a deleted history -> missing.
    assert_eq!(canonicalize(&resolve_switch("destination-missing", &dir, "0", &args(vec![jstr("3")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(true)));

    // being-lives-on: the caller's reel folds to a living birth on main (a name, not dead) -> true.
    assert_eq!(canonicalize(&resolve_switch("being-lives-on", &dir, "0", &args(vec![jstr("be1"), jstr("0")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(true)));
    // a being with no birth on the destination -> false.
    assert_eq!(canonicalize(&resolve_switch("being-lives-on", &dir, "0", &args(vec![jstr("nobody"), jstr("0")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(false)));
}

#[test]
fn cherub_truename_name_reads() {
    let dir = fresh("cherub-truename");
    let domain = "localhost";
    plant_name(&dir, domain, "real-name", false, 1.0);
    plant_name(&dir, domain, "closed-name", true, 10.0);

    // resolve-name-id: the "i-am" literal, a key id verbatim, else findByName.
    assert_eq!(canonicalize(&resolve_truename("resolve-name-id", &dir, "0", &args(vec![jstr("i-am")]), &AuthCtx::default()).unwrap()), canonicalize(&jstr("i-am")));
    let keyid = "z6MkExampleKeyIdTokenThatLooksLikeAPubkey";
    assert_eq!(canonicalize(&resolve_truename("resolve-name-id", &dir, "0", &args(vec![jstr(keyid)]), &AuthCtx::default()).unwrap()), canonicalize(&jstr(keyid)));
    // an unresolvable token -> Null (no name with that real-name on main).
    assert!(matches!(resolve_truename("resolve-name-id", &dir, "0", &args(vec![jstr("not-a-known-real-name")]), &AuthCtx::default()).unwrap(), Json::Null));

    // name-exists: a declared Name -> true; I (literal) -> true; an unknown -> false.
    assert_eq!(canonicalize(&resolve_truename("name-exists", &dir, "0", &args(vec![jstr("real-name")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(true)));
    assert_eq!(canonicalize(&resolve_truename("name-exists", &dir, "0", &args(vec![jstr("i-am")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(true)));
    assert_eq!(canonicalize(&resolve_truename("name-exists", &dir, "0", &args(vec![jstr("ghost")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(false)));

    // name-banished: the banished Name -> true; a live Name -> false; I -> false.
    assert_eq!(canonicalize(&resolve_truename("name-banished", &dir, "0", &args(vec![jstr("closed-name")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(true)));
    assert_eq!(canonicalize(&resolve_truename("name-banished", &dir, "0", &args(vec![jstr("real-name")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(false)));
    assert_eq!(canonicalize(&resolve_truename("name-banished", &dir, "0", &args(vec![jstr("i-am")]), &AuthCtx::default()).unwrap()), canonicalize(&Json::Bool(false)));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the dispatch table routes the NEW see-ops
// ════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn dispatch_routes_new_see_ops() {
    let dir = fresh("dispatch-new");
    let domain = "localhost";
    plant_space(&dir, "sp1", "room", "space-root", None, None, 1.0);
    plant_matter(&dir, "mt1", "note", "sp1", None, 2.0);
    plant_owned_space(&dir, "par", "parent", "space-root", "boss", 3.0);
    plant_name(&dir, domain, "delegate", false, 4.0);
    plant_being_owned(&dir, "pos", "Root", "owner-name", None, 20.0);

    let table = Resolvers;
    // each new op routes through the table to its resolver.
    let from = table.resolve("resolve-source", &args(vec![target("matter", "mt1"), Json::Null, Json::Null, Json::Null]), &dir, "0", &AuthCtx::caller("be1")).expect("resolve-source routes");
    assert_eq!(canonicalize(&from), canonicalize(&jstr("sp1")));
    let block = table.resolve("resolve-rename-spec", &args(vec![target("matter", "mt1"), jstr("renamed"), Json::Null, Json::Null]), &dir, "0", &AuthCtx::caller("be1")).expect("resolve-rename-spec routes");
    assert_eq!(get_str(&block, "name"), Some("renamed"));
    let id = table.resolve("space-id-of", &args(vec![target("space", "par")]), &dir, "0", &AuthCtx::default()).expect("space-id-of routes");
    assert_eq!(canonicalize(&id), canonicalize(&jstr("par")));
    let yes = table.resolve("able-exists", &args(vec![jstr("place-manager")]), &dir, "0", &AuthCtx::default()).expect("able-exists routes");
    assert_eq!(canonicalize(&yes), canonicalize(&Json::Bool(true)));
    let block = table.resolve("resolve-inheritation", &args(vec![jstr("delegate"), jstr("pos"), jstr("grant")]), &dir, "0", &AuthCtx::caller("owner-name")).expect("resolve-inheritation routes");
    assert_eq!(get_str(&block, "position"), Some("pos"));
    let tid = table.resolve("resolve-target-being", &args(vec![jstr("Root")]), &dir, "0", &AuthCtx::default()).expect("resolve-target-being routes");
    assert_eq!(canonicalize(&tid), canonicalize(&jstr("pos")));
    let miss = table.resolve("destination-missing", &args(vec![jstr("0")]), &dir, "0", &AuthCtx::default()).expect("destination-missing routes");
    assert_eq!(canonicalize(&miss), canonicalize(&Json::Bool(false)));
    let nid = table.resolve("resolve-name-id", &args(vec![jstr("i-am")]), &dir, "0", &AuthCtx::default()).expect("resolve-name-id routes");
    assert_eq!(canonicalize(&nid), canonicalize(&jstr("i-am")));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// be:birth (resolve-birth-being)
// ════════════════════════════════════════════════════════════════════════════════════════════════

use treehost::resolve_birth_being;

/// A be:birth spec params object (name + extras).
fn birth_spec(name: &str, home_space: &str, extra: Vec<(&str, Json)>) -> Json {
    let mut p = vec![("name", jstr(name)), ("homeSpace", jstr(home_space))];
    for kv in extra {
        p.push(kv);
    }
    obj(p)
}

#[test]
fn birth_being_happy_spec_and_content_id() {
    let dir = fresh("birth-happy");
    // a home space with a size (for the coord auto-pick) + the mother (i-am-owned, carries trueName).
    plant_space(&dir, "home1", "nursery", "space-root", Some(obj(vec![("x", jnum(8.0)), ("y", jnum(8.0))])), None, 1.0);
    plant_being_owned(&dir, "mom", "Mother", "i-am", None, 2.0);

    // I-am minter births a child under the mother. bornAt threads the act id into the content hash.
    let spec = birth_spec("child", "home1", vec![("bornAt", jstr("act-xyz")), ("able", jstr("dancer"))]);
    let block = resolve_birth_being(
        &dir,
        "0",
        &args(vec![target("being", "mom"), spec, Json::Null, Json::Null]),
        &AuthCtx::i_am(),
    )
    .expect("birth happy");

    // content-id is byte-identical to beingContentId({parentBeingId, name, homeHistory, bornAt}).
    let want_id = treehost::toolkit::being_content_id(&obj(vec![
        ("parentBeingId", jstr("mom")),
        ("name", jstr("child")),
        ("homeHistory", jstr("0")),
        ("bornAt", jstr("act-xyz")),
    ]));
    assert_eq!(get_str(&block, "beingId"), Some(want_id.as_str()), "being id is the content hash");

    let p = fp(&block);
    assert_eq!(get_str(p, "name"), Some("child"));
    assert_eq!(get_str(p, "parentBeingId"), Some("mom"));
    assert_eq!(get_str(p, "homeSpace"), Some("home1"));
    assert_eq!(get_str(p, "homeHistory"), Some("0"));
    assert_eq!(get_str(p, "position"), Some("home1"), "default position = homeSpace");
    assert_eq!(get_str(p, "trueName"), Some("i-am"), "expresses the mother's trueName");
    assert_eq!(get_str(p, "defaultAble"), Some("dancer"));
    // coord auto-picked in-bounds (the home has a size).
    let coord = get(p, "coord").expect("auto-picked coord");
    let cx = match get(coord, "x") { Some(Json::Num(n)) => *n, _ => -1.0 };
    let cy = match get(coord, "y") { Some(Json::Num(n)) => *n, _ => -1.0 };
    assert!((0.0..8.0).contains(&cx) && (0.0..8.0).contains(&cy), "coord in bounds, got {cx},{cy}");
    // NO password (the credential mint is a seal concern, not this resolver).
    assert!(get(p, "password").is_none(), "no credential password in the spec");
}

#[test]
fn birth_being_parent_not_found() {
    let dir = fresh("birth-no-parent");
    plant_space(&dir, "home1", "nursery", "space-root", None, None, 1.0);
    let spec = birth_spec("child", "home1", vec![]);
    let err = resolve_birth_being(
        &dir,
        "0",
        &args(vec![target("being", "ghost"), spec, Json::Null, Json::Null]),
        &AuthCtx::i_am(),
    )
    .unwrap_err();
    assert_eq!(err.reason, Reason::BeingNotFound, "missing parent -> BeingNotFound, got {err:?}");
}

#[test]
fn birth_being_name_collision() {
    let dir = fresh("birth-collision");
    plant_space(&dir, "home1", "nursery", "space-root", None, None, 1.0);
    plant_being_owned(&dir, "mom", "Mother", "i-am", None, 2.0);
    plant_being(&dir, "taken", "Existing", "home1", None);

    let spec = birth_spec("Existing", "home1", vec![]);
    let err = resolve_birth_being(
        &dir,
        "0",
        &args(vec![target("being", "mom"), spec, Json::Null, Json::Null]),
        &AuthCtx::i_am(),
    )
    .unwrap_err();
    assert_eq!(err.reason, Reason::NameCollision, "taken name -> NameCollision, got {err:?}");
}

#[test]
fn birth_being_unauthorized_minter() {
    let dir = fresh("birth-unauth");
    plant_space(&dir, "home1", "nursery", "space-root", None, None, 2.0);
    // the mother is owned by the Name "owner-name"; she chains under nobody (top-level).
    plant_being_owned(&dir, "mom", "Mother", "owner-name", None, 3.0);
    // the minter being is owned by a DIFFERENT Name, with no authority over the mother position.
    plant_being_owned(&dir, "stranger", "Stranger", "stranger-name", None, 4.0);

    let spec = birth_spec("child", "home1", vec![]);
    // a non-I minter with no authority over the parent position -> Forbidden.
    let err = resolve_birth_being(
        &dir,
        "0",
        &args(vec![target("being", "mom"), spec, Json::Null, Json::Null]),
        &AuthCtx::caller("stranger"),
    )
    .unwrap_err();
    assert_eq!(err.reason, Reason::Forbidden, "uncovered minter -> Forbidden, got {err:?}");

    // but the minter holding an inheritation point ON the mother position IS covered.
    plant_inheritation(&dir, "mom", "grant-inheritation", "stranger-name", "owner-name", 5.0);
    let spec2 = birth_spec("child", "home1", vec![]);
    resolve_birth_being(
        &dir,
        "0",
        &args(vec![target("being", "mom"), spec2, Json::Null, Json::Null]),
        &AuthCtx::caller("stranger"),
    )
    .expect("inheritation point covers the minter");
}

#[test]
fn birth_being_coord_out_of_bounds() {
    let dir = fresh("birth-coord-oob");
    plant_space(&dir, "home1", "nursery", "space-root", Some(obj(vec![("x", jnum(4.0)), ("y", jnum(4.0))])), None, 1.0);
    plant_being_owned(&dir, "mom", "Mother", "i-am", None, 2.0);

    // an explicit coord OUTSIDE the home's 4x4 box -> CoordOutOfBounds.
    let spec = birth_spec("child", "home1", vec![("coord", obj(vec![("x", jnum(9.0)), ("y", jnum(1.0))]))]);
    let err = resolve_birth_being(
        &dir,
        "0",
        &args(vec![target("being", "mom"), spec, Json::Null, Json::Null]),
        &AuthCtx::i_am(),
    )
    .unwrap_err();
    assert_eq!(err.reason, Reason::CoordOutOfBounds, "oob coord -> CoordOutOfBounds, got {err:?}");
}

#[test]
fn birth_being_routes_through_table() {
    let dir = fresh("birth-table");
    plant_space(&dir, "home1", "nursery", "space-root", None, None, 1.0);
    plant_being_owned(&dir, "mom", "Mother", "i-am", None, 2.0);
    let table = Resolvers;
    let spec = birth_spec("childT", "home1", vec![]);
    let block = table
        .resolve("resolve-birth-being", &args(vec![target("being", "mom"), spec, Json::Null, Json::Null]), &dir, "0", &AuthCtx::i_am())
        .expect("resolve-birth-being routes");
    assert_eq!(get_str(fp(&block), "name"), Some("childT"));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PART 3 — the substrate composite resolvers (end-matter / config / model / flow / render / portal /
// world-signal). Each: the happy-path spec is byte-correct + the gate fires with the right Reason.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/// Plant a matter with an explicit `type` + content (the model-type matter set-model resolves).
fn plant_matter_typed(dir: &Path, id: &str, name: &str, space_id: &str, ty: &str, content: Option<Json>, ord: f64) {
    let mut params = vec![("name", jstr(name)), ("spaceId", jstr(space_id)), ("type", jstr(ty))];
    if let Some(c) = content {
        params.push(("content", c));
    }
    let birth = obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("do")),
        ("act", jstr("create-matter")),
        ("of", obj(vec![("kind", jstr("matter")), ("id", jstr(id))])),
        ("params", obj(params)),
    ]);
    stamp(dir, "matter", id, &birth, ord);
    refold(dir, "0", "matter", id).expect("refold typed matter");
}

// ── end-matter ──────────────────────────────────────────────────────────────────────────────────────
#[test]
fn end_matter_author_and_root_owner_and_unauthorized() {
    let dir = fresh("end-matter");
    // a root with a non-I owner, a child space, a matter authored by author-be.
    plant_owned_space(&dir, "root1", "root", "space-root", "owner-be", 1.0);
    plant_space(&dir, "child1", "child", "root1", None, None, 2.0);
    plant_matter_with_author(&dir, "mt1", "note", "child1", "author-be", None, 3.0);

    // happy: the AUTHOR may end -> { matterId, factParams:{} }.
    let block = resolve_end_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), jstr("author-be"), Json::Null]),
        &AuthCtx::caller("author-be"),
    ).expect("end-matter by author");
    assert_eq!(get_str(&block, "matterId"), Some("mt1"));
    assert!(matches!(fp(&block), Json::Obj(e) if e.is_empty()), "end-matter factParams is empty");

    // the TREE OWNER (non-author) may end (resolve_root_owner finds owner-be on root1).
    let block = resolve_end_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), jstr("owner-be"), Json::Null]),
        &AuthCtx::caller("owner-be"),
    ).expect("end-matter by tree owner");
    assert_eq!(get_str(&block, "matterId"), Some("mt1"));

    // a rando (neither author nor root owner) -> Forbidden.
    let err = resolve_end_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), jstr("rando"), Json::Null]),
        &AuthCtx::caller("rando"),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::Forbidden, "non-author/owner -> Forbidden, got {err:?}");

    // no caller -> Unauthorized.
    let err = resolve_end_matter(
        &dir, "0",
        &args(vec![target("matter", "mt1"), Json::Null, Json::Null]),
        &AuthCtx::default(),
    ).unwrap_err();
    assert_eq!(err.reason, Reason::Unauthorized, "no caller -> Unauthorized");
}

// ── config ─────────────────────────────────────────────────────────────────────────────────────────
#[test]
fn config_set_and_delete_and_protected_gate() {
    let dir = fresh("config");
    // happy set: a normal key/value -> { key, value, factParams:{key,value} }.
    let block = resolve_config_set(
        &dir, "0",
        &args(vec![jstr("STORY_NAME"), jstr("My Place"), jstr("alice")]),
        &AuthCtx::caller("alice"),
    ).expect("config-set happy");
    assert_eq!(get_str(&block, "key"), Some("STORY_NAME"));
    assert_eq!(get_str(fp(&block), "key"), Some("STORY_NAME"));
    assert_eq!(get_str(fp(&block), "value"), Some("My Place"));

    // value required (null) -> InvalidInput.
    let err = resolve_config_set(
        &dir, "0",
        &args(vec![jstr("STORY_NAME"), Json::Null, jstr("alice")]),
        &AuthCtx::caller("alice"),
    ).unwrap_err();
    assert!(err.reason == Reason::InvalidInput && err.message.contains("`value` is required"), "null value -> invalid, got {err:?}");

    // bad key shape -> InvalidInput.
    let err = resolve_config_set(
        &dir, "0",
        &args(vec![jstr("1bad-key"), jstr("x"), jstr("alice")]),
        &AuthCtx::caller("alice"),
    ).unwrap_err();
    assert!(err.reason == Reason::InvalidInput && err.message.contains("Invalid config key"), "bad key -> invalid, got {err:?}");

    // protected key + non-I caller -> InvalidInput (protected refusal).
    let err = resolve_config_set(
        &dir, "0",
        &args(vec![jstr("seedVersion"), jstr("2"), jstr("alice")]),
        &AuthCtx::caller("alice"),
    ).unwrap_err();
    assert!(err.message.contains("protected"), "protected + non-I -> refused, got {err:?}");

    // protected key + the I-Am caller -> allowed.
    let block = resolve_config_set(
        &dir, "0",
        &args(vec![jstr("seedVersion"), jstr("2"), jstr("i-am")]),
        &AuthCtx::i_am(),
    ).expect("protected by I-Am allowed");
    assert_eq!(get_str(&block, "key"), Some("seedVersion"));

    // delete: bodiless params { key }.
    let block = resolve_config_delete(
        &dir, "0",
        &args(vec![jstr("STORY_NAME"), jstr("alice")]),
        &AuthCtx::caller("alice"),
    ).expect("config-delete happy");
    assert_eq!(get_str(fp(&block), "key"), Some("STORY_NAME"));
    assert!(get(fp(&block), "value").is_none(), "delete factParams carries only key");

    // delete protected + non-I -> refused.
    let err = resolve_config_delete(
        &dir, "0",
        &args(vec![jstr("disabledExtensions"), jstr("alice")]),
        &AuthCtx::caller("alice"),
    ).unwrap_err();
    assert!(err.message.contains("protected"), "delete protected + non-I -> refused");
}

// ── model ─────────────────────────────────────────────────────────────────────────────────────────
#[test]
fn model_block_set_clear_and_for_matter_type() {
    let dir = fresh("model");
    let cas = obj(vec![("kind", jstr("cas")), ("hash", jstr(&"a".repeat(64))), ("name", jstr("dragon.glb"))]);
    plant_matter_typed(&dir, "model1", "dragon", "sp1", "model", Some(cas), 2.0);

    // SET (entity-level being): { field:"qualities.render", value:{model,scale}, merge:true }.
    let block = resolve_model_block(
        &dir, "0",
        &args(vec![jstr("being"), jstr("model1"), jnum(2.0), Json::Null, Json::Null, Json::Bool(false)]),
        &AuthCtx::default(),
    ).expect("resolve-model-block set");
    assert_eq!(get_str(&block, "field"), Some("qualities.render"));
    assert!(matches!(get(&block, "merge"), Some(Json::Bool(true))));
    let value = get(&block, "value").unwrap();
    let model = get(value, "model").unwrap();
    assert_eq!(get_str(model, "matterId"), Some("model1"));
    assert_eq!(get_str(model, "hash"), Some("a".repeat(64).as_str()));
    assert_eq!(get_str(model, "url"), Some(format!("/api/v1/content/{}", "a".repeat(64)).as_str()));
    assert_eq!(get_str(model, "name"), Some("dragon"));
    assert!(matches!(get(value, "scale"), Some(Json::Num(n)) if *n == 2.0));

    // CLEAR (entity): { field:"qualities.render.model", value:null, merge:false }.
    let block = resolve_model_block(
        &dir, "0",
        &args(vec![jstr("being"), Json::Null, Json::Null, Json::Null, Json::Null, Json::Bool(true)]),
        &AuthCtx::default(),
    ).expect("resolve-model-block clear");
    assert_eq!(get_str(&block, "field"), Some("qualities.render.model"));
    assert!(matches!(get(&block, "value"), Some(Json::Null)));

    // forMatterType on a SPACE + known type -> the deep matterModels path.
    let block = resolve_model_block(
        &dir, "0",
        &args(vec![jstr("space"), jstr("model1"), Json::Null, Json::Null, jstr("file"), Json::Bool(false)]),
        &AuthCtx::default(),
    ).expect("resolve-model-block forMatterType");
    assert_eq!(get_str(&block, "field"), Some("qualities.render.matterModels.file"));

    // forMatterType on a NON-space -> InvalidInput.
    let err = resolve_model_block(
        &dir, "0",
        &args(vec![jstr("being"), jstr("model1"), Json::Null, Json::Null, jstr("file"), Json::Bool(false)]),
        &AuthCtx::default(),
    ).unwrap_err();
    assert!(err.reason == Reason::InvalidInput && err.message.contains("space targets only"), "forMatterType non-space -> invalid, got {err:?}");

    // forMatterType unknown type -> InvalidInput.
    let err = resolve_model_block(
        &dir, "0",
        &args(vec![jstr("space"), jstr("model1"), Json::Null, Json::Null, jstr("ext:nope"), Json::Bool(false)]),
        &AuthCtx::default(),
    ).unwrap_err();
    assert!(err.message.contains("unknown matter type"), "unknown forMatterType -> invalid, got {err:?}");

    // a non-model matter -> InvalidInput.
    plant_matter_typed(&dir, "gen1", "plain", "sp1", "generic", Some(jstr("hi")), 3.0);
    let err = resolve_model_block(
        &dir, "0",
        &args(vec![jstr("being"), jstr("gen1"), Json::Null, Json::Null, Json::Null, Json::Bool(false)]),
        &AuthCtx::default(),
    ).unwrap_err();
    assert!(err.message.contains("not \"model\""), "non-model matter -> invalid, got {err:?}");
}

#[test]
fn may_set_model_self_author_owner() {
    let dir = fresh("may-set-model");
    plant_owned_space(&dir, "root1", "root", "space-root", "owner-be", 1.0);
    plant_being(&dir, "self-be", "Self", "root1", None);
    plant_matter_with_author(&dir, "mt1", "thing", "root1", "author-be", None, 3.0);

    // being self -> true.
    let v = may_set_model(&dir, "0", &args(vec![jstr("being"), target("being", "self-be"), jstr("self-be")]), &AuthCtx::default()).unwrap();
    assert!(matches!(v, Json::Bool(true)), "self may set own model");

    // matter author -> true.
    let v = may_set_model(&dir, "0", &args(vec![jstr("matter"), target("matter", "mt1"), jstr("author-be")]), &AuthCtx::default()).unwrap();
    assert!(matches!(v, Json::Bool(true)), "author may set matter model");

    // space tree owner -> true.
    let v = may_set_model(&dir, "0", &args(vec![jstr("space"), target("space", "root1"), jstr("owner-be")]), &AuthCtx::default()).unwrap();
    assert!(matches!(v, Json::Bool(true)), "owner may set space model");

    // a rando -> false.
    let v = may_set_model(&dir, "0", &args(vec![jstr("matter"), target("matter", "mt1"), jstr("rando")]), &AuthCtx::default()).unwrap();
    assert!(matches!(v, Json::Bool(false)), "rando may not");
}

// ── set-being-flow ────────────────────────────────────────────────────────────────────────────────
#[test]
fn flow_spec_validates_clauses() {
    let dir = fresh("flow");
    // happy: an array of valid clauses -> { beingId, factParams:{field:"qualities.flow",value,merge:false} }.
    let params = obj(vec![
        ("beingId", jstr("be1")),
        ("flow", Json::Arr(vec![
            obj(vec![("able", jstr("dancer")), ("when", jstr("world.tick.alive")), ("stack", Json::Bool(true)), ("junk", jnum(9.0))]),
            obj(vec![("able", jstr("drummer"))]),
        ])),
    ]);
    let block = resolve_set_being_flow_spec(
        &dir, "0",
        &args(vec![target("being", "be1"), params]),
        &AuthCtx::default(),
    ).expect("flow happy");
    assert_eq!(get_str(&block, "beingId"), Some("be1"));
    let fpb = fp(&block);
    assert_eq!(get_str(fpb, "field"), Some("qualities.flow"));
    assert!(matches!(get(fpb, "merge"), Some(Json::Bool(false))));
    let clauses = match get(fpb, "value") { Some(Json::Arr(a)) => a, _ => panic!("clauses array") };
    assert_eq!(clauses.len(), 2);
    // unknown key dropped; when + stack kept.
    assert!(get(&clauses[0], "junk").is_none(), "unknown clause key dropped");
    assert_eq!(get_str(&clauses[0], "when"), Some("world.tick.alive"));
    assert!(matches!(get(&clauses[0], "stack"), Some(Json::Bool(true))));

    // target unresolvable -> InvalidInput.
    let err = resolve_set_being_flow_spec(
        &dir, "0",
        &args(vec![Json::Null, obj(vec![("flow", Json::Arr(vec![]))])]),
        &AuthCtx::default(),
    ).unwrap_err();
    assert!(err.reason == Reason::InvalidInput && err.message.contains("could not resolve target being"), "no target -> invalid, got {err:?}");

    // flow not an array -> InvalidInput.
    let err = resolve_set_being_flow_spec(
        &dir, "0",
        &args(vec![target("being", "be1"), obj(vec![("flow", jstr("nope"))])]),
        &AuthCtx::default(),
    ).unwrap_err();
    assert!(err.message.contains("must be an array"), "non-array flow -> invalid, got {err:?}");

    // a clause missing `able` -> InvalidInput.
    let err = resolve_set_being_flow_spec(
        &dir, "0",
        &args(vec![target("being", "be1"), obj(vec![("flow", Json::Arr(vec![obj(vec![("when", jstr("x"))])]))])]),
        &AuthCtx::default(),
    ).unwrap_err();
    assert!(err.message.contains("must be a non-empty string"), "clause without able -> invalid, got {err:?}");
}

// ── set-render ────────────────────────────────────────────────────────────────────────────────────
#[test]
fn render_block_validation() {
    let dir = fresh("render");
    // happy: model string + scale + rotation -> { field, value, merge:true }.
    let params = obj(vec![
        ("model", jstr("furniture:chair")),
        ("scale", jnum(1.5)),
        ("rotation", obj(vec![("x", jnum(0.0)), ("y", jnum(90.0)), ("z", jnum(0.0))])),
        ("animations", obj(vec![("tick", jstr("bounce"))])),
    ]);
    let block = validate_render_block(&dir, "0", &args(vec![params, jstr("matter")]), &AuthCtx::default()).expect("render happy");
    assert_eq!(get_str(&block, "field"), Some("qualities.render"));
    assert!(matches!(get(&block, "merge"), Some(Json::Bool(true))));
    let value = get(&block, "value").unwrap();
    assert_eq!(get_str(value, "model"), Some("furniture:chair"));
    assert_eq!(get_str(get(value, "animations").unwrap(), "tick"), Some("bounce"));

    // merge:false honored.
    let block = validate_render_block(&dir, "0", &args(vec![obj(vec![("merge", Json::Bool(false))]), Json::Null]), &AuthCtx::default()).expect("merge false");
    assert!(matches!(get(&block, "merge"), Some(Json::Bool(false))));

    // bad kind -> InvalidInput.
    let err = validate_render_block(&dir, "0", &args(vec![obj(vec![]), jstr("widget")]), &AuthCtx::default()).unwrap_err();
    assert!(err.reason == Reason::InvalidInput && err.message.contains("target must be matter"), "bad kind -> invalid, got {err:?}");

    // unknown key -> InvalidInput.
    let err = validate_render_block(&dir, "0", &args(vec![obj(vec![("glow", Json::Bool(true))]), jstr("matter")]), &AuthCtx::default()).unwrap_err();
    assert!(err.message.contains("unknown key"), "unknown key -> invalid, got {err:?}");

    // bad scale -> InvalidInput.
    let err = validate_render_block(&dir, "0", &args(vec![obj(vec![("scale", jnum(-1.0))]), jstr("matter")]), &AuthCtx::default()).unwrap_err();
    assert!(err.message.contains("positive finite"), "bad scale -> invalid, got {err:?}");
}

// ── portal ────────────────────────────────────────────────────────────────────────────────────────
#[test]
fn containing_space_from_space_and_matter() {
    let dir = fresh("portal");
    plant_space(&dir, "sp1", "room", "space-root", None, None, 1.0);
    plant_matter(&dir, "mt1", "thing", "sp1", None, 2.0);

    // a space target IS its own containing space.
    let v = resolve_containing_space(&dir, "0", &args(vec![target("space", "sp1")]), &AuthCtx::default()).unwrap();
    assert!(matches!(&v, Json::Str(s) if s == "sp1"));

    // a matter target -> its folded spaceId.
    let v = resolve_containing_space(&dir, "0", &args(vec![target("matter", "mt1")]), &AuthCtx::default()).unwrap();
    assert!(matches!(&v, Json::Str(s) if s == "sp1"));

    // neither kind -> null (the .word refuses on a falsy result).
    let v = resolve_containing_space(&dir, "0", &args(vec![target("being", "be1")]), &AuthCtx::default()).unwrap();
    assert!(matches!(v, Json::Null));
}

// ── set-world-signal ──────────────────────────────────────────────────────────────────────────────
#[test]
fn world_signal_gates_and_fact() {
    let dir = fresh("world-signal");
    // a story-root space (heavenSpace == "space-root").
    plant_space(&dir, "root1", "root", "", Some(obj(vec![("x", jnum(50.0)), ("y", jnum(50.0))])), Some("space-root"), 1.0);

    let table = Resolvers;
    // valid-namespace / valid-key kebab gates.
    assert!(matches!(table.resolve("valid-namespace", &args(vec![jstr("harmony")]), &dir, "0", &AuthCtx::default()).unwrap(), Json::Bool(true)));
    assert!(matches!(table.resolve("valid-namespace", &args(vec![jstr("Bad_NS")]), &dir, "0", &AuthCtx::default()).unwrap(), Json::Bool(false)));
    assert!(matches!(table.resolve("valid-key", &args(vec![jstr("tick.alive")]), &dir, "0", &AuthCtx::default()).unwrap(), Json::Bool(true)));
    assert!(matches!(table.resolve("valid-key", &args(vec![jstr("tick..bad")]), &dir, "0", &AuthCtx::default()).unwrap(), Json::Bool(false)));

    // parse-signal-value coercions.
    assert!(matches!(parse_signal_value(&dir, "0", &args(vec![jstr("true")]), &AuthCtx::default()).unwrap(), Json::Bool(true)));
    assert!(matches!(parse_signal_value(&dir, "0", &args(vec![jstr("42")]), &AuthCtx::default()).unwrap(), Json::Num(n) if n == 42.0));
    assert!(matches!(parse_signal_value(&dir, "0", &args(vec![jstr("hello")]), &AuthCtx::default()).unwrap(), Json::Str(s) if s == "hello"));

    // signal-field path.
    let f = signal_field(&dir, "0", &args(vec![jstr("harmony"), jstr("tick.alive")]), &AuthCtx::default()).unwrap();
    assert!(matches!(&f, Json::Str(s) if s == "qualities.world.harmony.tick.alive"));

    // signal-fact { field, value }.
    let block = signal_fact(&dir, "0", &args(vec![jstr("harmony"), jstr("tick"), jstr("on")]), &AuthCtx::default()).unwrap();
    assert_eq!(get_str(&block, "field"), Some("qualities.world.harmony.tick"));
    assert_eq!(get_str(&block, "value"), Some("on"));

    // story-root reads the planted root.
    let r = story_root(&dir, "0", &[], &AuthCtx::default()).unwrap();
    assert!(matches!(&r, Json::Str(s) if s == "root1"));
}

// ── dispatch table routes all the new ops ───────────────────────────────────────────────────────────
#[test]
fn part3_ops_route_through_table() {
    let dir = fresh("part3-table");
    plant_owned_space(&dir, "root1", "root", "space-root", "owner-be", 1.0);
    plant_matter_with_author(&dir, "mt1", "note", "root1", "author-be", None, 2.0);
    let table = Resolvers;

    for op in [
        "resolve-end-matter-spec", "resolve-config-set", "resolve-config-delete", "may-set-model",
        "resolve-model-block", "resolve-set-being-flow-spec", "validate-render-block",
        "resolve-containing-space", "valid-namespace", "valid-key", "parse-signal-value",
        "signal-field", "signal-fact", "story-root",
    ] {
        // each op name resolves to SOME arm (not the unknown-op fallback). We drive the simplest happy
        // arg set per op; the point is that the dispatch routes it (Ok or a typed gate, never "unknown").
        let r = table.resolve(op, &args(vec![target("matter", "mt1"), jstr("author-be"), Json::Null]), &dir, "0", &AuthCtx::caller("author-be"));
        if let Err(e) = &r {
            assert_ne!(e.message.contains("unknown see-op"), true, "op {op} hit the unknown-op fallback: {e:?}");
        }
    }
    // an unknown op still rejects.
    let err = table.resolve("resolve-nope", &[], &dir, "0", &AuthCtx::default()).unwrap_err();
    assert!(err.message.contains("unknown see-op"), "unknown op rejects");
}
