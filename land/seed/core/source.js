// TreeOS Seed . AGPL-3.0 . https://treeos.ai
//
// .source — the seed's own source tree as substrate.
//
// At boot, seed walks the land/ directory and plants a recursive
// filesystem-origin artifact tree under the `.source` system node.
// Each directory becomes a folder-artifact; each file becomes a
// file-artifact; parent-child relationships are captured through
// parentArtifactId so the artifact tree faithfully mirrors disk.
//
// The codebase becomes substrate-native at the right layer: the AI
// (or any being) running inside the land can SEE its own implementation
// through the same protocol it uses for every other position.
//
// Read-only sync direction. The substrate cannot mutate seed files
// through verbs — DO operations against `.source` artifacts reject with
// ORIGIN_READ_ONLY (gate lives in ibp/verbs/do.js). The kernel's
// reconciliation walk uses direct Artifact saves and bypasses the
// public createArtifact path because that path also (correctly)
// refuses to author into system nodes.
//
// See [[project_seed_source_system_node]] (decision 2026-05-19) and
// [[project_substrate_as_universal_workspace]] (the canonical proof
// case for parentArtifactId).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import log from "./log.js";
import Artifact from "../models/artifact.js";
import Node from "../models/node.js";
import { ARTIFACT_ORIGIN, SYSTEM_OWNER, SYSTEM_ROLE } from "./protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Default root: the land/ directory (one level above seed/). The
// SOURCE_TREE_ROOT env var overrides for tests or non-standard layouts.
const DEFAULT_SOURCE_ROOT = path.resolve(__dirname, "..");

// Entries skipped during the walk. Build artifacts, dependency trees,
// runtime data, secrets, and OS noise. The list is conservative; the
// goal is a mirror of source-controlled code, not the full disk.
const DEFAULT_IGNORE = new Set([
  ".git",
  ".github",
  "node_modules",
  "uploads",
  "data",
  "logs",
  "tmp",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".next",
  ".turbo",
  ".vite",
  ".vscode",
  ".idea",
  ".DS_Store",
  "Thumbs.db",
  ".env",
  ".env.local",
]);

// Conservative file-size cap: any single file over this gets its
// metadata captured but no extra processing. Prevents accidentally
// pulling huge binary blobs through the walk.
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// Cached source node id, looked up at boot and reused for the read-only
// DO gate (ibp/verbs/do.js calls isSourceNodeId).
let sourceNodeIdCache = null;

// ────────────────────────────────────────────────────────────────────
// PUBLIC API
// ────────────────────────────────────────────────────────────────────

/**
 * Bootstrap the `.source` artifact tree. Idempotent. Verifies the
 * `.source` system node exists, then kicks off a reconciliation walk
 * **detached** so boot is not blocked by a multi-thousand-file scan.
 *
 * Call after ensureLandRoot() so the system node already exists.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootPath]    - directory to mirror (default land/)
 * @param {Set<string>} [opts.ignore] - filename set to skip
 * @param {boolean} [opts.detached]   - run walk in background (default true)
 */
export async function ensureSourceTree(opts = {}) {
  const rootPath = opts.rootPath || process.env.SOURCE_TREE_ROOT || DEFAULT_SOURCE_ROOT;
  const ignore   = opts.ignore   || DEFAULT_IGNORE;
  const detached = opts.detached !== false;

  const sourceNode = await Node.findOne({ systemRole: SYSTEM_ROLE.SOURCE }).select("_id").lean();
  if (!sourceNode) {
    log.warn("Source", `.source system node missing; cannot populate source tree`);
    return null;
  }
  sourceNodeIdCache = String(sourceNode._id);

  if (!fs.existsSync(rootPath)) {
    log.warn("Source", `source root not found on disk: ${rootPath}`);
    return null;
  }

  const work = (async () => {
    const started = Date.now();
    try {
      const stats = await syncSourceTree({ rootPath, ignore });
      const ms = Date.now() - started;
      log.info("Source", `synced .source from ${rootPath} in ${ms}ms: +${stats.created} ~${stats.updated} -${stats.removed} =${stats.kept}`);
    } catch (err) {
      log.error("Source", `sync failed: ${err.message}`);
    }
  })();

  if (!detached) await work;
  return sourceNodeIdCache;
}

/**
 * Reconcile the substrate artifact tree against the disk tree rooted
 * at rootPath. Creates artifacts for new entries, updates ones whose
 * size or mtime changed, removes ones whose disk entry vanished, and
 * leaves identical ones alone. Always safe to re-run.
 *
 * @returns {{ created: number, updated: number, removed: number, kept: number }}
 */
export async function syncSourceTree({ rootPath, ignore = DEFAULT_IGNORE } = {}) {
  const targetPath = rootPath || process.env.SOURCE_TREE_ROOT || DEFAULT_SOURCE_ROOT;

  const sourceNode = await Node.findOne({ systemRole: SYSTEM_ROLE.SOURCE }).select("_id").lean();
  if (!sourceNode) throw new Error(".source system node not found");
  const sourceNodeId = String(sourceNode._id);
  sourceNodeIdCache = sourceNodeId;

  const stats = { created: 0, updated: 0, removed: 0, kept: 0 };

  // Root artifact for targetPath. One root per .source node: lookup by
  // (nodeId, parentArtifactId: null, origin: filesystem).
  let rootArtifact = await Artifact.findOne({
    nodeId: sourceNodeId,
    parentArtifactId: null,
    origin: ARTIFACT_ORIGIN.FILESYSTEM,
  });

  const rootName = path.basename(targetPath) || "/";
  if (!rootArtifact) {
    rootArtifact = await createSourceArtifact({
      nodeId: sourceNodeId,
      parentArtifactId: null,
      name: rootName,
      diskPath: targetPath,
      kind: "directory",
    });
    stats.created++;
  } else if (rootArtifact.content?.path !== targetPath || rootArtifact.name !== rootName) {
    // Source root moved on disk or renamed; update in place.
    rootArtifact.name = rootName;
    rootArtifact.content = { ...rootArtifact.content, path: targetPath, kind: "directory" };
    await rootArtifact.save();
    stats.updated++;
  } else {
    stats.kept++;
  }

  await reconcileChildren({
    diskPath: targetPath,
    parentArtifactId: String(rootArtifact._id),
    sourceNodeId,
    ignore,
    stats,
  });

  return stats;
}

/**
 * Cached lookup of the .source system node id. Returns null before
 * ensureSourceTree has run, or if the node has not been created.
 * Used by the DO gate to deny writes against .source artifacts.
 */
export function getSourceNodeId() {
  return sourceNodeIdCache;
}

/**
 * Truthy if the given nodeId is the .source system node. Synchronous
 * after ensureSourceTree has primed the cache.
 */
export function isSourceNodeId(nodeId) {
  if (!sourceNodeIdCache || !nodeId) return false;
  return String(nodeId) === sourceNodeIdCache;
}

// ────────────────────────────────────────────────────────────────────
// RECONCILIATION
// ────────────────────────────────────────────────────────────────────

async function reconcileChildren({ diskPath, parentArtifactId, sourceNodeId, ignore, stats }) {
  let entries;
  try {
    entries = await fs.promises.readdir(diskPath, { withFileTypes: true });
  } catch (err) {
    log.warn("Source", `readdir ${diskPath}: ${err.message}`);
    return;
  }

  // Index disk entries by name, applying the ignore set.
  const onDisk = new Map();
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    // Skip symlinks, sockets, devices — only mirror plain files and dirs.
    if (!entry.isFile() && !entry.isDirectory()) continue;
    onDisk.set(entry.name, entry);
  }

  // Existing mirrored children for this parent.
  const existing = await Artifact.find({
    parentArtifactId,
    origin: ARTIFACT_ORIGIN.FILESYSTEM,
  }).select("_id name content").lean();
  const existingByName = new Map(existing.map(a => [a.name, a]));

  // Create / update / recurse.
  for (const [name, entry] of onDisk) {
    const full = path.join(diskPath, name);
    const ex = existingByName.get(name);

    if (entry.isDirectory()) {
      let artifactId;
      if (!ex) {
        const created = await createSourceArtifact({
          nodeId: sourceNodeId,
          parentArtifactId,
          name,
          diskPath: full,
          kind: "directory",
        });
        artifactId = String(created._id);
        stats.created++;
      } else if (ex.content?.kind !== "directory") {
        // Type changed (file became dir). Drop the old subtree and recreate.
        await removeArtifactSubtree(ex._id, stats);
        const created = await createSourceArtifact({
          nodeId: sourceNodeId,
          parentArtifactId,
          name,
          diskPath: full,
          kind: "directory",
        });
        artifactId = String(created._id);
        stats.created++;
      } else {
        // Refresh path if the rootPath shifted under us.
        if (ex.content?.path !== full) {
          await Artifact.updateOne({ _id: ex._id }, { $set: { content: { ...ex.content, path: full, kind: "directory" } } });
          stats.updated++;
        } else {
          stats.kept++;
        }
        artifactId = String(ex._id);
      }
      await reconcileChildren({ diskPath: full, parentArtifactId: artifactId, sourceNodeId, ignore, stats });
      continue;
    }

    // Regular file.
    let st;
    try {
      st = await fs.promises.stat(full);
    } catch (err) {
      log.warn("Source", `stat ${full}: ${err.message}`);
      continue;
    }

    const oversize = st.size > DEFAULT_MAX_FILE_BYTES;
    const desiredContent = {
      path: full,
      kind: "file",
      size: st.size,
      mtime: st.mtime,
      mimeType: mimeTypeFor(name),
      ...(oversize ? { oversize: true } : {}),
    };

    if (!ex) {
      await createSourceArtifact({
        nodeId: sourceNodeId,
        parentArtifactId,
        name,
        diskPath: full,
        kind: "file",
        size: st.size,
        mtime: st.mtime,
        mimeType: desiredContent.mimeType,
        oversize,
      });
      stats.created++;
    } else if (ex.content?.kind !== "file") {
      await removeArtifactSubtree(ex._id, stats);
      await createSourceArtifact({
        nodeId: sourceNodeId,
        parentArtifactId,
        name,
        diskPath: full,
        kind: "file",
        size: st.size,
        mtime: st.mtime,
        mimeType: desiredContent.mimeType,
        oversize,
      });
      stats.created++;
    } else if (contentChanged(ex.content, desiredContent)) {
      await Artifact.updateOne(
        { _id: ex._id },
        { $set: { content: desiredContent } },
      );
      stats.updated++;
    } else {
      stats.kept++;
    }
  }

  // Remove substrate artifacts whose disk entry vanished.
  for (const [name, ex] of existingByName) {
    if (onDisk.has(name)) continue;
    await removeArtifactSubtree(ex._id, stats);
  }
}

async function removeArtifactSubtree(rootId, stats) {
  const toDelete = [];
  const stack = [String(rootId)];
  while (stack.length) {
    const id = stack.pop();
    toDelete.push(id);
    const kids = await Artifact.find({ parentArtifactId: id }).select("_id").lean();
    for (const k of kids) stack.push(String(k._id));
  }
  if (toDelete.length === 0) return;
  // Detach from any parent.children arrays before deleting the docs.
  await Artifact.updateMany(
    { children: { $in: toDelete } },
    { $pull: { children: { $in: toDelete } } },
  );
  await Artifact.deleteMany({ _id: { $in: toDelete } });
  stats.removed += toDelete.length;
}

function contentChanged(prev, next) {
  if (!prev || !next) return true;
  if (prev.path !== next.path) return true;
  if (prev.kind !== next.kind) return true;
  if (Number(prev.size) !== Number(next.size)) return true;
  const prevMtime = prev.mtime ? new Date(prev.mtime).getTime() : 0;
  const nextMtime = next.mtime ? new Date(next.mtime).getTime() : 0;
  if (prevMtime !== nextMtime) return true;
  if ((prev.mimeType || null) !== (next.mimeType || null)) return true;
  if (Boolean(prev.oversize) !== Boolean(next.oversize)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────
// AUTHORING (kernel-internal; bypasses createArtifact's system-node gate)
// ────────────────────────────────────────────────────────────────────

async function createSourceArtifact({
  nodeId, parentArtifactId, name, diskPath, kind,
  size = null, mtime = null, mimeType = null, oversize = false,
}) {
  const content = { path: diskPath, kind };
  if (size != null)     content.size = size;
  if (mtime != null)    content.mtime = mtime;
  if (mimeType != null) content.mimeType = mimeType;
  if (oversize)         content.oversize = true;

  const artifact = new Artifact({
    nodeId,
    parentArtifactId,
    beingId: SYSTEM_OWNER,
    name,
    origin: ARTIFACT_ORIGIN.FILESYSTEM,
    content,
    metadata: new Map([["source", { readOnly: true }]]),
  });
  await artifact.save();

  if (parentArtifactId) {
    await Artifact.updateOne(
      { _id: parentArtifactId },
      { $addToSet: { children: artifact._id } },
    );
  }

  return artifact;
}

// ────────────────────────────────────────────────────────────────────
// MIME TYPE GUESS (just enough; not a full lookup table)
// ────────────────────────────────────────────────────────────────────

const MIME_BY_EXT = {
  ".js":   "application/javascript",
  ".mjs":  "application/javascript",
  ".cjs":  "application/javascript",
  ".jsx":  "application/javascript",
  ".ts":   "application/typescript",
  ".tsx":  "application/typescript",
  ".json": "application/json",
  ".md":   "text/markdown",
  ".html": "text/html",
  ".css":  "text/css",
  ".scss": "text/x-scss",
  ".txt":  "text/plain",
  ".yml":  "application/yaml",
  ".yaml": "application/yaml",
  ".toml": "application/toml",
  ".sh":   "application/x-sh",
  ".py":   "text/x-python",
  ".sql":  "application/sql",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".ico":  "image/x-icon",
  ".pdf":  "application/pdf",
};

function mimeTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] || null;
}
