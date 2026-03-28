import log from "../../seed/log.js";
import tools from "./tools.js";
import { setServices, exportTreeSeed, plantTreeSeed, analyzeSeed } from "./core.js";

export async function init(core) {
  setServices({
    models: core.models,
    contributions: core.contributions,
    energy: core.energy || null,
    metadata: core.metadata,
  });

  const { default: router } = await import("./routes.js");

  log.info("SeedExport", "Tree seed export and plant loaded");

  return {
    router,
    tools,
    exports: {
      exportTreeSeed,
      plantTreeSeed,
      analyzeSeed,
    },
  };
}
