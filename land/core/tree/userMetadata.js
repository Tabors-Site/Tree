/**
 * User metadata helpers.
 * Same pattern as extensionMetadata.js but for User documents.
 *
 * Field mapping (old -> new):
 *   user.apiKeys              -> metadata.apiKeys (array)
 *   user.profileType          -> metadata.billing.profileType
 *   user.planExpiresAt        -> metadata.billing.planExpiresAt
 *   user.availableEnergy      -> metadata.energy.available
 *   user.additionalEnergy     -> metadata.energy.additional
 *   user.storageUsage         -> metadata.energy.storageUsage
 *   user.llmAssignments       -> metadata.userLlm.assignments
 *   user.rawIdeaAutoPlace     -> metadata.rawIdeas.autoPlace
 */

/**
 * Read from user metadata. Works with both Mongoose docs and .lean() plain objects.
 */
export function getUserMeta(user, key) {
  if (!user.metadata) return key === "apiKeys" ? [] : {};
  const data = user.metadata instanceof Map
    ? user.metadata.get(key)
    : user.metadata?.[key];
  if (key === "apiKeys") return data || [];
  return data || {};
}

export function setUserMeta(user, key, data) {
  if (!user.metadata) {
    user.metadata = new Map();
  }
  if (user.metadata instanceof Map) {
    user.metadata.set(key, data);
  } else {
    user.metadata[key] = data;
  }
  if (user.markModified) user.markModified("metadata");
}

// Convenience: get profile type (billing extension)
export function getProfileType(user) {
  const billing = getUserMeta(user, "billing");
  return billing.profileType || "basic";
}

// Convenience: get plan expiry (billing extension)
export function getPlanExpiry(user) {
  const billing = getUserMeta(user, "billing");
  return billing.planExpiresAt || null;
}

// Convenience: get energy amounts
export function getEnergy(user) {
  const energy = getUserMeta(user, "energy");
  return {
    available: energy.available || { amount: 350, lastResetAt: new Date() },
    additional: energy.additional || { amount: 0, lastResetAt: new Date() },
    storageUsage: energy.storageUsage || 0,
  };
}

// Convenience: set energy amounts
export function setEnergy(user, energyData) {
  const existing = getUserMeta(user, "energy");
  setUserMeta(user, "energy", { ...existing, ...energyData });
}

// Convenience: get API keys
export function getApiKeys(user) {
  return getUserMeta(user, "apiKeys");
}

// Convenience: set API keys
export function setApiKeys(user, keys) {
  setUserMeta(user, "apiKeys", keys);
}

// Convenience: get user LLM assignments
export function getUserLlmAssignments(user) {
  const llm = getUserMeta(user, "userLlm");
  return llm.assignments || { main: null, rawIdea: null };
}

// Convenience: set user LLM assignments
export function setUserLlmAssignments(user, assignments) {
  setUserMeta(user, "userLlm", { assignments });
}

// Convenience: get raw idea auto place setting
export function getRawIdeaAutoPlace(user) {
  const raw = getUserMeta(user, "rawIdeas");
  return raw.autoPlace !== undefined ? raw.autoPlace : true;
}
