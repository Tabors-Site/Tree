import { getUserMeta } from "../../../seed/tree/userMetadata.js";

const PLAN_DAILY_VALUE = {
  basic: 0,
  standard: 500,
  premium: 2000,
};

export function validatePurchase(user, { plan, energyAmount }) {

  if (plan) {
    if (!["standard", "premium"].includes(plan)) {
      throw new Error("Invalid plan");
    }

    const currentPlan = getUserMeta(user, "tiers").plan || "basic";
    const oldVal = PLAN_DAILY_VALUE[currentPlan] ?? 0;
    const newVal = PLAN_DAILY_VALUE[plan] ?? 0;

    if (newVal < oldVal) {
      throw new Error("Cannot downgrade plan");
    }
  }

  if (energyAmount != null) {
    if (typeof energyAmount !== "number" || energyAmount < 0) {
      throw new Error("Invalid energy amount");
    }

    if (energyAmount > 1_000_000) {
      throw new Error("Energy amount too large");
    }
  }
}
