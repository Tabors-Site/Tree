import router from "./routes.js";
import tools from "./tools.js";
import { setEnergyService } from "./core.js";

export async function init(core) {
  setEnergyService(core.energy);
  return { router, tools };
}
