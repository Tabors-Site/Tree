import { setServices, maybeResetEnergy, useEnergy, registerAction, DAILY_LIMITS } from "./core.js";
import log from "../../seed/log.js";

export async function init(core) {
  setServices({ models: core.models });

  const { default: router, setModels } = await import("./routes.js");
  setModels(core.models);
  // Register lifecycle hooks for energy metering
  core.hooks.register("beforeNote", async (data) => {
    try { await useEnergy({ userId: data.userId, action: "note" }); } catch (err) { log.debug("Energy", "note metering failed:", err.message); }
  }, "energy");

  core.hooks.register("beforeStatusChange", async (data) => {
    try { await useEnergy({ userId: data.userId, action: "editStatus" }); } catch (err) { log.debug("Energy", "editStatus metering failed:", err.message); }
  }, "energy");

  core.hooks.register("afterNodeCreate", async (data) => {
    try { await useEnergy({ userId: data.userId, action: "create" }); } catch (err) { log.debug("Energy", "create metering failed:", err.message); }
  }, "energy");

  core.hooks.register("beforeNodeDelete", async (data) => {
    try { await useEnergy({ userId: data.userId, action: "branchLifecycle" }); } catch (err) { log.debug("Energy", "branchLifecycle metering failed:", err.message); }
  }, "energy");


  // Replace the no-op energy service with the real one
  core.energy = { useEnergy, maybeResetEnergy, registerAction, DAILY_LIMITS };

  return {
    router,
    exports: { maybeResetEnergy, useEnergy, DAILY_LIMITS },
  };
}
