import router from "./routes.js";
import getTools from "./tools.js";
import { setEnergyService, setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat } from "./core.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const values = meta.values || {};
    const goals = meta.goals || {};
    if (Object.keys(values).length > 0) context.values = values;
    if (Object.keys(goals).length > 0) context.goals = goals;
  }, "values");

  return {
    router,
    tools: getTools(),
    exports: { setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat },
  };
}
