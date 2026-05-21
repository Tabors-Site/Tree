import log from "../../seed/log.js";
import getTools, { setEnergyService } from "./tools.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);

  log.warn("Shell", "Shell extension loaded (confined). AI has system access where explicitly allowed.");

  return {
    tools: getTools(),
  };
}
