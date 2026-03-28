import router from "./routes.js";
import { dispatchNotifications, dispatchTestNotification } from "./dispatch.js";
import { registerChannelType, getChannelType, getRegisteredTypes } from "./registry.js";
import { processGatewayMessage } from "./input.js";
import { getChannelWithSecrets, getChannelsForRoot, addGatewayChannel, updateGatewayChannel, deleteGatewayChannel } from "./core.js";

export async function init(core) {
  const { setModels } = await import("./core.js");
  setModels(core.models);

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
      registerChannelType,
      getChannelType,
      getRegisteredTypes,
      dispatchNotifications,
      dispatchTestNotification,
      processGatewayMessage,
      getChannelWithSecrets,
      getChannelsForRoot,
      addGatewayChannel,
      updateGatewayChannel,
      deleteGatewayChannel,
    },
  };
}
