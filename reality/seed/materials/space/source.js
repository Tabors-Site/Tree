// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// My own source, as substrate.
//
// At boot I walk the place/ directory on disk and plant a recursive
// read-only Matter tree (type "source") under the `./source` Tier-3 seed
// space. Each directory becomes a folder-Matter; each file becomes a
// file-Matter; parentMatterId chains the tree so what's under
// `./source` faithfully mirrors what's on the floor.
//
// The point is reflection. A being running inside this place can SEE
// the code I am running through the same protocol it uses to look at
// anything else. The codebase is substrate at the layer where every
// other position is substrate.
//
// One-way sync. Disk → substrate; never the other way. DO operations
// against `./source` Matter reject with SOURCE_READ_ONLY (gate in
// ibp/verbs/do.js). The reconciliation walk writes the matter
// PROJECTION slots directly (initProjection / tombstoneProjection in
// the projections collection, the same store every read path consults)
// and bypasses the public create-matter verb because that verb also
// (correctly) refuses to author into place heaven spaces. The walk
// reads and writes the one store, so what it plants is what SEE shows
// and what the next reconcile finds (idempotent, no duplication).
//
// SANCTIONED DOCTRINE EXCEPTION — "the place is folded from facts"
// does not apply to these rows. Source matter is a projection of the
// DISK, not of any reel: its source of truth is the checkout, its
// fold is this reconciliation walk, and it has no fact chain to
// rebuild from by design (stamping a fact per file per sync would
// bloat the chain with state the repo already versions). It is the
// one aggregate family whose cache is disk-folded instead of
// chain-folded: the walk writes the slot directly, the way a normal
// fold writes a slot after replaying a reel.
//
// Planned retirement: philosophy/OS/MIRROR.md. Under the mirror,
// source matter joins the rule (bytes in CAS, facts in the chain,
// projection on read) and the disk path becomes a window rendered
// from matter instead of a separate cache. The exception goes away
// when this whole file does.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import log from "../../seedReality/log.js";
import { matterContentId } from "../matter/matterId.js";
import { HEAVEN_SPACE } from "./heavenSpaces.js";
import { I_AM } from "../being/seedBeings.js";
import { initProjection, tombstoneProjection } from "../projections.js";
import ProjectionModel, { projectionKey } from "../branch/projection.js";
import { anchorFile } from "../matter/anchor.js";

// Lazy putContent; same boot-order rationale as the loader's lazy
// load (the matter content store is heavier than this file needs at
// import time). Memoized so the source walk doesn't re-import per
// file.
let _putContent = null;
async function getPutContent() {
  if (_putContent) return _putContent;
  const m = await import("../matter/contentStore.js");
  _putContent = m.putContent;
  return _putContent;
}

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
  "localStore",
  "mirror",
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
 * Bootstrap the `./source` matter tree. Idempotent. Verifies the
 * `./source` Tier-3 heaven space exists, then kicks off a reconciliation walk
 * **detached** so boot is not blocked by a multi-thousand-file scan.
 *
 * Call after ensureSpaceRoot() so the place heaven space already exists.
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

  // Branch is pinned to main ("0") throughout this file by design: the
  // ./source mirror is a heaven region, and heaven spaces live only on
  // main (one canonical projection per reality, no per-branch fork).
  const { findByHeavenSpace } = await import("../projections.js");
  const _sourceSlot = await findByHeavenSpace(HEAVEN_SPACE.SOURCE, "0");
  const sourceSpace = _sourceSlot ? { _id: _sourceSlot.id } : null;
  if (!sourceSpace) {
    log.warn(
      "Source",
      `./source heaven space missing; cannot populate source tree`,
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
      log.verbose(
        "Source",
        `synced ./source from ${rootPath} in ${ms}ms: +${stats.created} ~${stats.updated} -${stats.removed} =${stats.kept}`,
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

  const { findByHeavenSpace } = await import("../projections.js");
  const _sourceSlot = await findByHeavenSpace(HEAVEN_SPACE.SOURCE, "0");
  const sourceSpace = _sourceSlot ? { _id: _sourceSlot.id } : null;
  if (!sourceSpace) throw new Error("./source heaven space not found");
  const sourceSpaceId = String(sourceSpace._id);
  sourceSpaceIdCache = sourceSpaceId;

  const stats = { created: 0, updated: 0, removed: 0, kept: 0 };

  // Root matter for targetPath. Branch-aware via direct Projection query
  // — the matter-by-spaceId + source type is a substrate-internal
  // lookup pattern, not a wire-facing one.
  const _rootMatterSlot = await ProjectionModel.findOne({
    branch: "0", type: "matter",
    "state.spaceId": sourceSpaceId,
    "state.parentMatterId": null,
    "state.type": "source",
    tombstoned: { $ne: true },
  }).lean();
  let rootMatter = _rootMatterSlot ? { _id: _rootMatterSlot.id, ...(_rootMatterSlot.state || {}) } : null;

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
    // Source root moved on disk or renamed; update the slot in place.
    await patchSourceMatter(rootMatter._id, {
      name: rootName,
      content: { ...rootMatter.content, path: targetPath, kind: "directory" },
    });
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
 * Cached lookup of the `./source` heaven space id. Returns null before
 * ensureSourceTree has run, or if the space has not been created.
 * Used by the DO gate to deny writes against .source matters.
 */
export function getSourceSpaceId() {
  return sourceSpaceIdCache;
}

/**
 * Truthy if the given spaceId is the .source place heaven space. Synchronous
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
  const _existRows = await ProjectionModel.find({
    branch: "0", type: "matter",
    "state.parentMatterId": parentMatterId,
    "state.type": "source",
    tombstoned: { $ne: true },
  }).lean();
  const existing = _existRows.map((s) => ({
    _id: s.id, name: s.state?.name, content: s.state?.content,
  }));
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
          await patchSourceMatter(ex._id, {
            content: { ...ex.content, path: full, kind: "directory" },
          });
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

    // Anchor the bytes into localStore CAS. Oversize files keep their
    // matter row but skip anchoring (a 50MB+ file every boot would
    // be expensive; putContent dedups on hash, but the read is still
    // a hit). The hash on `content.hash` is what the mirror mount
    // reads from. Without a hash, the mount can't render the file.
    let hash = null;
    if (!oversize) {
      try {
        const putContent = await getPutContent();
        const ref = await anchorFile(full, name, putContent);
        if (ref) hash = ref.hash;
      } catch (err) {
        log.warn("Source", `CAS anchor failed for ${full}: ${err.message}`);
      }
    }

    const desiredContent = {
      path: full,
      kind: "file",
      size: st.size,
      mtime: st.mtime,
      mimeType: mimeTypeFor(name),
      ...(hash ? { hash } : {}),
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
        hash,
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
        hash,
        oversize,
      });
      stats.created++;
    } else if (contentChanged(ex.content, desiredContent)) {
      await patchSourceMatter(ex._id, { content: desiredContent });
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
    const kids = await ProjectionModel.find({
      branch: "0", type: "matter",
      "state.parentMatterId": id,
    }).select("id").lean();
    for (const k of kids) stack.push(String(k.id));
  }
  if (toDelete.length === 0) return;
  // Tombstone each — the projections collection records the deletion
  // explicitly so future queries filter them out.
  for (const id of toDelete) {
    await tombstoneProjection("matter", id, "0", 0).catch(() => {});
  }
  stats.removed += toDelete.length;
}

function contentChanged(prev, next) {
  if (!prev || !next) return true;
  if (prev.path !== next.path) return true;
  if (prev.kind !== next.kind) return true;
  if ((prev.hash || null) !== (next.hash || null)) return true;
  if (Number(prev.size) !== Number(next.size)) return true;
  const prevMtime = prev.mtime ? new Date(prev.mtime).getTime() : 0;
  const nextMtime = next.mtime ? new Date(next.mtime).getTime() : 0;
  if (prevMtime !== nextMtime) return true;
  if ((prev.mimeType || null) !== (next.mimeType || null)) return true;
  if (Boolean(prev.oversize) !== Boolean(next.oversize)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────
// AUTHORING (seed-internal; writes the matter PROJECTION slot directly,
// bypassing the create-matter verb's system-space gate. The slot shape
// mirrors what the matter reducer's applyCreateMatter folds, so SEE and
// the descriptor read these exactly like chain-folded matter.)
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
  hash = null,
  oversize = false,
}) {
  const content = { path: diskPath, kind };
  if (size != null) content.size = size;
  if (mtime != null) content.mtime = mtime;
  if (mimeType != null) content.mimeType = mimeType;
  if (hash) content.hash = hash;
  if (oversize) content.oversize = true;

  // Content-addressed id from the STABLE identity (where it lives + what
  // it is), not the mutable bytes (size/mtime), so the same disk entry
  // reproduces the same id every mirror and a content change patches in
  // place rather than re-creating.
  const parent = parentMatterId ? String(parentMatterId) : null;
  const matterId = matterContentId({
    spaceId, parentMatterId: parent, name, type: "source",
    content: { path: diskPath, kind }, beingId: I_AM,
  });
  const state = {
    spaceId,
    parentMatterId: parent,
    beingId: I_AM,
    name,
    type: "source",
    content,
    qualities: { source: { readOnly: true } },
    children: [],
    position: spaceId,
  };
  // Disk-folded: no reel, so foldedSeq is a constant. The slot IS the
  // fold of the disk entry.
  await initProjection("matter", matterId, "0", { state, foldedSeq: 0, position: spaceId });

  if (parent) {
    await ProjectionModel.updateOne(
      { _id: projectionKey("0", "matter", parent) },
      { $addToSet: { "state.children": matterId } },
    );
  }

  return { _id: matterId, ...state };
}

// Patch fields on an existing source-matter slot (rename, content
// refresh). Reads the slot, merges the patch into state, and writes it
// back through initProjection so the slot stays the authoritative fold
// of the disk entry.
async function patchSourceMatter(matterId, patch) {
  const key = projectionKey("0", "matter", String(matterId));
  const slot = await ProjectionModel.findById(key).lean();
  if (!slot) return;
  const state = { ...(slot.state || {}), ...patch };
  await initProjection("matter", String(matterId), "0", {
    state,
    foldedSeq: slot.foldedSeq ?? 0,
    position: state.position ?? state.spaceId ?? null,
  });
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
