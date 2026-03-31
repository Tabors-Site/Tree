import getTools from "./tools.js";
import { setServices, setEnergyService, setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat, getNodeValues, setNodeValues } from "./core.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);

  const { default: router, setNodeModel, resolveHtmlAuth } = await import("./routes.js");
  setNodeModel(core.models.Node);
  resolveHtmlAuth();
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
      htmlExt.router.use("/", buildHtmlRoutes());
    }
  } catch {}

  // Register navigation for value/goal tools (if treeos-base installed)
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    if (base?.exports?.registerToolNavigations) {
      const vUrl = ({ args, withToken: t }) => t(`/api/v1/node/${args.nodeId}?html`);
      base.exports.registerToolNavigations({
        "edit-node-value": vUrl,
        "edit-node-goal": vUrl,
      });
    }
  } catch {}

  // Register tree quick link
  try {
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("tree-quick-links", "values", ({ rootId, queryString }) =>
      `<a href="/api/v1/root/${rootId}/values${queryString}" class="back-link">Global Values</a>`,
      { priority: 30 }
    );
    base?.exports?.registerSlot?.("version-quick-links", "values", ({ nodeId, version, qs }) =>
      `<a href="/api/v1/node/${nodeId}/${version}/values${qs}">Values / Goals</a>`,
      { priority: 10 }
    );
  } catch {}

  return {
    router,
    tools: getTools(),
    modeTools: [
      { modeKey: "tree:edit", toolNames: ["edit-node-value", "edit-node-goal"] },
      { modeKey: "tree:be", toolNames: ["edit-node-value"] },
      { modeKey: "tree:librarian", toolNames: ["edit-node-value"] },
    ],
    exports: { setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat, getNodeValues, setNodeValues },
  };
}
