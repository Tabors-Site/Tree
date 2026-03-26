import router from "./routes.js";
import { dispatchNotifications, dispatchTestNotification } from "./dispatch.js";
import { registerChannelType, getChannelType, getRegisteredTypes } from "./registry.js";
import { processGatewayMessage } from "./input.js";
import { getChannelWithSecrets, getChannelsForRoot } from "./core.js";

export async function init(core) {
  const { setModels } = await import("./core.js");
  setModels(core.models);

  return {
    router,
    exports: {
      registerChannelType,
      getChannelType,
      getRegisteredTypes,
      dispatchNotifications,
      dispatchTestNotification,
      processGatewayMessage,
      getChannelWithSecrets,
      getChannelsForRoot,
    },
  };
}
