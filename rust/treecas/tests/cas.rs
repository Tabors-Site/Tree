// treecas end-to-end on the real filesystem: the CAS content-byte store, the
// sweep mechanics (ref-set as input), and disk-file anchor. No JS — this proves
// the Rust CAS works on its own; the byte-compat assertions (the exact sharded
// path, the SHA-256 hash value, the .meta.json sidecar bytes) pin it to the JS
// on-disk layout so the two runtimes share one store.
//
// Ports the behaviors of seed/materials/matter/{contentStore,casSweep,anchor}.js.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use treecas::{
    anchor, delete_content, get_content, has_content, list_hashes, put_content, read_content,
    stat_content, sweep, CasError, Meta,
};

// A fresh, unique scratch root per test (std only — no tempfile crate). Cleaned
// at the end of each test. Uniqueness via pid + a per-process counter so
// parallel test threads never share a root.
fn fresh_root(tag: &str) -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let p = std::env::temp_dir().join(format!("treecas-test-{}-{}-{}", tag, std::process::id(), n));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(&p).expect("mk root");
    p
}

fn text_meta() -> Meta {
    Meta::for_bytes(None, None, Some("utf8".to_string()))
}

// cas/<hash[0..2]>/<hash> — the exact byte-compatible path.
fn blob_path(root: &Path, hash: &str) -> PathBuf {
    root.join("cas").join(&hash[0..2]).join(hash)
}

#[test]
fn put_get_roundtrips_exact_bytes_and_dedups() {
    let root = fresh_root("roundtrip");
    let bytes = b"hello world";

    let r = put_content(&root, bytes, &text_meta()).expect("put");
    // Byte-compat: the hash IS the SHA-256 hex of the bytes (pinned literal).
    assert_eq!(
        r.hash, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        "hash must be the SHA-256 hex of the bytes (shared with JS hashOf)"
    );
    assert_eq!(r.size, 11);
    assert_eq!(r.mime_type, "text/plain; charset=utf-8");

    // get round-trips the EXACT bytes.
    let got = get_content(&root, &r.hash).expect("get").expect("present");
    assert_eq!(got, bytes, "get must return the exact bytes put");

    // Idempotent: a second put of identical bytes returns the same ref, no churn.
    let r2 = put_content(&root, bytes, &text_meta()).expect("put again");
    assert_eq!(r2.hash, r.hash, "dedup: same bytes -> same hash");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn stored_path_is_cas_shard_hash_with_sidecar() {
    let root = fresh_root("path");
    let bytes = b"hello world";
    let r = put_content(&root, bytes, &text_meta()).expect("put");

    // The bytes live at cas/<shard>/<hash> exactly.
    let blob = blob_path(&root, &r.hash);
    assert!(blob.is_file(), "blob must be at cas/<shard>/<hash>: {:?}", blob);
    assert_eq!(blob.parent().unwrap().file_name().unwrap(), &r.hash[0..2]);
    assert_eq!(fs::read(&blob).unwrap(), bytes, "on-disk blob = the bytes");

    // The sidecar is <hash>.meta.json and its bytes equal JS
    // JSON.stringify({ mimeType, size, name }) exactly (byte-compat).
    let mut meta_p = blob.clone().into_os_string();
    meta_p.push(".meta.json");
    let meta_text = fs::read_to_string(PathBuf::from(meta_p)).expect("sidecar present");
    assert_eq!(
        meta_text, r#"{"mimeType":"text/plain; charset=utf-8","size":11,"name":null}"#,
        "sidecar bytes must match JS JSON.stringify order/format"
    );

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn get_validates_hash_and_rejects_corruption() {
    let root = fresh_root("validate");
    let bytes = b"the cas validates its bytes on read";
    let r = put_content(&root, bytes, &text_meta()).expect("put");

    // A clean read validates and returns the bytes.
    assert!(get_content(&root, &r.hash).expect("get").is_some());

    // Corrupt the stored blob in place — its bytes no longer hash to the address.
    let blob = blob_path(&root, &r.hash);
    fs::write(&blob, b"tampered bytes that do not match the hash").expect("corrupt");

    // get must now ERROR (the integrity check trips), not silently return.
    match get_content(&root, &r.hash) {
        Err(CasError::BadHash(_)) => {} // expected: hash mismatch
        Err(other) => panic!("expected BadHash on corruption, got {:?}", other),
        Ok(_) => panic!("get must reject a corrupted blob, not return it"),
    }

    // A malformed hash string is rejected up front (path-traversal guard).
    assert!(matches!(get_content(&root, "../etc/passwd"), Err(CasError::BadHash(_))));
    assert!(matches!(get_content(&root, "NOTHEX"), Err(CasError::BadHash(_))));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn has_stat_list_delete() {
    let root = fresh_root("hsld");
    let bytes = b"stat me";
    let r = put_content(
        &root,
        bytes,
        &Meta {
            mime_type: "text/plain; charset=utf-8".to_string(),
            name: Some("note.txt".to_string()),
            encoding: Some("utf8".to_string()),
        },
    )
    .expect("put");

    // has
    assert!(has_content(&root, &r.hash).expect("has"), "present hash -> true");
    let absent = "0".repeat(64);
    assert!(!has_content(&root, &absent).expect("has-absent"), "absent hash -> false");

    // stat: size + mimeType + name from the sidecar
    let st = stat_content(&root, &r.hash).expect("stat").expect("present");
    assert_eq!(st.size, bytes.len() as u64);
    assert_eq!(st.mime_type, "text/plain; charset=utf-8");
    assert_eq!(st.name.as_deref(), Some("note.txt"));
    assert!(stat_content(&root, &absent).expect("stat-absent").is_none());

    // list: the one hash we stored shows up (sidecars + tmp skipped)
    let listed = list_hashes(&root).expect("list");
    assert!(listed.iter().any(|e| e.hash == r.hash && e.size == bytes.len() as u64));
    assert!(
        listed.iter().all(|e| e.hash.len() == 64),
        "list yields only bare hashes, never sidecars/tmp"
    );

    // read_content: chunked stream reassembles the exact bytes
    let mut acc = Vec::new();
    let streamed = read_content(&root, &r.hash, 3, |chunk| {
        acc.extend_from_slice(chunk);
        Ok(())
    })
    .expect("read_content");
    assert!(streamed, "stream of a present blob returns true");
    assert_eq!(acc, bytes, "chunked read reassembles the exact bytes");

    // delete: removes the blob (and sidecar), idempotent on a second call
    assert!(delete_content(&root, &r.hash).expect("delete") == true, "first delete removes it");
    assert!(!has_content(&root, &r.hash).expect("has-after-delete"), "gone after delete");
    assert!(
        !blob_path(&root, &r.hash).with_extension("meta.json").exists()
            || !{
                let mut m = blob_path(&root, &r.hash).into_os_string();
                m.push(".meta.json");
                PathBuf::from(m).exists()
            },
        "sidecar removed on delete"
    );
    assert!(delete_content(&root, &r.hash).expect("delete-again") == false, "second delete is a no-op");

    // get of a purged blob returns None (not an error)
    assert!(get_content(&root, &r.hash).expect("get-purged").is_none());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn anchor_ingests_a_disk_file() {
    let root = fresh_root("anchor");

    // A source file on disk (outside the CAS).
    let src_dir = fresh_root("anchor-src");
    let src = src_dir.join("greeting.txt");
    fs::write(&src, b"hello world").expect("write src");

    // anchor reads it into the CAS and returns the hash.
    let hash = anchor(&root, &src).expect("anchor");
    assert_eq!(
        hash, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        "anchored hash = SHA-256 of the file bytes"
    );

    // The bytes are now in the CAS and round-trip.
    let got = get_content(&root, &hash).expect("get").expect("present");
    assert_eq!(got, b"hello world");

    // The mime + name came from the filename (txt -> text/plain, name preserved).
    let st = stat_content(&root, &hash).expect("stat").expect("present");
    assert_eq!(st.mime_type, "text/plain; charset=utf-8");
    assert_eq!(st.name.as_deref(), Some("greeting.txt"));

    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&src_dir);
}

#[test]
fn sweep_deletes_unreferenced_keeps_referenced_and_respects_grace() {
    let root = fresh_root("sweep");

    // Two blobs: one will be referenced, one will not.
    let keep = put_content(&root, b"referenced bytes -- keep me", &text_meta()).expect("put keep");
    let drop = put_content(&root, b"orphaned bytes -- reclaim me", &text_meta()).expect("put drop");

    // Reference set (the INPUT — what the JS would derive from the chain): only
    // the keep hash is referenced.
    let mut referenced: HashSet<String> = HashSet::new();
    referenced.insert(keep.hash.clone());

    // Make both blobs "old" by back-dating the sweep's `now_ms` far past their
    // mtime so grace does not spare them. We read each blob's mtime via the
    // listing and choose now = max(mtime) + a large margin, grace = 0.
    let entries = list_hashes(&root).expect("list");
    let max_mtime = entries.iter().map(|e| e.mtime_ms).fold(0.0_f64, f64::max);

    // --- grace spares everything when now is at/just-after the mtime ---
    // now == max_mtime, grace == 1 hour: every blob is "younger than grace", so
    // NOTHING is deleted even though `drop` is unreferenced.
    let one_hour_ms = 60.0 * 60.0 * 1000.0;
    let spared = sweep(&root, &referenced, max_mtime, one_hour_ms, 1000).expect("sweep grace");
    assert_eq!(spared.deleted, 0, "grace must spare a fresh unreferenced blob");
    assert!(has_content(&root, &drop.hash).expect("has drop"), "drop still present under grace");

    // --- past the grace window: the unreferenced blob is reclaimed ---
    // now = mtime + 2h, grace = 1h -> both blobs are older than grace, so the
    // unreferenced `drop` is deleted and the referenced `keep` is NOT.
    let now = max_mtime + 2.0 * one_hour_ms;
    let res = sweep(&root, &referenced, now, one_hour_ms, 1000).expect("sweep");
    assert_eq!(res.deleted, 1, "exactly the one unreferenced blob is reclaimed");
    assert_eq!(res.deleted_hashes, vec![drop.hash.clone()], "the reclaimed hash is `drop`");
    assert!(res.freed_bytes > 0, "freed bytes accounted");

    // keep survives (it was referenced); drop is gone.
    assert!(has_content(&root, &keep.hash).expect("has keep"), "referenced blob kept");
    assert!(!has_content(&root, &drop.hash).expect("has drop after"), "unreferenced blob reclaimed");

    // The keep blob still round-trips after the sweep.
    assert_eq!(
        get_content(&root, &keep.hash).expect("get keep").expect("present"),
        b"referenced bytes -- keep me"
    );

    // A re-sweep now deletes nothing (the only orphan is already gone).
    let again = sweep(&root, &referenced, now, one_hour_ms, 1000).expect("re-sweep");
    assert_eq!(again.deleted, 0, "idempotent: nothing left to reclaim");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn sweep_per_cycle_cap_limits_deletions() {
    let root = fresh_root("cap");

    // Three unreferenced blobs.
    let h1 = put_content(&root, b"orphan one", &text_meta()).expect("p1").hash;
    let h2 = put_content(&root, b"orphan two", &text_meta()).expect("p2").hash;
    let h3 = put_content(&root, b"orphan three", &text_meta()).expect("p3").hash;
    let empty: HashSet<String> = HashSet::new();

    let entries = list_hashes(&root).expect("list");
    let max_mtime = entries.iter().map(|e| e.mtime_ms).fold(0.0_f64, f64::max);
    let now = max_mtime + 10.0 * 60.0 * 60.0 * 1000.0; // well past grace
    let grace = 0.0;

    // Cap at 2: only two reclaimed this cycle, `capped` flagged.
    let first = sweep(&root, &empty, now, grace, 2).expect("capped sweep");
    assert_eq!(first.deleted, 2, "cap limits this cycle to 2 deletions");
    assert!(first.capped, "cap reached -> capped flag set");

    // The next cycle reclaims the remaining one.
    let second = sweep(&root, &empty, now, grace, 2).expect("next sweep");
    assert_eq!(second.deleted, 1, "remaining orphan reclaimed next cycle");
    assert!(!second.capped, "nothing left -> not capped");

    // All three are gone now.
    for h in [&h1, &h2, &h3] {
        assert!(!has_content(&root, h).expect("has"), "all orphans reclaimed across cycles");
    }

    let _ = fs::remove_dir_all(&root);
}
