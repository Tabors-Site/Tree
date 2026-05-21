// tree:book-worker-build
//
// Book-workspace's Build Worker. Writes a new chapter/scene end to
// end. Tool list: create-node-note (primary write), create-new-node-
// branch (for scene decomposition when warranted), get-node-notes
// (read sibling chapters for continuity), workspace-peek-sibling-file
// (deeper sibling inspection).
//
// NOT included: edit-node-note — Build is for new content; rewriting
// existing chapters routes to Refine.

import governingBuildMode from "../../governing/modes/workerBuild.js";
import { WORKER_BASE_TOOLS } from "../../governing/modes/workerBase.js";
import { composeBookWorkerPrompt } from "./workerComposer.js";

const TOOL_NAMES = [
  ...WORKER_BASE_TOOLS,  // governing-flag-issue (only base tool — scope-bounded by design)
  "create-node-note",
  "create-new-node-branch",
  "get-node-notes",
  "workspace-peek-sibling-file",
];

export default {
  name: "tree:book-worker-build",
  emoji: "✍",
  label: "Book Build Worker",
  bigMode: "tree",

  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 3,

  toolNames: TOOL_NAMES,

  buildSystemPrompt(ctx) {
    return composeBookWorkerPrompt(ctx, {
      type: "build",
      toolNames: TOOL_NAMES,
      governingPromptBuilder: governingBuildMode.buildSystemPrompt,
    });
  },
};
