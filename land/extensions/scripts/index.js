import tools from "./tools.js";
import { setServices, setEnergyService } from "./core.js";
import { setExtensions } from "./scriptsFunctions/safeFunctions.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);

  const { default: router, setNodeModel, resolveHtmlAuth } = await import("./routes.js");
  setNodeModel(core.models.Node);
  resolveHtmlAuth();

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
