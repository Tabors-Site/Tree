import log from "../../seed/log.js";
import router from "./routes.js";
import { getNotifications } from "./core.js";
import Notification from "./model.js";

export async function init(core) {
  log.verbose("Notifications", "Extension initialized");

  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt) {
      const { default: buildHtmlRoutes } = await import("./htmlRoutes.js");
      const htmlRouter = buildHtmlRoutes();
      htmlExt.router.use("/", htmlRouter);
    }
  } catch {}

  return {
    router,
    exports: {
      getNotifications,
      Notification,
    },
  };
}
