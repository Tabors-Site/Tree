import router from "./routes.js";
import { resolveHtmlAuth } from "./routes.js";
import { dispatchNotifications, dispatchTestNotification } from "./dispatch.js";
import { registerChannelType, getChannelType, getRegisteredTypes } from "./registry.js";
import { processGatewayMessage } from "./input.js";
import { getChannelWithSecrets, getChannelsForRoot, addGatewayChannel, updateGatewayChannel, deleteGatewayChannel } from "./core.js";
import GatewayChannel from "./model.js";

export async function init(core) {
  resolveHtmlAuth();
  const { setModels } = await import("./core.js");
  setModels(core.models);

  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt) {
      const { default: buildHtmlRoutes } = await import("./htmlRoutes.js");
      htmlExt.router.use("/", buildHtmlRoutes());
    }
  } catch {}

  // Register tree owner section (gateway management panel)
  try {
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("tree-owner-sections", "gateway", ({ rootId, queryString }) =>
      `<div class="content-card">
        <div class="section-header"><h2>Gateway</h2></div>
        <p style="color:rgba(255,255,255,0.7);font-size:0.85rem;margin:0 0 12px">
          Manage output channels for this tree. Send dream summaries and notifications to Telegram, Discord, or your browser.
        </p>
        <a href="/api/v1/root/${rootId}/gateway${queryString}"
           style="display:inline-block;padding:8px 16px;border-radius:8px;
                  border:1px solid rgba(115,111,230,0.4);background:rgba(115,111,230,0.15);
                  color:rgba(200,200,255,0.95);font-weight:600;text-decoration:none;
                  font-size:0.9rem;cursor:pointer">
          Manage Channels
        </a>
      </div>`,
      { priority: 30 }
    );
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
      GatewayChannel,
    },
  };
}
