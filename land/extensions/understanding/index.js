// Understanding extension entry point.
// Phase 1: wraps existing code without moving files.
// The manifest points to existing file locations.
// In Phase 2, files move into this directory and imports get refactored.

import UnderstandingRun from "../../db/models/understandingRun.js";
import UnderstandingNode from "../../db/models/understandingNode.js";

export async function init(core) {
  // Import existing modules from their current locations
  const understanding = await import("../../core/tree/understanding.js");
  const orchestrator = await import("../../orchestrators/pipelines/understand.js");

  return {
    models: { UnderstandingRun, UnderstandingNode },

    // Routes not wired through loader yet (still hardcoded in routeHandler.js)
    // Will switch in Phase 2 when routes become a factory function
    router: null,

    // Expose for cross-extension calls (dream pipeline uses these)
    exports: {
      orchestrateUnderstanding: orchestrator.orchestrateUnderstanding,
      createUnderstandingRun: understanding.createUnderstandingRun,
      findOrCreateUnderstandingRun: understanding.findOrCreateUnderstandingRun,
      prepareIncrementalRun: understanding.prepareIncrementalRun,
      buildRunTree: understanding.buildRunTree,
    },
  };
}
