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
import Node from "../../seed/models/node.js";
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

  // Priority 4: explicit name with no existing project → create a new child.
  if (!name) throw new Error("no active workspace and no rootId to auto-init");
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
    // workspace-read-file: read the latest note content of a file
    // node. Use this before overwriting so the AI sees the current
    // state.
    // ---------------------------------------------------------------
    {
      name: "workspace-read-file",
      description: "Read the current content of a file in the active project. Returns the file's latest note text.",
      schema: {
        filePath: z.string().describe("Path relative to the project root."),
        projectName: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
      async handler({ filePath, projectName, userId, rootId, nodeId }) {
        try {
          const project = await ensureProject({ rootId, currentNodeId: nodeId, userId, core, name: projectName });
          const { fileNode, created } = await resolveOrCreateFile({
            projectNodeId: project._id, relPath: filePath, userId, core,
          });
          if (created) return text(`workspace-read-file: ${filePath} did not exist (just created as empty). Write content first.`);
          const content = await readFileContent(fileNode._id);
          const truncated = content.length > 20000 ? content.slice(0, 20000) + "\n... (truncated)" : content;
          return text(`${filePath} (${content.length}b):\n\`\`\`\n${truncated}\n\`\`\``);
        } catch (e) {
          return text(`workspace-read-file failed: ${e.message}`);
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
      description: "Read a file from the .source self-tree (the live TreeOS codebase ingested at boot). Use this to pull real examples from existing extensions before writing new code. Path is relative to .source root, e.g. 'extensions/fitness/manifest.js' or 'seed/protocol.js'.",
      schema: {
        filePath: z.string().describe("Path relative to .source root (e.g. 'extensions/fitness/tools.js')."),
      },
      annotations: { readOnlyHint: true },
      async handler({ filePath }) {
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
          const trimmed = content.length > 20000 ? content.slice(0, 20000) + "\n... (truncated)" : content;
          return text(`.source/${rel} (${content.length}b):\n\`\`\`\n${trimmed}\n\`\`\``);
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
