import log from "../../seed/log.js";
import handler from "./handler.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  var gateway = getExtension("gateway");
  if (!gateway?.exports?.registerChannelType) {
    throw new Error("gateway-telegram requires the gateway extension to be loaded first");
  }

  gateway.exports.registerChannelType("telegram", handler);
  log.verbose("GatewayTelegram", "Registered telegram channel type");

  var { default: router } = await import("./routes.js");

  return {
    router,
  };
}
