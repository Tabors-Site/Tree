import log from "../../seed/log.js";
import handler from "./handler.js";
import { getExtension } from "../loader.js";
import { startupScan, stopPolling } from "./pollJob.js";

export async function init(core) {
  const gateway = getExtension("gateway");
  if (!gateway?.exports?.registerChannelType) {
    throw new Error("gateway-x requires the gateway extension to be loaded first");
  }

  gateway.exports.registerChannelType("x", handler);
  log.verbose("GatewayX", "Registered X channel type");

  return {
    jobs: [
      {
        name: "gateway-x-poll",
        start: () => { startupScan(); },
        stop: () => { stopPolling(); },
      },
    ],
  };
}
