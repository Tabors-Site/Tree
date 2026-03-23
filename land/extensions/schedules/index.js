import router from "./routes.js";
import tools from "./tools.js";

export async function init(core) {
  // Register enrichContext hook so AI sees schedule data
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (meta.schedule) context.schedule = meta.schedule;
    if (meta.reeffectTime) context.reeffectTime = meta.reeffectTime;
  }, "schedules");

  return { router, tools };
}
