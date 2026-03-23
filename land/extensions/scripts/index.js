import router from "./routes.js";
import tools from "./tools.js";
import { setEnergyService } from "./core.js";
import { setExtensions } from "./scriptsFunctions/safeFunctions.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  setEnergyService(core.energy);

  // Wire optional extension functions for sandboxed scripts
  setExtensions({
    values: getExtension("values")?.exports,
    prestige: getExtension("prestige")?.exports,
    schedules: getExtension("schedules")?.exports,
  });

  return { router, tools };
}
