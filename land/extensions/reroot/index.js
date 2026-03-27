import log from "../../seed/log.js";
import { setServices } from "./core.js";

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

  const { default: router } = await import("./routes.js");

  log.verbose("Reroot", "Tree reorganization engine loaded");

  return { router };
}
