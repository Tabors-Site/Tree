// tree:book-worker-refine
//
// Book-workspace's Refine Worker. Read the target chapter first via
// get-node-notes, then improve via edit-node-note. NO new-chapter
// creation in this turn's tools — Refine is for existing content.

import governingRefineMode from "../../governing/modes/workerRefine.js";
import { WORKER_BASE_TOOLS } from "../../governing/modes/workerBase.js";
import { composeBookWorkerPrompt } from "./workerComposer.js";

const TOOL_NAMES = [
  ...WORKER_BASE_TOOLS,
  "get-node-notes",
  "edit-node-note",
  "workspace-peek-sibling-file",
];

export default {
  name: "tree:book-worker-refine",
  emoji: "🪶",
  label: "Book Refine Worker",
  bigMode: "tree",

  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 3,

  toolNames: TOOL_NAMES,

  buildSystemPrompt(ctx) {
    return composeBookWorkerPrompt(ctx, {
      type: "refine",
      toolNames: TOOL_NAMES,
      governingPromptBuilder: governingRefineMode.buildSystemPrompt,
    });
  },
};
