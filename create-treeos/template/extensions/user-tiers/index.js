import log from "../../seed/log.js";
import { setModels, getUserTier, hasAccess, setUserTier, registerFeature } from "./core.js";
import { getExtension } from "../loader.js";
import { getUserMeta } from "../../seed/tree/userMetadata.js";

export async function init(core) {
  setModels(core.models);

  log.info("UserTiers", "Tier management loaded");

  const router = (await import("./routes.js")).default(core);

  // Register plan badge on user profile (replaces the default "User/Admin" badge)
  try {
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("user-profile-badge", "user-tiers", ({ userId, queryString, user }) => {
      const plan = (getUserMeta(user, "tiers").plan || "basic").toLowerCase();
      const label = plan.charAt(0).toUpperCase() + plan.slice(1);
      return `<a href="/api/v1/user/${userId}/energy${queryString}">
        <span class="plan-badge plan-${plan}">${label} Plan</span>
      </a>`;
    }, { priority: 10 });
  } catch {}

  return {
    router,
    exports: { getUserTier, hasAccess, setUserTier, registerFeature },
  };
}
