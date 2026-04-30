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
import { logContribution } from "../../seed/tree/contributions.js";
import { readNs } from "../../seed/tree/extensionMetadata.js";

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

// Thin wrapper over the kernel's readNs so callers can still do
// readMeta(node) for the code-workspace namespace without threading
// the namespace argument.
function readMeta(node, ns = NS) {
  return readNs(node, ns);
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

  // Merge on top of whatever the node already carries under this
  // namespace. The AI may have written a plan (plan.steps[]) BEFORE
  // the first file write auto-initialized the project, and a blind
  // replace would wipe that state. Only fields that initProject
  // actually owns get overwritten; everything else (plan.steps,
  // plan.driftAt, logSnapshot, etc.) is preserved.
  const existingBase = existing && typeof existing === "object" ? existing : {};
  const data = {
    ...existingBase,
    role: ROLE_PROJECT,
    initialized: true,
    name: name || node.name,
    description: description || existingBase.description || "",
    workspacePath: resolvedPath,
    language: existingBase.language || "javascript",
    createdAt: existingBase.createdAt || new Date().toISOString(),
  };

  if (core?.metadata) {
    await core.metadata.setExtMeta(node, NS, data);
  } else {
    // Direct write fallback for programmatic use (e.g. offline tests).
    await Node.updateOne({ _id: node._id }, { $set: { [`metadata.${NS}`]: data } });
  }

  // Pin the response mode on the project node so follow-up messages
  // ("proceed", "make them the same color") stay in code modes and
  // don't fall through to tree:respond. The orchestrator's tense
  // suffix routing still redirects to code-plan / code-review / etc.
  // when the grammar is confident; this only catches the ambiguous
  // default-receiver case.
  try {
    await Node.updateOne(
      { _id: node._id },
      { $set: { "metadata.modes.respond": "tree:code-coach" } },
    );
  } catch (err) {
    log.debug("CodeWorkspace", `pin respond mode failed: ${err.message}`);
  }

  // Module-type anchor. The workspace sits inside land/.workspaces/,
  // and land/package.json has "type": "module". Without an explicit
  // package.json at the workspace root, Node walks up and loads every
  // AI-written .js file as ESM — so `const x = require(...)` crashes
  // with "require is not defined in ES module scope" on preview spawn.
  // Drop a minimal package.json pinning "type": "commonjs" so the AI's
  // CJS code runs. If the AI later writes its own package.json (with
  // deps, scripts, etc.), its version wins — this file is only a
  // first-write default.
  try {
    const fsMod = await import("fs/promises");
    const pkgPath = path.join(resolvedPath, "package.json");
    await fsMod.mkdir(resolvedPath, { recursive: true });
    try {
      await fsMod.access(pkgPath);
    } catch {
      const stub = {
        name: (data.name || "workspace").toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
        version: "0.0.0",
        private: true,
        type: "commonjs",
      };
      await fsMod.writeFile(pkgPath, JSON.stringify(stub, null, 2) + "\n", "utf8");
      log.info("CodeWorkspace", `seeded package.json at ${pkgPath} (type=commonjs)`);
    }
  } catch (err) {
    log.warn("CodeWorkspace", `seed package.json failed: ${err.message}`);
  }

  // Enable the kernel cascade system on the project root so file writes
  // anywhere in the sub-tree automatically fire propagation. Extensions
  // like code-workspace (here), contradiction, notifications, codebook,
  // and dashboard pick up the signals without any swarm-specific wiring.
  try {
    const existingCascadeMeta = node.metadata instanceof Map
      ? node.metadata.get("cascade")
      : node.metadata?.cascade;
    if (!existingCascadeMeta?.enabled) {
      const cascadeData = {
        enabled: true,
        enabledAt: new Date().toISOString(),
        enabledBy: "code-workspace",
      };
      if (core?.metadata?.setExtMeta) {
        await core.metadata.setExtMeta(node, "cascade", cascadeData);
      } else {
        await Node.updateOne(
          { _id: node._id },
          { $set: { "metadata.cascade": cascadeData } },
        );
      }
      log.info("CodeWorkspace", `Enabled cascade on project root ${node._id}`);
    }
  } catch (err) {
    log.warn("CodeWorkspace", `Failed to enable cascade on project: ${err.message}`);
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
  if (cleaned.includes("\0")) throw new Error(`null byte in path: "${relPath}"`);

  // Split first, then filter. This handles `./`, `foo/./bar`,
  // `foo//bar`, and similar normalization cases without needing a
  // separate regex pass. Dot-segments (`.`) are path syntax for
  // "current directory" and get collapsed. Double-dot segments (`..`)
  // are path traversal and must REJECT — we check AFTER filtering so
  // a single-segment `./` cleanly rejects as empty, while a real
  // filename containing `..` (like `some..name.js`) is still legal.
  const raw = cleaned.split(/[\/\\]+/).filter(Boolean);
  const segments = raw.filter((s) => s !== ".");

  if (segments.some((s) => s === "..")) {
    throw new Error(`path traversal not allowed: "${relPath}"`);
  }
  if (segments.length === 0) {
    throw new Error("empty file path (after normalization)");
  }
  return segments;
}

async function findChildByName(parentId, childName) {
  const parent = await Node.findById(parentId).select("children").lean();
  if (!parent?.children?.length) return null;
  const candidates = await Node.find({
    _id: { $in: parent.children },
    name: childName,
  }).lean();
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Duplicate children with the same name exist (a consistency bug elsewhere
  // in the swarm). Pick the one with actual content — the one with more
  // descendants, or, as a tiebreak, the oldest. Never return an empty
  // duplicate when a populated one is available; that was the failure mode
  // where workspace-read-file reported "did not exist" for a file that
  // lived under a sibling duplicate.
  candidates.sort((a, b) => {
    const aCount = Array.isArray(a.children) ? a.children.length : 0;
    const bCount = Array.isArray(b.children) ? b.children.length : 0;
    if (aCount !== bCount) return bCount - aCount;
    const aTime = a.dateCreated ? new Date(a.dateCreated).getTime() : 0;
    const bTime = b.dateCreated ? new Date(b.dateCreated).getTime() : 0;
    return aTime - bTime;
  });
  return candidates[0];
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

/**
 * Pure lookup: find a file node at a given relative path under a project
 * without creating anything. Returns the lean node document or null.
 * Used by read-only code paths (source-read, code review) so a wrong
 * path doesn't leave orphan nodes in the tree.
 */
export async function findFileByPath(projectNodeId, relPath) {
  let segments;
  try {
    segments = splitPath(relPath);
  } catch {
    return null;
  }
  let cursorId = String(projectNodeId);
  for (const segment of segments) {
    const child = await findChildByName(cursorId, segment);
    if (!child) return null;
    cursorId = String(child._id);
  }
  return Node.findById(cursorId).lean();
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

/**
 * Error thrown when a write to a gated source-tree node is rejected.
 * The tool handlers catch this and surface the reason to the AI so it
 * can tell the user why nothing changed (e.g. ".source is read-only —
 * run source-mode free to enable writes").
 */
export class SourceWriteRejected extends Error {
  constructor(reason) {
    super(reason);
    this.name = "SourceWriteRejected";
    this.code = "SOURCE_WRITE_REJECTED";
  }
}

/**
 * Gate a write against .source-tree policy. Walks the ancestor chain to
 * find the first project node. If it's marked as a source tree, the
 * project's writeMode determines whether the write is allowed:
 *   - disabled (default): rejected
 *   - approve: rejected in this phase (Phase 2 will wire approve)
 *   - free: allowed
 * Additionally, files whose filePath begins with "seed/" are rejected
 * unconditionally — the kernel is off-limits regardless of mode.
 */
async function checkSourceGate(fileNodeId) {
  let currentId = String(fileNodeId);
  let guard = 0;
  let filePath = null;
  while (currentId && guard < 128) {
    const node = await Node.findById(currentId).select("_id parent metadata").lean();
    if (!node) return; // node doesn't exist yet — not a gated path
    const data = node.metadata instanceof Map ? node.metadata.get(NS) : node.metadata?.[NS];
    if (data?.filePath && !filePath) filePath = data.filePath;
    if (data?.isSourceTree) {
      // Inside the source tree — gate applies.
      // Seed is always read-only.
      if (filePath && /^(\/)?seed(\/|$)/i.test(filePath)) {
        throw new SourceWriteRejected(
          "seed/ is read-only in .source. The kernel cannot be edited from inside the tree. " +
          "If you really need to change seed code, edit it on disk and restart the land.",
        );
      }
      const mode = data.writeMode || "disabled";
      if (mode === "free") return; // allowed
      if (mode === "approve") {
        throw new SourceWriteRejected(
          ".source writeMode is 'approve' but approve-gating isn't wired yet (Phase 2). " +
          "Use 'source-mode free' to enable direct writes.",
        );
      }
      // disabled (default)
      throw new SourceWriteRejected(
        ".source is read-only (writeMode=disabled). Flip it with 'source-mode free' to allow writes.",
      );
    }
    if (!node.parent) return;
    currentId = String(node.parent);
    guard++;
  }
}

export async function writeFileContent({ fileNodeId, content, userId, partial = false }) {
  await checkSourceGate(fileNodeId);

  // Snapshot the existing content BEFORE we delete, so we can detect
  // edit-vs-create and fire the right hook action. This matters for
  // the afterNote validators (syntax, contract, dead-receiver) that
  // care whether a file is being rewritten or created for the first time.
  const existing = await Note.findOne({ nodeId: fileNodeId, contentType: "text" })
    .sort({ createdAt: -1 })
    .lean();
  const isEdit = !!existing;
  const previousSize = existing?.content ? Buffer.byteLength(existing.content, "utf8") : 0;

  await Note.deleteMany({ nodeId: fileNodeId });
  const note = await Note.create({
    _id: uuidv4(),
    contentType: "text",
    content: content ?? "",
    userId: userId || WORKSPACE_SYSTEM_USER,
    nodeId: fileNodeId,
  });

  const newSize = Buffer.byteLength(content ?? "", "utf8");
  const sizeKB = Math.ceil(newSize / 1024);
  const deltaKB = Math.ceil((newSize - previousSize) / 1024);

  // Partial mode skips afterNote and contribution logging. Used by
  // chunked-append writes where intermediate chunks would otherwise
  // trigger the syntax validator on incomplete code (which would then
  // block the next chunk via findBlockingSyntaxError) and pollute the
  // contribution log with one entry per chunk. The caller is expected
  // to do a final non-partial write that fires hooks on the complete
  // content.
  if (partial) return note;

  // Fire afterNote so the validators (phase 1-4) see this write. The
  // bypass of beforeNote is intentional — that hook has a size cap for
  // user-facing notes and bulk code writes can exceed it. But the
  // AFTER side is the one the validators care about and it never
  // rejects writes, just reacts to them.
  try {
    const { hooks } = await import("../../seed/hooks.js");
    hooks.run("afterNote", {
      note,
      nodeId: fileNodeId,
      userId: userId || WORKSPACE_SYSTEM_USER,
      contentType: "text",
      sizeKB,
      deltaKB,
      action: isEdit ? "edit" : "create",
    }).catch(() => {});
  } catch {}

  // Log the contribution so the tree's audit trail includes this
  // write. Without this, code-workspace writes were invisible to
  // every downstream system (recent activity, contribution queries,
  // user metrics, blame walks).
  try {
    await logContribution({
      userId: userId || WORKSPACE_SYSTEM_USER,
      nodeId: fileNodeId,
      action: "note",
      noteAction: {
        action: isEdit ? "edit" : "add",
        noteId: note._id.toString(),
        content: content ?? "",
      },
      via: "code-workspace.writeFileContent",
      sizeKB,
      deltaKB,
    });
  } catch {}

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
/**
 * Local view of the tree from the current node's perspective. This is
 * TreeOS's principle of "each node handles itself and reaches out to
 * its neighbors" applied to context: the AI at any position doesn't
 * need a flat walk of the whole project, it needs to see its own
 * immediate surroundings.
 *
 * Returns:
 *   {
 *     self:     { name, role, childCount },
 *     parent:   { name, role, nodeId } | null,
 *     children: [{ name, role, nodeId }],   // direct children
 *     siblings: [{ name, role, nodeId }],   // children of parent,
 *                                            // excluding self
 *   }
 *
 * Bounded: max 30 children, max 30 siblings. If the AI needs to see
 * deeper, it navigates (workspace-list / cd) and the view shifts to
 * its new position. One level at a time, like walking a real
 * filesystem.
 */
export async function localNodeView(nodeId) {
  if (!nodeId) return null;
  const node = await Node.findById(nodeId).select("_id name parent metadata children type").lean();
  if (!node) return null;
  const selfMeta = readMeta(node);
  const selfRole = selfMeta?.role || null;
  // Swarm role is set by initBranchRole / initProjectRole on a
  // separate namespace. Surface it so facets that need to
  // distinguish branches from project roots from plan-type nodes
  // (e.g. compoundBranches.shouldInject) can read view.self.swarmRole
  // without an extra DB query.
  const readSwarmRole = (n) => {
    const m = n?.metadata instanceof Map ? n.metadata.get("swarm") : n?.metadata?.swarm;
    return m?.role || null;
  };
  const selfSwarmRole = readSwarmRole(node);
  const selfNodeType = node.type || null;

  const childDocs = Array.isArray(node.children) && node.children.length > 0
    ? await Node.find({ _id: { $in: node.children } })
        .select("_id name metadata").lean()
    : [];
  childDocs.sort((a, b) => a.name.localeCompare(b.name));
  const children = childDocs.slice(0, 30).map((c) => ({
    name: c.name,
    nodeId: String(c._id),
    role: readMeta(c)?.role || null,
  }));

  let parent = null;
  let siblings = [];
  if (node.parent) {
    const parentDoc = await Node.findById(node.parent)
      .select("_id name metadata children").lean();
    if (parentDoc) {
      parent = {
        name: parentDoc.name,
        nodeId: String(parentDoc._id),
        role: readMeta(parentDoc)?.role || null,
      };
      if (Array.isArray(parentDoc.children) && parentDoc.children.length > 0) {
        const sibDocs = await Node.find({
          _id: { $in: parentDoc.children, $ne: node._id },
        }).select("_id name metadata").lean();
        sibDocs.sort((a, b) => a.name.localeCompare(b.name));
        siblings = sibDocs.slice(0, 30).map((s) => ({
          name: s.name,
          nodeId: String(s._id),
          role: readMeta(s)?.role || null,
        }));
      }
    }
  }

  return {
    self: {
      name: node.name,
      nodeId: String(node._id),
      role: selfRole,
      swarmRole: selfSwarmRole,
      type: selfNodeType,
      childCount: Array.isArray(node.children) ? node.children.length : 0,
    },
    parent,
    children,
    siblings,
  };
}

export async function walkProjectFiles(projectNodeId) {
  const files = [];

  async function visit(nodeId, relBase) {
    const node = await Node.findById(nodeId).select("_id name parent metadata children").lean();
    if (!node) return;
    let data = readMeta(node);
    // Swarm-created branch nodes have `role` only in metadata.swarm, not
    // metadata.code-workspace. When plan-mode writes the local plan to
    // metadata.code-workspace.plan, the branch ends up with a truthy
    // code-workspace namespace but no `role` field. Check for the role
    // specifically — if absent, fall back to the swarm namespace so the
    // recursion descends into branch nodes. Without this, every file
    // written under a swarm branch is invisible to syncUp: tree has the
    // notes, disk stays empty, the preview has nothing to run.
    if (!data?.role) {
      const swMeta = node.metadata instanceof Map
        ? node.metadata.get("swarm")
        : node.metadata?.swarm;
      if (swMeta?.role === "branch") data = { ...(data || {}), role: "branch" };
    }
    if (!data?.role) return;

    if (data.role === ROLE_FILE) {
      const filePath = relBase ? `${relBase}/${node.name}` : node.name;
      const content = await readFileContent(node._id);
      files.push({ filePath, nodeId: String(node._id), content });
      return;
    }

    // Project = root, no path prefix.
    // Directory / Branch = contributes the node name to the path so files
    // under backend/ write to workspace/backend/ on disk (branches created
    // by the swarm runner use role="branch" and need the same traversal
    // and path-prefix behavior as plain directories).
    if (
      data.role === ROLE_PROJECT ||
      data.role === ROLE_DIRECTORY ||
      data.role === "branch"
    ) {
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

/**
 * Resolve the workspace root directory for an arbitrary node.
 *
 * Pass 1 decouples the PLAN ANCHOR (where a swarm run is scoped, which
 * may be a sub-plan node at depth) from the WORKSPACE ANCHOR (the
 * top-level project whose directory holds the actual files on disk).
 * Sub-plans don't own workspaces; their files still land in the outer
 * project's workspace. This helper walks up via swarm's
 * findProjectForNode to discover the right anchor, so hook handlers
 * that receive `rootProjectNode` (which may actually be a sub-plan)
 * get the correct path without threading a separate parameter.
 *
 * Resolution order:
 *   1. Starting node has workspacePath metadata → use it.
 *   2. Walk up via findProjectForNode → use the anchor's workspacePath.
 *   3. Fall back to DEFAULT_WORKSPACE_ROOT + nodeId (matches legacy
 *      behavior for pre-Pass-1 nodes that never got initialized).
 *
 * Returns the workspace path string.
 */
export async function resolveWorkspaceRoot(nodeId) {
  if (!nodeId) return null;
  try {
    const node = await Node.findById(nodeId).select("metadata").lean();
    if (node) {
      const meta = readMeta(node);
      if (meta?.workspacePath) return meta.workspacePath;
    }
    try {
      const { getExtension } = await import("../loader.js");
      const sw = getExtension("swarm")?.exports;
      if (sw?.findProjectForNode) {
        const project = await sw.findProjectForNode(nodeId);
        if (project) return getWorkspacePath(project);
      }
    } catch {
      // Swarm unavailable — very unusual, fall through to default.
    }
    return path.join(DEFAULT_WORKSPACE_ROOT, String(nodeId));
  } catch {
    return null;
  }
}

export { readMeta, NS };
