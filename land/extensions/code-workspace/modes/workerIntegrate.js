// tree:code-worker-integrate
//
// Code-workspace's Integrate Worker. Writes top-level integration
// files (package.json, README, top-level index.html when no client
// sub-Ruler owns it). Reads sibling outputs first via
// workspace-peek-sibling-file.
//
// Tool list: workspace-add-file (for the integration files), heavy
// read tools (workspace-peek-sibling-file, workspace-read-file,
// workspace-list, source-read). NO workspace-edit-file in this set —
// integration writes new top-level files; existing files at this
// scope already-edited fall into Refine territory and a separate
// leaf step.

import governingIntegrateMode from "../../governing/modes/workerIntegrate.js";
import { WORKER_BASE_TOOLS } from "../../governing/modes/workerBase.js";
import { composeCodeWorkerPrompt } from "./workerComposer.js";

const TOOL_NAMES = [
  ...WORKER_BASE_TOOLS,
  "workspace-add-file",
  "workspace-peek-sibling-file",
  "workspace-read-file",
  "workspace-list",
  "workspace-probe",
  "source-read",
  "source-list",
];

export default {
  name: "tree:code-worker-integrate",
  emoji: "🧵",
  label: "Code Integrate Worker",
  bigMode: "tree",

  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 1,
  maxSteppedRuns: 20,

  toolNames: TOOL_NAMES,

  buildSystemPrompt(ctx) {
    return composeCodeWorkerPrompt(ctx, {
      type: "integrate",
      toolNames: TOOL_NAMES,
      governingPromptBuilder: governingIntegrateMode.buildSystemPrompt,
    });
  },
};
