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
      base.exports.registerToolNavigation("edit-node-schedule", ({ args, withToken: t }) =>
        t(`/api/v1/node/${args.nodeId}?html`));
    }
  } catch {}

  // Register tree quick link
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("tree-quick-links", "schedules", ({ rootId, queryString }) =>
      `<a href="/api/v1/root/${rootId}/calendar${queryString}" class="back-link">Calendar</a>`,
      { priority: 20 }
    );
    base?.exports?.registerSlot?.("version-meta-cards", "schedules", ({ nodeId, version, qs, scheduleHtml, reeffectTime }) =>
      `<div class="meta-card">
        <div class="meta-label">Schedule</div>
        <div class="schedule-info">
          <div class="schedule-row">
            <div class="schedule-text">
              <div class="meta-value">${scheduleHtml || "Not set"}</div>
              <div class="repeat-text">Repeat: ${reeffectTime || 0} hours</div>
            </div>
            <button id="editScheduleBtn" style="padding:8px 12px;">&#9999;&#65039;</button>
          </div>
        </div>
      </div>`,
      { priority: 10 }
    );
  } catch {}

  return {
    router,
    tools,
    modeTools: [
      { modeKey: "tree:edit", toolNames: ["edit-node-schedule"] },
    ],
    exports: { updateSchedule, getCalendar },
  };
}
