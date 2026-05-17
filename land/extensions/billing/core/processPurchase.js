import Being from "../../../seed/models/being.js";
import { upgradeUserPlan } from "./upgradePlan.js";
import { clearUserClientCache } from "../../../seed/llm/conversation.js";
import { getBeingMeta, setBeingMeta } from "../../../seed/tree/beingMetadata.js";

/**
 * Read the user's energy metadata, ensuring the expected shape exists.
 * Energy data lives in user.metadata under the "energy" key with structure:
 *   { available: { amount, lastResetAt }, additional: { amount } }
 */
function getEnergy(user) {
  const energy = getBeingMeta(user, "energy");
  if (!energy.available) energy.available = { amount: 0, lastResetAt: null };
  if (!energy.additional) energy.additional = { amount: 0 };
  if (typeof energy.available.amount !== "number") energy.available.amount = 0;
  if (typeof energy.additional.amount !== "number") energy.additional.amount = 0;
  return energy;
}

const ALLOWED_PAID_PLANS = ["standard", "premium"];
const PLAN_DURATION_DAYS = 30;
const MAX_ENERGY_PURCHASE = 1_000_000; // safety cap

export async function processPurchase({
  beingId,
  plan,
  energyAmount,
}) {
  const user = await Being.findById(beingId);

  if (!user) {
    throw new Error("User not found");
  }

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

  if (plan && plan !== "basic") {
    const currentPlan = getBeingMeta(user, "tiers").plan || "basic";
    if (plan !== currentPlan) {
      upgradeUserPlan(user, plan);
    }

    const billing = getBeingMeta(user, "billing");
    const baseTime = Math.max(
      Date.now(),
      billing.planExpiresAt?.getTime?.() || (typeof billing.planExpiresAt === "number" ? billing.planExpiresAt : 0)
    );

    setBeingMeta(user, "billing", {
      ...billing,
      planExpiresAt: new Date(baseTime + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000),
    });
  }

  if (energyAmount > 0) {
    const energy = getEnergy(user);
    energy.additional.amount += energyAmount;
    setBeingMeta(user, "energy", energy);
  }

  await user.save();

  clearUserClientCache(beingId);

  return user;
}
