import log from "../../seed/log.js";
import getWorkspaceTools from "./tools.js";
import { readMeta } from "./workspace.js";
import { ensureSourceTree } from "./source.js";

import planMode from "./modes/plan.js";
import logMode from "./modes/log.js";
import coachMode from "./modes/coach.js";
import askMode from "./modes/ask.js";
import reviewMode from "./modes/review.js";

export async function init(core) {
  // LLM slots: one per mode so operators can pin a cheap model to
  // ask/coach and a strong model to plan/log.
  try {
    core.llm?.registerRootLlmSlot?.("code-plan");
    core.llm?.registerRootLlmSlot?.("code-log");
    core.llm?.registerRootLlmSlot?.("code-coach");
    core.llm?.registerRootLlmSlot?.("code-ask");
    core.llm?.registerRootLlmSlot?.("code-review");
  } catch {}

  core.modes.registerMode("tree:code-plan", planMode, "code-workspace");
  core.modes.registerMode("tree:code-log", logMode, "code-workspace");
  core.modes.registerMode("tree:code-coach", coachMode, "code-workspace");
  core.modes.registerMode("tree:code-ask", askMode, "code-workspace");
  core.modes.registerMode("tree:code-review", reviewMode, "code-workspace");

  try {
    core.llm?.registerModeAssignment?.("tree:code-plan", "code-plan");
    core.llm?.registerModeAssignment?.("tree:code-log", "code-log");
    core.llm?.registerModeAssignment?.("tree:code-coach", "code-coach");
    core.llm?.registerModeAssignment?.("tree:code-ask", "code-ask");
    core.llm?.registerModeAssignment?.("tree:code-review", "code-review");
  } catch {}

  // Enrich context when the user is inside a project or a file node.
  // Reads from our single namespace ("code-workspace") and distinguishes
  // project vs file vs directory via the role field.
  core.hooks.register(
    "enrichContext",
    async ({ context, meta }) => {
      const data = meta?.["code-workspace"];
      if (!data || typeof data !== "object") return;
      if (data.role === "project") {
        context.workspace = {
          name: data.name || null,
          workspacePath: data.workspacePath || null,
          initialized: !!data.initialized,
        };
      } else if (data.role === "file") {
        context.code = {
          role: "file",
          filePath: data.filePath || null,
          language: data.language || null,
        };
      } else if (data.role === "directory") {
        context.code = {
          role: "directory",
          filePath: data.filePath || null,
        };
      }
    },
    "code-workspace",
  );

  // Auto-sync is handled inline by the write tools (see tools.js). We
  // can't use an afterNote hook here because writeFileContent calls
  // Note.create directly (bypassing the note CRUD hooks) so code file
  // content can exceed the user note size cap. The tools call
  // scheduleSync right after every write, which debounces per project.

  // Boot-time ingest of land/extensions/ and land/seed/ into the .source
  // self-tree. Runs AFTER the extension loader finishes and DB is ready,
  // via the afterBoot hook. First boot: full ingest. Subsequent boots:
  // mtime-based incremental refresh — only changed files are re-read.
  // Fire-and-forget so a slow ingest doesn't block boot-completion;
  // log progress through the normal CodeWorkspace log prefix.
  core.hooks.register(
    "afterBoot",
    async () => {
      try {
        const res = await ensureSourceTree(core);
        if (res?.created) {
          log.info("CodeWorkspace", `.source self-tree initialized: ${res.fileCount ?? 0} files, ${res.dirCount ?? 0} dirs. writeMode=disabled (read-only). Use 'source-mode free' to enable writes.`);
        } else if (res?.refreshed) {
          log.info("CodeWorkspace", `.source self-tree refreshed: ${res.updated ?? 0} updated, ${res.added ?? 0} added, ${res.removed ?? 0} removed, ${res.unchanged ?? 0} unchanged.`);
        }
      } catch (err) {
        log.error("CodeWorkspace", `.source boot ingest failed: ${err.message}`);
        log.error("CodeWorkspace", err.stack?.split("\n").slice(0, 5).join("\n"));
      }
    },
    "code-workspace",
  );

  const tools = getWorkspaceTools(core);
  log.info("CodeWorkspace", `Loaded v0.3.0. 5 modes (code-plan/log/coach/ask/review). ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}. Confined — run 'ext-allow code-workspace' at a tree root to activate. .source self-tree will initialize after boot.`);

  return {
    tools,

    // No modeTools injection. code-workspace owns its own modes fully.
    // Other extensions (e.g. code-forge) reach workspace functions via
    // getExtension("code-workspace").exports.* rather than re-implementing
    // any tree↔note plumbing.
    exports: {
      async getProjectByName(rootId, name) {
        const { findProjectByName } = await import("./workspace.js");
        return findProjectByName(rootId, name);
      },
      async initProject(args) {
        const { initProject } = await import("./workspace.js");
        return initProject(args);
      },
      async addFile(args) {
        const { resolveOrCreateFile, writeFileContent } = await import("./workspace.js");
        const { fileNode, created } = await resolveOrCreateFile(args);
        await writeFileContent({ fileNodeId: fileNode._id, content: args.content, userId: args.userId });
        return { fileNode, created };
      },
      async readFile({ projectNodeId, relPath, userId, core: c }) {
        const { resolveOrCreateFile, readFileContent } = await import("./workspace.js");
        const { fileNode, created } = await resolveOrCreateFile({ projectNodeId, relPath, userId, core: c });
        if (created) return "";
        return readFileContent(fileNode._id);
      },
      async walkFiles(projectNodeId) {
        const { walkProjectFiles } = await import("./workspace.js");
        return walkProjectFiles(projectNodeId);
      },
      async syncUp(projectNodeId) {
        const { syncUp } = await import("./sync.js");
        return syncUp(projectNodeId);
      },
      async runInWorkspace(args) {
        const { runInWorkspace } = await import("./sandbox.js");
        return runInWorkspace(args);
      },
      readMeta,
    },
  };
}
