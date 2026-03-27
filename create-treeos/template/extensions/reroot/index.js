import log from "../../seed/log.js";
import { setServices } from "./core.js";

export async function init(core) {
  setServices({
    models: core.models,
    contributions: core.contributions,
    llm: core.llm,
    energy: core.energy || null,
  });

  const { default: router } = await import("./routes.js");

  log.verbose("Reroot", "Tree reorganization engine loaded");

  return { router };
}
