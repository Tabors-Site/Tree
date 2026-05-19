// tree:code-worker-refine
//
// Code-workspace's Refine Worker. The Worker reads before writing,
// makes the smallest correct change, preserves unrelated behavior.
// Tool list curated to read + edit + targeted delete. NO add — that's
// Build's job.
//
// The rewriteOverEdits facet is included specifically for Refine: it
// catches the anti-pattern of "AI rewrites the same file three times
// in a session" which most often shows up during Refine work and is a
// signal the change isn't converging.

import governingRefineMode from "../../governing/modes/workerRefine.js";
import { WORKER_BASE_TOOLS } from "../../governing/modes/workerBase.js";
import { composeCodeWorkerPrompt } from "./workerComposer.js";

const TOOL_NAMES = [
  ...WORKER_BASE_TOOLS,
  "workspace-read-file",
  "workspace-edit-file",
  "workspace-delete-file",
  "workspace-peek-sibling-file",
  "workspace-list",
  "source-read",
  "source-list",
];

export default {
  name: "tree:code-worker-refine",
  emoji: "🪓",
  label: "Code Refine Worker",
  bigMode: "tree",

  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 1,
  maxSteppedRuns: 20,

  toolNames: TOOL_NAMES,

  buildSystemPrompt(ctx) {
    return composeCodeWorkerPrompt(ctx, {
      type: "refine",
      toolNames: TOOL_NAMES,
      governingPromptBuilder: governingRefineMode.buildSystemPrompt,
    });
  },
};
