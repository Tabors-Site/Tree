import log from "../../seed/log.js";
import handler from "./handler.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  const gateway = getExtension("gateway");
  if (!gateway?.exports?.registerChannelType) {
    throw new Error("gateway-webhook requires the gateway extension to be loaded first");
  }

  gateway.exports.registerChannelType("webapp", handler);
  log.verbose("GatewayWebhook", "Registered webapp (webhook) channel type");

  return {};
}
