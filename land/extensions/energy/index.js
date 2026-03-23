import router from "./routes.js";
import { maybeResetEnergy, useEnergy, DAILY_LIMITS } from "./core.js";

export async function init(core) {
  // Register lifecycle hooks for energy metering
  core.hooks.register("beforeNote", async (data) => {
    try { await useEnergy({ userId: data.userId, action: "note" }); } catch {}
  }, "energy");

  core.hooks.register("beforeStatusChange", async (data) => {
    try { await useEnergy({ userId: data.userId, action: "editStatus" }); } catch {}
  }, "energy");

  core.hooks.register("afterNodeCreate", async (data) => {
    try { await useEnergy({ userId: data.userId, action: "create" }); } catch {}
  }, "energy");

  core.hooks.register("beforeNodeDelete", async (data) => {
    try { await useEnergy({ userId: data.userId, action: "branchLifecycle" }); } catch {}
  }, "energy");

  // Replace the no-op energy service with the real one
  core.energy = { useEnergy, maybeResetEnergy, DAILY_LIMITS };

  return {
    router,
    exports: { maybeResetEnergy, useEnergy, DAILY_LIMITS },
  };
}
