import { getBeingMeta } from "../../seed/tree/beingMetadata.js";

let Being;

export function setModels(models) {
  Being = models.Being;
}

// Feature access map. Extensions can register their own features via registerFeature().
const FEATURE_ACCESS = {
  "auto-place": ["standard", "premium"],
  "file-upload": ["standard", "premium"],
};

/**
 * Register a feature with its required tiers.
 * Called by extensions during init to declare what tiers unlock their features.
 */
export function registerFeature(feature, tiers) {
  FEATURE_ACCESS[feature] = tiers;
}

/**
 * Get a user's current tier. Returns "basic" if not set.
 */
export async function getUserTier(beingId) {
  const user = await Being.findById(beingId).select("metadata").lean();
  if (!user) return "basic";
  const tiers = getBeingMeta(user, "tiers");
  return tiers.plan || "basic";
}

/**
 * Check if a user's tier grants access to a feature.
 * Returns true if the feature isn't registered (permissive default).
 */
export async function hasAccess(beingId, feature) {
  const allowedTiers = FEATURE_ACCESS[feature];
  if (!allowedTiers) return true; // unknown feature = no restriction

  const tier = await getUserTier(beingId);
  return allowedTiers.includes(tier);
}

/**
 * Set a user's tier. Called by billing or admin.
 */
export async function setUserTier(beingId, tier) {
  const { batchSetBeingMeta } = await import("../../seed/tree/beingMetadata.js");
  await batchSetBeingMeta(beingId, "tiers", { plan: tier });
  return tier;
}
