import log from "../../seed/log.js";
import { configure } from "./core.js";
import getTools from "./tools.js";

import analyzeMode from "./modes/analyze.js";
import browseMode from "./modes/browse.js";
import editMode from "./modes/edit.js";
import testMode from "./modes/test.js";
import reviewMode from "./modes/review.js";

export async function init(core) {
  configure({ metadata: core.metadata });

  // Register LLM slots: different models for different jobs
  core.llm.registerRootLlmSlot?.("code-analyze");
  core.llm.registerRootLlmSlot?.("code-search");
  core.llm.registerRootLlmSlot?.("code-edit");
  core.llm.registerRootLlmSlot?.("code-test");
  core.llm.registerRootLlmSlot?.("code-review");

  // Register modes
  core.modes.registerMode("tree:code-analyze", analyzeMode, "codebase");
  core.modes.registerMode("tree:code-browse", browseMode, "codebase");
  core.modes.registerMode("tree:code-edit", editMode, "codebase");
  core.modes.registerMode("tree:code-test", testMode, "codebase");
  core.modes.registerMode("tree:code-review", reviewMode, "codebase");

  // LLM slot assignments: cheap for search/test, quality for edit/review
  if (core.llm.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:code-analyze", "code-analyze");
    core.llm.registerModeAssignment("tree:code-browse", "code-analyze");
    core.llm.registerModeAssignment("tree:code-edit", "code-edit");
    core.llm.registerModeAssignment("tree:code-test", "code-test");
    core.llm.registerModeAssignment("tree:code-review", "code-review");
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
