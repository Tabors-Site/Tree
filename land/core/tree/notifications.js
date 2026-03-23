// core/notifications.js
// Shared notification queries used by routesURL and chat.

import mongoose from "mongoose";
const Notification = mongoose.models.Notification || { find: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: () => [] }) }) }) }), countDocuments: () => 0, updateMany: () => ({}) };

/**
 * Get notifications for a user, optionally filtered by rootId.
 * @param {object} opts
 * @param {string} opts.userId   - required
 * @param {string} [opts.rootId] - filter to a single tree
 * @param {number} [opts.limit]  - max results (default 50, max 100)
 * @param {number} [opts.offset] - pagination offset
 * @param {number} [opts.sinceDays] - only return notifications from the last N days
 * @returns {{ notifications: object[], total: number }}
 */
export async function getNotifications({
  userId,
  rootId,
  limit = 50,
  offset = 0,
  sinceDays,
} = {}) {
  const filter = { userId };
  if (rootId) filter.rootId = rootId;
  if (sinceDays) {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);
    filter.createdAt = { $gte: since };
  }

  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const [notifications, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(safeLimit)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  return { notifications, total };
}
