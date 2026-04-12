/**
 * code-workspace core helpers.
 *
 * A "workspace" is any node marked with metadata.workspace.initialized = true.
 * Its subtree mirrors a filesystem:
 *
 *   project node            metadata.code.role = "project"
 *     directory node        metadata.code.role = "directory"
 *       file node           metadata.code.role = "file"
 *         note              the file's current content (one active note)
 *
 * All file operations go through node CRUD + note CRUD. Nothing in this file
 * touches disk — that is sync.js's job. This keeps the tree as the source of
 * truth and makes every edit visible to position-scoped modes, cascade, and
 * the grammar pipeline before anything is written out.
 */

import path from "path";
import { fileURLToPath } from "url";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { v4 as uuidv4 } from "uuid";
import log from "../../seed/log.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// land/extensions/code-workspace/workspace.js -> land
export const LAND_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_WORKSPACE_ROOT = path.join(LAND_DIR, ".workspaces");

export const ROLE_PROJECT = "project";
export const ROLE_DIRECTORY = "directory";
export const ROLE_FILE = "file";

const LANGUAGE_BY_EXT = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript",
  ".json": "json", ".md": "markdown", ".css": "css", ".html": "html",
  ".yaml": "yaml", ".yml": "yaml", ".sh": "shell", ".py": "python",
};

// Single metadata namespace owned by this extension. The kernel enforces
// namespace ownership: code-workspace can only write to metadata["code-workspace"].
// All our per-node data (project marker, file role, directory role) lives
// inside this one namespace and a `role` field distinguishes them.
const NS = "code-workspace";

// ---------------------------------------------------------------------------
// Metadata accessors that work on both Map-backed and plain-object nodes
// ---------------------------------------------------------------------------

function readMeta(node, ns = NS) {
  if (!node?.metadata) return null;
  if (node.metadata instanceof Map) return node.metadata.get(ns) || null;
  return node.metadata[ns] || null;
}

/**
 * Compute a relative filesystem path from a node by walking its parent
 * chain up to (but not including) the project root. Uses metadata.code.role
 * to ignore non-code ancestors.
 */
async function relPathForNode(nodeId, projectId) {
  const parts = [];
  let currentId = String(nodeId);
  let guard = 0;
  while (currentId && currentId !== String(projectId) && guard < 128) {
    const node = await Node.findById(currentId).select("name parent metadata").lean();
    if (!node) break;
    const data = readMeta(node);
    if (!data || (data.role !== ROLE_FILE && data.role !== ROLE_DIRECTORY)) break;
    parts.unshift(node.name);
    currentId = String(node.parent);
    guard++;
  }
  return parts.join("/");
}

// ---------------------------------------------------------------------------
// Project lookup and creation
// ---------------------------------------------------------------------------

/**
 * Find a project node. Either by exact nodeId, or by walking the current
 * ancestor chain until a node with metadata.workspace.initialized is found.
 */
export async function findProject(nodeId) {
  if (!nodeId) return null;
  let currentId = String(nodeId);
  let guard = 0;
  while (currentId && guard < 128) {
    const node = await Node.findById(currentId).select("_id name parent metadata").lean();
    if (!node) return null;
    const data = readMeta(node);
    if (data?.role === ROLE_PROJECT && data.initialized) return node;
    if (!node.parent) return null;
    currentId = String(node.parent);
    guard++;
  }
  return null;
}

/**
 * Find an already-initialized project by its user-facing name under the same
 * tree root. Used by forge tools that take a name rather than a nodeId.
 */
export async function findProjectByName(rootId, name) {
  if (!rootId || !name) return null;
  // BFS from root until we find a project node whose name matches.
  const seen = new Set();
  const queue = [String(rootId)];
  while (queue.length > 0) {
    const nextLevel = [];
    const batch = await Node.find({ _id: { $in: queue } }).select("_id name parent metadata children").lean();
    for (const node of batch) {
      const id = String(node._id);
      if (seen.has(id)) continue;
      seen.add(id);
      const data = readMeta(node);
      if (data?.role === ROLE_PROJECT && data.initialized && (data.name === name || node.name === name)) {
        return node;
      }
      if (Array.isArray(node.children)) for (const c of node.children) nextLevel.push(String(c));
    }
    queue.length = 0;
    queue.push(...nextLevel);
    if (seen.size > 500) break;
  }
  return null;
}

/**
 * Initialize a project on an existing node. Marks it with metadata.workspace
 * and metadata.code.role=project, records the on-disk workspace path.
 *
 * Safe to call multiple times — idempotent if already initialized.
 */
export async function initProject({ projectNodeId, name, description, workspacePath, userId, core }) {
  const node = await Node.findById(projectNodeId);
  if (!node) throw new Error(`Project node ${projectNodeId} not found`);

  const existing = readMeta(node);
  if (existing?.role === ROLE_PROJECT && existing.initialized) {
    return { node, workspacePath: existing.workspacePath, alreadyInitialized: true };
  }

  const resolvedPath = workspacePath
    ? path.resolve(workspacePath)
    : path.join(DEFAULT_WORKSPACE_ROOT, String(node._id));

  const data = {
    role: ROLE_PROJECT,
    initialized: true,
    name: name || node.name,
    description: description || "",
    workspacePath: resolvedPath,
    language: "javascript",
    createdAt: new Date().toISOString(),
  };

  if (core?.metadata) {
    await core.metadata.setExtMeta(node, NS, data);
  } else {
    // Direct write fallback for programmatic use (e.g. offline tests).
    await Node.updateOne({ _id: node._id }, { $set: { [`metadata.${NS}`]: data } });
  }

  log.info("CodeWorkspace", `Initialized project "${data.name}" at ${resolvedPath} (node ${node._id})`);
  return { node: await Node.findById(node._id), workspacePath: resolvedPath, alreadyInitialized: false };
}

// ---------------------------------------------------------------------------
// Path → node resolution inside a project
// ---------------------------------------------------------------------------

function splitPath(relPath) {
  if (typeof relPath !== "string") throw new Error("file path must be a string");
  const cleaned = relPath.replace(/^[\/\\]+/, "").replace(/[\/\\]+$/, "");
  if (!cleaned) throw new Error("empty file path");
  if (cleaned.includes("..")) throw new Error(`path traversal not allowed: "${relPath}"`);
  if (cleaned.includes("\0")) throw new Error(`null byte in path: "${relPath}"`);
  return cleaned.split(/[\/\\]+/).filter(Boolean);
}

async function findChildByName(parentId, childName) {
  const parent = await Node.findById(parentId).select("children").lean();
  if (!parent?.children?.length) return null;
  return Node.findOne({
    _id: { $in: parent.children },
    name: childName,
  }).lean();
}

/**
 * Resolve a file path under a project to a node. Walks slash-separated
 * segments and either finds or creates each directory along the way,
 * finally finding or creating a file node at the tail.
 *
 * Returns { fileNode, created: boolean, segments }.
 */
export async function resolveOrCreateFile({ projectNodeId, relPath, userId, core }) {
  const segments = splitPath(relPath);
  const dirs = segments.slice(0, -1);
  const fileName = segments[segments.length - 1];

  let cursor = await Node.findById(projectNodeId);
  if (!cursor) throw new Error(`Project node ${projectNodeId} not found`);

  // Walk (and create) directory nodes
  for (const segment of dirs) {
    let child = await findChildByName(cursor._id, segment);
    if (!child) {
      const created = core?.tree?.createNode
        ? await core.tree.createNode({ parentId: cursor._id, name: segment, type: "directory", userId })
        : await Node.create({
            _id: uuidv4(),
            name: segment,
            type: "directory",
            parent: cursor._id,
            status: "active",
          });
      if (core?.tree?.createNode) {
        await Node.updateOne({ _id: cursor._id }, { $addToSet: { children: created._id } });
      } else {
        await Node.updateOne({ _id: cursor._id }, { $addToSet: { children: created._id } });
      }
      const dirDoc = await Node.findById(created._id);
      await persistNodeMeta(dirDoc, {
        role: ROLE_DIRECTORY,
        filePath: segments.slice(0, segments.indexOf(segment) + 1).join("/"),
      }, core);
      cursor = dirDoc;
    } else {
      cursor = await Node.findById(child._id);
    }
  }

  // Find or create the file node at the tail
  let created = false;
  let fileNode = await findChildByName(cursor._id, fileName);
  if (!fileNode) {
    const newDoc = core?.tree?.createNode
      ? await core.tree.createNode({ parentId: cursor._id, name: fileName, type: "file", userId })
      : await Node.create({
          _id: uuidv4(),
          name: fileName,
          type: "file",
          parent: cursor._id,
          status: "active",
        });
    await Node.updateOne({ _id: cursor._id }, { $addToSet: { children: newDoc._id } });
    const fileDoc = await Node.findById(newDoc._id);
    await persistNodeMeta(fileDoc, {
      role: ROLE_FILE,
      filePath: segments.join("/"),
      language: LANGUAGE_BY_EXT[path.extname(fileName).toLowerCase()] || null,
    }, core);
    created = true;
    fileNode = await Node.findById(fileDoc._id).lean();
  }
  return { fileNode, created, segments };
}

async function persistNodeMeta(node, data, core) {
  if (core?.metadata?.setExtMeta) {
    await core.metadata.setExtMeta(node, NS, data);
    return;
  }
  await Node.updateOne({ _id: node._id }, { $set: { [`metadata.${NS}`]: data } });
}

// ---------------------------------------------------------------------------
// Read / write file content as notes
// ---------------------------------------------------------------------------

/**
 * Read a file node's current content (the most recent text note).
 */
export async function readFileContent(fileNodeId) {
  const note = await Note.findOne({ nodeId: fileNodeId, contentType: "text" })
    .sort({ createdAt: -1 })
    .lean();
  return note?.content ?? "";
}

/**
 * Write content to a file node. Replaces existing notes on that node with a
 * single fresh note. This keeps file content as "one active note = current
 * content" which lines up with how codebase/core.js ingest already stores
 * file content on nodes. Bypasses beforeNote/afterNote for bulk code edits
 * because file content can be larger than the user-facing note size cap.
 */
// Fallback userId for writes that come from non-authenticated paths
// (boot hooks, background jobs, tests). The Note schema requires a
// userId, but our file-content notes are bulk-ingested-style and don't
// need to attribute to a real user. We use a stable sentinel so all
// workspace writes share the same synthetic author.
const WORKSPACE_SYSTEM_USER = "00000000-0000-0000-0000-code-workspace";

export async function writeFileContent({ fileNodeId, content, userId }) {
  await Note.deleteMany({ nodeId: fileNodeId });
  const note = await Note.create({
    _id: uuidv4(),
    contentType: "text",
    content: content ?? "",
    userId: userId || WORKSPACE_SYSTEM_USER,
    nodeId: fileNodeId,
  });
  return note;
}

// ---------------------------------------------------------------------------
// Walk the project subtree and produce a flat file list
// ---------------------------------------------------------------------------

/**
 * Depth-first walker. Visits every file node under the project and yields
 * { filePath, fileNode, content } for each. Directories are traversed but
 * not emitted. Mirrors the book extension's walker pattern — book does the
 * same thing for compiling notes into a single document; we do it to
 * compile a subtree into an on-disk project.
 */
export async function walkProjectFiles(projectNodeId) {
  const files = [];

  async function visit(nodeId, relBase) {
    const node = await Node.findById(nodeId).select("_id name parent metadata children").lean();
    if (!node) return;
    const data = readMeta(node);
    if (!data) return;

    if (data.role === ROLE_FILE) {
      const filePath = relBase ? `${relBase}/${node.name}` : node.name;
      const content = await readFileContent(node._id);
      files.push({ filePath, nodeId: String(node._id), content });
      return;
    }

    if (data.role === ROLE_PROJECT || data.role === ROLE_DIRECTORY) {
      const childRel = data.role === ROLE_PROJECT
        ? ""
        : (relBase ? `${relBase}/${node.name}` : node.name);
      if (Array.isArray(node.children)) {
        // Load children in parallel, then visit in sorted order for determinism.
        const kids = await Node.find({ _id: { $in: node.children } })
          .select("_id name").lean();
        kids.sort((a, b) => a.name.localeCompare(b.name));
        for (const kid of kids) {
          await visit(kid._id, childRel);
        }
      }
    }
  }

  await visit(projectNodeId, "");
  return files;
}

/**
 * Return the workspacePath stored on a project node, resolving legacy/unset
 * projects to the default workspace root.
 */
export function getWorkspacePath(projectNode) {
  const data = readMeta(projectNode);
  if (data?.workspacePath) return data.workspacePath;
  return path.join(DEFAULT_WORKSPACE_ROOT, String(projectNode._id));
}

export { readMeta, NS };
