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
      htmlExt.router.use("/", buildHtmlRoutes());
    }
  } catch {}

  // Register quick link on user profile
  try {
    const { getExtension: getExt } = await import("../loader.js");
    const treeos = getExt("treeos-base");
    treeos?.exports?.registerSlot?.("user-quick-links", "notifications", ({ userId, queryString }) =>
      `<li><a href="/api/v1/user/${userId}/notifications${queryString}">Notifications</a></li>`,
      { priority: 40 }
    );
  } catch {}

  return {
    router,
    exports: {
      getNotifications,
      Notification,
    },
  };
}
