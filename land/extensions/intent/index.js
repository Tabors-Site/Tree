import log from "../../seed/log.js";
import { setServices, startIntentJob, stopIntentJob } from "./intentJob.js";

export async function init(core) {
  setServices({
    models: core.models,
    llm: core.llm,
    contributions: core.contributions,
    energy: core.energy || null,
  });

  const { default: router, setModels } = await import("./routes.js");
  setModels(core.models);

  log.info("Intent", "Autonomous intent engine loaded");

  return {
    router,
    jobs: [
      {
        name: "intent-cycle",
        start: () => startIntentJob(),
        stop: () => stopIntentJob(),
      },
    ],
  };
}
