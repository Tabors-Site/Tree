import log from "../../seed/log.js";
import handler from "./handler.js";
import { getExtension } from "../loader.js";
import { startupScan, disconnectAllBots } from "./botManager.js";

export async function init(core) {
  const gateway = getExtension("gateway");
  if (!gateway?.exports?.registerChannelType) {
    throw new Error("gateway-discord requires the gateway extension to be loaded first");
  }

  gateway.exports.registerChannelType("discord", handler);
  log.verbose("GatewayDiscord", "Registered discord channel type");

  return {
    jobs: [
      {
        name: "gateway-discord-bots",
        start: () => { startupScan(); },
        stop: () => { disconnectAllBots(); },
      },
    ],
  };
}
