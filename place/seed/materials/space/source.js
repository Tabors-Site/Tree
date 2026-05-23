// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// My own source, as substrate.
//
// At boot I walk the place/ directory on disk and plant a recursive
// filesystem-origin Matter tree under the .source place seed space.
// Each directory becomes a folder-Matter; each file becomes a
// file-Matter; parentMatterId chains the tree so what's under
// .source faithfully mirrors what's on the floor.
//
// The point is reflection. A being running inside this place can SEE
// the code I am running through the same protocol it uses to look at
// anything else. The codebase is substrate at the layer where every
// other position is substrate.
//
// One-way sync. Disk → substrate; never the other way. DO operations
// against .source Matter reject with ORIGIN_READ_ONLY (gate in
// ibp/verbs/do.js). The reconciliation walk uses direct Matter
// saves and bypasses the public createMatter path because that path
// also (correctly) refuses to author into place seed spaces.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import log from "../../system/log.js";
import Matter from "../matter/matter.js";
import Space from "./space.js";
import { MATTER_ORIGIN } from "../matter/origins.js";
import { SEED_SPACE } from "./seedSpaces.js";
import { I_AM } from "../being/seedBeings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default root: the place/ directory (three levels above this file,
// which lives at seed/materials/space/). SOURCE_TREE_ROOT env var overrides
// for tests or non-standard layouts.
const DEFAULT_SOURCE_ROOT = path.resolve(__dirname, "../../..");

// Entries skipped during the walk. Build matters, dependency trees,
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
// qualities captured but no extra processing. Prevents accidentally
// pulling huge binary blobs through the walk.
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// Cached source space id, looked up at boot and reused for the read-only
// DO gate (ibp/verbs/do.js calls isSourceSpaceId).
let sourceSpaceIdCache = null;

// ────────────────────────────────────────────────────────────────────
// PUBLIC API
// ────────────────────────────────────────────────────────────────────

/**
 * Bootstrap the `.source` matter tree. Idempotent. Verifies the
 * `.source` place seed space exists, then kicks off a reconciliation walk
 * **detached** so boot is not blocked by a multi-thousand-file scan.
 *
 * Call after ensurePlaceRoot() so the place seed space already exists.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootPath]    - directory to mirror (default place/)
 * @param {Set<string>} [opts.ignore] - filename set to skip
 * @param {boolean} [opts.detached]   - run walk in background (default true)
 */
export async function ensureSourceTree(opts = {}) {
  const rootPath =
    opts.rootPath || process.env.SOURCE_TREE_ROOT || DEFAULT_SOURCE_ROOT;
  const ignore = opts.ignore || DEFAULT_IGNORE;
  const detached = opts.detached !== false;

  const sourceSpace = await Space.findOne({ seedSpace: SEED_SPACE.SOURCE })
    .select("_id")
    .lean();
  if (!sourceSpace) {
    log.warn(
      "Source",
      `.source place seed space missing; cannot populate source tree`,
    );
    return null;
  }
  sourceSpaceIdCache = String(sourceSpace._id);

  if (!fs.existsSync(rootPath)) {
    log.warn("Source", `source root not found on disk: ${rootPath}`);
    return null;
  }

  const work = (async () => {
    const started = Date.now();
    try {
      const stats = await syncSourceTree({ rootPath, ignore });
      const ms = Date.now() - started;
      log.info(
        "Source",
        `synced .source from ${rootPath} in ${ms}ms: +${stats.created} ~${stats.updated} -${stats.removed} =${stats.kept}`,
      );
    } catch (err) {
      log.error("Source", `sync failed: ${err.message}`);
    }
  })();

  if (!detached) await work;
  return sourceSpaceIdCache;
}

/**
 * Reconcile the substrate matter tree against the disk tree rooted
 * at rootPath. Creates matters for new entries, updates ones whose
 * size or mtime changed, removes ones whose disk entry vanished, and
 * leaves identical ones alone. Always safe to re-run.
 *
 * @returns {{ created: number, updated: number, removed: number, kept: number }}
 */
export async function syncSourceTree({
  rootPath,
  ignore = DEFAULT_IGNORE,
} = {}) {
  const targetPath =
    rootPath || process.env.SOURCE_TREE_ROOT || DEFAULT_SOURCE_ROOT;

  const sourceSpace = await Space.findOne({ seedSpace: SEED_SPACE.SOURCE })
    .select("_id")
    .lean();
  if (!sourceSpace) throw new Error(".source place seed space not found");
  const sourceSpaceId = String(sourceSpace._id);
  sourceSpaceIdCache = sourceSpaceId;

  const stats = { created: 0, updated: 0, removed: 0, kept: 0 };

  // Root matter for targetPath. One root per .source space: lookup by
  // (spaceId, parentMatterId: null, origin: filesystem).
  let rootMatter = await Matter.findOne({
    spaceId: sourceSpaceId,
    parentMatterId: null,
    origin: MATTER_ORIGIN.FILESYSTEM,
  });

  const rootName = path.basename(targetPath) || "/";
  if (!rootMatter) {
    rootMatter = await createSourceMatter({
      spaceId: sourceSpaceId,
      parentMatterId: null,
      name: rootName,
      diskPath: targetPath,
      kind: "directory",
    });
    stats.created++;
  } else if (
    rootMatter.content?.path !== targetPath ||
    rootMatter.name !== rootName
  ) {
    // Source root moved on disk or renamed; update in place.
    rootMatter.name = rootName;
    rootMatter.content = {
      ...rootMatter.content,
      path: targetPath,
      kind: "directory",
    };
    await rootMatter.save();
    stats.updated++;
  } else {
    stats.kept++;
  }

  await reconcileChildren({
    diskPath: targetPath,
    parentMatterId: String(rootMatter._id),
    sourceSpaceId,
    ignore,
    stats,
  });

  return stats;
}

/**
 * Cached lookup of the .source place seed space id. Returns null before
 * ensureSourceTree has run, or if the space has not been created.
 * Used by the DO gate to deny writes against .source matters.
 */
export function getSourceSpaceId() {
  return sourceSpaceIdCache;
}

/**
 * Truthy if the given spaceId is the .source place seed space. Synchronous
 * after ensureSourceTree has primed the cache.
 */
export function isSourceSpaceId(spaceId) {
  if (!sourceSpaceIdCache || !spaceId) return false;
  return String(spaceId) === sourceSpaceIdCache;
}

// ────────────────────────────────────────────────────────────────────
// RECONCILIATION
// ────────────────────────────────────────────────────────────────────

async function reconcileChildren({
  diskPath,
  parentMatterId,
  sourceSpaceId,
  ignore,
  stats,
}) {
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
  const existing = await Matter.find({
    parentMatterId,
    origin: MATTER_ORIGIN.FILESYSTEM,
  })
    .select("_id name content")
    .lean();
  const existingByName = new Map(existing.map((a) => [a.name, a]));

  // Create / update / recurse.
  for (const [name, entry] of onDisk) {
    const full = path.join(diskPath, name);
    const ex = existingByName.get(name);

    if (entry.isDirectory()) {
      let matterId;
      if (!ex) {
        const created = await createSourceMatter({
          spaceId: sourceSpaceId,
          parentMatterId,
          name,
          diskPath: full,
          kind: "directory",
        });
        matterId = String(created._id);
        stats.created++;
      } else if (ex.content?.kind !== "directory") {
        // Type changed (file became dir). Drop the old subtree and recreate.
        await removeMatterSubtree(ex._id, stats);
        const created = await createSourceMatter({
          spaceId: sourceSpaceId,
          parentMatterId,
          name,
          diskPath: full,
          kind: "directory",
        });
        matterId = String(created._id);
        stats.created++;
      } else {
        // Refresh path if the rootPath shifted under us.
        if (ex.content?.path !== full) {
          await Matter.updateOne(
            { _id: ex._id },
            {
              $set: {
                content: { ...ex.content, path: full, kind: "directory" },
              },
            },
          );
          stats.updated++;
        } else {
          stats.kept++;
        }
        matterId = String(ex._id);
      }
      await reconcileChildren({
        diskPath: full,
        parentMatterId: matterId,
        sourceSpaceId,
        ignore,
        stats,
      });
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
      await createSourceMatter({
        spaceId: sourceSpaceId,
        parentMatterId,
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
      await removeMatterSubtree(ex._id, stats);
      await createSourceMatter({
        spaceId: sourceSpaceId,
        parentMatterId,
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
      await Matter.updateOne(
        { _id: ex._id },
        { $set: { content: desiredContent } },
      );
      stats.updated++;
    } else {
      stats.kept++;
    }
  }

  // Remove substrate matters whose disk entry vanished.
  for (const [name, ex] of existingByName) {
    if (onDisk.has(name)) continue;
    await removeMatterSubtree(ex._id, stats);
  }
}

async function removeMatterSubtree(rootId, stats) {
  const toDelete = [];
  const stack = [String(rootId)];
  while (stack.length) {
    const id = stack.pop();
    toDelete.push(id);
    const kids = await Matter.find({ parentMatterId: id }).select("_id").lean();
    for (const k of kids) stack.push(String(k._id));
  }
  if (toDelete.length === 0) return;
  // Detach from any parent.children arrays before deleting the docs.
  await Matter.updateMany(
    { children: { $in: toDelete } },
    { $pull: { children: { $in: toDelete } } },
  );
  await Matter.deleteMany({ _id: { $in: toDelete } });
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
// AUTHORING (seed-internal; bypasses createMatter's system-space gate)
// ────────────────────────────────────────────────────────────────────

async function createSourceMatter({
  spaceId,
  parentMatterId,
  name,
  diskPath,
  kind,
  size = null,
  mtime = null,
  mimeType = null,
  oversize = false,
}) {
  const content = { path: diskPath, kind };
  if (size != null) content.size = size;
  if (mtime != null) content.mtime = mtime;
  if (mimeType != null) content.mimeType = mimeType;
  if (oversize) content.oversize = true;

  const matter = new Matter({
    spaceId,
    parentMatterId,
    beingId: I_AM,
    name,
    origin: MATTER_ORIGIN.FILESYSTEM,
    content,
    qualities: new Map([["source", { readOnly: true }]]),
  });
  await matter.save();

  if (parentMatterId) {
    await Matter.updateOne(
      { _id: parentMatterId },
      { $addToSet: { children: matter._id } },
    );
  }

  return matter;
}

// ────────────────────────────────────────────────────────────────────
// MIME TYPE GUESS (just enough; not a full lookup table)
// ────────────────────────────────────────────────────────────────────

const MIME_BY_EXT = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".jsx": "application/javascript",
  ".ts": "application/typescript",
  ".tsx": "application/typescript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".html": "text/html",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".txt": "text/plain",
  ".yml": "application/yaml",
  ".yaml": "application/yaml",
  ".toml": "application/toml",
  ".sh": "application/x-sh",
  ".py": "text/x-python",
  ".sql": "application/sql",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

function mimeTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] || null;
}
