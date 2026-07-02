// treeproj: refold caches the projection. Rust stamps a being reel (treestore, the same stamp path as
// treefold's write-half), then refold reads it, folds it (treefold), and writes the .proj snapshot —
// the read-side cache, derived with no Node. The foldedSeq CAS guards a stale concurrent refold.

use treeproj::{canonicalize, folded_seq, load_snapshot, refold, save_snapshot, Json};
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

fn birth(name: &str) -> Json {
    obj(vec![
        ("through", jstr("i-am")),
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("name", jstr(name)), ("homeSpace", jstr("sp1"))])),
    ])
}
fn rename(name: &str) -> Json {
    obj(vec![
        ("through", jstr("be1")),
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("field", jstr("name")), ("value", jstr(name))])),
    ])
}

#[test]
fn refold_caches_the_projection_and_cas_guards_it() {
    let dir = std::env::temp_dir().join("treeproj-refold");
    let _ = std::fs::remove_dir_all(&dir);

    // Rust stamps a being reel: birth @Alice (seq 1), rename (seq 2).
    stamp(&dir, "being", "be1", &birth("Alice"), 1.0);
    stamp(&dir, "being", "be1", &rename("Alice-2"), 2.0);

    // refold: read the reel -> fold -> cache the .proj snapshot.
    let slot = refold(&dir, "0", "being", "be1").expect("refold");

    // The snapshot persisted: reload it and confirm it matches what refold returned.
    let loaded = load_snapshot(&dir, "0", "being", "be1").expect("snapshot on disk");
    assert_eq!(canonicalize(&loaded), canonicalize(&slot), "loaded snapshot == refold output");
    assert_eq!(folded_seq(&loaded), Some(2.0), "foldedSeq = the reel tip");

    // The cached state IS the folded projection (the rename won over the birth).
    let state = get(&loaded, "state").expect("state in slot");
    assert_eq!(sval(state, "name"), "Alice-2", "the cache holds the folded projection");

    // CAS: a stale refold (expects foldedSeq 1, on-disk is 2) is refused — the higher fold stands.
    let stale = obj(vec![("state", obj(vec![])), ("foldedSeq", Json::Num(1.0))]);
    assert!(
        !save_snapshot(&dir, "0", "being", "be1", &stale, Some(1.0)).expect("cas write"),
        "stale fold (expected 1, on-disk 2) must lose the CAS"
    );
    let after = load_snapshot(&dir, "0", "being", "be1").expect("still on disk");
    assert_eq!(
        sval(get(&after, "state").expect("state"), "name"),
        "Alice-2",
        "the CAS-refused write left the cache intact"
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treeproj: stamp -> refold(read+fold) -> .proj cache; foldedSeq CAS guards a stale fold  OK (no Node)");
}
