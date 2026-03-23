import router from "./routes.js";
import { maybeResetEnergy, useEnergy, DAILY_LIMITS } from "./core.js";

export async function init(core) {
  return {
    router,
    exports: { maybeResetEnergy, useEnergy, DAILY_LIMITS },
  };
}
