import mongoose from "mongoose";

const GovernanceConfigSchema = new mongoose.Schema({
  _id: { type: String, default: "governance" },

  // Enforcement threshold. Lands below this version are excluded from listings.
  // null means no minimum (all versions listed).
  minimumSeedVersion: { type: String, default: null },
  minimumSeedVersionNumeric: { type: Number, default: null },

  // Advisory. Displayed to operators but not enforced.
  // null means no recommendation.
  recommendedSeedVersion: { type: String, default: null },

  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: null },
});

const GovernanceConfig = mongoose.model("GovernanceConfig", GovernanceConfigSchema);

/**
 * Get the governance config. Creates the singleton document if it doesn't exist.
 */
export async function getGovernanceConfig() {
  let config = await GovernanceConfig.findById("governance").lean();
  if (!config) {
    config = await GovernanceConfig.create({ _id: "governance" });
    return config.toObject ? config.toObject() : config;
  }
  return config;
}

/**
 * Update governance config fields.
 */
export async function setGovernanceConfig(fields) {
  const update = { ...fields, updatedAt: new Date() };

  // Compute numeric version for query-efficient comparison
  if (fields.minimumSeedVersion) {
    const [maj, min, pat] = fields.minimumSeedVersion.split(".").map(Number);
    update.minimumSeedVersionNumeric = maj * 10000 + min * 100 + (pat || 0);
  } else if (fields.minimumSeedVersion === null) {
    update.minimumSeedVersionNumeric = null;
  }

  const config = await GovernanceConfig.findOneAndUpdate(
    { _id: "governance" },
    { $set: update },
    { new: true, upsert: true },
  );
  return config.toObject ? config.toObject() : config;
}

export default GovernanceConfig;
