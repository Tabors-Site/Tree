import {
  startTreeDreamJob,
  stopTreeDreamJob,
  runTreeDreamJob,
} from "./treeDream.js";
import router from "./routes.js";

import cleanupAnalyze from "./modes/cleanupAnalyze.js";
import cleanupExpandScan from "./modes/cleanupExpandScan.js";
import drainCluster from "./modes/drainCluster.js";
import drainScout from "./modes/drainScout.js";
import drainPlan from "./modes/drainPlan.js";
import dreamSummary from "./modes/dreamSummary.js";
import dreamThought from "./modes/dreamThought.js";

export async function init(core) {
  // Register dream/cleanup/drain modes + LLM slot mappings
  core.modes.registerMode("tree:cleanup-analyze", cleanupAnalyze, "dreams");
  core.modes.registerMode("tree:cleanup-expand-scan", cleanupExpandScan, "dreams");
  core.modes.registerMode("tree:drain-cluster", drainCluster, "dreams");
  core.modes.registerMode("tree:drain-scout", drainScout, "dreams");
  core.modes.registerMode("tree:drain-plan", drainPlan, "dreams");
  core.modes.registerMode("tree:dream-summary", dreamSummary, "dreams");
  core.modes.registerMode("tree:dream-thought", dreamThought, "dreams");
  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:cleanup-analyze", "cleanup");
    core.llm.registerModeAssignment("tree:cleanup-expand-scan", "cleanup");
    core.llm.registerModeAssignment("tree:drain-cluster", "drain");
    core.llm.registerModeAssignment("tree:drain-scout", "drain");
    core.llm.registerModeAssignment("tree:drain-plan", "drain");
    core.llm.registerModeAssignment("tree:dream-summary", "notification");
    core.llm.registerModeAssignment("tree:dream-thought", "notification");
    core.llm.registerRootLlmSlot?.("cleanup");
    core.llm.registerRootLlmSlot?.("drain");
    core.llm.registerRootLlmSlot?.("notification");
  }

  return {
    router,
    jobs: [
      {
        name: "tree-dream",
        start: () => {
          startTreeDreamJob({ intervalMs: 30 * 60 * 1000 });
          runTreeDreamJob();
        },
        stop: () => stopTreeDreamJob(),
      },
    ],
  };
}
