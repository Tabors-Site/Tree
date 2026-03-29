import tools from "./tools.js";
import { setServices, setEnergyService, addPrestige, resolveVersion } from "./core.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);

  const { default: router, setNodeModel } = await import("./routes.js");
  setNodeModel(core.models.Node);

  const Node = core.models.Node;

  core.hooks.register("beforeNote", async (data) => {
    const node = await Node.findById(data.nodeId).select("metadata").lean();
    if (!node) return;
    const prestige = core.metadata.getExtMeta(node, "prestige");
    if (!data.metadata) data.metadata = {};
    data.metadata.version = prestige?.current || 0;
  }, "prestige");

  core.hooks.register("beforeContribution", async (data) => {
    const node = await Node.findById(data.nodeId).select("metadata").lean();
    if (!node) return;
    const prestige = core.metadata.getExtMeta(node, "prestige");
    if (prestige?.current) {
      data.nodeVersion = String(prestige.current);
    }
  }, "prestige");

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const prestige = meta.prestige;
    if (prestige?.current) {
      context.prestige = prestige.current;
      context.totalVersions = (prestige.history?.length || 0) + 1;
    }
  }, "prestige");

  return {
    router,
    tools,
    modeTools: [
      { modeKey: "tree:edit", toolNames: ["add-node-prestige"] },
    ],
    exports: { addPrestige, resolveVersion },
  };
}
