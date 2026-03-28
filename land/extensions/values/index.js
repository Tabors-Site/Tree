import getTools from "./tools.js";
import { setServices, setEnergyService, setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat } from "./core.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);

  const { default: router, setNodeModel } = await import("./routes.js");
  setNodeModel(core.models.Node);
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const values = meta.values || {};
    const goals = meta.goals || {};
    if (Object.keys(values).length > 0) context.values = values;
    if (Object.keys(goals).length > 0) context.goals = goals;
  }, "values");

  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt) {
      const { default: buildHtmlRoutes } = await import("./htmlRoutes.js");
      const htmlRouter = buildHtmlRoutes();
      htmlExt.router.use("/", htmlRouter);
    }
  } catch {}

  return {
    router,
    tools: getTools(),
    modeTools: [
      { modeKey: "tree:edit", toolNames: ["edit-node-version-value", "edit-node-version-goal"] },
    ],
    exports: { setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat },
  };
}
