import log from "../../seed/log.js";
import { setModels, getUserTier, hasAccess, setUserTier, registerFeature } from "./core.js";

export async function init(core) {
  setModels(core.models);

  log.info("UserTiers", "Tier management loaded");

  const router = (await import("./routes.js")).default(core);

  return {
    router,
    exports: { getUserTier, hasAccess, setUserTier, registerFeature },
  };
}
