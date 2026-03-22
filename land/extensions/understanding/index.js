import UnderstandingRun from "./understandingRun.js";
import UnderstandingNode from "./understandingNode.js";
import router from "../../routes/api/understanding.js";

export async function init(core) {
  const understanding = await import("../../core/tree/understanding.js");
  const orchestrator = await import("../../orchestrators/pipelines/understand.js");

  return {
    models: { UnderstandingRun, UnderstandingNode },
    router,
    exports: {
      orchestrateUnderstanding: orchestrator.orchestrateUnderstanding,
      createUnderstandingRun: understanding.createUnderstandingRun,
      findOrCreateUnderstandingRun: understanding.findOrCreateUnderstandingRun,
      prepareIncrementalRun: understanding.prepareIncrementalRun,
      buildRunTree: understanding.buildRunTree,
    },
  };
}
