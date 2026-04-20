/**
 * code-workspace tools.
 *
 * Every file operation lives on tree nodes + notes. Disk is a projection
 * that the workspace-sync-up tool materializes on demand (or that test /
 * run tools materialize implicitly before spawning subprocesses).
 *
 * Tool name conventions follow the extension's namespace:
 *   workspace-init, workspace-add-file, workspace-read-file, ...
 * The forge extension calls these via getExtension("code-workspace")
 * rather than re-implementing any of them.
 */

import { z } from "zod";
import path from "path";
import http from "http";
import Node from "../../seed/models/node.js";
import { getEntryByNodeId, allEntries as allPreviewEntries } from "./serve/registry.js";
import { startPreview } from "./serve/spawner.js";
import { loadProjectNode, workspacePathFor } from "./serve/projectLookup.js";
import log from "../../seed/log.js";
import {
  findProject,
  findProjectByName,
  initProject,
  resolveOrCreateFile,
  findFileByPath,
  readFileContent,
  writeFileContent,
  walkProjectFiles,
  getWorkspacePath,
  readMeta,
  ROLE_FILE,
  ROLE_DIRECTORY,
  DEFAULT_WORKSPACE_ROOT,
  SourceWriteRejected,
} from "./workspace.js";
import { syncUp } from "./sync.js";
import { runInWorkspace, DEFAULTS } from "./sandbox.js";
import { setSourceWriteMode, SOURCE_PROJECT_NAME, getSourceProject } from "./source.js";

// ─────────────────────────────────────────────────────────────────────────
// EDIT-DRIFT GUARD
//
// When workspace-edit-file runs twice on the same file without an
// intervening read, the model's line numbers are stale: the first edit
// shifted every line below it, so the second edit lands at the wrong
// offset (best case: nothing; worst case: duplicates or broken braces).
// The coach's system prompt already warns about this, but the model
// defaults to "small problem → small edit" and ignores it.
//
// Rule enforced here: an edit is rejected when the file has already
// been edited in this user's context without a subsequent read. The
// rejection tells the model to either re-read the file (which refreshes
// its mental line map) or switch to workspace-add-file (whole-file
// rewrite — offsets don't matter). Reads and add-file calls reset the
// counter.
//
// Scope: `${userId}:${filePath}`. Per-user so concurrent users don't
// interfere. 10-minute TTL so a long-idle file becomes free to edit
// again without a re-read (the user probably forgot the file state by
// then anyway). Module-local Map, bounded by the sweeper below.
// ─────────────────────────────────────────────────────────────────────────

const _editDrift = new Map(); // key → { editsSinceRead, lastTouch }
const EDIT_DRIFT_TTL_MS = 10 * 60 * 1000;

function _driftKey(userId, filePath) { return `${userId}:${filePath}`; }
function _driftNoteRead(userId, filePath) {
  _editDrift.set(_driftKey(userId, filePath), { editsSinceRead: 0, lastTouch: Date.now() });
}
function _driftNoteEdit(userId, filePath) {
  const k = _driftKey(userId, filePath);
  const entry = _editDrift.get(k) || { editsSinceRead: 0, lastTouch: Date.now() };
  entry.editsSinceRead += 1;
  entry.lastTouch = Date.now();
  _editDrift.set(k, entry);
}
function _driftCheckBeforeEdit(userId, filePath) {
  const k = _driftKey(userId, filePath);
  const entry = _editDrift.get(k);
  if (!entry) return null;
  if (Date.now() - entry.lastTouch > EDIT_DRIFT_TTL_MS) {
    _editDrift.delete(k);
    return null;
  }
  if (entry.editsSinceRead > 0) {
    return (
      `workspace-edit-file rejected: you already edited ${filePath} ${entry.editsSinceRead === 1 ? "once" : entry.editsSinceRead + " times"} ` +
      `in this session without re-reading it. Your line numbers are stale. ` +
      `Call workspace-read-file(${JSON.stringify({ filePath })}) first to refresh the line numbers, ` +
      `or call workspace-add-file to rewrite the whole file cleanly (preferred for 2+ related changes — see the coach prompt).`
    );
  }
  return null;
}

// TTL sweep: reap entries whose lastTouch is older than the cap.
// Runs every 5 min, unrefs so it doesn't keep the process alive.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _editDrift) {
    if (now - v.lastTouch > EDIT_DRIFT_TTL_MS) _editDrift.delete(k);
  }
}, 5 * 60 * 1000).unref();

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

// Default line budget for a single paginated file read. 200 lines keeps the
// LLM's working context light on 27B local models where stuffing a whole
// 20KB index.html into tool results caused the next generation to freeze.
// Callers override via `limit` and continue with `startLine`.
const DEFAULT_READ_LINES = 200;
const MAX_READ_LINES = 800;

// Slice a file's content by line range and return { body, totalLines, shown, remaining, nextStart }.
// `startLine` is 0-indexed. `limit` is the number of lines to return.
function sliceByLines(content, startLine, limit) {
  const str = typeof content === "string" ? content : "";
  const lines = str.split("\n");
  const total = lines.length;
  const start = Math.max(0, Math.min(startLine | 0, total));
  const cap = Math.max(1, Math.min((limit | 0) || DEFAULT_READ_LINES, MAX_READ_LINES));
  const end = Math.min(total, start + cap);
  const slice = lines.slice(start, end);
  const remaining = total - end;
  // Number each line so edit tools can reference absolute positions.
  const numbered = slice.map((ln, i) => `${String(start + i + 1).padStart(5, " ")}  ${ln}`).join("\n");
  return {
    body: numbered,
    totalLines: total,
    shown: slice.length,
    remaining,
    nextStart: remaining > 0 ? end : null,
    rangeLabel: `${start + 1}-${end}`,
  };
}

// Loud logging helper. Every workspace tool entry, success, and failure
// goes through this so the server log shows the full conversation between
// the AI and the workspace without needing debug-level verbosity.
function trace(tool, phase, detail) {
  const msg = detail ? `${tool} ${phase}: ${detail}` : `${tool} ${phase}`;
  log.info("CodeWorkspace", msg);
}

// ---------------------------------------------------------------------------
// Auto-sync: any tool that writes a file triggers a debounced sync so disk
// mirrors the tree without the AI ever calling workspace-sync explicitly.
// Debounce window collapses a multi-file tool loop into one sync.
// ---------------------------------------------------------------------------
const _pendingSyncs = new Map(); // projectId -> timer
const SYNC_DEBOUNCE_MS = 250;

/**
 * Resolve a worker-supplied `filePath` against the caller's branch root.
 *
 * A swarm worker's path is ALWAYS relative to its own branch. The tool
 * refuses anything that would leave the branch: absolute paths, `..`
 * segments, paths whose first segment is the worker's own branch name
 * (double-nesting), and paths whose first segment matches a sibling
 * branch name (ghost-copying a peer's tree).
 *
 * Returns { filePath, isInBranch, error }. On success `filePath` is the
 * branch-rooted project path. On rejection `error` is a clean string
 * the tool returns to the agent. When the caller is not inside a branch
 * at all, the path is returned unchanged (project-level calls are fine).
 */
async function resolveBranchRootedPath(nodeId, filePath) {
  const raw = String(filePath || "").trim();
  if (!raw) return { filePath: raw, isInBranch: false, error: "filePath is empty" };
  if (raw.startsWith("/")) {
    return { filePath: raw, isInBranch: false, error: `absolute paths are not allowed: "${raw}"` };
  }

  if (!nodeId) return { filePath: raw, isInBranch: false, error: null };

  let branch = null;
  let siblingNames = new Set();
  try {
    const { getExtension } = await import("../loader.js");
    const sw = getExtension("swarm")?.exports;
    if (sw?.findBranchContext) {
      const ctx = await sw.findBranchContext(nodeId);
      branch = ctx?.branchNode || null;
      if (branch && sw.findBranchSiblings) {
        const sibs = await sw.findBranchSiblings(branch._id);
        siblingNames = new Set((sibs || []).map((s) => s.name).filter(Boolean));
      }
    }
  } catch {
    // Swarm extension missing → treat as not-in-branch. Path passes through.
  }

  if (!branch) return { filePath: raw, isInBranch: false, error: null };

  const swarmMeta = branch.metadata instanceof Map
    ? branch.metadata.get("swarm")
    : branch.metadata?.["swarm"];
  const branchPath = (swarmMeta?.path || branch.name || "")
    .toString()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!branchPath) return { filePath: raw, isInBranch: false, error: null };

  // Integration / shell branch (path: "."). Its filesystem slot is
  // the project root, so writes pass through unchanged: "index.html"
  // stays "index.html", not "./index.html". We still mark it as
  // isInBranch so sibling-path validation below can refuse writes
  // into peer branches. But we skip the sibling + self-prefix checks
  // — shell intentionally names files at the root level that don't
  // conflict with peer dirs.
  if (branchPath === ".") {
    return { filePath: raw, isInBranch: true, error: null };
  }

  const segments = raw.split("/").filter(Boolean);
  if (segments.length === 0) {
    return { filePath: raw, isInBranch: true, error: "filePath has no segments" };
  }
  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      return {
        filePath: raw, isInBranch: true,
        error: `path "${raw}" contains "${seg}" — paths inside a branch cannot traverse out of it`,
      };
    }
  }
  if (segments[0] === branchPath) {
    return {
      filePath: raw, isInBranch: true,
      error: `path "${raw}" starts with your own branch name "${branchPath}". You are already inside "${branchPath}" — write paths are relative to your branch root, so drop the "${branchPath}/" prefix.`,
    };
  }
  if (siblingNames.has(segments[0])) {
    const sibling = segments[0];
    const afterSibling = segments.slice(1).join("/");
    const peekHint = afterSibling
      ? `To read a file from "${sibling}", call workspace-peek-sibling-file with siblingName="${sibling}" filePath="${afterSibling}".`
      : `To read files from "${sibling}", call workspace-peek-sibling-file with siblingName="${sibling}" filePath="<file in that branch>".`;
    return {
      filePath: raw, isInBranch: true,
      error: `path "${raw}" points into sibling branch "${sibling}". You're in branch "${branchPath}"; "${sibling}" is a peer branch with its own worker. ${peekHint} To reference "${sibling}" at runtime, embed the reference (fetch URL, require path) as a literal string inside your own code — do not write files there.`,
    };
  }

  return { filePath: `${branchPath}/${raw}`, isInBranch: true, error: null };
}

/**
 * Files we allow at a project root even after branches exist. Two
 * categories:
 *   1. Workspace-wide config that belongs above the branch level
 *      (package.json, tsconfig.json, .gitignore, …).
 *   2. Integration / entry-point files — the "shell" that loads
 *      branch modules and composes them into one app. A static HTML
 *      game with modules in backend/, frontend/, etc. still needs a
 *      root index.html that pulls the modules together. Same for a
 *      root main.* or serve.* that imports branch code. Without these
 *      in the allow-list, the architect can't write the integration
 *      layer even when branches exist.
 */
const ROOT_ALLOWED_FILES = new Set([
  // config
  "package.json",
  "package-lock.json",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  "README.md",
  "readme.md",
  ".env.example",
  "tsconfig.json",
  "jsconfig.json",
  "Makefile",
  "Dockerfile",
  // integration shell — the entry point that loads branch modules
  "index.html",
  "index.htm",
  "index.js",
  "index.mjs",
  "index.ts",
  "main.js",
  "main.mjs",
  "main.ts",
  "main.py",
  "app.js",
  "app.mjs",
  "app.ts",
  "app.py",
  "server.js",
  "server.mjs",
  "server.ts",
  // stylesheets + assets siblings index.html typically imports
  "style.css",
  "styles.css",
  "main.css",
  "index.css",
  "app.css",
]);

/**
 * Reject file writes at a project root that don't belong inside any
 * existing branch. Once a project has decomposed into branches, every
 * file is the responsibility of some branch — a bare "server.js" at
 * the project root is an orphan. But a path like "backend/server.js"
 * is a legitimate branch-scoped write expressed via the full path, so
 * it's allowed. Root-level config files (package.json, README.md,
 * tsconfig.json, etc.) are also allowed.
 *
 * Only runs when nodeId is AT the project root (resolveBranchRootedPath
 * already covered in-branch calls).
 *
 * Returns null on OK, or an error string on reject.
 */
async function checkProjectRootHasBranches(nodeId, filePath) {
  if (!nodeId || !filePath) return null;
  const firstSegment = filePath.split("/").filter(Boolean)[0] || filePath;
  if (ROOT_ALLOWED_FILES.has(firstSegment)) return null;
  try {
    const node = await Node.findById(nodeId).select("metadata name").lean();
    if (!node) return null;
    const sw = node.metadata instanceof Map
      ? node.metadata.get("swarm")
      : node.metadata?.["swarm"];
    if (sw?.role !== "project") return null;
    const branches = sw?.subPlan?.branches;
    if (!Array.isArray(branches) || branches.length === 0) return null;
    const branchNames = new Set(branches.map((b) => b?.name).filter(Boolean));
    // Branch-prefixed path: "backend/server.js" when "backend" is an
    // existing branch. That's a legitimate scoped write, not an orphan.
    if (branchNames.has(firstSegment)) return null;
    const namesList = [...branchNames].join(", ") || "(unknown)";
    return (
      `write at project root rejected: "${node.name}" has child branches [${namesList}] and "${firstSegment}" is not one of them. ` +
      `Either write inside an existing branch by prefixing the path with the branch name ` +
      `(e.g. "${[...branchNames][0] || "backend"}/${filePath.includes("/") ? filePath.split("/").slice(1).join("/") : filePath}"), ` +
      `or emit a [[BRANCHES]] block adding "${firstSegment}" as a new branch with [[DONE]]. ` +
      `Root-level config files (package.json, README.md, tsconfig.json, etc.) are allowed at the root.`
    );
  } catch {
    return null;
  }
}

/**
 * Render a one-paragraph summary of a preview registry entry for the
 * workspace-status tool. Includes the slug, port, kind, child PID,
 * uptime, last hit, and a count of buffered stderr lines so the AI
 * can decide whether to call workspace-logs to investigate.
 */
function formatEntrySummary(entry) {
  if (!entry) return "(empty)";
  const uptime = entry.startedAt ? Math.round((Date.now() - entry.startedAt) / 1000) + "s" : "?";
  const lastHit = entry.lastHit ? Math.round((Date.now() - entry.lastHit) / 1000) + "s ago" : "never";
  const stderrLines = Array.isArray(entry.stderr) ? entry.stderr.length : 0;
  const stdoutLines = Array.isArray(entry.stdout) ? entry.stdout.length : 0;
  const lines = [
    `  slug:       ${entry.slug || "?"}`,
    `  kind:       ${entry.kind || "?"}`,
    `  port:       ${entry.port || "(none)"}`,
    `  pid:        ${entry.pid || "(none)"}`,
    `  cwd:        ${entry.childCwd || entry.workspacePath || "?"}`,
    `  uptime:     ${uptime}`,
    `  last hit:   ${lastHit}`,
    `  stdout:     ${stdoutLines} buffered lines`,
    `  stderr:     ${stderrLines} buffered lines${stderrLines > 0 ? " (← run workspace-logs stderr)" : ""}`,
  ];
  if (entry.fallbackStaticDir) lines.push(`  static fb:  ${entry.fallbackStaticDir}`);
  return lines.join("\n");
}

/**
 * Branch-aware single-file write. Wraps the same pipeline workspace-add-file
 * uses (resolveBranchRootedPath + resolveOrCreateFile + writeFileContent +
 * debounced sync) so strategy wrappers like ws-create-server don't need to
 * re-implement branch rooting or project detection.
 *
 * Accepts { core, nodeId, userId, rootId, projectName?, filePath, content }.
 * Returns { ok, filePath, created } on success or { ok: false, error } on
 * rejection/failure. The filePath returned reflects any branch-root rewrite.
 */
export async function writeFileInBranch({
  core = null,
  nodeId,
  userId,
  rootId,
  projectName,
  filePath,
  content,
}) {
  try {
    const resolved = await resolveBranchRootedPath(nodeId, filePath);
    if (resolved.error) return { ok: false, error: resolved.error };
    const finalPath = resolved.filePath;

    // Locate or auto-init the project. Reuse the same priority chain as
    // the tool handlers by calling findProject / initProject directly —
    // ensureProject lives inside the getWorkspaceTools closure for reasons
    // of `core` access, and is not reachable from module-top helpers.
    let project = await findProject(nodeId || rootId);
    if (!project && projectName && rootId) {
      project = await findProjectByName(rootId, projectName);
    }
    if (!project && rootId) {
      const rootNode = await Node.findById(rootId).lean();
      if (rootNode) {
        const { node } = await initProject({
          projectNodeId: rootId,
          name: rootNode.name || "workspace",
          description: "Auto-initialized by strategy wrapper.",
          userId,
          core,
        });
        project = node;
      }
    }
    if (!project) return { ok: false, error: "no active workspace; cannot resolve project root" };

    const { fileNode, created } = await resolveOrCreateFile({
      projectNodeId: project._id,
      relPath: finalPath,
      userId,
      core,
    });
    await writeFileContent({ fileNodeId: fileNode._id, content, userId });
    scheduleSync(project._id);
    return { ok: true, filePath: finalPath, created };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Branch-aware single-file read. The companion to writeFileInBranch: same
 * path-resolution rules, same project auto-detection, returns the file's
 * content as a string or null if the file doesn't exist.
 *
 * Accepts { nodeId, userId, rootId, projectName?, filePath }.
 * Returns { ok, filePath, content } on success or { ok: false, error } on
 * rejection/failure. Strategy wrappers use this instead of reaching into
 * workspace internals to read a peer file in their own branch.
 */
export async function readFileInBranch({
  nodeId,
  rootId,
  projectName,
  filePath,
}) {
  try {
    const resolved = await resolveBranchRootedPath(nodeId, filePath);
    if (resolved.error) return { ok: false, error: resolved.error };
    const finalPath = resolved.filePath;

    let project = await findProject(nodeId || rootId);
    if (!project && projectName && rootId) {
      project = await findProjectByName(rootId, projectName);
    }
    if (!project) return { ok: false, error: "no active workspace" };

    const fileNode = await findFileByPath(project._id, finalPath);
    if (!fileNode) return { ok: true, filePath: finalPath, content: null };
    const content = await readFileContent(fileNode._id);
    return { ok: true, filePath: finalPath, content: content ?? "" };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function scheduleSync(projectId) {
  if (!projectId) return;
  const id = String(projectId);
  const existing = _pendingSyncs.get(id);
  if (existing) clearTimeout(existing);
  _pendingSyncs.set(
    id,
    setTimeout(async () => {
      _pendingSyncs.delete(id);
      try {
        const res = await syncUp(id);
        trace("auto-sync", "done", `${res.projectName}: ${res.written.length} wrote, ${res.skipped.length} unchanged → ${res.workspacePath}`);
      } catch (err) {
        log.error("CodeWorkspace", `auto-sync ${id} FAILED: ${err.message}`);
        log.error("CodeWorkspace", err.stack?.split("\n").slice(0, 5).join("\n"));
      }
    }, SYNC_DEBOUNCE_MS),
  );
}

async function ensureProject({ rootId, currentNodeId, userId, core, name, workspacePath }) {
  // Priority 1: explicit name of an already-existing project.
  if (name) {
    const existing = await findProjectByName(rootId, name);
    if (existing) {
      trace("ensureProject", "found-by-name", `${name} → ${existing._id}`);
      return existing;
    }
  }

  // Priority 1b: if the requested name matches the TREE ROOT's own name,
  // the user wants the root itself to be the project — not a duplicate
  // child node named after the root. Promote the root in place. This
  // catches the case where the model emits projectName: "tinder2" for
  // a tree root literally called "tinder2": findProjectByName returns
  // null because the root isn't initialized yet, and without this
  // shortcut priority 4 would create a `tinder2` child under `tinder2`.
  if (name && rootId) {
    const rootNode = await Node.findById(rootId).select("_id name").lean();
    if (rootNode && rootNode.name === name) {
      trace("ensureProject", "promote-root-by-name", `${name} (${rootId})`);
      const initRes = await initProject({
        projectNodeId: rootId,
        name,
        description: "Auto-initialized: tree root name matched requested project name.",
        workspacePath,
        userId,
        core,
      });
      return initRes.node;
    }
  }

  // Priority 2: the user is already standing inside (or on) a workspace
  // project. Walk the ancestor chain from currentNodeId up to the tree root.
  const fromPosition = await findProject(currentNodeId || rootId);
  if (fromPosition) {
    if (!name || readMeta(fromPosition)?.name === name) {
      trace("ensureProject", "found-in-ancestors", `${fromPosition.name} (${fromPosition._id})`);
      return fromPosition;
    }
  }

  // Priority 3: auto-promote the tree root itself into a workspace.
  // Fires when no name was supplied OR when the requested name matches
  // the root's own name (already handled above as priority 1b, but kept
  // here as a safety net for the no-name path).
  if (!name && rootId) {
    trace("ensureProject", "auto-init", `rootId=${rootId}`);
    const rootNode = await Node.findById(rootId).lean();
    if (rootNode) {
      const autoName = rootNode.name || "workspace";
      const initRes = await initProject({
        projectNodeId: rootId,
        name: autoName,
        description: "Auto-initialized on first code write.",
        workspacePath,
        userId,
        core,
      });
      trace("ensureProject", "auto-init-done", `${autoName} at ${initRes.workspacePath}`);
      return initRes.node;
    }
  }

  // Priority 4: explicit name with no existing project AND the requested
  // name does NOT match the tree root → create a new child. This is the
  // genuine "user wants a new sub-project under this tree" case (e.g.
  // `workspace-init my-utility` while standing at /home).
  if (!name) throw new Error("no active workspace and no rootId to auto-init");
  trace("ensureProject", "create-child", `${name} under ${rootId}`);
  const parentId = rootId;
  let projectNode;
  if (core?.tree?.createNode) {
    projectNode = await core.tree.createNode({
      parentId,
      name,
      type: "project",
      userId,
    });
  } else {
    const { v4: uuidv4 } = await import("uuid");
    projectNode = await Node.create({
      _id: uuidv4(),
      name,
      type: "project",
      parent: parentId,
      status: "active",
    });
    await Node.updateOne({ _id: parentId }, { $addToSet: { children: projectNode._id } });
  }
  const { node } = await initProject({
    projectNodeId: projectNode._id,
    name,
    workspacePath,
    userId,
    core,
  });
  return node;
}

export default function getWorkspaceTools(core) {
  return [
    // ---------------------------------------------------------------
    // workspace-init: mark the current node (or a new child) as a
    // project root. Records metadata.workspace and metadata.code.
    // Idempotent: if the ancestor chain already has a project,
    // reports it instead of creating another.
    // ---------------------------------------------------------------
    {
      name: "workspace-init",
      description: "Initialize a code project at the current tree position. Creates or reuses a project node, records its on-disk workspace path, and marks it as a workspace root. Every subsequent file operation runs inside this project.",
      schema: {
        name: z.string().describe("Human-readable project name (directory name on disk)."),
        description: z.string().optional().describe("One-line project description."),
        workspacePath: z.string().optional().describe("Absolute on-disk workspace path. Defaults to land/.workspaces/<nodeId>."),
      },
      annotations: { readOnlyHint: false },
      async handler({ name, description, workspacePath, userId, rootId, nodeId }) {
        if (!name) return text("workspace-init: name required");
        try {
          const project = await ensureProject({
            rootId, currentNodeId: nodeId, userId, core, name, workspacePath,
          });
          if (description) {
            await core?.metadata?.mergeExtMeta?.(project, "workspace", { description });
          }
          const wsPath = getWorkspacePath(project);
          return text(`Workspace "${name}" ready. Project node ${project._id}. Workspace path: ${wsPath}. Use workspace-add-file to create files.`);
        } catch (e) {
          return text(`workspace-init failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-add-file: create or overwrite a file inside the
    // project. Walks the slash-separated path, auto-creating
    // directory nodes, then writes the content as a note on the
    // file node. Creates a real tree structure; every file node
    // is addressable by cd.
    // ---------------------------------------------------------------
    {
      name: "workspace-add-file",
      description: "Create or overwrite a file inside the active project. The file becomes a tree node with its content stored as a note, so the AI can navigate to it later. Path is relative to the project root and may include subdirectories (e.g. 'src/lib/util.js') which become directory nodes.",
      schema: {
        filePath: z.string().describe("Path inside your workspace. If you're inside a swarm branch, paths are rooted at your branch — drop the branch name, and paths that leave your branch (absolute, '..', sibling-branch name) are rejected."),
        content: z.string().describe("Full file content. Replaces any previous content on the node."),
        projectName: z.string().optional().describe("Target project by name if you're not inside one."),
      },
      annotations: { readOnlyHint: false },
      async handler({ filePath, content, projectName, userId, rootId, nodeId }) {
        const bytes = Buffer.byteLength(content || "", "utf8");
        trace("workspace-add-file", "CALL", `path=${filePath} bytes=${bytes} rootId=${rootId} nodeId=${nodeId} projectName=${projectName || "(auto)"}`);
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          trace("workspace-add-file", "project", `${project.name} (${project._id})`);
          // Branch-rooted path resolution. If the caller is inside a
          // swarm branch, the path is always resolved relative to that
          // branch's root. Any attempt to leave the branch (absolute,
          // `..`, sibling branch name, own branch name) is rejected
          // cleanly. Project-level calls pass through unchanged.
          {
            const resolved = await resolveBranchRootedPath(nodeId, filePath);
            if (resolved.error) {
              trace("workspace-add-file", "REJECTED", resolved.error.slice(0, 200));
              return text(`workspace-add-file rejected: ${resolved.error}`);
            }
            if (resolved.filePath !== filePath) {
              trace("workspace-add-file", "branch-root", `${filePath} → ${resolved.filePath}`);
              filePath = resolved.filePath;
            }
            if (!resolved.isInBranch) {
              const orphan = await checkProjectRootHasBranches(nodeId, filePath);
              if (orphan) {
                trace("workspace-add-file", "ORPHAN-AT-ROOT", orphan.slice(0, 200));
                return text(`workspace-add-file rejected: ${orphan}`);
              }
            }
          }

          // Syntax-error gate: if another file in this project is still
          // failing to parse, force the AI to fix it before writing
          // elsewhere. Writing to the broken file itself is always
          // allowed — that's the fix path.
          {
            const { findBlockingSyntaxError } = await import("./swarmEvents.js");
            const blocker = await findBlockingSyntaxError({
              projectNodeId: project._id,
              targetFilePath: filePath,
            });
            if (blocker) {
              const errFile = blocker?.payload?.file || blocker?.filePath;
              const line = blocker?.payload?.line;
              const msg = blocker?.payload?.message || "syntax error";
              trace("workspace-add-file", "BLOCKED-BY-SYNTAX", `${errFile} still broken`);
              return text(
                `workspace-add-file blocked: ${errFile} has an unresolved syntax error ` +
                `(line ${line}: ${msg}). Fix ${errFile} first — call workspace-read-file to see it, ` +
                `then workspace-add-file on ${errFile} with corrected content. The block lifts ` +
                `automatically once it parses.`
              );
            }
          }
          const { fileNode, created } = await resolveOrCreateFile({
            projectNodeId: project._id, relPath: filePath, userId, core,
          });
          trace("workspace-add-file", "file-node", `${created ? "created" : "reused"} ${filePath} (${fileNode._id})`);
          await writeFileContent({ fileNodeId: fileNode._id, content, userId });
          trace("workspace-add-file", "note-saved", `${bytes}b on ${fileNode._id}`);
          scheduleSync(project._id);
          trace("workspace-add-file", "OK", `${filePath} scheduled sync`);
          // Whole-file rewrite: the model's next edit starts from a
          // clean slate (it submitted the entire file, so line numbers
          // are whatever it just wrote). Clear drift state.
          _driftNoteRead(userId, filePath);
          return text(`${created ? "Created" : "Updated"} ${filePath} (${bytes}b) on node ${fileNode._id} in project "${project.name}". Auto-sync scheduled.`);
        } catch (e) {
          if (e instanceof SourceWriteRejected) {
            // Clean message for a policy rejection — don't dump a stack.
            trace("workspace-add-file", "REJECTED", e.message);
            return text(`workspace-add-file rejected: ${e.message}`);
          }
          log.error("CodeWorkspace", `workspace-add-file FAILED path=${filePath} err=${e.message}`);
          log.error("CodeWorkspace", e.stack?.split("\n").slice(0, 8).join("\n"));
          return text(`workspace-add-file failed: ${e.message}\n\nStack (first 3 frames):\n${e.stack?.split("\n").slice(0, 3).join("\n")}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-read-file: read a paginated line window from a file in
    // the active project. Line-numbered output lets edit tools reference
    // absolute positions. Defaults to 200 lines so big files (index.html,
    // bundled output) don't blow up the LLM context on subsequent calls.
    // ---------------------------------------------------------------
    {
      name: "workspace-read-file",
      description: "Read a file in the active project as a line-numbered window. Default returns first 200 lines. Use startLine (0-indexed) and limit to page through larger files. Numbered output (1-indexed) can be fed back to workspace-edit-file.",
      schema: {
        filePath: z.string().describe("Path inside your workspace. Rooted at your branch if you're inside one."),
        startLine: z.number().int().min(0).optional().describe("Zero-indexed starting line. Default 0."),
        limit: z.number().int().min(1).max(800).optional().describe("Max lines to return. Default 200, max 800."),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
      async handler({ filePath, startLine, limit, projectName, userId, rootId, nodeId }) {
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          {
            const resolved = await resolveBranchRootedPath(nodeId, filePath);
            if (resolved.error) return text(`workspace-read-file rejected: ${resolved.error}`);
            filePath = resolved.filePath;
          }
          const { fileNode, created } = await resolveOrCreateFile({
            projectNodeId: project._id, relPath: filePath, userId, core,
          });
          if (created) return text(`workspace-read-file: ${filePath} did not exist (just created as empty). Write content first.`);
          const content = await readFileContent(fileNode._id);
          if (!content) return text(`${filePath} is empty.`);
          const slice = sliceByLines(content, startLine || 0, limit || DEFAULT_READ_LINES);
          const tail = slice.remaining > 0
            ? `\n\n... ${slice.remaining} more lines. Call again with startLine=${slice.nextStart} to continue.`
            : "";
          // Reset the edit-drift counter for this file: the model just
          // saw fresh line numbers, so the next edit is trusted.
          _driftNoteRead(userId, filePath);
          return text(
            `${filePath} (${content.length}b, ${slice.totalLines} lines) — showing ${slice.rangeLabel}:\n` +
            "```\n" + slice.body + "\n```" + tail,
          );
        } catch (e) {
          return text(`workspace-read-file failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-peek-sibling-file: read-only access to a sibling
    // branch's file. Each branch's subtree is exclusively its own for
    // writes; this tool is how a branch's AI checks what its siblings
    // actually built before composing code that depends on their shape.
    // The full file content is returned; no edit tool exists for
    // siblings (their subtree is off-limits to writes from here).
    // ---------------------------------------------------------------
    {
      name: "workspace-peek-sibling-file",
      description:
        "Read a file from a SIBLING branch. Each branch's subtree is " +
        "write-scoped to itself; use this tool to see what a sibling " +
        "has actually built before writing code that depends on it. " +
        "siblingName matches the branch name (as shown in the Sibling " +
        "Branches context block). filePath is relative to the sibling's " +
        "branch root.",
      schema: {
        siblingName: z.string().describe("The sibling branch's name (e.g. 'backend', 'shared')."),
        filePath: z.string().describe("Path relative to that sibling branch's root (e.g. 'server.js', 'src/auth.js')."),
      },
      annotations: { readOnlyHint: true },
      async handler({ siblingName, filePath, nodeId }) {
        try {
          const { getExtension } = await import("../loader.js");
          const sw = getExtension("swarm")?.exports;
          if (!sw?.readSiblingNode) return text(`workspace-peek-sibling-file: swarm extension unavailable.`);
          const result = await sw.readSiblingNode(nodeId, siblingName, filePath);
          if (!result) return text(`workspace-peek-sibling-file: no file at ${siblingName}/${filePath}.`);
          const notes = Array.isArray(result.notes) ? result.notes : [];
          if (notes.length === 0) return text(`${siblingName}/${filePath} exists but has no content yet.`);
          const body = notes[0].content || "";
          const truncated = notes[0].truncated ? "\n\n... (truncated)" : "";
          return text(
            `${siblingName}/${filePath} (${body.length}b, read-only):\n` +
            "```\n" + body + "\n```" + truncated,
          );
        } catch (err) {
          return text(`workspace-peek-sibling-file failed: ${err.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-edit-file: line-range edit on a file's note. Delegates
    // to the kernel's editNote() which does the splice, size check,
    // hooks, contribution logging, cascade trigger. This is the cheap
    // incremental path — small surgical edits don't need a full
    // workspace-add-file rewrite. Use startLine alone to insert before
    // that line, or startLine+endLine to replace the range [start,end).
    // ---------------------------------------------------------------
    {
      name: "workspace-edit-file",
      description: "Edit a file in the active project by line range. Replaces lines [startLine, endLine) with `content` (both 1-indexed and inclusive in user terms — this tool converts to 0-indexed internally). Omit endLine to insert `content` before startLine. Use this for small surgical edits instead of rewriting the whole file. The success response reports the new total line count plus a small post-edit window of what actually landed — trust those numbers over your own memory when planning a second edit in the same turn, since any length-changing edit shifts every line below it.",
      schema: {
        filePath: z.string().describe("Path inside your workspace. Rooted at your branch if you're inside one."),
        content: z.string().describe("New content to splice in (can be multi-line)."),
        startLine: z.number().int().min(1).describe("1-indexed start line. With endLine, the start of the replaced range. Alone, the line to insert before."),
        endLine: z.number().int().min(1).optional().describe("1-indexed exclusive end line. Omit to insert without replacing."),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
      async handler({ filePath, content, startLine, endLine, projectName, userId, rootId, nodeId }) {
        const bytes = Buffer.byteLength(content || "", "utf8");
        trace("workspace-edit-file", "CALL", `path=${filePath} lines=${startLine}-${endLine ?? "(insert)"} bytes=${bytes}`);

        // Edit-drift guard: chained edits without a re-read accumulate
        // offset drift and land at the wrong place. If we've already
        // edited this file in this user's session without a read since,
        // reject and tell the model to refresh its line numbers or
        // switch to workspace-add-file. Resolution happens after the
        // branch-rooted path resolution below.
        try {
          const preResolved = await resolveBranchRootedPath(nodeId, filePath);
          const resolvedPath = preResolved?.error ? filePath : preResolved.filePath;
          const driftMsg = _driftCheckBeforeEdit(userId, resolvedPath);
          if (driftMsg) {
            trace("workspace-edit-file", "DRIFT-REJECTED", resolvedPath);
            return text(driftMsg);
          }
        } catch {}

        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          {
            const resolved = await resolveBranchRootedPath(nodeId, filePath);
            if (resolved.error) {
              trace("workspace-edit-file", "REJECTED", resolved.error.slice(0, 200));
              return text(`workspace-edit-file rejected: ${resolved.error}`);
            }
            if (resolved.filePath !== filePath) {
              trace("workspace-edit-file", "branch-root", `${filePath} → ${resolved.filePath}`);
              filePath = resolved.filePath;
            }
            if (!resolved.isInBranch) {
              const orphan = await checkProjectRootHasBranches(nodeId, filePath);
              if (orphan) {
                trace("workspace-edit-file", "ORPHAN-AT-ROOT", orphan.slice(0, 200));
                return text(`workspace-edit-file rejected: ${orphan}`);
              }
            }
          }

          // Syntax-error gate with a twist for the EDIT tool: if the
          // target file itself is the broken one, we STILL reject the
          // call and force workspace-add-file (full rewrite) instead.
          // Chained edits on a file whose offsets are already wrong
          // produce "fixes" that accumulate duplicate declarations and
          // dangling tokens — exactly the failure mode that left
          // whiteboard2's index.js with `const canvas = ...;width, height);`.
          // Full rewrites never drift.
          {
            const { findBlockingSyntaxError } = await import("./swarmEvents.js");
            const blockerElsewhere = await findBlockingSyntaxError({
              projectNodeId: project._id,
              targetFilePath: filePath,
            });
            if (blockerElsewhere) {
              const errFile = blockerElsewhere?.payload?.file || blockerElsewhere?.filePath;
              const line = blockerElsewhere?.payload?.line;
              const msg = blockerElsewhere?.payload?.message || "syntax error";
              trace("workspace-edit-file", "BLOCKED-BY-SYNTAX", `${errFile} still broken`);
              return text(
                `workspace-edit-file blocked: ${errFile} has an unresolved syntax error ` +
                `(line ${line}: ${msg}). Fix ${errFile} first — call workspace-read-file to see it, ` +
                `then rewrite it with workspace-add-file. The block lifts once it parses.`
              );
            }
            // Is THIS file the broken one? Check by asking with a
            // target path that couldn't possibly equal the broken one
            // (a sentinel). Any match means the target file itself is
            // broken; reject with full-rewrite instruction.
            const blockerSelf = await findBlockingSyntaxError({
              projectNodeId: project._id,
              targetFilePath: "\u0000__edit_gate_sentinel__\u0000",
            });
            if (blockerSelf) {
              const errFile = blockerSelf?.payload?.file || blockerSelf?.filePath;
              if (errFile === filePath) {
                const line = blockerSelf?.payload?.line;
                const msg = blockerSelf?.payload?.message || "syntax error";
                trace("workspace-edit-file", "REJECT-EDIT-BROKEN-FILE", `${filePath} is broken`);
                return text(
                  `workspace-edit-file rejected: ${filePath} is the file with an unresolved ` +
                  `syntax error (line ${line}: ${msg}). Splice edits on a file with broken ` +
                  `offsets accumulate duplicate declarations and dangling tokens. Use ` +
                  `workspace-read-file to see the current state, then workspace-add-file ` +
                  `with the FULL corrected content in one shot. Do not try to edit.`
                );
              }
            }
          }

          const { fileNode, created } = await resolveOrCreateFile({
            projectNodeId: project._id, relPath: filePath, userId, core,
          });
          if (created) return text(`workspace-edit-file: ${filePath} did not exist. Use workspace-add-file to create it first.`);

          // Find the current text note for this file.
          const Note = (await import("../../seed/models/note.js")).default;
          const note = await Note.findOne({ nodeId: fileNode._id, contentType: "text" })
            .sort({ createdAt: -1 });
          if (!note) return text(`workspace-edit-file: ${filePath} has no content yet. Use workspace-add-file.`);

          // Source-tree gate. workspace.js keeps checkSourceGate private, so we
          // inline the same ancestor walk here — editNote itself doesn't know
          // about the source-tree policy.
          {
            const { default: N } = await import("../../seed/models/node.js");
            let currentId = String(fileNode._id);
            let guard = 0;
            while (currentId && guard < 128) {
              const n = await N.findById(currentId).select("_id parent metadata").lean();
              if (!n) break;
              const data = n.metadata instanceof Map ? n.metadata.get("code-workspace") : n.metadata?.["code-workspace"];
              if (data?.isSourceTree) {
                if (data.writeMode !== "free") {
                  trace("workspace-edit-file", "REJECTED", ".source writeMode is not 'free'");
                  return text(`workspace-edit-file rejected: .source is read-only. Flip with 'source-mode free' to allow writes.`);
                }
                break;
              }
              if (!n.parent) break;
              currentId = String(n.parent);
              guard++;
            }
          }

          // editNote wants 0-indexed lineStart/lineEnd. Convert from 1-indexed user values.
          const { editNote } = await import("../../seed/tree/notes.js");
          const lineStart0 = Math.max(0, (startLine | 0) - 1);
          const lineEnd0 = endLine != null ? Math.max(lineStart0, (endLine | 0) - 1) : null;

          const oldLineCount = (note.content || "").split("\n").length;

          const result = await editNote({
            noteId: note._id,
            content,
            userId: note.userId, // preserve original authorship so the edit is accepted
            lineStart: lineStart0,
            lineEnd: lineEnd0,
            wasAi: true,
          });

          scheduleSync(project._id);
          trace("workspace-edit-file", "OK", `${filePath} ${result.message || "updated"}`);
          _driftNoteEdit(userId, filePath);

          // Post-edit context window. Edits that change line count leave the
          // agent's mental line-number map stale. A subsequent edit in the
          // same turn will either miss or fail with "Invalid line range".
          // Surface the new total plus a small window of what actually
          // landed so the agent can self-correct offsets (and visually
          // verify it didn't accidentally drop a function it still calls).
          const newText = result?.Note?.content ?? "";
          const newLines = newText.length ? newText.split("\n") : [];
          const newTotal = newLines.length;
          const insertedCount = (content || "").split("\n").length;
          const windowStart1 = Math.max(1, startLine - 2);
          const windowEnd1 = Math.min(newTotal, startLine - 1 + insertedCount + 2);
          const windowLines = [];
          for (let i = windowStart1; i <= windowEnd1; i++) {
            const s = newLines[i - 1] ?? "";
            windowLines.push(`  ${String(i).padStart(4, " ")}  ${s}`);
          }
          const contextBlock = windowLines.length
            ? `\nPost-edit (lines ${windowStart1}-${windowEnd1}):\n${windowLines.join("\n")}`
            : "";
          return text(
            `Edited ${filePath} lines ${startLine}-${endLine ?? "(insert)"}: ${result.message || "updated"}. ` +
            `File now ${newTotal} lines (was ${oldLineCount}). Auto-sync scheduled.` +
            contextBlock
          );
        } catch (e) {
          trace("workspace-edit-file", "FAILED", e.message);
          return text(`workspace-edit-file failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-list: flat file listing under the active project
    // ---------------------------------------------------------------
    {
      name: "workspace-list",
      description: "List every file in the active project with its size. Useful to see the project layout before editing.",
      schema: {
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
      async handler({ projectName, userId, rootId, nodeId }) {
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          const files = await walkProjectFiles(project._id);
          if (files.length === 0) return text(`Project "${project.name}" has no files yet.`);
          const lines = files.map(f => `  ${f.filePath} (${(f.content || "").length}b)`).join("\n");
          return text(`Files in "${project.name}":\n${lines}`);
        } catch (e) {
          return text(`workspace-list failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-delete-file: remove a file node (and its note) from
    // the project
    // ---------------------------------------------------------------
    {
      name: "workspace-delete-file",
      description: "Delete a file from the active project. Removes the file node and its content note from the tree.",
      schema: {
        filePath: z.string(),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
      async handler({ filePath, projectName, userId, rootId, nodeId }) {
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          const { fileNode, created } = await resolveOrCreateFile({
            projectNodeId: project._id, relPath: filePath, userId, core,
          });
          if (created) return text(`workspace-delete-file: ${filePath} did not exist.`);
          // Remove notes first, then the node itself via core tree helper
          const Note = (await import("../../seed/models/note.js")).default;
          await Note.deleteMany({ nodeId: fileNode._id });
          if (core?.tree?.deleteNodeBranch) {
            await core.tree.deleteNodeBranch(fileNode._id, userId);
          } else {
            await Node.deleteOne({ _id: fileNode._id });
            await Node.updateOne({ _id: fileNode.parent }, { $pull: { children: fileNode._id } });
          }
          scheduleSync(project._id);
          return text(`Deleted ${filePath} from "${project.name}". Auto-synced.`);
        } catch (e) {
          return text(`workspace-delete-file failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-sync: compile the tree into real files on disk.
    // Book-style depth-first walk of file nodes.
    // ---------------------------------------------------------------
    {
      name: "workspace-sync",
      description: "Write every file in the active project to disk (compile tree → files). Uses a depth-first walker like the book extension. Run this before tests, builds, or publishing.",
      schema: {
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
      async handler({ projectName, userId, rootId, nodeId }) {
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          const res = await syncUp(project._id);
          return text(`Synced "${res.projectName}" to ${res.workspacePath}. Wrote ${res.written.length} file(s), ${res.skipped.length} unchanged.`);
        } catch (e) {
          return text(`workspace-sync failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-run: spawn a whitelisted binary inside the workspace
    // dir. Supports node, npm, npx, git, and anything under
    // <workspace>/node_modules/.bin/.
    // ---------------------------------------------------------------
    {
      name: "workspace-run",
      description: "Run a command inside the active project's workspace directory. Only node, npm, npx, git, and local node_modules/.bin binaries are allowed. Output is capped at 64KB. Use this for builds, linters, one-off scripts.",
      schema: {
        binary: z.string().describe("Binary name (e.g. 'node', 'npm', 'npx')."),
        args: z.array(z.string()).describe("Arguments passed to the binary."),
        timeoutMs: z.number().optional().describe("Override default timeout."),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
      async handler({ binary, args, timeoutMs, projectName, userId, rootId, nodeId }) {
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          // Sync first so disk matches tree
          await syncUp(project._id);
          const workspacePath = getWorkspacePath(project);
          const res = await runInWorkspace({
            workspacePath,
            binary,
            args: args || [],
            timeoutMs: timeoutMs || DEFAULTS.buildMs,
          });
          const status = res.timedOut ? "TIMEOUT" : (res.exitCode === 0 ? "OK" : `EXIT ${res.exitCode}`);
          const parts = [
            `workspace-run ${binary} ${(args || []).join(" ")} → ${status} (${res.durationMs}ms)`,
          ];
          if (res.stdout) parts.push(`stdout:\n${res.stdout}`);
          if (res.stderr) parts.push(`stderr:\n${res.stderr}`);
          return text(parts.join("\n\n"));
        } catch (e) {
          return text(`workspace-run failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-test: detect and run tests. Prefers an explicit
    // test.js at the project root, falls back to `node --test` on
    // the project dir.
    // ---------------------------------------------------------------
    {
      name: "workspace-test",
      description: "Run the project's tests using Node's built-in runner. Syncs the tree to disk first, then runs node --test. Returns passed/failed counts plus raw output.",
      schema: {
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
      async handler({ projectName, userId, rootId, nodeId }) {
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          const { workspacePath } = await syncUp(project._id);
          // Install declared deps before running tests. Without this the
          // AI's test files fail with ERR_MODULE_NOT_FOUND on the first
          // run after it writes a package.json with dependencies.
          try {
            const { ensureDepsInstalled } = await import("./serve/spawner.js");
            const ir = await ensureDepsInstalled(workspacePath);
            if (!ir.ok) {
              return text(`workspace-test: npm install failed before running tests:\n${ir.output || "(no output)"}`);
            }
          } catch (installErr) {
            log.warn("CodeWorkspace", `workspace-test: ensureDepsInstalled threw: ${installErr.message}`);
          }
          const fs = await import("fs/promises");
          const explicit = [];
          try {
            const entries = await fs.readdir(workspacePath);
            for (const entry of entries) {
              if (/^(test|tests)\.m?js$/.test(entry) || /\.test\.m?js$/.test(entry)) {
                explicit.push(entry);
              }
            }
          } catch {}
          const args = ["--test"];
          if (explicit.length > 0) args.push(...explicit);
          else args.push(".");
          const res = await runInWorkspace({
            workspacePath,
            binary: "node",
            args,
            timeoutMs: DEFAULTS.testMs,
          });
          const passed = res.exitCode === 0 && !res.timedOut;
          const parts = [
            `workspace-test "${project.name}": ${passed ? "PASSED" : "FAILED"} (exit ${res.exitCode}${res.timedOut ? ", timed out" : ""})`,
          ];
          if (res.stdout) parts.push(res.stdout);
          if (res.stderr) parts.push(`stderr:\n${res.stderr}`);
          return text(parts.join("\n"));
        } catch (e) {
          return text(`workspace-test failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // source-read: read a file from the .source self-tree.
    // Path is relative to the .source project root and may start with
    // "extensions/..." or "seed/...". Returns the current note content
    // of the file node. This is how generator modes pull real TreeOS
    // code as reference before writing new extensions, tools, modes.
    // ---------------------------------------------------------------
    {
      name: "source-read",
      description: "Read a file from the .source self-tree as a line-numbered window. Default returns first 200 lines. Use startLine (0-indexed) and limit to page through larger files. Path is relative to .source root, e.g. 'extensions/fitness/manifest.js'.",
      schema: {
        filePath: z.string().describe("Path relative to .source root (e.g. 'extensions/fitness/tools.js')."),
        startLine: z.number().int().min(0).optional().describe("Zero-indexed starting line. Default 0."),
        limit: z.number().int().min(1).max(800).optional().describe("Max lines to return. Default 200, max 800."),
      },
      annotations: { readOnlyHint: true },
      async handler({ filePath, startLine, limit }) {
        try {
          // Normalize: strip any leading /.source/ or .source/ prefix so
          // the LLM can pass either form.
          let rel = String(filePath || "").trim();
          rel = rel.replace(/^\/?\.source\//, "");
          rel = rel.replace(/^\/+/, "");
          if (!rel) return text("source-read: filePath required");

          const project = await getSourceProject();
          if (!project) return text("source-read: .source project not initialized yet.");

          // Pure lookup — never create placeholder nodes for bad paths.
          const fileNode = await findFileByPath(project._id, rel);
          if (!fileNode) {
            return text(
              `source-read: "${rel}" not found in .source. Try source-list to see what's available, ` +
              `or check your path (paths are relative to .source root, e.g. 'extensions/fitness/manifest.js').`,
            );
          }
          const content = await readFileContent(fileNode._id);
          if (!content) return text(`source-read: "${rel}" exists but has no content (may have been pruned or skipped during ingest).`);
          const slice = sliceByLines(content, startLine || 0, limit || DEFAULT_READ_LINES);
          const tail = slice.remaining > 0
            ? `\n\n... ${slice.remaining} more lines. Call again with startLine=${slice.nextStart} to continue.`
            : "";
          return text(
            `.source/${rel} (${content.length}b, ${slice.totalLines} lines) — showing ${slice.rangeLabel}:\n` +
            "```\n" + slice.body + "\n```" + tail,
          );
        } catch (e) {
          return text(`source-read failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // source-list: list files in a .source subdirectory.
    // Lets the AI discover what's available before calling source-read.
    // Path is relative to .source root; empty path lists top-level.
    // ---------------------------------------------------------------
    {
      name: "source-list",
      description: "List files under a subdirectory of .source (the live TreeOS codebase). Useful for discovering available references. Path is relative to .source root; omit it to list top-level (extensions + seed). For a specific extension, pass e.g. 'extensions/fitness'.",
      schema: {
        subdir: z.string().optional().describe("Subdirectory relative to .source root. Empty = top level."),
      },
      annotations: { readOnlyHint: true },
      async handler({ subdir }) {
        try {
          const project = await getSourceProject();
          if (!project) return text("source-list: .source project not initialized yet.");

          let dirPrefix = String(subdir || "").trim();
          dirPrefix = dirPrefix.replace(/^\/?\.source\//, "");
          dirPrefix = dirPrefix.replace(/^\/+|\/+$/g, "");

          const allFiles = await walkProjectFiles(project._id);
          const matching = dirPrefix
            ? allFiles.filter((f) => f.filePath === dirPrefix || f.filePath.startsWith(dirPrefix + "/"))
            : allFiles;

          if (matching.length === 0) {
            return text(`source-list: no files found under .source/${dirPrefix || ""}.`);
          }

          // Cap output and group by top-level directory for scanability
          const capped = matching.slice(0, 200);
          const lines = capped.map((f) => `  ${f.filePath} (${(f.content || "").length}b)`);
          const more = matching.length > capped.length ? `\n  ... and ${matching.length - capped.length} more` : "";
          return text(`Files in .source/${dirPrefix || "(root)"}:\n${lines.join("\n")}${more}\n\nTotal: ${matching.length} files.`);
        } catch (e) {
          return text(`source-list failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-probe: fire an HTTP request at the project's running
    // preview. Resolves the active project from the AI's tree position
    // (same as every other workspace tool), looks up its preview entry
    // in the registry, and routes the request to 127.0.0.1:<childPort>.
    //
    // Auto-starts the preview if it isn't running yet — the AI shouldn't
    // have to issue a separate "start preview" tool call before its
    // first probe. Idempotent re-spawning is already handled by
    // startPreview (returns existing entry if alive).
    //
    // The AI's natural workflow becomes:
    //   workspace-add-file backend/server.js
    //   workspace-probe POST /api/auth/login {"email":"a","password":"b"}
    //   → 200 {"sessionId":"...","user":{...}}
    //   workspace-edit-file ...
    //   workspace-probe GET /api/profiles
    //   → 200 [...]
    //   [[DONE]]
    //
    // Eyes during writes, not just after.
    // ---------------------------------------------------------------
    {
      name: "workspace-probe",
      description: "Make an HTTP request to your project's running preview server. Use this AFTER writing a route handler to verify it actually works — not just that it parses. Auto-starts the preview if it isn't running. Returns status code, response headers, and the first 4KB of body. Use this BEFORE declaring [[DONE]] on any route work.",
      schema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).describe("HTTP method"),
        path: z.string().describe("Path on the preview server, e.g. '/api/auth/login' or '/' — must start with /"),
        body: z.string().optional().describe("Request body (JSON string, form data, etc.). Defaults to none. Auto-sets content-type: application/json if the body parses as JSON."),
        headers: z.record(z.string()).optional().describe("Extra request headers (e.g. {'x-session-id': 'abc'}). Content-Type is set automatically based on body."),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
      async handler({ method, path: urlPath, body, headers, projectName, userId, rootId, nodeId }) {
        if (!urlPath || !urlPath.startsWith("/")) {
          return text(`workspace-probe: path must start with / (got "${urlPath}")`);
        }
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });

          // Resolve the branch context — what branch is the AI inside
          // when it fires this probe? Used for tree-state attribution
          // (verifiedEndpoint.probedBy, signal.from) and for picking
          // the right ancestor to roll the verification up to.
          const { getExtension } = await import("../loader.js");
          const sw = getExtension("swarm")?.exports;
          const { SIGNAL_KIND, pruneProbeFailureForEndpoint } = await import("./swarmEvents.js");
          const branchCtx = sw?.findBranchContext ? await sw.findBranchContext(nodeId) : null;
          const branchNode = branchCtx?.branchNode || null;
          const branchName = branchNode?.name || null;
          // Source of rollup walks: prefer the branch (if we're in
          // one), else the project node. Either way, rollup terminates
          // at the project root which gets the verified-endpoint map.
          const rollupSource = branchNode?._id || project._id;

          // Resolve or start the preview entry for this project
          let entry = getEntryByNodeId(project._id);
          if (!entry || !entry.port) {
            trace("workspace-probe", "starting-preview", `${project.name} (${project._id})`);
            try {
              const projectNode = await loadProjectNode(project._id);
              if (!projectNode) {
                return text(`workspace-probe: project "${project.name}" is not initialized. Call workspace-init first.`);
              }
              entry = await startPreview({
                projectNode,
                workspacePath: workspacePathFor(projectNode),
              });
            } catch (startErr) {
              return text(`workspace-probe: could not start preview — ${startErr.message}`);
            }
            if (!entry?.port) {
              return text(`workspace-probe: preview started but did not bind to a port. Check workspace-logs stderr for the crash.`);
            }
            // Brief grace period for the child to actually listen
            await new Promise((r) => setTimeout(r, 800));
          }

          entry.lastHit = Date.now();

          // Build request headers. Auto-set content-type for JSON bodies.
          const reqHeaders = { ...(headers || {}) };
          let bodyBuf = null;
          if (body != null && body !== "") {
            bodyBuf = Buffer.from(body, "utf8");
            const lc = Object.keys(reqHeaders).map((k) => k.toLowerCase());
            if (!lc.includes("content-type")) {
              // If body parses as JSON, assume JSON
              try {
                JSON.parse(body);
                reqHeaders["content-type"] = "application/json";
              } catch {
                reqHeaders["content-type"] = "text/plain";
              }
            }
            reqHeaders["content-length"] = String(bodyBuf.length);
          }
          reqHeaders.host = `127.0.0.1:${entry.port}`;

          const result = await new Promise((resolve) => {
            const req = http.request(
              {
                hostname: "127.0.0.1",
                port: entry.port,
                path: urlPath,
                method,
                headers: reqHeaders,
                timeout: 8000,
              },
              (res) => {
                const chunks = [];
                let total = 0;
                res.on("data", (c) => {
                  if (total < 4096) {
                    chunks.push(c);
                    total += c.length;
                  }
                });
                res.on("end", () => {
                  const responseBody = Buffer.concat(chunks).toString("utf8").slice(0, 4096);
                  resolve({
                    ok: true,
                    status: res.statusCode || 0,
                    headers: res.headers || {},
                    body: responseBody,
                    truncated: total > 4096,
                  });
                });
              },
            );
            req.on("timeout", () => {
              req.destroy();
              resolve({ ok: false, error: "request timed out after 8s" });
            });
            req.on("error", (err) => {
              resolve({ ok: false, error: err.message });
            });
            if (bodyBuf) req.end(bodyBuf);
            else req.end();
          });

          // Capture stderr tail BEFORE we examine the response so a
          // probe that triggered a crash mid-handler has the trace
          // attached to its signal.
          const stderrSnapshot = Array.isArray(entry.stderr)
            ? entry.stderr.slice(-15).join("\n")
            : "";

          // Failure path: 4xx/5xx OR network error → cascade signal
          if (!result.ok || (result.status >= 400)) {
            const status = result.status || null;
            try {
              if (sw?.appendSignal) {
                await sw.appendSignal({
                  nodeId: rollupSource,
                  signal: {
                    from: branchName || project.name || "probe",
                    kind: SIGNAL_KIND.PROBE_FAILURE,
                    filePath: null,
                    payload: {
                      method,
                      path: urlPath,
                      status,
                      reason: result.error || (status ? `HTTP ${status}` : "unknown"),
                      body: result.body || null,
                      stderrTail: stderrSnapshot || null,
                    },
                  },
                  core,
                });
              }
            } catch {}
            const reason = result.error || `HTTP ${status}`;
            const bodyTail = result.body ? `\nbody:\n${result.body.slice(0, 1000)}` : "";
            const stderrLine = stderrSnapshot
              ? `\n\nServer stderr (last 15 lines):\n${stderrSnapshot}`
              : "";
            trace("workspace-probe", "FAIL", `${method} ${urlPath} → ${status || "err"} (branch=${branchName || "-"})`);
            return text(
              `workspace-probe ${method} ${urlPath} → ${status || "ERROR"}: ${reason}\n` +
              `(signal cascaded to ${branchName ? `branch "${branchName}"` : "project"})${bodyTail}${stderrLine}`,
            );
          }

          // Success path: 2xx/3xx → rollup verifiedEndpoint + prune any
          // stale probe-failure for this endpoint
          let returnedFields = [];
          if (result.body) {
            try {
              const parsed = JSON.parse(result.body);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                returnedFields = Object.keys(parsed);
              }
            } catch {}
          }
          try {
            if (sw?.rollUpDetail) {
              await sw.rollUpDetail({
                fromNodeId: rollupSource,
                delta: {
                  verifiedEndpoint: {
                    key: `${method} ${urlPath}`,
                    status: result.status,
                    returnedFields,
                    lastVerifiedAt: new Date().toISOString(),
                    probedBy: branchName || null,
                  },
                  lastActivity: new Date().toISOString(),
                },
                core,
              });
            }
            await pruneProbeFailureForEndpoint({
              nodeId: rollupSource,
              method,
              path: urlPath,
              core,
            });
          } catch {}

          const headerLines = Object.entries(result.headers)
            .slice(0, 8)
            .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
            .join("\n");

          const bodyLine = result.body
            ? `\nbody (${result.truncated ? "truncated to 4KB" : "full"}):\n${result.body}`
            : "\nbody: (empty)";

          trace("workspace-probe", "OK", `${method} ${urlPath} → ${result.status} (branch=${branchName || "-"})`);
          return text(
            `workspace-probe ${method} ${urlPath} → ${result.status}\n` +
            headerLines +
            bodyLine +
            `\n\n(verified${branchName ? ` by ${branchName}` : ""}, rolled up to project)`,
          );
        } catch (e) {
          return text(`workspace-probe failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-logs: read the captured stdout/stderr ring buffer of
    // the project's running preview. The spawner already keeps the
    // last 200 lines of each stream — we just expose them.
    //
    // Use cases:
    //   - workspace-probe returned 500 → workspace-logs stderr to see
    //     the stack trace
    //   - the preview crashed on boot → workspace-logs stderr to see
    //     the import/syntax error the validators didn't catch
    //   - need to verify the server logged something specific (e.g.
    //     "Player joined room") → workspace-logs stdout
    // ---------------------------------------------------------------
    {
      name: "workspace-logs",
      description: "Read the last N lines of stdout or stderr from your project's running preview. Use this AFTER workspace-probe returns an error or 5xx, to see the actual stack trace. Captures the same buffer the smoke validator and preview proxy use.",
      schema: {
        stream: z.enum(["stdout", "stderr", "both"]).optional().describe("Which stream to read (default: both)"),
        lines: z.number().int().min(1).max(200).optional().describe("Max lines to return (default: 50, max: 200)"),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
      async handler({ stream, lines, projectName, userId, rootId, nodeId }) {
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          const entry = getEntryByNodeId(project._id);
          if (!entry) {
            return text(
              `workspace-logs: no preview running for "${project.name}". ` +
              `Use workspace-probe (auto-starts) or workspace-status to check state.`,
            );
          }

          const cap = Math.max(1, Math.min(lines || 50, 200));
          const which = stream || "both";

          // Read the requested streams from the registry's ring buffer
          const stdoutTail = which === "stdout" || which === "both"
            ? (Array.isArray(entry.stdout) ? entry.stdout.slice(-cap) : [])
            : null;
          const stderrTail = which === "stderr" || which === "both"
            ? (Array.isArray(entry.stderr) ? entry.stderr.slice(-cap) : [])
            : null;

          // Snapshot the read into the tree. Future enrichContext +
          // resume detection see "what was last seen here, when, and
          // by whom" instead of having to re-read the running buffer
          // (which may have rotated, or the preview may have died).
          // Stored on the branch (if we're in one) else on the project.
          try {
            const { getExtension } = await import("../loader.js");
            const sw = getExtension("swarm")?.exports;
            const ctx = sw?.findBranchContext ? await sw.findBranchContext(nodeId) : null;
            const target = ctx?.branchNode?._id || project._id;
            const snapshot = {
              readAt: new Date().toISOString(),
              readBy: ctx?.branchNode?.name || null,
              stdout: stdoutTail ? stdoutTail.slice(-30).join("\n") : null,
              stderr: stderrTail ? stderrTail.slice(-30).join("\n") : null,
              previewSlug: entry.slug || null,
              previewPort: entry.port || null,
            };
            const { default: NodeModel } = await import("../../seed/models/node.js");
            const node = await NodeModel.findById(target);
            if (node) {
              const cur = node.metadata instanceof Map
                ? node.metadata.get("code-workspace") || {}
                : node.metadata?.["code-workspace"] || {};
              const draft = { ...cur, logSnapshot: snapshot };
              if (core?.metadata?.setExtMeta) {
                await core.metadata.setExtMeta(node, "code-workspace", draft);
              } else {
                await NodeModel.updateOne(
                  { _id: target },
                  { $set: { "metadata.code-workspace": draft } },
                );
              }
            }
          } catch (snapErr) {
            // Snapshot is best-effort — never block the read on it
          }

          const out = [];
          if (stdoutTail !== null) {
            const arr = Array.isArray(entry.stdout) ? entry.stdout : [];
            out.push(`=== stdout (${stdoutTail.length} of ${arr.length} lines) ===`);
            out.push(stdoutTail.length > 0 ? stdoutTail.join("\n") : "(empty)");
          }
          if (stderrTail !== null) {
            const arr = Array.isArray(entry.stderr) ? entry.stderr : [];
            if (out.length > 0) out.push("");
            out.push(`=== stderr (${stderrTail.length} of ${arr.length} lines) ===`);
            out.push(stderrTail.length > 0 ? stderrTail.join("\n") : "(empty)");
          }

          return text(out.join("\n"));
        } catch (e) {
          return text(`workspace-logs failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-status: report the preview state for the active
    // project (and optionally all running previews). Lightweight: no
    // process probing, just registry state. Use to answer "is my
    // preview running and on what port" without calling workspace-probe.
    // ---------------------------------------------------------------
    {
      name: "workspace-status",
      description: "Report the running preview state for your project: is it up, what port, what was its start command, when was it last hit, how many bytes of stderr buffered. Cheap registry lookup — no process probing.",
      schema: {
        all: z.boolean().optional().describe("If true, list every running preview on this land instead of just this project"),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
      async handler({ all, projectName, userId, rootId, nodeId }) {
        try {
          if (all) {
            const entries = allPreviewEntries();
            if (entries.length === 0) return text("No previews running.");
            const lines = entries.map((e) => formatEntrySummary(e));
            return text(`Running previews (${entries.length}):\n` + lines.join("\n"));
          }

          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          const entry = getEntryByNodeId(project._id);
          if (!entry) {
            return text(
              `Preview for "${project.name}" is NOT running. ` +
              `Call workspace-probe (auto-starts) to spin one up, or check the project has a runnable shape (package.json scripts.start or index.html).`,
            );
          }
          return text(`Preview for "${project.name}":\n${formatEntrySummary(entry)}`);
        } catch (e) {
          return text(`workspace-status failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-plan: node-local checklist. Every node can plan for
    // its own scope. Actions:
    //   set    — overwrite the checklist with a new step list
    //   add    — append one step
    //   check  — mark one step done
    //   block  — mark one step blocked with a reason
    //   clear  — remove all steps on this node
    //   show   — read the current plan
    //
    // Steps are scoped to the node the tool is called FROM (the session's
    // currentNodeId). Rollup of descendants' step counts happens
    // automatically after any mutation — no extra calls needed.
    // ---------------------------------------------------------------
    {
      name: "workspace-plan",
      description: "Manage a node-local plan checklist for the current tree position. Every node has its own scope; children's counts roll up to parents. Actions: 'set' overwrites with new steps, 'add' appends one, 'check' marks done, 'block' marks blocked with a reason, 'clear' removes all, 'show' reads the plan. Use this to decompose a task into checkable steps and advance one per turn.",
      schema: {
        action: z.enum(["set", "add", "check", "block", "clear", "show"]).describe("What to do with the plan."),
        steps: z.array(z.string()).optional().describe("For action=set: the list of step titles. Each string becomes one step."),
        title: z.string().optional().describe("For action=add: the title of the new step."),
        stepId: z.string().optional().describe("For action=check or block: the id of the step (e.g. 's_ab12cd') as shown by action=show."),
        reason: z.string().optional().describe("For action=block: why this step is blocked."),
      },
      annotations: { readOnlyHint: false },
      async handler({ action, steps, title, stepId, reason, userId, rootId, nodeId }) {
        try {
          const targetNodeId = nodeId || rootId;
          if (!targetNodeId) return text("workspace-plan: no current node to plan for.");

          const {
            setNodePlanSteps,
            addNodePlanStep,
            updateNodePlanStep,
            clearNodePlanSteps,
            readNodePlanSteps,
            readNodeStepRollup,
            formatNodePlan,
          } = await import("./swarmEvents.js");

          const nodeDoc = await Node.findById(targetNodeId).select("name").lean();
          const nodeName = nodeDoc?.name || null;

          if (action === "show") {
            const [localSteps, rollup] = await Promise.all([
              readNodePlanSteps(targetNodeId),
              readNodeStepRollup(targetNodeId),
            ]);
            return text(formatNodePlan({ steps: localSteps || [], rollup, nodeName }));
          }

          if (action === "set") {
            if (!Array.isArray(steps) || steps.length === 0) {
              return text("workspace-plan set: requires non-empty steps[] array of titles.");
            }

            // Empty-root gate. When the caller is at a project root that
            // has no children AND no local plan yet, flat `workspace-plan
            // action=set` is almost always the wrong move for a compound
            // task — the AI ignores the compoundBranches facet and bangs
            // out a 7-step flat plan instead of decomposing. Reject here
            // and force the AI to emit [[BRANCHES]] first. If the task
            // is genuinely a single file, the AI can skip the plan and
            // call workspace-add-file directly; the gate doesn't touch
            // that path.
            try {
              const targetDoc = await Node.findById(targetNodeId).select("children metadata").lean();
              const cwTargetMeta = targetDoc?.metadata instanceof Map
                ? targetDoc.metadata.get("code-workspace")
                : targetDoc?.metadata?.["code-workspace"];
              const swTargetMeta = targetDoc?.metadata instanceof Map
                ? targetDoc.metadata.get("swarm")
                : targetDoc?.metadata?.["swarm"];
              const role = swTargetMeta?.role || cwTargetMeta?.role;
              const isProjectRole = role === "project" || role == null;
              const hasChildren = Array.isArray(targetDoc?.children) && targetDoc.children.length > 0;
              const existingStepCount = cwTargetMeta?.plan?.steps?.length || 0;
              const filesWritten = swTargetMeta?.aggregatedDetail?.filesWritten || 0;

              // Only reject at the empty-root decision point: project
              // role, no children, no prior files, no prior plan, AND
              // the AI is trying to set a multi-step plan. A 1-2 step
              // plan is a weak signal for a small task so we let it
              // through.
              if (
                isProjectRole &&
                !hasChildren &&
                existingStepCount === 0 &&
                filesWritten === 0 &&
                steps.length >= 3
              ) {
                trace(
                  "workspace-plan",
                  "BLOCKED-EMPTY-ROOT-SET",
                  `${steps.length}-step flat plan at empty project root ${String(targetNodeId).slice(0, 8)}`,
                );
                return text(
                  `workspace-plan action=set REJECTED at empty project root.\n\n` +
                  `You attempted a ${steps.length}-step flat plan at a fresh project root. ` +
                  `That is the failure mode for compound tasks — the plan would carry ` +
                  `backend, frontend, and test steps all in one session that can't hold ` +
                  `all three contexts at once.\n\n` +
                  `YOUR NEXT ACTION: emit this [[BRANCHES]] block as plain text (no tool ` +
                  `call), then [[DONE]] on its own line. DO NOT call any more tools this ` +
                  `turn. The swarm runner will parse the block and dispatch one fresh ` +
                  `code-plan session per branch. Each branch builds its own scope with ` +
                  `its own plan — that is how compound tasks succeed.\n\n` +
                  `Copy this structure verbatim, filling in real specs for the task:\n\n` +
                  `    [[BRANCHES]]\n` +
                  `    branch: backend\n` +
                  `      spec: <one paragraph — what backend owns, routes/payloads/state>\n` +
                  `      slot: code-plan\n` +
                  `      path: backend\n` +
                  `      files: package.json, server.js\n` +
                  `\n` +
                  `    branch: frontend\n` +
                  `      spec: <one paragraph — views, state, what backend calls it makes>\n` +
                  `      slot: code-plan\n` +
                  `      path: frontend\n` +
                  `      files: index.html, app.js\n` +
                  `    [[/BRANCHES]]\n` +
                  `    [[DONE]]\n\n` +
                  `Rules: every branch name MUST equal its path. Never use the project's ` +
                  `own name as a branch name. Each branch must have a unique name/path.\n\n` +
                  `If the task is genuinely a single file or a small fix, skip the plan ` +
                  `and call workspace-add-file directly for that file. You do not need ` +
                  `a plan for one file.\n\n` +
                  `This block lifts the moment you emit [[BRANCHES]] or write a file.`
                );
              }
            } catch (gateErr) {
              log.debug("CodeWorkspace", `workspace-plan empty-root gate skipped: ${gateErr.message}`);
            }

            const shaped = steps.map((t) => ({ title: String(t).trim() })).filter((s) => s.title);
            const written = await setNodePlanSteps({ nodeId: targetNodeId, steps: shaped, core });
            const rollup = await readNodeStepRollup(targetNodeId);
            return text(
              `Set ${written?.length || 0} steps on ${nodeName || targetNodeId}.\n\n` +
              formatNodePlan({ steps: written || [], rollup, nodeName }),
            );
          }

          if (action === "add") {
            if (!title || !title.trim()) {
              return text("workspace-plan add: requires title.");
            }
            const step = await addNodePlanStep({ nodeId: targetNodeId, title: title.trim(), core });
            return text(`Added step ${step?.id}: ${step?.title}`);
          }

          if (action === "check") {
            if (!stepId) return text("workspace-plan check: requires stepId.");
            const updated = await updateNodePlanStep({
              nodeId: targetNodeId,
              stepId,
              patch: { status: "done" },
              core,
            });
            if (!updated) return text(`workspace-plan check: no step with id ${stepId} on this node.`);
            const rollup = await readNodeStepRollup(targetNodeId);
            const localSteps = await readNodePlanSteps(targetNodeId);
            return text(
              `✓ ${updated.title}\n\n` +
              formatNodePlan({ steps: localSteps || [], rollup, nodeName }),
            );
          }

          if (action === "block") {
            if (!stepId) return text("workspace-plan block: requires stepId.");
            const updated = await updateNodePlanStep({
              nodeId: targetNodeId,
              stepId,
              patch: { status: "blocked", blockedReason: reason || "unspecified" },
              core,
            });
            if (!updated) return text(`workspace-plan block: no step with id ${stepId} on this node.`);
            return text(`Blocked step ${stepId}: ${updated.blockedReason}`);
          }

          if (action === "clear") {
            await clearNodePlanSteps({ nodeId: targetNodeId, core });
            return text(`Cleared plan on ${nodeName || targetNodeId}.`);
          }

          return text(`workspace-plan: unknown action "${action}".`);
        } catch (e) {
          log.warn("CodeWorkspace", `workspace-plan failed: ${e.message}`);
          return text(`workspace-plan failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // workspace-show-context: dump the enrichContext the AI is seeing.
    // Re-runs the real enrichContext hook pipeline (so extensions get
    // a fresh pass) and returns the assembled context object section
    // by section. Used by operators to audit what their model actually
    // receives and by the model itself to sanity-check its own view.
    //
    // dryRun defaults to true so inspecting state doesn't advance the
    // session's fresh-signal watermark. The orchestrator's real turn
    // path is the ONLY caller that passes dryRun=false (and only via
    // the normal hook fire, not via this tool).
    // ---------------------------------------------------------------
    {
      name: "workspace-show-context",
      description: "Show the enrichContext the AI receives for the current session's tree position. Re-runs the real hook pipeline (safe, read-only by default) and returns every extension-populated context key. Use this to verify the project plan tree, fresh signals, contracts, position breadcrumb, and aggregated detail match what you expect.",
      schema: {},
      annotations: { readOnlyHint: true },
      async handler({ userId, rootId, nodeId, sessionId }) {
        try {
          if (!sessionId) {
            return text("workspace-show-context: no sessionId available for the current call.");
          }
          const cw = await import("./sessionWatch.js");
          const dump = await cw.dumpContextForSession(sessionId, core, { dryRun: true });
          if (dump.error) {
            return text(`workspace-show-context: ${dump.error}`);
          }
          const ctx = dump.context || {};
          const keys = Object.keys(ctx);
          if (keys.length === 0) {
            return text(
              `(no enrichContext keys populated)\n` +
              `watchedNodeId=${dump.watchedNodeId} projectId=${dump.projectId}\n` +
              `This usually means the session isn't registered as a watcher. ` +
              `Navigate to a project or branch node and try again.`,
            );
          }
          const lines = [`# enrichContext dump for session ${sessionId.slice(0, 12)}`];
          lines.push(`watchedNodeId: ${dump.watchedNodeId}`);
          if (dump.projectId) lines.push(`projectId: ${dump.projectId}`);
          lines.push("");
          for (const key of keys) {
            const val = ctx[key];
            lines.push(`## ${key}`);
            if (typeof val === "string") {
              lines.push(val);
            } else {
              try {
                lines.push(JSON.stringify(val, null, 2));
              } catch {
                lines.push(String(val));
              }
            }
            lines.push("");
          }
          return text(lines.join("\n"));
        } catch (e) {
          return text(`workspace-show-context failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // source-mode: flip the writeMode on the .source self-tree.
    // .source is the TreeOS codebase reflected as a tree (see source.js).
    // Default mode is "disabled" — the AI can read land/extensions and
    // land/seed content freely but cannot write. "free" unlocks writes
    // to extensions files (seed is always read-only). "approve" is
    // reserved for Phase 2 when the approve extension gets wired in.
    // ---------------------------------------------------------------
    {
      name: "source-mode",
      description: "Set the write policy for the .source self-tree (the TreeOS codebase as tree nodes). Modes: disabled (default, read-only), approve (Phase 2, not yet wired), free (writes go through, edits propagate to land/ on disk). Seed is always read-only regardless of mode.",
      schema: {
        mode: z.enum(["disabled", "approve", "free"]).describe("disabled | approve | free"),
      },
      annotations: { readOnlyHint: false },
      async handler({ mode }) {
        try {
          const { previous, current } = await setSourceWriteMode(mode);
          trace("source-mode", "SET", `${previous} → ${current}`);
          if (current === "free") {
            return text(
              `.source writeMode: ${previous} → free. ` +
              `The AI can now edit extension files. land/seed/ remains read-only.`,
            );
          }
          if (current === "approve") {
            return text(
              `.source writeMode: ${previous} → approve. ` +
              `Note: approve-gating is not yet wired (Phase 2). Writes will be rejected with a "not yet wired" message. Use 'free' for now.`,
            );
          }
          return text(`.source writeMode: ${previous} → ${current}. All writes blocked.`);
        } catch (e) {
          return text(`source-mode failed: ${e.message}`);
        }
      },
    },
  ];
}
