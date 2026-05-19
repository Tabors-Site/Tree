import log from "../../seed/log.js";
import tools from "./tools.js";
import scoutMode from "./modes/scout.js";
import { setServices, runScout, getScoutHistory, getScoutGaps } from "./core.js";

export async function init(core) {
  setServices(core);

  // Register the scout mode. Hidden from mode bar. Used internally by
  // the OrchestratorRuntime during angle decomposition and synthesis steps.
  core.modes.registerMode("tree:scout", scoutMode, "scout");

  // enrichContext: surface recent scout results and accumulated gaps
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const scoutMeta = meta?.scout;
    if (!scoutMeta) return;

    if (scoutMeta.history?.length > 0) {
      context.recentScout = scoutMeta.history[0];
    }
    if (scoutMeta.gaps?.length > 0) {
      context.scoutGaps = scoutMeta.gaps.slice(0, 5);
    }
  }, "scout");

  const { default: router } = await import("./routes.js");

  log.verbose("Scout", "Scout loaded (triangulation search)");

  return {
    router,
    tools,
    exports: {
      runScout,
      getScoutHistory,
      getScoutGaps,
    },
  };
}
