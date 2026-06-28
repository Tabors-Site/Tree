// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treecas — the CAS CONTENT-BYTE STORE. Matter's content bytes (text and binary
// alike) addressed by what they ARE: the SHA-256 of their bytes. The chain holds
// facts ABOUT bytes (a content ref `{ kind:"cas", hash, size, mimeType, name,
// encoding }`); the bytes themselves live HERE. Identical bytes from a hundred
// writes store once (same hash, same file); an edit makes a new hash, the old
// version's bytes stay until the retention sweep or an explicit purge removes
// them.
//
// This is the single biggest materials gap the rest of the port deferred:
// treestore is the chain floor (reels + the stamp), but it explicitly leaves the
// CAS content store to a later phase — this crate IS that phase.
//
// Ports three live JS modules (which stay LIVE in JS; they delete only at the
// JS-runtime cutover — see NOTES.md):
//   seed/materials/matter/contentStore.js -> store.rs (put/get/has/stat/delete/
//                                             list/read)
//   seed/materials/matter/casSweep.js     -> sweep.rs (the sweep MECHANICS; the
//                                             reference set is an INPUT, not
//                                             re-derived — the chain scan stays
//                                             in JS)
//   seed/materials/matter/anchor.js       -> anchor.rs (disk -> CAS ingestion)
//
// Byte-compatible on-disk layout so a Rust runtime and the JS share ONE CAS:
//   <root>/cas/<hash[0..2]>/<hash>            the bytes
//   <root>/cas/<hash[0..2]>/<hash>.meta.json  { mimeType, size, name }
// same hash (SHA-256 hex via treehash), same sidecar bytes (JSON.stringify order
// via treehash::stringify), same atomic tmp+rename write (plus a dir fsync — the
// durability upgrade treestore made over the JS, RESULT-identical).
//
// Dependencies: treehash (SHA-256 + the JS-faithful JSON serializer) + std. No
// other crates; the CAS is a byte store on the filesystem.

mod anchor;
mod durable;
mod store;
mod sweep;
mod util;

// ── content store (contentStore.js) ─────────────────────────────────────────
pub use store::{
    delete_content, get_content, has_content, hash_of, list_hashes, put_content, read_content,
    stat_content, ContentRef, HashEntry, Meta, Stat,
};

// ── retention sweep (casSweep.js — ref-set is an input) ─────────────────────
pub use sweep::{sweep, sweep_entries, SweepResult};

// ── anchor (anchor.js — disk -> CAS) ────────────────────────────────────────
pub use anchor::{anchor, anchor_ref, is_text_mime, mime_from_name};

// ── hash validation + errors ────────────────────────────────────────────────
pub use util::{assert_hash, is_hash, CasError};

// Re-export the SHA-256 primitive so callers can address bytes without pulling
// treehash directly (the CAS hash IS this).
pub use treehash::sha256_hex;
