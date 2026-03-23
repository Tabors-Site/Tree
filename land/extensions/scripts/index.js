import router from "./routes.js";
import tools from "./tools.js";
import { setEnergyService } from "./core.js";
import { setExtensions } from "./scriptsFunctions/safeFunctions.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);

  // Wire optional extension functions for sandboxed scripts
  setExtensions({
    values: getExtension("values")?.exports,
    prestige: getExtension("prestige")?.exports,
    schedules: getExtension("schedules")?.exports,
  });

  // Inject script list into AI context
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const scripts = meta.scripts?.list || [];
    if (scripts.length > 0) {
      context.scripts = scripts.map(s => ({ id: s._id, name: s.name }));
    }
  }, "scripts");

  return { router, tools };
}
