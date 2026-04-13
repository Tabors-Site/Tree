import log from "../../seed/log.js";
import { configure } from "./core.js";
import getTools from "./tools.js";

import analyzeMode from "./modes/analyze.js";
import browseMode from "./modes/browse.js";
import editMode from "./modes/edit.js";
import testMode from "./modes/test.js";
// reviewMode intentionally not imported: code-workspace owns tree:code-review
// now. codebase still ships its reviewMode file for future reintroduction,
// but the mode key is reserved for the authoring extension's review+refine
// loop. Past-tense messages ("how does this look", "review this", "check
// the project") route through the grammar pipeline to code-workspace.

export async function init(core) {
  configure({ metadata: core.metadata });

  // Register LLM slots: different models for different jobs
  core.llm.registerRootLlmSlot?.("code-analyze");
  core.llm.registerRootLlmSlot?.("code-search");
  core.llm.registerRootLlmSlot?.("code-edit");
  core.llm.registerRootLlmSlot?.("code-test");

  // Register modes (code-review deliberately omitted; owned by code-workspace)
  core.modes.registerMode("tree:code-analyze", analyzeMode, "codebase");
  core.modes.registerMode("tree:code-browse", browseMode, "codebase");
  core.modes.registerMode("tree:code-edit", editMode, "codebase");
  core.modes.registerMode("tree:code-test", testMode, "codebase");

  // LLM slot assignments: cheap for search/test, quality for edit
  if (core.llm.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:code-analyze", "code-analyze");
    core.llm.registerModeAssignment("tree:code-browse", "code-analyze");
    core.llm.registerModeAssignment("tree:code-edit", "code-edit");
    core.llm.registerModeAssignment("tree:code-test", "code-test");
  }

  // enrichContext: inject code metadata when at a code node
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const codeMeta = meta?.code;
    if (!codeMeta) return;

    context.code = {
      role: codeMeta.role || (codeMeta.initialized ? "repository" : null),
      language: codeMeta.language || null,
      fileCount: codeMeta.fileCount || null,
      path: codeMeta.path || null,
    };
  }, "codebase");

  // Set modes.respond on code roots so the routing index picks them up
  // This happens at ingest time via the tool, not here.

  log.info("Code", "Loaded. The tree reads code.");

  return {
    tools: getTools(),
    // Inject code tools into converse and librarian modes so code-ingest
    // is available before a code tree is set up.
    modeTools: [
      { modeKey: "tree:converse", toolNames: ["code-ingest", "code-search", "code-git"] },
      { modeKey: "tree:librarian", toolNames: ["code-ingest", "code-search"] },
    ],
  };
}
