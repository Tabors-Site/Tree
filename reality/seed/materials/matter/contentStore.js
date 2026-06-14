// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// contentStore — the content-addressable store. Bytes live HERE;
// the chain holds facts ABOUT bytes.
//
// Doctrinally this is the reality's **localStore**: the unconditional
// CAS layer that every reality has, populated automatically by
// putContent whenever owned bytes are created. Not all bytes here are
// "installed" or "active" — they're just stored. The optional store
// pack (reality/resources/store/) sits on top of this layer and lets a
// reality choose which localStore items to expose as publishable
// resources. See philosophy/OS/ROOTS.md for the four-layer model
// (localStore, federation, peering, store).
//
// Every piece of matter content (text and binary alike) is addressed
// by what it IS: the SHA-256 of its bytes. Facts and projections
// carry a content ref `{ kind:"cas", hash, size, mimeType, name,
// encoding, preview }` — never the bytes themselves. Identical bytes
// from a hundred writes store once (same hash, same file). An edit
// produces a new hash; the old version's bytes stay until retention
// policy or an explicit purge removes them. See philosophy/OS/OS.md
// "Every File Is Matter": the byte content of files lives in a
// content-addressable store separate from the chain, referenced by
// hash. This module is that store, shaped so the future kernel CAS
// is a drop-in replacement (hash → bytes, no DB coupling).
//
// Layout on disk:
//
//   <uploads>/cas/<hash[0..2]>/<hash>            the bytes
//   <uploads>/cas/<hash[0..2]>/<hash>.meta.json  { mimeType, size, name }
//
// The two-hex shard dir keeps directory fan-out sane. The sidecar
// lets the HTTP serving route answer Content-Type without a DB read.
// Sidecar meta is first-put-wins: the first writer's mimeType/name
// stick (later putters of the same bytes get the same ref fields
// they passed, but the disk meta doesn't churn).
//
// Writes are atomic: bytes land in a tmp file in the shard dir, then
// fs.rename onto the final name. A crash between a put and the fact
// that references it leaves an unreferenced blob — the retention
// sweeper's grace period owns those; the write path never deletes.
//
// Hash strings are validated EVERYWHERE (/^[0-9a-f]{64}$/). That is
// also the path-traversal guard: a hash can never name a path
// outside its shard.

import { createHash, randomUUID } from "crypto";
import { promises as fs, createReadStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same resolution matters.js uses: env override, else reality/uploads.
const uploadsFolder = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(__dirname, "../../../uploads");
const CAS_ROOT = path.join(uploadsFolder, "cas");

const HASH_RE = /^[0-9a-f]{64}$/;

// Preview: the first slice of utf8-decodable content, carried inline
// on the ref so descriptors stay zero-IO. Capped in CHARACTERS and
// BYTES (multibyte text can exceed the byte cap at 400 chars).
const PREVIEW_CHARS = 400;
const PREVIEW_MAX_BYTES = 512;

// Read-through text cache for cognition + descriptor full-read paths.
// Tiny by design — the disk is fast and the kernel page cache does
// the heavy lifting; this only saves repeated decode work.
const TEXT_CACHE_MAX_ENTRIES = 64;
const TEXT_CACHE_MAX_TEXT_BYTES = 1024 * 1024; // don't cache > 1MB texts
const textCache = new Map();

export function assertHash(hash, caller = "contentStore") {
  if (typeof hash !== "string" || !HASH_RE.test(hash)) {
    throw new Error(`${caller}: invalid content hash "${String(hash).slice(0, 80)}"`);
  }
  return hash;
}

export function isContentHash(value) {
  return typeof value === "string" && HASH_RE.test(value);
}

/** SHA-256 hex of a Buffer or utf8 string. */
export function hashOf(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  return createHash("sha256").update(buf).digest("hex");
}

function blobPath(hash) {
  return path.join(CAS_ROOT, hash.slice(0, 2), hash);
}
function metaPath(hash) {
  return blobPath(hash) + ".meta.json";
}

function buildPreview(buf, encoding) {
  if (encoding !== "utf8") return null;
  try {
    let text = buf.toString("utf8").slice(0, PREVIEW_CHARS);
    while (Buffer.byteLength(text, "utf8") > PREVIEW_MAX_BYTES) {
      text = text.slice(0, Math.floor(text.length * 0.8));
    }
    return text;
  } catch {
    return null;
  }
}

/**
 * Store bytes (or a utf8 string), return the content ref the fact
 * carries. Idempotent: identical bytes return the same ref without a
 * second write (deduplication is the hash doing its job).
 *
 * @param {Buffer|string} bytesOrString
 * @param {object} [opts]
 * @param {string} [opts.mimeType]
 * @param {string} [opts.name]      original filename, forensic only
 * @param {string} [opts.encoding]  "utf8" when the bytes are text
 * @returns {Promise<{kind, hash, size, mimeType, name, encoding, preview}>}
 */
export async function putContent(bytesOrString, opts = {}) {
  const isString = typeof bytesOrString === "string";
  const buf = Buffer.isBuffer(bytesOrString)
    ? bytesOrString
    : Buffer.from(String(bytesOrString), "utf8");
  const encoding = opts.encoding || (isString ? "utf8" : null);
  const mimeType = opts.mimeType
    || (encoding === "utf8" ? "text/plain; charset=utf-8" : "application/octet-stream");
  const name = opts.name || null;
  const hash = hashOf(buf);

  const ref = {
    kind: "cas",
    hash,
    size: buf.length,
    mimeType,
    name,
    encoding,
    preview: buildPreview(buf, encoding),
  };

  const target = blobPath(hash);
  if (await exists(target)) return ref; // dedup hit — bytes already live here

  const shardDir = path.dirname(target);
  await fs.mkdir(shardDir, { recursive: true });
  const tmp = path.join(shardDir, `tmp-${randomUUID()}`);
  await fs.writeFile(tmp, buf);
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    // A concurrent put won the rename. The blob exists; drop our tmp.
    await fs.unlink(tmp).catch(() => {});
    if (!(await exists(target))) throw err;
  }
  // Sidecar meta: first-put-wins ('wx' refuses when it already exists).
  await fs
    .writeFile(metaPath(hash), JSON.stringify({ mimeType, size: buf.length, name }), { flag: "wx" })
    .catch(() => {});
  return ref;
}

/** Raw bytes for a hash, or null when absent (purged / GC'd / unknown). */
export async function getContent(hash) {
  assertHash(hash, "getContent");
  try {
    return await fs.readFile(blobPath(hash));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Decode a hash's bytes as utf8 text, with a small LRU. Null when
 * the blob is absent. Callers that need to distinguish "purged" from
 * "never existed" already hold the ref — the ref IS the evidence the
 * bytes existed.
 */
export async function getContentText(hash) {
  assertHash(hash, "getContentText");
  if (textCache.has(hash)) {
    const v = textCache.get(hash);
    textCache.delete(hash);
    textCache.set(hash, v);
    return v;
  }
  const buf = await getContent(hash);
  if (buf == null) return null;
  const text = buf.toString("utf8");
  if (buf.length <= TEXT_CACHE_MAX_TEXT_BYTES) {
    if (textCache.size >= TEXT_CACHE_MAX_ENTRIES) {
      textCache.delete(textCache.keys().next().value);
    }
    textCache.set(hash, text);
  }
  return text;
}

/** Readable stream for the HTTP serving route. Null when absent. */
export async function streamContent(hash) {
  assertHash(hash, "streamContent");
  if (!(await exists(blobPath(hash)))) return null;
  return createReadStream(blobPath(hash));
}

export async function hasContent(hash) {
  assertHash(hash, "hasContent");
  return exists(blobPath(hash));
}

/** { size, mimeType, name } from sidecar + stat, or null when absent. */
export async function statContent(hash) {
  assertHash(hash, "statContent");
  try {
    const st = await fs.stat(blobPath(hash));
    let meta = {};
    try {
      meta = JSON.parse(await fs.readFile(metaPath(hash), "utf8"));
    } catch { /* sidecar optional */ }
    return {
      size: st.size,
      mimeType: meta.mimeType || "application/octet-stream",
      name: meta.name || null,
      mtimeMs: st.mtimeMs,
    };
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Physically remove a blob (purge op / retention sweep). ENOENT is
 * fine — purge is idempotent. The chain's facts referencing the hash
 * remain; reads return the purged marker derived from the ref.
 */
export async function deleteContent(hash) {
  assertHash(hash, "deleteContent");
  textCache.delete(hash);
  let removed = false;
  try {
    await fs.unlink(blobPath(hash));
    removed = true;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await fs.unlink(metaPath(hash)).catch(() => {});
  return removed;
}

/**
 * Iterate every stored hash (the retention sweeper's walk). Yields
 * { hash, size, mtimeMs }. Tmp files and sidecars are skipped.
 */
export async function* listHashes() {
  let shards = [];
  try {
    shards = await fs.readdir(CAS_ROOT);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const shard of shards) {
    if (!/^[0-9a-f]{2}$/.test(shard)) continue;
    const dir = path.join(CAS_ROOT, shard);
    let entries = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!HASH_RE.test(entry)) continue;
      try {
        const st = await fs.stat(path.join(dir, entry));
        yield { hash: entry, size: st.size, mtimeMs: st.mtimeMs };
      } catch { /* raced a delete; skip */ }
    }
  }
}

/** Is this value a canonical cas content ref? */
export function isCasRef(value) {
  return !!(
    value &&
    typeof value === "object" &&
    value.kind === "cas" &&
    isContentHash(value.hash)
  );
}

/**
 * The marker readers return when a ref's bytes are gone (purged or
 * GC'd). Derived from the ref — the chain still proves what the
 * content WAS (hash, size, type); only the bytes are absent.
 */
export function purgedMarker(ref) {
  return {
    purged: true,
    hash: ref?.hash || null,
    size: ref?.size ?? null,
    mimeType: ref?.mimeType || null,
    name: ref?.name || null,
  };
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export { CAS_ROOT };
