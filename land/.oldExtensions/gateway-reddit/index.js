import log from "../../seed/log.js";
import handler from "./handler.js";
import { getExtension } from "../loader.js";
import { startupScan, stopPolling } from "./pollJob.js";

export async function init(core) {
  const gateway = getExtension("gateway");
  if (!gateway?.exports?.registerChannelType) {
    throw new Error("gateway-reddit requires the gateway extension to be loaded first");
  }

  gateway.exports.registerChannelType("reddit", handler);
  log.verbose("GatewayReddit", "Registered Reddit channel type");

  return {
    jobs: [
      {
        name: "gateway-reddit-poll",
        start: () => { startupScan(); },
        stop: () => { stopPolling(); },
      },
    ],
  };
}
