// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Shared furniture for the CAS: the hash validator (the path-traversal guard),
// the sharded blob/meta paths, and a unique tmp-file name for the atomic write.
//
// Ports the constants + helpers contentStore.js keeps at the top of the file:
//   HASH_RE = /^[0-9a-f]{64}$/   -> is_hash / assert_hash
//   blobPath(hash) = cas/<hash[0..2]>/<hash>
//   metaPath(hash) = blobPath(hash) + ".meta.json"
//   tmp-${randomUUID()}          -> unique_tmp (the rename source)

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// The CAS error surface. A CAS op fails for exactly two reasons: a malformed
/// hash (the path-traversal guard tripped) or an I/O fault from std::fs. Kept a
/// plain enum so callers can match without pulling an error crate (std only).
#[derive(Debug)]
pub enum CasError {
    /// The hash string was not 64 lowercase hex chars. Carries the offending
    /// value (clamped) for the message, mirroring JS `assertHash`.
    BadHash(String),
    /// An underlying filesystem error (read/write/rename/stat/mkdir).
    Io(std::io::Error),
}

impl std::fmt::Display for CasError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CasError::BadHash(h) => write!(f, "treecas: invalid content hash \"{}\"", h),
            CasError::Io(e) => write!(f, "treecas: io error: {}", e),
        }
    }
}

impl std::error::Error for CasError {}

impl From<std::io::Error> for CasError {
    fn from(e: std::io::Error) -> Self {
        CasError::Io(e)
    }
}

/// `HASH_RE.test(value)` — exactly 64 lowercase hex chars. This is also the
/// path-traversal guard: a value that passes can never name a path outside its
/// two-char shard (no `/`, no `.`, no `..`).
pub fn is_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// contentStore.js `assertHash`: validate or error (clamping the message to the
/// first 80 chars of the bad value, as the JS does).
pub fn assert_hash(hash: &str) -> Result<(), CasError> {
    if is_hash(hash) {
        Ok(())
    } else {
        let clamped: String = hash.chars().take(80).collect();
        Err(CasError::BadHash(clamped))
    }
}

/// The CAS root: `<root>/cas`. The `root` passed in is the localStore folder
/// (JS `localStoreFolder`); contentStore.js joins `cas` onto it for `CAS_ROOT`.
pub fn cas_root(root: &Path) -> PathBuf {
    root.join("cas")
}

/// `blobPath(hash)` = `<root>/cas/<hash[0..2]>/<hash>`. Caller has validated.
pub fn blob_path(root: &Path, hash: &str) -> PathBuf {
    cas_root(root).join(&hash[0..2]).join(hash)
}

/// `metaPath(hash)` = `blobPath(hash) + ".meta.json"`.
pub fn meta_path(root: &Path, hash: &str) -> PathBuf {
    let mut p = blob_path(root, hash).into_os_string();
    p.push(".meta.json");
    PathBuf::from(p)
}

/// Is this directory name a valid two-hex shard? (`/^[0-9a-f]{2}$/`.) Mirrors
/// the listHashes shard filter.
pub fn is_shard(name: &str) -> bool {
    name.len() == 2 && name.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A unique tmp filename for the atomic write, the std-only stand-in for JS
/// `tmp-${randomUUID()}`. It does not need to be a UUID — only unique within
/// the shard dir for the lifetime of one put. We combine a per-process counter
/// with the nanosecond clock and the pid so concurrent puts never collide.
///
/// NOTE: the clock here is a UNIQUENESS seed only (a tmp name that gets
/// renamed away immediately); it is NOT an ordering input and never reaches a
/// fact or the sweep. The store stays clock-free in every observable byte.
pub fn unique_tmp(shard_dir: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    shard_dir.join(format!("tmp-{pid}-{nanos}-{n}"))
}
