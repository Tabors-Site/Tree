// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Durable atomic write: bytes -> tmp in the same dir -> fsync the tmp ->
// rename onto the final name -> fsync the dir. Mirrors treestore/src/store.rs's
// durable-write discipline (fsync the file AND its directory so a fsync'd file
// in an un-fsync'd dir cannot vanish on a crash).
//
// The JS contentStore writes are atomic by tmp + fs.rename; the Rust store goes
// one further with the fsync pair (the same upgrade treestore made over the JS
// fileStore). The on-disk RESULT is identical: a fully-written file at the final
// path, or nothing — the fsyncs change durability, not bytes.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

/// Best-effort directory fsync (a fsync'd file in an un-fsync'd dir can vanish
/// on some filesystems). On Unix we open the dir as a File and sync_all;
/// elsewhere the file sync already ran, so this is a no-op. Copied from
/// treestore/src/store.rs `sync_dir`.
pub fn sync_dir(dir: &Path) {
    if let Ok(f) = fs::File::open(dir) {
        let _ = f.sync_all();
    }
}

/// Atomically place `bytes` at `target`:
///   1. write to a sibling tmp file (`tmp_path`, in the same dir so rename is
///      atomic — same filesystem),
///   2. fsync the tmp file's contents,
///   3. rename tmp -> target (atomic replace on POSIX),
///   4. fsync the target's directory so the rename is durable.
///
/// The dir is assumed to exist already (the caller mkdir -p's the shard). On any
/// error the tmp file is removed (best effort), so a failed write leaves no
/// orphan tmp behind.
pub fn atomic_write(target: &Path, tmp_path: &Path, bytes: &[u8]) -> io::Result<()> {
    let res = (|| {
        let mut f = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(tmp_path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        // drop f before rename
        drop(f);
        fs::rename(tmp_path, target)?;
        if let Some(parent) = target.parent() {
            sync_dir(parent);
        }
        Ok(())
    })();
    if res.is_err() {
        let _ = fs::remove_file(tmp_path);
    }
    res
}
