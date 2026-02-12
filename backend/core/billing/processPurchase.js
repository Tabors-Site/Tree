import User from "../../db/models/user.js";
import { upgradeUserPlan } from "./upgradePlan.js";

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

    // ⏳ Extend subscription time safely
    const baseTime = Math.max(
      Date.now(),
      user.planExpiresAt?.getTime() || 0
    );

    user.planExpiresAt = new Date(
      baseTime + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000
    );
  }

  /* ===============================
     ADDITIONAL ENERGY PURCHASE
  =============================== */

  if (energyAmount > 0) {
    user.additionalEnergy.amount += energyAmount;
  }

  await user.save();

  return user;
}
