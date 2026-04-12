import log from "../../seed/log.js";
import getWorkspaceTools from "./tools.js";
import { readMeta } from "./workspace.js";

import planMode from "./modes/plan.js";
import logMode from "./modes/log.js";
import coachMode from "./modes/coach.js";
import askMode from "./modes/ask.js";

export async function init(core) {
  // LLM slots: one per mode so operators can pin a cheap model to
  // ask/coach and a strong model to plan/log.
  try {
    core.llm?.registerRootLlmSlot?.("code-plan");
    core.llm?.registerRootLlmSlot?.("code-log");
    core.llm?.registerRootLlmSlot?.("code-coach");
    core.llm?.registerRootLlmSlot?.("code-ask");
  } catch {}

  core.modes.registerMode("tree:code-plan", planMode, "code-workspace");
  core.modes.registerMode("tree:code-log", logMode, "code-workspace");
  core.modes.registerMode("tree:code-coach", coachMode, "code-workspace");
  core.modes.registerMode("tree:code-ask", askMode, "code-workspace");

  try {
    core.llm?.registerModeAssignment?.("tree:code-plan", "code-plan");
    core.llm?.registerModeAssignment?.("tree:code-log", "code-log");
    core.llm?.registerModeAssignment?.("tree:code-coach", "code-coach");
    core.llm?.registerModeAssignment?.("tree:code-ask", "code-ask");
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

  const tools = getWorkspaceTools(core);
  log.info("CodeWorkspace", `Loaded v0.1.1. 4 modes (code-plan/log/coach/ask). 8 tools: ${tools.map((t) => t.name).join(", ")}. Confined — run 'ext-allow code-workspace' at a tree root to activate.`);

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
