import { setServices, maybeResetEnergy, useEnergy, registerAction, DAILY_LIMITS } from "./core.js";
import log from "../../seed/log.js";

export async function init(core) {
  setServices({ models: core.models });

  const { default: router, setModels, resolveHtmlAuth } = await import("./routes.js");
  setModels(core.models);
  resolveHtmlAuth();
  // Register lifecycle hooks for energy metering
  core.hooks.register("beforeArtifact", async (data) => {
    try { await useEnergy({ beingId: data.beingId, action: "note" }); } catch (err) { log.debug("Energy", "note metering failed:", err.message); }
  }, "energy");

  core.hooks.register("beforeStatusChange", async (data) => {
    try { await useEnergy({ beingId: data.beingId, action: "editStatus" }); } catch (err) { log.debug("Energy", "editStatus metering failed:", err.message); }
  }, "energy");

  core.hooks.register("afterNodeCreate", async (data) => {
    try { await useEnergy({ beingId: data.beingId, action: "create" }); } catch (err) { log.debug("Energy", "create metering failed:", err.message); }
  }, "energy");

  core.hooks.register("beforeNodeDelete", async (data) => {
    try { await useEnergy({ beingId: data.beingId, action: "branchLifecycle" }); } catch (err) { log.debug("Energy", "branchLifecycle metering failed:", err.message); }
  }, "energy");


  // Replace the no-op energy service with the real one
  core.energy = { useEnergy, maybeResetEnergy, registerAction, DAILY_LIMITS };

  // Register energy display on user profile
  try {
    const { getExtension } = await import("../loader.js");
    const { getBeingMeta } = await import("../../seed/tree/beingMetadata.js");
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("user-profile-energy", "energy", ({ beingId, queryString, user }) => {
      maybeResetEnergy(user);
      const energyData = getBeingMeta(user, "energy");
      const amount = (energyData.available?.amount ?? 0) + (energyData.additional?.amount ?? 0);
      const lastReset = energyData.available?.lastResetAt;
      const nextReset = lastReset ? new Date(new Date(lastReset).getTime() + 86400000) : null;
      const resetLabel = nextReset
        ? nextReset.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" })
        : "...";
      return `<span class="meta-item">
        <a href="/api/v1/user/${beingId}/energy${queryString}">\u26A1 ${amount} \u00B7 resets ${resetLabel}</a>
      </span>`;
    }, { priority: 10 });
  } catch {}

  return {
    router,
    exports: { maybeResetEnergy, useEnergy, DAILY_LIMITS },
  };
}
