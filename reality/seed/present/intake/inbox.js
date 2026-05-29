// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Inbox — a thin reader over the InboxProjection. Per Bucket 3
// Option D (2026-05-23) the inbox stopped being storage on
// Space.qualities and became a fact-derived projection: every
// SUMMON stamps a be:summon Fact on the summoner's reel, the
// cross-cutting fold maintains `InboxProjection` rows keyed by
// correlation, and this file just queries that collection.
//
// Writers are GONE — appendToInbox retired. The SUMMON verb stamps
// the Fact directly (see seed/ibp/verbs/summon.js summonVerb). Closure is
// also fact-driven: when the answering moment seals, its Act row
// carries `answers: <correlation>` and the InboxProjection row
// disappears. No durable `consumed` / `cancelled` state — the row
// either exists (open) or it doesn't.
//
// What survives here: per-being readers (`readInbox`,
// `getInboxSummary`) used by the descriptor and the UI.

import InboxProjection from "../../past/act/inboxProjection.js";

/**
 * Read a being's open inbox at this position. Returns the
 * InboxProjection rows targeting the being, optionally filtered to
 * the inbox-space and date window. Open = "no answering moment has
 * sealed for this summon yet; no sever-fact has dropped it".
 *
 * @param {string} spaceId  the inbox-space (the recipient's stance)
 * @param {string} beingId  the recipient
 * @param {object} [options]
 * @param {string} [options.since]  ISO8601; entries with sentAt >= since
 * @param {number} [options.limit]
 * @returns {Promise<Array<object>>}
 */
export async function readInbox(spaceId, beingId, options = {}) {
  if (!spaceId || !beingId) return [];
  const q = { recipient: String(beingId), inboxSpaceId: String(spaceId) };
  if (options.since) q.sentAt = { $gte: new Date(options.since) };
  let cursor = InboxProjection.find(q).sort({ sentAt: 1 });
  if (typeof options.limit === "number") cursor = cursor.limit(options.limit);
  return await cursor.lean();
}

/**
 * Mailbox summary across every being at this position. Returned
 * object is keyed by beingId; descriptor joins with Being lookups
 * for human-readable display. Aggregates over InboxProjection by
 * recipient with a per-recipient count and recent slice.
 */
export async function getInboxSummary(spaceId) {
  if (!spaceId) return {};
  const rows = await InboxProjection.aggregate([
    { $match: { inboxSpaceId: String(spaceId) } },
    { $sort: { sentAt: 1 } },
    {
      $group: {
        _id:    "$recipient",
        total:  { $sum: 1 },
        recent: { $push: "$$ROOT" },
      },
    },
  ]);
  const out = {};
  for (const r of rows) {
    out[String(r._id)] = {
      total:  r.total,
      recent: (r.recent || []).slice(-3),
    };
  }
  return out;
}
