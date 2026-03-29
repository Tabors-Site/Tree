import { setServices, setEnergyService } from "./core.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);
  const { default: router, resolveHtmlAuth } = await import("./routes.js");
  resolveHtmlAuth();
  return { router };
}
