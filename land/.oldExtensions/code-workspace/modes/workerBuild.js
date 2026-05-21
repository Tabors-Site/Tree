// tree:code-worker-build
//
// Code-workspace's Build Worker. Specializes the governing Build base
// for JS projects: tool list curated to creation (workspace-add-file
// primary), prompt body adds the JS-builder identity, facets curated
// to what informs new-artifact decisions (declared contracts, sibling
// visibility, blockingError catch, behavioral test surface, probe
// loop awareness, nodePlan).
//
// NOT included: workspace-edit-file, workspace-delete-file — Build is
// for new artifacts. A leaf step that asks for editing an existing
// file is a Refine leaf and should route to the Refine Worker. The
// Worker enforces this both via prompt and by the tool set itself
// (no workspace-edit-file in toolNames means the Worker literally
// cannot call it).

import governingBuildMode from "../../governing/modes/workerBuild.js";
import { WORKER_BASE_TOOLS } from "../../governing/modes/workerBase.js";
import { composeCodeWorkerPrompt } from "./workerComposer.js";

const TOOL_NAMES = [
  ...WORKER_BASE_TOOLS,  // governing-flag-issue (only base tool — scope-bounded by design)
  "workspace-add-file",
  "workspace-read-file",
  "workspace-peek-sibling-file",
  "workspace-list",
  "workspace-probe",
  "source-read",
  "source-list",
];

export default {
  name: "tree:code-worker-build",
  emoji: "🔨",
  label: "Code Build Worker",
  bigMode: "tree",

  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 1,
  maxSteppedRuns: 20,

  toolNames: TOOL_NAMES,

  buildSystemPrompt(ctx) {
    return composeCodeWorkerPrompt(ctx, {
      type: "build",
      toolNames: TOOL_NAMES,
      governingPromptBuilder: governingBuildMode.buildSystemPrompt,
    });
  },
};
