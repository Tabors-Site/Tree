import log from "../../seed/log.js";
import handler from "./handler.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  const gateway = getExtension("gateway");
  if (!gateway?.exports?.registerChannelType) {
    throw new Error("gateway-sms requires the gateway extension to be loaded first");
  }

  gateway.exports.registerChannelType("sms", handler);
  log.verbose("GatewaySMS", "Registered SMS channel type");

  const { default: router } = await import("./routes.js");

  return { router };
}
