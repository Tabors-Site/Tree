import Contribution from "../models/contribution.js";

/**
 * Get contributions for a node at a specific version.
 * Returns raw contribution documents. Extensions interpret meaning.
 */
async function getContributions({
  nodeId,
  version,
  limit,
  startDate,
  endDate,
}) {
  if (!nodeId) {
    throw new Error("Missing required parameter: nodeId");
  }

  if (typeof version !== "number" || isNaN(version)) {
    throw new Error("Invalid or missing version: must be a number");
  }

  const query = { nodeId, nodeVersion: version };

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  let q = Contribution.find(query)
    .populate("userId", "username")
    .populate("nodeId", "name")
    .sort({ date: -1 })
    .lean();

  if (typeof limit === "number" && limit > 0) {
    q = q.limit(limit);
  }

  const contributions = await q;
  return { contributions };
}

/**
 * Get contributions by a specific user.
 * Returns raw contribution documents.
 */
async function getContributionsByUser(userId, limit, startDate, endDate) {
  if (!userId) {
    throw new Error("Missing required parameter: userId");
  }

  const query = { userId };

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  let q = Contribution.find(query)
    .populate("userId", "username")
    .populate("nodeId", "name")
    .sort({ date: -1 })
    .lean();

  if (typeof limit === "number" && limit > 0) {
    q = q.limit(limit);
  }

  const contributions = await q;
  return { contributions };
}

export { getContributions, getContributionsByUser };
