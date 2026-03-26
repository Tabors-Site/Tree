import { setServices, setEnergyService } from "./core.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions });
  if (core.energy) setEnergyService(core.energy);
  const { default: router } = await import("./routes.js");
  return { router };
}
