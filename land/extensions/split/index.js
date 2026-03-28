import log from "../../seed/log.js";
import tools from "./tools.js";
import { setServices, analyze, preview, execute, getHistory } from "./core.js";

export async function init(core) {
  core.llm.registerRootLlmSlot?.("split");

  setServices({
    models: core.models,
    contributions: core.contributions,
    llm: core.llm,
    energy: core.energy || null,
    metadata: core.metadata,
  });

  const { default: router } = await import("./routes.js");

  log.info("Split", "Branch mitosis loaded");

  return {
    router,
    tools,
    exports: {
      analyze,
      preview,
      execute,
      getHistory,
    },
  };
}
