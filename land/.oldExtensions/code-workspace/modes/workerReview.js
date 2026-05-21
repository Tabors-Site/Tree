// tree:code-worker-review
//
// Code-workspace's Review Worker. READ-ONLY by tool restriction: no
// workspace-add-file, no workspace-edit-file, no workspace-delete-file.
// The Worker reads code, runs tests/probes for evidence, judges, and
// emits findings as prose at [[DONE]] time.
//
// Including workspace-test and workspace-probe: a review that involves
// running the code to see how it behaves is part of judging — not a
// modification. The probes return data; the Worker uses that data in
// its findings.

import governingReviewMode from "../../governing/modes/workerReview.js";
import { WORKER_BASE_TOOLS } from "../../governing/modes/workerBase.js";
import { composeCodeWorkerPrompt } from "./workerComposer.js";

const TOOL_NAMES = [
  ...WORKER_BASE_TOOLS,
  "workspace-read-file",
  "workspace-peek-sibling-file",
  "workspace-list",
  "workspace-test",
  "workspace-probe",
  "workspace-logs",
  "source-read",
  "source-list",
];

export default {
  name: "tree:code-worker-review",
  emoji: "🔍",
  label: "Code Review Worker",
  bigMode: "tree",

  // Review may take more turns than other types because it reads
  // broadly before consolidating — probe, read, peek, read again.
  // The eventual exit is [[DONE]] with prose findings.
  maxMessagesBeforeLoop: 40,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 1,
  maxSteppedRuns: 25,

  toolNames: TOOL_NAMES,

  buildSystemPrompt(ctx) {
    return composeCodeWorkerPrompt(ctx, {
      type: "review",
      toolNames: TOOL_NAMES,
      governingPromptBuilder: governingReviewMode.buildSystemPrompt,
    });
  },
};
