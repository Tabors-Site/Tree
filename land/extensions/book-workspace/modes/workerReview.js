// tree:book-worker-review
//
// Book-workspace's Review Worker. READ-ONLY: no create-node-note, no
// edit-node-note. The Worker reads chapters and produces findings as
// prose at [[DONE]] time.

import governingReviewMode from "../../governing/modes/workerReview.js";
import { WORKER_BASE_TOOLS } from "../../governing/modes/workerBase.js";
import { composeBookWorkerPrompt } from "./workerComposer.js";

const TOOL_NAMES = [
  ...WORKER_BASE_TOOLS,
  "get-node-notes",
  "workspace-peek-sibling-file",
];

export default {
  name: "tree:book-worker-review",
  emoji: "🔍",
  label: "Book Review Worker",
  bigMode: "tree",

  // Review may need more turns to read multiple chapters thoroughly
  // before consolidating findings.
  maxMessagesBeforeLoop: 40,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 3,

  toolNames: TOOL_NAMES,

  buildSystemPrompt(ctx) {
    return composeBookWorkerPrompt(ctx, {
      type: "review",
      toolNames: TOOL_NAMES,
      governingPromptBuilder: governingReviewMode.buildSystemPrompt,
    });
  },
};
