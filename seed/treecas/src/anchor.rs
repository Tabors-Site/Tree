// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// CAS anchor primitive — disk -> CAS ingestion. Port of seed/materials/matter/
// anchor.js's `anchorFile`: read the bytes on disk, derive the mime from the
// filename, put them into the CAS, return the ref. Anchoring is one-way (disk ->
// CAS); the mirror's read path is the inverse direction off the same store.
//
// The JS anchor.js takes `putContent` as an injected dependency (so it is usable
// before the seed fully boots). In the Rust crate the store is a sibling module,
// so `anchor` calls `put_content` directly — same effect, fewer moving parts.
//
// mimeFromName / isTextMime are ported so an anchored file gets the same
// mimeType + encoding hint the JS would assign, keeping the resulting CAS ref
// (and thus the sidecar) identical across the two runtimes.

use std::fs;
use std::path::Path;

use crate::store::{put_content, ContentRef, Meta};
use crate::util::CasError;

/// `MIME_BY_EXT` from anchor.js: the extension -> mimeType table. Anything not
/// listed falls through to "application/octet-stream".
fn mime_by_ext(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "js" | "mjs" | "cjs" => "application/javascript",
        "json" => "application/json",
        "md" => "text/markdown; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "fbx" => "application/octet-stream",
        _ => return None,
    })
}

/// anchor.js `mimeFromName`: the mime from a filename's extension, or
/// "application/octet-stream" when there is no recognized extension.
pub fn mime_from_name(name: &str) -> String {
    match name.rfind('.') {
        None => "application/octet-stream".to_string(),
        Some(dot) => {
            let ext = name[dot + 1..].to_ascii_lowercase();
            mime_by_ext(&ext).unwrap_or("application/octet-stream").to_string()
        }
    }
}

/// anchor.js `isTextMime`: is this a text-ish mime (so the bytes get the "utf8"
/// encoding hint)? text/*, plus the named application/model exceptions.
pub fn is_text_mime(mime: &str) -> bool {
    mime.starts_with("text/")
        || mime == "application/javascript"
        || mime == "application/json"
        || mime == "application/yaml"
        || mime == "application/toml"
        || mime == "model/gltf+json"
        || mime == "image/svg+xml"
}

/// anchor(root, src_path) -> hash. Ingest one disk file into the CAS: read its
/// bytes, derive the mime + encoding from its filename, put it into the store at
/// `root`, return the content hash. The original filename (the file's last path
/// component) is recorded as the ref/sidecar `name`, as the JS `anchorFile`
/// passes `relName`.
///
/// Returns the hash directly (the port spec's `anchor -> hash`); use
/// `anchor_ref` when you want the full ref (size + mimeType too).
pub fn anchor(root: &Path, src_path: &Path) -> Result<String, CasError> {
    Ok(anchor_ref(root, src_path)?.hash)
}

/// anchor, returning the full content ref the put produced (the JS `anchorFile`
/// returns `{ hash, size, mimeType }`; this returns the complete ContentRef).
pub fn anchor_ref(root: &Path, src_path: &Path) -> Result<ContentRef, CasError> {
    let bytes = fs::read(src_path)?;
    let name = src_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());
    let mime = name
        .as_deref()
        .map(mime_from_name)
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let encoding = if is_text_mime(&mime) { Some("utf8".to_string()) } else { None };
    let meta = Meta { mime_type: mime, name, encoding };
    put_content(root, &bytes, &meta)
}
