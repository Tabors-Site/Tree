import { getUserMeta, setUserMeta } from "../../../seed/tree/userMetadata.js";

let DAILY_LIMITS = {};
export function setEnergyService(energy) { DAILY_LIMITS = energy.DAILY_LIMITS || {}; }

const PLAN_DAILY_VALUE = {
  basic: 0,
  standard: 500,
  premium: 2000,
};

export function upgradeUserPlan(user, newPlan) {
  const now = Date.now();

  const oldPlan = getUserMeta(user, "tiers").plan || "basic";
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

  setUserMeta(user, "tiers", { plan: newPlan });

  energy.available.amount = DAILY_LIMITS[newPlan] ?? DAILY_LIMITS.basic;
  energy.available.lastResetAt = new Date();
  setUserMeta(user, "energy", energy);

  return user;
}
