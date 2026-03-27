import log from "../../seed/log.js";
import router from "./routes.js";
import { getNotifications } from "./core.js";
import Notification from "./model.js";

export async function init(core) {
  log.verbose("Notifications", "Extension initialized");

  return {
    router,
    exports: {
      getNotifications,
      Notification,
    },
  };
}
