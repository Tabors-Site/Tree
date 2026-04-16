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
 * Walk up from the current tree position to find the nearest swarm
 * branch node with a declared path, and return the path prefix (or
 * null if no branch ancestor). Used by the write/read tools to enforce
 * that branch file operations land UNDER the branch's declared path.
 *
 * Without this, the LLM occasionally drops the `backend/` prefix when
 * writing a file (forgetting which branch it's in) and the file lands
 * at the workspace root — which confuses the smoke validator, the
 * sync engine, and every downstream consumer. The tools now auto-
 * prefix to the branch path so the model physically can't mis-target.
 */
async function resolveBranchPrefix(nodeId) {
  if (!nodeId) return null;
  try {
    const { findBranchContext } = await import("./swarmEvents.js");
    const ctx = await findBranchContext(nodeId);
    const branch = ctx?.branchNode;
    if (!branch) return null;
    const meta = branch.metadata instanceof Map
      ? branch.metadata.get("code-workspace")
      : branch.metadata?.["code-workspace"];
    const prefix = meta?.path;
    if (!prefix || typeof prefix !== "string") return null;
    return prefix.replace(/^\/+/, "").replace(/\/+$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * If `filePath` isn't already under `branchPrefix`, prepend it. Returns
 * { filePath, rewrote } so callers can log when the rewrite happened.
 * Idempotent: files that are already correctly prefixed pass through.
 * Accepts `branchPrefix === null` as a no-op so the helper is safe
 * to call unconditionally.
 */
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

function applyBranchPrefix(filePath, branchPrefix) {
  if (!branchPrefix) return { filePath, rewrote: false };
  if (filePath === branchPrefix) return { filePath, rewrote: false };
  if (filePath.startsWith(branchPrefix + "/")) return { filePath, rewrote: false };
  return { filePath: `${branchPrefix}/${filePath}`, rewrote: true };
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
        filePath: z.string().describe("Path relative to the project root (e.g. 'index.js' or 'lib/helper.js')."),
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
          // Enforce branch path prefix. If the caller is operating
          // inside a swarm branch with a declared path, any file it
          // writes MUST live under that path — else the file lands at
          // the project root, confusing smoke validation and downstream
          // consumers. Rewrite quietly; log the rewrite so the trace
          // shows what happened.
          const branchPrefix = await resolveBranchPrefix(nodeId);
          const prefixed = applyBranchPrefix(filePath, branchPrefix);
          if (prefixed.rewrote) {
            trace("workspace-add-file", "branch-prefix", `${filePath} → ${prefixed.filePath}`);
            filePath = prefixed.filePath;
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
        filePath: z.string().describe("Path relative to the project root."),
        startLine: z.number().int().min(0).optional().describe("Zero-indexed starting line. Default 0."),
        limit: z.number().int().min(1).max(800).optional().describe("Max lines to return. Default 200, max 800."),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
      async handler({ filePath, startLine, limit, projectName, userId, rootId, nodeId }) {
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          const branchPrefix = await resolveBranchPrefix(nodeId);
          const prefixed = applyBranchPrefix(filePath, branchPrefix);
          if (prefixed.rewrote) filePath = prefixed.filePath;
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
    // workspace-edit-file: line-range edit on a file's note. Delegates
    // to the kernel's editNote() which does the splice, size check,
    // hooks, contribution logging, cascade trigger. This is the cheap
    // incremental path — small surgical edits don't need a full
    // workspace-add-file rewrite. Use startLine alone to insert before
    // that line, or startLine+endLine to replace the range [start,end).
    // ---------------------------------------------------------------
    {
      name: "workspace-edit-file",
      description: "Edit a file in the active project by line range. Replaces lines [startLine, endLine) with `content` (both 1-indexed and inclusive in user terms — this tool converts to 0-indexed internally). Omit endLine to insert `content` before startLine. Use this for small surgical edits instead of rewriting the whole file.",
      schema: {
        filePath: z.string().describe("Path relative to the project root."),
        content: z.string().describe("New content to splice in (can be multi-line)."),
        startLine: z.number().int().min(1).describe("1-indexed start line. With endLine, the start of the replaced range. Alone, the line to insert before."),
        endLine: z.number().int().min(1).optional().describe("1-indexed exclusive end line. Omit to insert without replacing."),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
      async handler({ filePath, content, startLine, endLine, projectName, userId, rootId, nodeId }) {
        const bytes = Buffer.byteLength(content || "", "utf8");
        trace("workspace-edit-file", "CALL", `path=${filePath} lines=${startLine}-${endLine ?? "(insert)"} bytes=${bytes}`);
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          const branchPrefix = await resolveBranchPrefix(nodeId);
          const prefixed = applyBranchPrefix(filePath, branchPrefix);
          if (prefixed.rewrote) {
            trace("workspace-edit-file", "branch-prefix", `${filePath} → ${prefixed.filePath}`);
            filePath = prefixed.filePath;
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
          return text(`Edited ${filePath} lines ${startLine}-${endLine ?? "(insert)"}: ${result.message || "updated"}. Auto-sync scheduled.`);
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
            await core.tree.deleteNodeBranch({ nodeId: fileNode._id, userId });
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
          const { findBranchContext, rollUpDetail, appendSignalInbox, SIGNAL_KIND, pruneProbeFailureForEndpoint } =
            await import("./swarmEvents.js");
          const branchCtx = await findBranchContext(nodeId);
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
              await appendSignalInbox({
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
            await rollUpDetail({
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
            const { findBranchContext } = await import("./swarmEvents.js");
            const ctx = await findBranchContext(nodeId);
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
              const draft = { ...cur };
              if (!draft.aggregatedDetail) draft.aggregatedDetail = {};
              draft.aggregatedDetail.recentLogSnapshot = snapshot;
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
              const targetMeta = targetDoc?.metadata instanceof Map
                ? targetDoc.metadata.get("code-workspace")
                : targetDoc?.metadata?.["code-workspace"];
              const isProjectRole = targetMeta?.role === "project" || targetMeta?.role == null;
              const hasChildren = Array.isArray(targetDoc?.children) && targetDoc.children.length > 0;
              const existingStepCount = targetMeta?.subPlan?.steps?.length || 0;
              const filesWritten = targetMeta?.aggregatedDetail?.filesWritten || 0;

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
