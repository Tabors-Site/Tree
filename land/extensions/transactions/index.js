import router from "./routes.js";
import { setEnergyService } from "./core.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);
  return { router };
}
