import tools from "./tools.js";
import { setServices, setEnergyService, updateSchedule, getCalendar } from "./core.js";

export async function init(core) {
  setServices({ models: core.models, contributions: core.contributions, metadata: core.metadata });
  if (core.energy) setEnergyService(core.energy);

  const { default: router, setNodeModel } = await import("./routes.js");
  setNodeModel(core.models.Node);

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const sched = meta.schedules;
    if (sched?.date) context.schedule = sched.date;
    if (sched?.reeffectTime) context.reeffectTime = sched.reeffectTime;
  }, "schedules");

  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt) {
      const { default: buildHtmlRoutes } = await import("./htmlRoutes.js");
      htmlExt.router.use("/", buildHtmlRoutes());
    }
  } catch {}

  // Register navigation for schedule tool (if treeos-base installed)
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    if (base?.exports?.registerToolNavigation) {
      base.exports.registerToolNavigation("edit-node-version-schedule", ({ args, withToken: t }) =>
        t(`/api/v1/node/${args.nodeId}/${args.prestige || 0}?html`));
    }
  } catch {}

  return {
    router,
    tools,
    modeTools: [
      { modeKey: "tree:edit", toolNames: ["edit-node-version-schedule"] },
    ],
    exports: { updateSchedule, getCalendar },
  };
}
