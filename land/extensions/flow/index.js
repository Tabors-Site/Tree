import { getFlowForPosition } from "./core.js";

export async function init(core) {
  const { default: router } = await import("./routes.js");

  // Mount flow dashboard page if html-rendering is available
  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt?.pageRouter) {
      const { default: flowDashboardRouter } = await import("./app/flowDashboard.js");
      htmlExt.pageRouter.use("/", flowDashboardRouter);
    }
  } catch (err) {
    const log = (await import("../../seed/log.js")).default;
    log.warn("Flow", `Dashboard page not mounted: ${err.message}`);
  }

  return {
    router,
    exports: { getFlowForPosition },
  };
}
