import { orchestrateTreeRequest } from "./orchestrator.js";

export async function init(core) {
  return {
    orchestrator: {
      bigMode: "tree",
      handle: orchestrateTreeRequest,
    },
    // Expose for other extensions that call orchestrateTreeRequest directly
    exports: { orchestrateTreeRequest },
  };
}
