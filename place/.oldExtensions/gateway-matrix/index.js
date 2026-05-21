import log from "../../seed/log.js";
import handler from "./handler.js";
import { getExtension } from "../loader.js";
import { startupScan, stopAllSyncLoops } from "./syncJob.js";

export async function init(core) {
  const gateway = getExtension("gateway");
  if (!gateway?.exports?.registerChannelType) {
    throw new Error("gateway-matrix requires the gateway extension to be loaded first");
  }

  gateway.exports.registerChannelType("matrix", handler);
  log.verbose("GatewayMatrix", "Registered Matrix channel type");

  return {
    jobs: [
      {
        name: "gateway-matrix-sync",
        start: () => { startupScan(); },
        stop: () => { stopAllSyncLoops(); },
      },
    ],
  };
}
