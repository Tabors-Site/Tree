// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// CAS anchor primitive.
//
// One function that turns bytes on disk into bytes in localStore.
// Used by the resource loader (bulk anchor for every resource at
// boot) and by the source walker (per-file anchor during the source
// reflection). When source retires under the mirror (MIRROR.md), the
// same primitive will land any new tree of matter that needs disk
// bytes mirrored into CAS.
//
// Anchoring is one-way: disk → CAS. The mirror's read path is the
// inverse direction off the same store.
//
// No `putContent` import at the top, callers pass it in. This keeps
// anchor.js usable from the loader before the seed has fully
// initialized (the matter content store is heavier than we need at
// boot order).

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ─── skip & mime ────────────────────────────────────────────────────

export const DEFAULT_SKIP_NAMES = new Set([
  "node_modules", ".lockfile.json", ".disabled", ".treeos-profile",
]);

const MIME_BY_EXT = {
  js:    "application/javascript",
  mjs:   "application/javascript",
  cjs:   "application/javascript",
  json:  "application/json",
  md:    "text/markdown; charset=utf-8",
  txt:   "text/plain; charset=utf-8",
  yaml:  "application/yaml",
  yml:   "application/yaml",
  toml:  "application/toml",
  glb:   "model/gltf-binary",
  gltf:  "model/gltf+json",
  mp3:   "audio/mpeg",
  wav:   "audio/wav",
  ogg:   "audio/ogg",
  png:   "image/png",
  jpg:   "image/jpeg",
  jpeg:  "image/jpeg",
  gif:   "image/gif",
  webp:  "image/webp",
  svg:   "image/svg+xml",
  fbx:   "application/octet-stream",
};

export function mimeFromName(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = name.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

export function isTextMime(mime) {
  if (!mime) return false;
  return mime.startsWith("text/")
    || mime === "application/javascript"
    || mime === "application/json"
    || mime === "application/yaml"
    || mime === "application/toml"
    || mime === "model/gltf+json"
    || mime === "image/svg+xml";
}

// ─── walk ───────────────────────────────────────────────────────────

// Recursively yield files under `dir` with their relative + absolute
// paths. Skips dotfiles + `skipNames`. Returns a sorted array for
// deterministic merkle roots.
export function walkFolderFiles(dir, skipNames = DEFAULT_SKIP_NAMES) {
  const files = [];
  function recur(d, prefix = "") {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || skipNames.has(e.name)) continue;
      const sub  = prefix ? `${prefix}/${e.name}` : e.name;
      const full = path.join(d, e.name);
      if (e.isDirectory()) recur(full, sub);
      else if (e.isFile()) files.push({ rel: sub, full });
    }
  }
  recur(dir);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

// ─── anchor ─────────────────────────────────────────────────────────

// Anchor one file into CAS. Reads bytes from `diskPath`, derives the
// mime from `relName`, calls `putContent`, returns the CAS ref
// `{hash, size, mimeType}` or null on read failure.
export async function anchorFile(diskPath, relName, putContent) {
  let bytes;
  try { bytes = fs.readFileSync(diskPath); } catch { return null; }
  const mimeType = mimeFromName(relName);
  const ref = await putContent(bytes, {
    name:     relName,
    mimeType,
    encoding: isTextMime(mimeType) ? "utf8" : null,
  });
  return { hash: ref.hash, size: ref.size, mimeType: ref.mimeType };
}

// Anchor every file under `dir` into CAS. Returns
// `{files: [{path, hash, size, mimeType}], rootHash}` where rootHash
// is a deterministic merkle over sorted (path, hash) pairs.
export async function anchorFolder(dir, putContent, skipNames) {
  const entries = walkFolderFiles(dir, skipNames);
  const files = [];
  for (const f of entries) {
    const ref = await anchorFile(f.full, f.rel, putContent);
    if (!ref) continue;
    files.push({ path: f.rel, ...ref });
  }
  const merkle = crypto.createHash("sha256");
  for (const f of files) {
    merkle.update(f.path);
    merkle.update("\0");
    merkle.update(f.hash);
    merkle.update("\0");
  }
  return { files, rootHash: merkle.digest("hex") };
}

// Build a "tree blob" from a list of {path, hash, size, mimeType?}
// entries: a small JSON document that names the file set, put into
// CAS like any other content. Used by the publish flow so a listing
// manifest (capped at 64KB) carries ONE asset (the tree hash) instead
// of a per-file assets[] that overflows for any non-trivial bundle.
//
// The blob is sorted by path for stable hashing. The same `files` in
// the same order → the same tree hash → the same listing hash. CAS
// dedups the blob across repeated publishes of the same content.
//
// Returns `{treeHash, treeSize, files}`. Bytes are added to CAS as a
// side effect (putContent dedups; no churn for a republish).
export async function buildTreeBlob(files, putContent, opts = {}) {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const blob = {
    kind:    opts.kind || "treeos.tree.v1",
    name:    opts.name || null,
    version: opts.version || null,
    files:   sorted.map((f) => ({
      path:     f.path,
      hash:     f.hash,
      size:     f.size,
      ...(f.mimeType ? { mimeType: f.mimeType } : {}),
    })),
  };
  const json = JSON.stringify(blob);
  const ref = await putContent(json, {
    name:     opts.name ? `${opts.name}.tree.json` : "tree.json",
    mimeType: "application/json",
    encoding: "utf8",
  });
  return { treeHash: ref.hash, treeSize: ref.size, files: sorted };
}
