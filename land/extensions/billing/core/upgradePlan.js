let DAILY_LIMITS = {};
try { ({ DAILY_LIMITS } = await import("../../energy/core.js")); } catch {}
import { getEnergy, setEnergy, getUserMeta } from "../../../core/tree/userMetadata.js";

const PLAN_DAILY_VALUE = {
  basic: 0,
  standard: 500,
  premium: 2000,
};

export function upgradeUserPlan(user, newPlan) {
  const now = Date.now();

  const oldPlan = user.profileType;
  const billing = getUserMeta(user, "billing");
  const expiresAt = billing.planExpiresAt?.getTime?.() || (typeof billing.planExpiresAt === "number" ? billing.planExpiresAt : 0);

  if (PLAN_DAILY_VALUE[newPlan] <= PLAN_DAILY_VALUE[oldPlan]) {
    throw new Error("Not an upgrade");
  }

  const energy = getEnergy(user);

  if (expiresAt > now && oldPlan !== "basic" && oldPlan !== "premium") {
    const remainingDays = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));

    const energyPerDay = PLAN_DAILY_VALUE[oldPlan];

    const compensationEnergy = remainingDays * energyPerDay;

    energy.additional.amount += compensationEnergy;
  }

  user.profileType = newPlan;

  energy.available.amount = DAILY_LIMITS[newPlan] ?? DAILY_LIMITS.basic;
  energy.available.lastResetAt = new Date();
  setEnergy(user, energy);

  return user;
}
