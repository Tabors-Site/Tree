import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";

let User;

export function setModels(models) {
  User = models.User;
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
export async function getUserTier(userId) {
  const user = await User.findById(userId).select("metadata").lean();
  if (!user) return "basic";
  const tiers = getUserMeta(user, "tiers");
  return tiers.plan || "basic";
}

/**
 * Check if a user's tier grants access to a feature.
 * Returns true if the feature isn't registered (permissive default).
 */
export async function hasAccess(userId, feature) {
  const allowedTiers = FEATURE_ACCESS[feature];
  if (!allowedTiers) return true; // unknown feature = no restriction

  const tier = await getUserTier(userId);
  return allowedTiers.includes(tier);
}

/**
 * Set a user's tier. Called by billing or admin.
 */
export async function setUserTier(userId, tier) {
  const { batchSetUserMeta } = await import("../../seed/tree/userMetadata.js");
  await batchSetUserMeta(userId, "tiers", { plan: tier });
  return tier;
}
