import { getFlowForPosition } from "./core.js";

export async function init(core) {
  const { default: router } = await import("./routes.js");

  // Mount flow dashboard page if html-rendering is available
  try {
    const htmlExt = (await import("../loader.js")).getExtension("html-rendering");
    if (htmlExt?.pageRouter) {
      const { default: flowDashboardRouter } = await import("./app/flowDashboard.js");
      htmlExt.pageRouter.use("/", flowDashboardRouter);
    }
  } catch {}

  return {
    router,
    exports: { getFlowForPosition },
  };
}
