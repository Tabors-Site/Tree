import log from "../../seed/log.js";
import { setServices } from "./core.js";
import { setModels as setJobModels, startPruneJob, stopPruneJob } from "./pruneJob.js";

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setServices({
    models: core.models,
    contributions: core.contributions,
    llm: { ...core.llm, runChat: async (opts) => {
      if (opts.userId && opts.userId !== "SYSTEM" && !await core.llm.userHasLlm(opts.userId)) return { answer: null };
      return core.llm.runChat({ ...opts, llmPriority: BG });
    } },
    energy: core.energy || null,
  });

  setJobModels(core.models);

  const { default: router, setModels } = await import("./routes.js");
  setModels(core.models);

  log.info("Prune", "Tree pruning engine loaded");

  return {
    router,
    jobs: [
      {
        name: "prune-cycle",
        start: () => startPruneJob(),
        stop: () => stopPruneJob(),
      },
    ],
  };
}
