import router from "./routes.js";
import tools from "./tools.js";
import { getExtMeta } from "../../core/tree/extensionMetadata.js";
import Node from "../../db/models/node.js";
import { setEnergyService, addPrestige } from "./core.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);
  core.hooks.register("beforeNote", async (data) => {
    const node = await Node.findById(data.nodeId).select("metadata").lean();
    if (!node) return;
    const prestige = getExtMeta(node, "prestige");
    if (prestige?.current) {
      data.version = prestige.current;
    }
  }, "prestige");

  core.hooks.register("beforeContribution", async (data) => {
    const node = await Node.findById(data.nodeId).select("metadata").lean();
    if (!node) return;
    const prestige = getExtMeta(node, "prestige");
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
    exports: { addPrestige },
  };
}
