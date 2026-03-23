import router from "./routes.js";
import { startupScan, disconnectAllBots } from "./discordBotManager.js";
import { dispatchNotifications, dispatchTestNotification } from "./dispatch.js";

export async function init(core) {
  return {
    router,
    jobs: [
      {
        name: "gateway-discord-bots",
        start: () => { startupScan(); },
        stop: () => { disconnectAllBots(); },
      },
    ],
    exports: {
      dispatchNotifications,
      dispatchTestNotification,
    },
  };
}
