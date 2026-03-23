import router from "./routes.js";
import tools from "./tools.js";
import { setEnergyService, updateSchedule } from "./core.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (meta.schedule) context.schedule = meta.schedule;
    if (meta.reeffectTime) context.reeffectTime = meta.reeffectTime;
  }, "schedules");

  return {
    router,
    tools,
    exports: { updateSchedule },
  };
}
