// The storage floor, end-to-end on the real filesystem (the "own OS" layer): stamp a chain of facts,
// write each with write_fact_doc (durable append + fsync = the stamp), read the reel back, verify the
// on-disk chain with treeverify, check the .head pointer, and confirm replay idempotency. No JS — this
// proves the Rust store works on its own; stamp_vectors.rs proves its bytes equal the JS store's.

use treestore::{
    canonicalize, compute_fact_doc, read_reel_file, read_reel_head, verify_fact_chain, write_fact_doc,
    Head, Json,
};

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn spec(n: f64) -> Json {
    Json::Obj(vec![
        ("through".to_string(), jstr("beRT")),
        ("verb".to_string(), jstr("do")),
        ("act".to_string(), jstr("set-being")),
        (
            "of".to_string(),
            Json::Obj(vec![("kind".to_string(), jstr("being")), ("id".to_string(), jstr("beRT"))]),
        ),
        (
            "params".to_string(),
            Json::Obj(vec![("field".to_string(), jstr("n")), ("value".to_string(), Json::Num(n))]),
        ),
    ])
}
fn verdict_ok(v: &Json) -> bool {
    matches!(v, Json::Obj(e) if e.iter().any(|(k, x)| k == "ok" && matches!(x, Json::Bool(true))))
}

#[test]
fn store_roundtrip_write_read_verify_replay() {
    let dir = std::env::temp_dir().join("treestore-roundtrip-test");
    let _ = std::fs::remove_dir_all(&dir);

    // Stamp + write a 4-fact chain on (history "0", being, "beRT").
    let mut head = Head::genesis();
    let mut docs: Vec<Json> = Vec::new();
    for i in 1..=4u32 {
        let stamped = compute_fact_doc("0", &spec(i as f64), &head, Some(100.0 + i as f64));
        let w = write_fact_doc(&dir, "0", "being", "beRT", &stamped.doc).expect("write_fact_doc");
        assert!(!w.replayed, "fresh append should not be a replay (fact {i})");
        assert_eq!(w.seq, i as f64, "seq advances 1..N");
        docs.push(stamped.doc.clone());
        head = stamped.next_head;
    }

    // Read the reel back off disk.
    let facts = read_reel_file(&dir, "0", "being", "beRT", None, None);
    assert_eq!(facts.len(), 4, "all four facts read back");

    // The on-disk chain verifies (treeverify, on bytes Rust itself wrote).
    let verdict = verify_fact_chain(&facts);
    assert!(verdict_ok(&verdict), "on-disk chain failed verify: {}", canonicalize(&verdict));

    // The .head pointer landed at the chain tip.
    let h = read_reel_head(&dir, "0", "being", "beRT");
    assert_eq!(h.head, 4.0, ".head seq counter at the tip");
    assert_eq!(h.head_hash, head.head_hash, ".head root hash = the last fact's _id");

    // Seq-range read: after=2 keeps seq 3,4.
    let tail = read_reel_file(&dir, "0", "being", "beRT", Some(2.0), None);
    assert_eq!(tail.len(), 2, "after=2 -> seq 3,4");

    // Idempotent replay: re-writing an already-landed doc (seq <= head) is a no-op, no growth.
    let replay = write_fact_doc(&dir, "0", "being", "beRT", &docs[0]).expect("replay write");
    assert!(replay.replayed, "re-writing fact #1 (seq 1, head at 4) must be a replay");
    assert_eq!(
        read_reel_file(&dir, "0", "being", "beRT", None, None).len(),
        4,
        "replay must not grow the reel",
    );

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treestore fs round-trip: stamp -> append+fsync -> read -> verify -> head -> replay  OK");
}
