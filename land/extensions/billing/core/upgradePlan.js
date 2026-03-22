import { DAILY_LIMITS } from "../../energy/core.js";

const PLAN_DAILY_VALUE = {
  basic: 0,
  standard: 500,
  premium: 2000,
};

export function upgradeUserPlan(user, newPlan) {
  const now = Date.now();

  const oldPlan = user.profileType;
  const expiresAt = user.planExpiresAt?.getTime() || 0;

  // ❌ Only allow upgrades here
  if (PLAN_DAILY_VALUE[newPlan] <= PLAN_DAILY_VALUE[oldPlan]) {
    throw new Error("Not an upgrade");
  }

  /* ===============================
     Convert Remaining Time → Energy
     =============================== */

  if (expiresAt > now && oldPlan !== "basic" && oldPlan !== "premium") {
    const remainingDays = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));

    const energyPerDay = PLAN_DAILY_VALUE[oldPlan];

    const compensationEnergy = remainingDays * energyPerDay;

    user.additionalEnergy.amount += compensationEnergy;
  }

  /* ===============================
     Switch Plan
     =============================== */

  user.profileType = newPlan;

  user.availableEnergy.amount = DAILY_LIMITS[newPlan] ?? DAILY_LIMITS.basic;

  user.availableEnergy.lastResetAt = new Date();

  return user;
}
