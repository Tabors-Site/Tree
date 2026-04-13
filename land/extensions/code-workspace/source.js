/**
 * .source — the TreeOS self-tree.
 *
 * On boot, code-workspace ingests land/extensions/ and land/seed/ into a
 * project node named ".source" created as a child of the land root. The
 * tree mirrors the directory structure; every file becomes a node with
 * its content stored as a note. The AI can navigate there the same way
 * it navigates any project, read patterns from existing extensions,
 * propose edits — and with writeMode gating, those edits either require
 * operator approval or flow through freely.
 *
 * Scope:
 *   land/extensions/   — all of them, including disabled
 *   land/seed/         — the whole kernel so the AI can read contracts
 * Skipped:
 *   node_modules/      — noise
 *   .workspaces/       — runtime output, not source
 *   hidden files/dirs  — .git, .disabled, .treeos-profile, etc.
 *   oversized files    — >200KB per file to keep notes sane
 *   binaries           — by extension blacklist
 *
 * The project's workspace metadata carries a writeMode field:
 *   "disabled" — writes to .source file nodes are rejected outright (safest)
 *   "approve"  — writes require operator confirmation via the approve extension
 *   "free"     — writes flow through without confirmation (dev mode)
 *
 * Default on first boot is "disabled". Operator flips it via source-mode tool.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import log from "../../seed/log.js";
import { getLandRootId } from "../../seed/landRoot.js";
import { SYSTEM_ROLE } from "../../seed/protocol.js";
import { NS, ROLE_PROJECT, ROLE_DIRECTORY, ROLE_FILE, LAND_DIR } from "./workspace.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// land/extensions/code-workspace/source.js → land
const LAND_ROOT_DIR = LAND_DIR;

export const SOURCE_PROJECT_NAME = ".source";

const SCAN_SCOPES = [
  { relRoot: "extensions", label: "extensions" },
  { relRoot: "seed", label: "seed" },
];

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".workspaces",
  ".git",
  ".svn",
  ".hg",
  "__pycache__",
  ".idea",
  ".vscode",
  ".cache",
  ".npm-cache",
  "coverage",
  "dist",
  "build",
]);

const SKIP_FILE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".ico", ".svg", ".webp", ".bmp",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".lock", ".map",
]);

const MAX_FILE_BYTES = 200_000; // 200KB per file
const MAX_DEPTH = 15;

const LANGUAGE_BY_EXT = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript",
  ".json": "json", ".md": "markdown", ".css": "css", ".html": "html",
  ".yaml": "yaml", ".yml": "yaml", ".sh": "shell", ".py": "python",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the .source project exists and is populated. Idempotent — skips
 * ingest if the project already exists and has been populated. Called from
 * code-workspace's init after the loader finishes booting extensions.
 *
 * Returns { created, populated, fileCount, dirCount, skipped }.
 */
export async function ensureSourceTree(core) {
  const landRootId = getLandRootId();
  if (!landRootId) {
    log.warn("CodeWorkspace", "ensureSourceTree: no land root id, skipping");
    return { created: false, populated: false };
  }

  // Is there already a .source project under the land root?
  const existing = await Node.findOne({
    parent: landRootId,
    name: SOURCE_PROJECT_NAME,
  }).lean();

  if (existing) {
    // systemRole migration: earlier builds created .source with no
    // systemRole, so the /land/root endpoint filtered it out of `ls /`.
    // Upgrade in place so it appears as a system node on next `ls /`
    // without needing a re-ingest.
    if (existing.systemRole !== SYSTEM_ROLE.SOURCE) {
      await Node.updateOne(
        { _id: existing._id },
        { $set: { systemRole: SYSTEM_ROLE.SOURCE } },
      );
      log.info("CodeWorkspace", ".source systemRole set to 'source' (migration).");
    }
    const data = existing.metadata instanceof Map
      ? existing.metadata.get(NS)
      : existing.metadata?.[NS];
    if (data?.role === ROLE_PROJECT && data.sourcePopulated) {
      // Existing tree — run an mtime-based incremental refresh so any
      // files changed on disk since last boot get re-read into notes.
      // Unchanged files are skipped. This is what makes "tree reflects
      // files except on boot when it grabs it" hold across restarts.
      return refreshSource(existing._id);
    }
    // Project exists but wasn't populated — populate it now.
    return populateSource(existing._id, core, { created: false });
  }

  // Create the project node as a child of the land root, tagged with
  // systemRole=SOURCE so the /land/root endpoint and other kernel
  // filters treat it as infrastructure. SOURCE is added to
  // seed/protocol.js's SYSTEM_ROLE enum; the node schema accepts it
  // through the same path as .identity / .config / .extensions.
  // rootOwner=null + contributors=[] matches the pattern the seed
  // uses for its own system nodes.
  const node = new Node({
    _id: uuidv4(),
    name: SOURCE_PROJECT_NAME,
    type: "source",
    parent: landRootId,
    children: [],
    status: "active",
    systemRole: SYSTEM_ROLE.SOURCE,
  });
  await node.save();
  await Node.updateOne({ _id: landRootId }, { $addToSet: { children: node._id } });

  // Initial metadata — read-only until operator explicitly flips.
  const initialData = {
    role: ROLE_PROJECT,
    initialized: true,
    name: SOURCE_PROJECT_NAME,
    description: "TreeOS self-tree: live view of land/extensions and land/seed.",
    workspacePath: LAND_ROOT_DIR,
    language: "javascript",
    createdAt: new Date().toISOString(),
    writeMode: "disabled",
    isSourceTree: true,
    sourcePopulated: false,
  };
  await Node.updateOne({ _id: node._id }, { $set: { [`metadata.${NS}`]: initialData } });

  log.info("CodeWorkspace", `.source project created (${node._id}) — ingesting...`);
  return populateSource(node._id, core, { created: true });
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

async function populateSource(projectId, core, opts = {}) {
  const stats = { fileCount: 0, dirCount: 0, skipped: 0, bytesIngested: 0 };
  const created = opts.created ?? false;

  for (const scope of SCAN_SCOPES) {
    const absRoot = path.join(LAND_ROOT_DIR, scope.relRoot);
    try {
      await fs.access(absRoot);
    } catch {
      log.debug("CodeWorkspace", `.source scope skipped (missing): ${scope.relRoot}`);
      continue;
    }

    // Ensure a top-level directory node under .source for this scope
    const topDirId = await ensureChildDir(projectId, scope.relRoot, scope.relRoot);
    stats.dirCount++;
    await walk(topDirId, absRoot, scope.relRoot, stats, 0);
  }

  // Mark populated on the project
  await Node.updateOne(
    { _id: projectId },
    {
      $set: {
        [`metadata.${NS}.sourcePopulated`]: true,
        [`metadata.${NS}.fileCount`]: stats.fileCount,
        [`metadata.${NS}.dirCount`]: stats.dirCount,
        [`metadata.${NS}.ingestedAt`]: new Date().toISOString(),
      },
    },
  );

  log.info("CodeWorkspace", `.source ingest complete: ${stats.fileCount} files, ${stats.dirCount} dirs, ${stats.skipped} skipped, ${Math.round(stats.bytesIngested / 1024)}KB`);
  return { created, populated: true, ...stats };
}

async function walk(parentNodeId, absPath, relPath, stats, depth) {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true });
  } catch (err) {
    log.debug("CodeWorkspace", `.source walk: unreadable ${relPath}: ${err.message}`);
    return;
  }

  // Deterministic order: dirs first, then files
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const entryRel = path.join(relPath, entry.name);
    const entryAbs = path.join(absPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        stats.skipped++;
        continue;
      }
      // Skip hidden dirs other than ones users may intentionally inspect
      if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
        stats.skipped++;
        continue;
      }

      const childDirId = await ensureChildDir(parentNodeId, entry.name, entryRel);
      stats.dirCount++;
      await walk(childDirId, entryAbs, entryRel, stats, depth + 1);
      continue;
    }

    if (!entry.isFile()) {
      stats.skipped++;
      continue;
    }

    // Skip hidden files
    if (entry.name.startsWith(".")) {
      stats.skipped++;
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (SKIP_FILE_EXTENSIONS.has(ext)) {
      stats.skipped++;
      continue;
    }

    // Size check
    let fileStat;
    try {
      fileStat = await fs.stat(entryAbs);
    } catch {
      stats.skipped++;
      continue;
    }
    if (fileStat.size > MAX_FILE_BYTES) {
      stats.skipped++;
      continue;
    }

    let content;
    try {
      content = await fs.readFile(entryAbs, "utf-8");
    } catch {
      stats.skipped++;
      continue;
    }

    await createFileNode(parentNodeId, entry.name, entryRel, content, ext, fileStat.mtimeMs);
    stats.fileCount++;
    stats.bytesIngested += content.length;
  }
}

/**
 * Find or create a directory node as a child of parentNodeId, with the
 * code-workspace metadata marking it as a directory at the given relPath.
 */
async function ensureChildDir(parentNodeId, name, relPath) {
  // Look for an existing child with this name
  const parent = await Node.findById(parentNodeId).select("children").lean();
  if (parent?.children?.length) {
    const existing = await Node.findOne({
      _id: { $in: parent.children },
      name,
    }).select("_id metadata").lean();
    if (existing) {
      // Ensure code-workspace metadata is set (upgrade path)
      await Node.updateOne(
        { _id: existing._id },
        { $set: { [`metadata.${NS}`]: { role: ROLE_DIRECTORY, filePath: relPath } } },
      );
      return existing._id;
    }
  }

  const dirNode = new Node({
    _id: uuidv4(),
    name,
    type: "directory",
    parent: parentNodeId,
    children: [],
    status: "active",
    metadata: new Map([[NS, { role: ROLE_DIRECTORY, filePath: relPath }]]),
  });
  await dirNode.save();
  await Node.updateOne({ _id: parentNodeId }, { $addToSet: { children: dirNode._id } });
  return dirNode._id;
}

/**
 * Create a file node under parentNodeId and write the content to a note.
 * Bypasses createNote's hook pipeline (same bulk-ingest pattern the
 * codebase extension uses) because source files can exceed the user note
 * size limit and don't need the hook overhead.
 */
async function createFileNode(parentNodeId, name, relPath, content, ext, mtimeMs) {
  const fileMeta = {
    role: ROLE_FILE,
    filePath: relPath,
    language: LANGUAGE_BY_EXT[ext] || null,
    bytes: content.length,
    mtimeMs: mtimeMs || Date.now(),
  };

  const parent = await Node.findById(parentNodeId).select("children").lean();
  if (parent?.children?.length) {
    const existing = await Node.findOne({
      _id: { $in: parent.children },
      name,
    }).select("_id").lean();
    if (existing) {
      await Note.deleteMany({ nodeId: existing._id });
      await Note.create({
        _id: uuidv4(),
        contentType: "text",
        content,
        userId: "00000000-0000-0000-0000-code-workspace",
        nodeId: existing._id,
      });
      await Node.updateOne(
        { _id: existing._id },
        { $set: { [`metadata.${NS}`]: fileMeta } },
      );
      return existing._id;
    }
  }

  const fileNode = new Node({
    _id: uuidv4(),
    name,
    type: "file",
    parent: parentNodeId,
    children: [],
    status: "active",
    metadata: new Map([[NS, fileMeta]]),
  });
  await fileNode.save();
  await Node.updateOne({ _id: parentNodeId }, { $addToSet: { children: fileNode._id } });

  await Note.create({
    _id: uuidv4(),
    contentType: "text",
    content,
    userId: "00000000-0000-0000-0000-code-workspace",
    nodeId: fileNode._id,
  });

  return fileNode._id;
}

// ---------------------------------------------------------------------------
// Incremental refresh
// ---------------------------------------------------------------------------

/**
 * Walk the existing .source tree and compare each file node's stored
 * mtime against the real file on disk. Re-read only changed files. Also
 * pick up new files that weren't in the tree last boot, and prune file
 * nodes whose backing file is gone. Directories get lazily created if a
 * new scope/subdirectory appeared.
 *
 * Runs on every boot after first boot. First boot uses populateSource
 * instead (because there's nothing to diff against).
 */
async function refreshSource(projectId) {
  const stats = {
    fileCount: 0,
    dirCount: 0,
    skipped: 0,
    unchanged: 0,
    updated: 0,
    added: 0,
    removed: 0,
    bytesIngested: 0,
  };

  for (const scope of SCAN_SCOPES) {
    const absRoot = path.join(LAND_ROOT_DIR, scope.relRoot);
    try {
      await fs.access(absRoot);
    } catch {
      continue;
    }
    const topDirId = await ensureChildDir(projectId, scope.relRoot, scope.relRoot);
    stats.dirCount++;
    await refreshWalk(topDirId, absRoot, scope.relRoot, stats, 0);
  }

  await Node.updateOne(
    { _id: projectId },
    {
      $set: {
        [`metadata.${NS}.fileCount`]: stats.fileCount,
        [`metadata.${NS}.dirCount`]: stats.dirCount,
        [`metadata.${NS}.refreshedAt`]: new Date().toISOString(),
      },
    },
  );

  log.info(
    "CodeWorkspace",
    `.source refresh: ${stats.unchanged} unchanged, ${stats.updated} updated, ${stats.added} added, ${stats.removed} removed, ${stats.skipped} skipped`,
  );
  return { created: false, populated: true, refreshed: true, ...stats };
}

async function refreshWalk(parentNodeId, absPath, relPath, stats, depth) {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true });
  } catch (err) {
    log.debug("CodeWorkspace", `.source refresh: unreadable ${relPath}: ${err.message}`);
    return;
  }

  // Index existing tree children by name for quick diff.
  const parent = await Node.findById(parentNodeId).select("children").lean();
  const existingChildren = parent?.children?.length
    ? await Node.find({ _id: { $in: parent.children } })
        .select("_id name metadata")
        .lean()
    : [];
  const existingByName = new Map(existingChildren.map((c) => [c.name, c]));
  const seenNames = new Set();

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const entryRel = path.join(relPath, entry.name);
    const entryAbs = path.join(absPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        stats.skipped++;
        continue;
      }
      if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
        stats.skipped++;
        continue;
      }
      seenNames.add(entry.name);
      const childDirId = await ensureChildDir(parentNodeId, entry.name, entryRel);
      stats.dirCount++;
      await refreshWalk(childDirId, entryAbs, entryRel, stats, depth + 1);
      continue;
    }

    if (!entry.isFile()) {
      stats.skipped++;
      continue;
    }
    if (entry.name.startsWith(".")) {
      stats.skipped++;
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (SKIP_FILE_EXTENSIONS.has(ext)) {
      stats.skipped++;
      continue;
    }

    let fileStat;
    try {
      fileStat = await fs.stat(entryAbs);
    } catch {
      stats.skipped++;
      continue;
    }
    if (fileStat.size > MAX_FILE_BYTES) {
      stats.skipped++;
      continue;
    }

    seenNames.add(entry.name);

    // Compare against existing node's mtime
    const existing = existingByName.get(entry.name);
    if (existing) {
      const data = existing.metadata instanceof Map
        ? existing.metadata.get(NS)
        : existing.metadata?.[NS];
      const storedMtime = data?.mtimeMs || 0;
      if (storedMtime >= fileStat.mtimeMs) {
        stats.unchanged++;
        stats.fileCount++;
        continue;
      }
      // Changed — re-read and update
      let content;
      try {
        content = await fs.readFile(entryAbs, "utf-8");
      } catch {
        stats.skipped++;
        continue;
      }
      await createFileNode(parentNodeId, entry.name, entryRel, content, ext, fileStat.mtimeMs);
      stats.updated++;
      stats.fileCount++;
      stats.bytesIngested += content.length;
      continue;
    }

    // New file — create it
    let content;
    try {
      content = await fs.readFile(entryAbs, "utf-8");
    } catch {
      stats.skipped++;
      continue;
    }
    await createFileNode(parentNodeId, entry.name, entryRel, content, ext, fileStat.mtimeMs);
    stats.added++;
    stats.fileCount++;
    stats.bytesIngested += content.length;
  }

  // Prune nodes whose backing file is gone from disk. Only remove nodes
  // we can prove were originally ingested by us (have code-workspace
  // metadata with role=file or role=directory). Never touch user-created
  // nodes that might somehow live in this subtree.
  for (const child of existingChildren) {
    if (seenNames.has(child.name)) continue;
    const data = child.metadata instanceof Map
      ? child.metadata.get(NS)
      : child.metadata?.[NS];
    if (data?.role !== ROLE_FILE && data?.role !== ROLE_DIRECTORY) continue;
    try {
      // Recursive delete: remove descendant notes + nodes
      await pruneSubtree(child._id);
      await Node.updateOne({ _id: parentNodeId }, { $pull: { children: child._id } });
      stats.removed++;
    } catch (err) {
      log.debug("CodeWorkspace", `.source refresh prune failed for ${child.name}: ${err.message}`);
    }
  }
}

async function pruneSubtree(nodeId) {
  const node = await Node.findById(nodeId).select("children").lean();
  if (!node) return;
  if (Array.isArray(node.children)) {
    for (const childId of node.children) {
      await pruneSubtree(childId);
    }
  }
  await Note.deleteMany({ nodeId });
  await Node.deleteOne({ _id: nodeId });
}

// ---------------------------------------------------------------------------
// Write-gate helpers
// ---------------------------------------------------------------------------

/**
 * Find the .source project node. Returns the Mongoose document or null.
 * Cheap — hits the (parent, name) compound the tree already indexes.
 */
export async function getSourceProject() {
  const landRootId = getLandRootId();
  if (!landRootId) return null;
  return Node.findOne({ parent: landRootId, name: SOURCE_PROJECT_NAME }).lean();
}

/**
 * Check whether a file node lives under the .source project. If so, return
 * its writeMode. Otherwise return null (not a source node, no gating).
 */
export async function getSourceWriteMode(nodeId) {
  if (!nodeId) return null;
  let currentId = String(nodeId);
  let guard = 0;
  while (currentId && guard < 128) {
    const node = await Node.findById(currentId).select("_id name parent metadata").lean();
    if (!node) return null;
    const data = node.metadata instanceof Map ? node.metadata.get(NS) : node.metadata?.[NS];
    if (data?.isSourceTree) {
      return data.writeMode || "disabled";
    }
    if (!node.parent) return null;
    currentId = String(node.parent);
    guard++;
  }
  return null;
}

/**
 * Set the writeMode on the .source project. Accepts "disabled", "approve",
 * or "free". Returns the previous mode.
 */
export async function setSourceWriteMode(mode) {
  if (!["disabled", "approve", "free"].includes(mode)) {
    throw new Error(`invalid writeMode "${mode}". Must be disabled, approve, or free.`);
  }
  const landRootId = getLandRootId();
  if (!landRootId) throw new Error("land root not available");
  const project = await Node.findOne({ parent: landRootId, name: SOURCE_PROJECT_NAME });
  if (!project) throw new Error(".source project does not exist yet");
  const data = project.metadata instanceof Map ? project.metadata.get(NS) : project.metadata?.[NS];
  const previous = data?.writeMode || "disabled";
  await Node.updateOne(
    { _id: project._id },
    { $set: { [`metadata.${NS}.writeMode`]: mode } },
  );
  return { previous, current: mode };
}
