import UnderstandingRun from "./understandingRun.js";
import UnderstandingNode from "./understandingNode.js";
import router from "./routes.js";
import tools from "./tools.js";

import understand from "./modes/understand.js";
import understandSummarize from "./modes/understandSummarize.js";

export async function init(core) {
  const understanding = await import("./core.js");
  const orchestrator = await import("./pipeline.js");

  // Register understanding modes + LLM slot mappings
  core.modes.registerMode("tree:understand", understand, "understanding");
  core.modes.registerMode("tree:understand-summarize", understandSummarize, "understanding");
  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:understand", "understanding");
    core.llm.registerModeAssignment("tree:understand-summarize", "understanding");
  }

  return {
    models: { UnderstandingRun, UnderstandingNode },
    router,
    tools,
    exports: {
      orchestrateUnderstanding: orchestrator.orchestrateUnderstanding,
      createUnderstandingRun: understanding.createUnderstandingRun,
      findOrCreateUnderstandingRun: understanding.findOrCreateUnderstandingRun,
      prepareIncrementalRun: understanding.prepareIncrementalRun,
      buildRunTree: understanding.buildRunTree,
    },
  };
}
