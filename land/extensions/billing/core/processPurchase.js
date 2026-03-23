import User from "../../../db/models/user.js";
import { upgradeUserPlan } from "./upgradePlan.js";
import { clearUserClientCache } from "../../../ws/conversation.js";
import { getEnergy, setEnergy, getUserMeta, setUserMeta } from "../../../core/tree/userMetadata.js";

/* ===============================
   CONFIG
=============================== */

const ALLOWED_PAID_PLANS = ["standard", "premium"];
const PLAN_DURATION_DAYS = 30;
const MAX_ENERGY_PURCHASE = 1_000_000; // safety cap

export async function processPurchase({
  userId,
  plan,
  energyAmount,
}) {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  /* ===============================
     INPUT VALIDATION
  =============================== */

  if (plan && !ALLOWED_PAID_PLANS.includes(plan)) {
    throw new Error("Invalid plan");
  }

  if (energyAmount != null) {
    if (typeof energyAmount !== "number" || energyAmount < 0) {
      throw new Error("Invalid energy amount");
    }

    if (energyAmount > MAX_ENERGY_PURCHASE) {
      throw new Error(`Energy amount exceeds limit of ${MAX_ENERGY_PURCHASE}`);
    }
  }

  /* ===============================
     PLAN PURCHASE / RENEWAL
  =============================== */

  // ⚠️ Only PAID plans should extend expiry
  if (plan && plan !== "basic") {

    // 🔼 Upgrade only if different plan
    if (plan !== user.profileType) {
      upgradeUserPlan(user, plan);
    }

    // Extend subscription time safely
    const billing = getUserMeta(user, "billing");
    const baseTime = Math.max(
      Date.now(),
      billing.planExpiresAt?.getTime?.() || (typeof billing.planExpiresAt === "number" ? billing.planExpiresAt : 0)
    );

    setUserMeta(user, "billing", {
      ...billing,
      planExpiresAt: new Date(baseTime + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000),
    });
  }

  /* ===============================
     ADDITIONAL ENERGY PURCHASE
  =============================== */

  if (energyAmount > 0) {
    const energy = getEnergy(user);
    energy.additional.amount += energyAmount;
    setEnergy(user, energy);
  }

  await user.save();

  // Bust LLM client cache so custom connections take effect immediately
  clearUserClientCache(userId);

  return user;
}
