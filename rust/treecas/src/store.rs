// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The content-addressable byte store. Bytes live HERE; the chain holds facts
// ABOUT bytes. Port of seed/materials/matter/contentStore.js's filesystem core:
// putContent / getContent / hasContent / statContent / deleteContent /
// listHashes / streamContent, over the sharded cas/<hash[0..2]>/<hash> layout +
// the <hash>.meta.json sidecar.
//
// Byte-compatible with the JS on-disk layout so a Rust runtime and the JS share
// one CAS:
//   - same path:   cas/<hash[0..2]>/<hash> for the bytes, +".meta.json" sidecar
//   - same hash:   SHA-256 hex of the bytes (via treehash::sha256_hex)
//   - same meta:   JSON.stringify({ mimeType, size, name }) — insertion order,
//                  via treehash::stringify (the JS-faithful serializer). null
//                  name serializes as `"name":null`, exactly as the JS writes.
//
// Atomic writes: bytes land in a tmp file in the shard dir, then rename onto the
// final name (plus a dir fsync — the durability upgrade treestore made over the
// JS, RESULT-identical). A crash between a put and the fact that references it
// leaves an unreferenced blob; the retention sweeper's grace period owns those,
// the write path never deletes.
//
// Hash strings are validated EVERYWHERE (is_hash). That is also the
// path-traversal guard: a hash can never name a path outside its shard.

use std::fs;
use std::io::{self, Read};
use std::path::Path;

use treehash::{sha256_hex, stringify, Json};

use crate::durable::atomic_write;
use crate::util::{
    assert_hash, blob_path, cas_root, is_hash, is_shard, meta_path, unique_tmp, CasError,
};

/// The content metadata a put carries and a stat returns: the JS sidecar fields
/// `{ mimeType, size, name }` plus the original `encoding` hint (kept off-disk —
/// the JS sidecar never persists encoding, so neither do we; it only shapes the
/// returned ref). `name` is forensic-only (the original filename) and may be
/// absent.
#[derive(Debug, Clone, PartialEq)]
pub struct Meta {
    pub mime_type: String,
    pub name: Option<String>,
    /// `Some("utf8")` when the bytes are text; mirrors the JS encoding hint.
    pub encoding: Option<String>,
}

impl Meta {
    /// The JS putContent defaults: when no mimeType is given, text bytes
    /// (encoding "utf8") default to "text/plain; charset=utf-8", binary to
    /// "application/octet-stream".
    pub fn for_bytes(mime_type: Option<String>, name: Option<String>, encoding: Option<String>) -> Self {
        let mime_type = mime_type.unwrap_or_else(|| {
            if encoding.as_deref() == Some("utf8") {
                "text/plain; charset=utf-8".to_string()
            } else {
                "application/octet-stream".to_string()
            }
        });
        Meta { mime_type, name, encoding }
    }
}

/// The content ref a fact carries: `{ kind:"cas", hash, size, mimeType, name,
/// encoding }`. (The JS ref also carries an inline `preview`; that is a
/// descriptor convenience computed at put time and not part of the on-disk
/// layout — readers re-derive it. We return the structural ref the chain needs;
/// preview generation stays in JS for now. See NOTES.md.)
#[derive(Debug, Clone, PartialEq)]
pub struct ContentRef {
    pub hash: String,
    pub size: u64,
    pub mime_type: String,
    pub name: Option<String>,
    pub encoding: Option<String>,
}

/// The sidecar bytes: `JSON.stringify({ mimeType, size, name })`, insertion
/// order, via the JS-faithful serializer. This is the exact byte sequence the
/// JS putContent writes to <hash>.meta.json, so the two stores' sidecars are
/// interchangeable.
fn meta_json(mime_type: &str, size: u64, name: &Option<String>) -> String {
    let name_json = match name {
        Some(s) => Json::Str(s.clone()),
        None => Json::Null,
    };
    let obj = Json::Obj(vec![
        ("mimeType".to_string(), Json::Str(mime_type.to_string())),
        ("size".to_string(), Json::Num(size as f64)),
        ("name".to_string(), name_json),
    ]);
    stringify(&obj)
}

/// SHA-256 hex of the bytes — the content's address. (treehash::sha256_hex is
/// the same primitive the JS `hashOf` uses via crypto.createHash("sha256").)
pub fn hash_of(bytes: &[u8]) -> String {
    sha256_hex(bytes)
}

/// putContent: store `bytes`, return the content ref the fact carries.
/// Idempotent — identical bytes return the same ref WITHOUT a second write
/// (dedup is the hash doing its job). The blob is written atomically (tmp +
/// rename + dir fsync); the sidecar is first-put-wins (create_new — the first
/// writer's mimeType/name stick, later putters of the same bytes get the ref
/// fields they passed but the disk meta doesn't churn).
///
/// `root` is the localStore folder; bytes land at `<root>/cas/<hash[0..2]>/<hash>`.
pub fn put_content(root: &Path, bytes: &[u8], meta: &Meta) -> Result<ContentRef, CasError> {
    let hash = hash_of(bytes);
    let size = bytes.len() as u64;

    let ref_out = ContentRef {
        hash: hash.clone(),
        size,
        mime_type: meta.mime_type.clone(),
        name: meta.name.clone(),
        encoding: meta.encoding.clone(),
    };

    let target = blob_path(root, &hash);
    if target.exists() {
        return Ok(ref_out); // dedup hit — bytes already live here
    }

    let shard_dir = target.parent().expect("blob path always has a shard parent");
    fs::create_dir_all(shard_dir)?;

    let tmp = unique_tmp(shard_dir);
    match atomic_write(&target, &tmp, bytes) {
        Ok(()) => {}
        Err(err) => {
            // A concurrent put may have won the rename onto `target`. If the
            // blob now exists, that race is a success (same bytes, same hash);
            // otherwise propagate. Mirrors the JS rename catch.
            if !target.exists() {
                return Err(CasError::Io(err));
            }
        }
    }

    // Sidecar meta: first-put-wins. create_new refuses when it already exists;
    // a failure to write the sidecar is non-fatal (the JS `.catch(() => {})`) —
    // the bytes are what matter, statContent tolerates a missing sidecar.
    let meta_bytes = meta_json(&meta.mime_type, size, &meta.name);
    let meta_tmp = unique_tmp(shard_dir);
    let meta_target = meta_path(root, &hash);
    if !meta_target.exists() {
        let _ = atomic_write(&meta_target, &meta_tmp, meta_bytes.as_bytes());
    }

    Ok(ref_out)
}

/// getContent: raw bytes for a hash, VALIDATING that the stored bytes still
/// hash to the requested address (the CAS invariant — a corrupt or swapped blob
/// is rejected, not silently returned). `Ok(None)` when the blob is absent
/// (purged / GC'd / unknown), as the JS returns null on ENOENT. A hash mismatch
/// is a `CasError::BadHash` carrying the requested hash (the integrity failure).
///
/// NOTE: the JS getContent does NOT re-hash on read (it trusts the path = the
/// hash). The Rust port ADDS read-validation per the port spec ("get VALIDATES
/// the hash matches, else error"); this is a strict superset — a store the JS
/// wrote correctly always passes, and a tampered blob now fails loudly.
pub fn get_content(root: &Path, hash: &str) -> Result<Option<Vec<u8>>, CasError> {
    assert_hash(hash)?;
    let bytes = match fs::read(blob_path(root, hash)) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(CasError::Io(e)),
    };
    let actual = hash_of(&bytes);
    if actual != hash {
        // The stored bytes do not match their address: corruption / tamper.
        return Err(CasError::BadHash(hash.to_string()));
    }
    Ok(Some(bytes))
}

/// hasContent: does the blob exist? Validates the hash first (path-traversal
/// guard). Does not read the bytes (no integrity check — `get_content` does
/// that); this is the cheap presence probe the JS `hasContent` is.
pub fn has_content(root: &Path, hash: &str) -> Result<bool, CasError> {
    assert_hash(hash)?;
    Ok(blob_path(root, hash).exists())
}

/// What statContent returns: `{ size, mime_type, name }` from the sidecar + the
/// file size from the filesystem. `None` when the blob is absent. The sidecar is
/// optional — a missing/corrupt sidecar yields the JS defaults
/// (mimeType "application/octet-stream", name null) but the real on-disk size.
#[derive(Debug, Clone, PartialEq)]
pub struct Stat {
    pub size: u64,
    pub mime_type: String,
    pub name: Option<String>,
}

/// statContent: `{ size, mimeType, name }` from sidecar + stat, or None when
/// absent. (The JS also returns `mtimeMs`; the sweep gets that separately via
/// `list_hashes` as a sweep input, and the port keeps the store clock-free, so
/// `Stat` carries no wall-clock field. See NOTES.md.)
pub fn stat_content(root: &Path, hash: &str) -> Result<Option<Stat>, CasError> {
    assert_hash(hash)?;
    let md = match fs::metadata(blob_path(root, hash)) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(CasError::Io(e)),
    };
    let size = md.len();
    let (mut mime_type, mut name) = ("application/octet-stream".to_string(), None);
    if let Ok(text) = fs::read_to_string(meta_path(root, hash)) {
        if let Ok(Json::Obj(entries)) = treehash::parse(&text) {
            for (k, v) in &entries {
                match (k.as_str(), v) {
                    ("mimeType", Json::Str(s)) => mime_type = s.clone(),
                    ("name", Json::Str(s)) => name = Some(s.clone()),
                    _ => {}
                }
            }
        }
    }
    Ok(Some(Stat { size, mime_type, name }))
}

/// deleteContent: physically remove a blob (purge op / retention sweep). A
/// missing blob is fine (purge is idempotent). The sidecar is removed too
/// (best effort). Returns whether the blob itself was present and removed. The
/// chain's facts referencing the hash remain — only the bytes go.
pub fn delete_content(root: &Path, hash: &str) -> Result<bool, CasError> {
    assert_hash(hash)?;
    let removed = match fs::remove_file(blob_path(root, hash)) {
        Ok(()) => true,
        Err(e) if e.kind() == io::ErrorKind::NotFound => false,
        Err(e) => return Err(CasError::Io(e)),
    };
    let _ = fs::remove_file(meta_path(root, hash));
    Ok(removed)
}

/// One entry the sweeper's walk yields: the hash, the byte size, and the file's
/// modified time as a UNIX-millis value. The mtime is the ONLY clock the CAS
/// touches, and it is read straight from the filesystem (an OS file property,
/// not a world clock) — it exists so the sweep's grace check can spare a fresh
/// blob whose fact hasn't sealed. Mirrors the JS listHashes yield
/// `{ hash, size, mtimeMs }`.
#[derive(Debug, Clone, PartialEq)]
pub struct HashEntry {
    pub hash: String,
    pub size: u64,
    pub mtime_ms: f64,
}

fn mtime_ms(md: &fs::Metadata) -> f64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// The sweep's TOCTOU re-check: re-read a blob's `(size, mtime_ms)` straight
/// from the filesystem, or None if it vanished. The public `Stat` is clock-free
/// by design (no mtime field), so the sweep — which DOES need the mtime to
/// detect a concurrent re-put, exactly as the JS re-stat does — uses this
/// internal probe instead. Not part of the public API.
pub(crate) fn restat_mtime(root: &Path, hash: &str) -> Result<Option<(u64, f64)>, CasError> {
    assert_hash(hash)?;
    match fs::metadata(blob_path(root, hash)) {
        Ok(md) => Ok(Some((md.len(), mtime_ms(&md)))),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(CasError::Io(e)),
    }
}

/// listHashes: every stored hash with its size + mtime (the retention sweeper's
/// walk). Tmp files and `.meta.json` sidecars are skipped; only entries whose
/// name is a valid 64-hex hash in a valid two-hex shard are yielded. Returns a
/// Vec (the JS is an async generator; the Rust port materializes the list — the
/// sweep iterates it once). Order follows the filesystem's readdir order, which
/// the sweep does not depend on.
pub fn list_hashes(root: &Path) -> Result<Vec<HashEntry>, CasError> {
    let mut out = Vec::new();
    let root_dir = cas_root(root);
    let shards = match fs::read_dir(&root_dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(CasError::Io(e)),
    };
    for shard_ent in shards {
        let shard_ent = match shard_ent {
            Ok(e) => e,
            Err(_) => continue,
        };
        let shard_name = shard_ent.file_name();
        let shard_str = match shard_name.to_str() {
            Some(s) => s,
            None => continue,
        };
        if !is_shard(shard_str) {
            continue;
        }
        let entries = match fs::read_dir(shard_ent.path()) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for ent in entries {
            let ent = match ent {
                Ok(e) => e,
                Err(_) => continue,
            };
            let name = ent.file_name();
            let name_str = match name.to_str() {
                Some(s) => s,
                None => continue,
            };
            if !is_hash(name_str) {
                continue; // tmp-*, *.meta.json, anything not a bare hash
            }
            match ent.metadata() {
                Ok(md) => out.push(HashEntry {
                    hash: name_str.to_string(),
                    size: md.len(),
                    mtime_ms: mtime_ms(&md),
                }),
                Err(_) => continue, // raced a delete; skip
            }
        }
    }
    Ok(out)
}

/// A chunked reader over a blob — the std-only equivalent of the JS
/// `streamContent` (which returns a Node createReadStream for the HTTP serving
/// route). `read_content` opens the blob and, for each `chunk_size` slice of
/// bytes, invokes `sink`; it stops early if `sink` returns `Err`. Returns
/// `Ok(false)` when the blob is absent (the JS stream returns null), `Ok(true)`
/// when the whole blob streamed.
///
/// This does NOT re-hash (a stream is for serving bytes, like the JS); use
/// `get_content` when you need the integrity check.
pub fn read_content<F>(
    root: &Path,
    hash: &str,
    chunk_size: usize,
    mut sink: F,
) -> Result<bool, CasError>
where
    F: FnMut(&[u8]) -> io::Result<()>,
{
    assert_hash(hash)?;
    let chunk_size = chunk_size.max(1);
    let mut file = match fs::File::open(blob_path(root, hash)) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(CasError::Io(e)),
    };
    let mut buf = vec![0u8; chunk_size];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        sink(&buf[..n])?;
    }
    Ok(true)
}
