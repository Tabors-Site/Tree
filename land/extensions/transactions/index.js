import router from "./routes.js";
import { setEnergyService } from "./core.js";

export async function init(core) {
  setEnergyService(core.energy);
  return { router };
}
