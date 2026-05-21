// tree:book-worker-integrate
//
// Book-workspace's Integrate Worker. Writes top-level book scaffolding
// — preface, afterword, jacket copy, dedication — that ties chapters
// into a coherent whole. Must read sibling chapters first via
// get-node-notes.
//
// Tool list includes create-node-note (for the integration piece) but
// NOT edit-node-note — integration creates new top-level content; it
// does not modify existing chapters. If integration reveals a chapter
// needs amendment, that's a separate Refine leaf.

import governingIntegrateMode from "../../governing/modes/workerIntegrate.js";
import { WORKER_BASE_TOOLS } from "../../governing/modes/workerBase.js";
import { composeBookWorkerPrompt } from "./workerComposer.js";

const TOOL_NAMES = [
  ...WORKER_BASE_TOOLS,
  "create-node-note",
  "get-node-notes",
  "workspace-peek-sibling-file",
];

export default {
  name: "tree:book-worker-integrate",
  emoji: "🧵",
  label: "Book Integrate Worker",
  bigMode: "tree",

  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 3,

  toolNames: TOOL_NAMES,

  buildSystemPrompt(ctx) {
    return composeBookWorkerPrompt(ctx, {
      type: "integrate",
      toolNames: TOOL_NAMES,
      governingPromptBuilder: governingIntegrateMode.buildSystemPrompt,
    });
  },
};
