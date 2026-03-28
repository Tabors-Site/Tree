import tools from "./tools.js";
import { setServices, setEnergyService, updateSchedule, getCalendar } from "./core.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);

  const { default: router, setNodeModel } = await import("./routes.js");
  setNodeModel(core.models.Node);

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    // Legacy top-level metadata keys (see core.js comment)
    if (meta.schedule) context.schedule = meta.schedule;
    if (meta.reeffectTime) context.reeffectTime = meta.reeffectTime;
  }, "schedules");

  return {
    router,
    tools,
    modeTools: [
      { modeKey: "tree:edit", toolNames: ["edit-node-version-schedule"] },
    ],
    exports: { updateSchedule, getCalendar },
  };
}
