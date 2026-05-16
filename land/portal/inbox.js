// TreeOS IBP — inbox primitives.
//
// The inbox is per-embodiment-per-position metadata, stored under
// `metadata.inbox.<embodiment>` on the Node document. The kernel treats
// `inbox` as a reserved namespace: it cannot be written through DO
// set-meta (see actions/set-meta.js), only through these primitives,
// which TALK uses.
//
// Each inbox entry combines the TALK envelope shape with protocol-side
// bookkeeping:
//   {
//     from, content, intent, correlation, inReplyTo?, attachments?, sentAt,
//     consumed:    boolean,
//     consumedAt?: ISO8601,
//     summonedAt?: ISO8601,
//     responseId?: <correlation id of the response, if any>,
//   }
//
// Operations are atomic against the Node document. No read-modify-write
// races: $push appends and $set updates individual flags by array index.

import { randomUUID } from "crypto";
import Node from "../seed/models/node.js";

const INBOX_NS = "inbox";

/**
 * Append a message to a being's inbox at this position.
 *
 * @param {string} nodeId
 * @param {string} embodiment   the qualifier name (e.g. "ruler", "oracle")
 * @param {object} message      TALK envelope payload (from, content, intent, ...)
 * @returns {Promise<{ messageId, sentAt }>}
 */
export async function appendToInbox(nodeId, embodiment, message) {
  if (!nodeId) throw new Error("appendToInbox requires nodeId");
  if (!embodiment) throw new Error("appendToInbox requires embodiment");
  if (!message || typeof message !== "object") throw new Error("appendToInbox requires a message object");

  const sentAt = message.sentAt || new Date().toISOString();
  const messageId = message.correlation || randomUUID();

  const entry = {
    from:         message.from || null,
    content:      message.content ?? null,
    intent:       message.intent || "chat",
    correlation:  messageId,
    inReplyTo:    message.inReplyTo || null,
    attachments:  Array.isArray(message.attachments) ? message.attachments : [],
    sentAt,
    consumed:     false,
    summonedAt:   null,
    consumedAt:   null,
    responseId:   null,
  };

  // Atomic $push to the per-embodiment bucket. Mongo creates the path if
  // it does not yet exist on the metadata Map.
  await Node.updateOne(
    { _id: nodeId },
    { $push: { [`metadata.${INBOX_NS}.${embodiment}`]: entry } },
  );

  return { messageId, sentAt };
}

/**
 * Read a being's inbox at this position.
 *
 * @param {string} nodeId
 * @param {string} embodiment
 * @param {object} [options]
 * @param {string} [options.since]      ISO8601; only entries with sentAt >= since
 * @param {boolean} [options.unconsumed] only entries with consumed=false
 * @param {number} [options.limit]      cap on entries returned
 * @returns {Promise<Array<object>>}
 */
export async function readInbox(nodeId, embodiment, options = {}) {
  if (!nodeId || !embodiment) return [];
  const node = await Node.findById(nodeId)
    .select(`metadata.${INBOX_NS}.${embodiment}`)
    .lean();
  if (!node) return [];

  const bucket = readMetaPath(node, [INBOX_NS, embodiment]);
  if (!Array.isArray(bucket)) return [];

  let entries = bucket;
  if (options.unconsumed) entries = entries.filter((e) => !e.consumed);
  if (options.since) entries = entries.filter((e) => e.sentAt >= options.since);
  if (typeof options.limit === "number") entries = entries.slice(0, options.limit);
  return entries;
}

/**
 * Mark messages as consumed after a summoning processes them.
 *
 * @param {string} nodeId
 * @param {string} embodiment
 * @param {string[]} correlationIds   ids of entries being consumed
 * @param {string} [responseId]       correlation id of the response, if any
 * @returns {Promise<{ consumed: number }>}
 */
export async function markInboxConsumed(nodeId, embodiment, correlationIds, responseId) {
  if (!nodeId || !embodiment || !Array.isArray(correlationIds) || correlationIds.length === 0) {
    return { consumed: 0 };
  }
  const consumedAt = new Date().toISOString();
  // Read current bucket to find array indices for the named correlations.
  const node = await Node.findById(nodeId)
    .select(`metadata.${INBOX_NS}.${embodiment}`)
    .lean();
  const bucket = readMetaPath(node, [INBOX_NS, embodiment]);
  if (!Array.isArray(bucket)) return { consumed: 0 };

  const idSet = new Set(correlationIds);
  const updates = {};
  let consumed = 0;
  bucket.forEach((entry, i) => {
    if (!idSet.has(entry.correlation) || entry.consumed) return;
    const base = `metadata.${INBOX_NS}.${embodiment}.${i}`;
    updates[`${base}.consumed`]   = true;
    updates[`${base}.consumedAt`] = consumedAt;
    if (responseId) updates[`${base}.responseId`] = responseId;
    consumed++;
  });

  if (consumed === 0) return { consumed: 0 };
  await Node.updateOne({ _id: nodeId }, { $set: updates });
  return { consumed };
}

/**
 * Get the full per-embodiment inbox bucket. Used by descriptor builders.
 */
export async function getInboxBucket(nodeId, embodiment) {
  return readInbox(nodeId, embodiment, {});
}

/**
 * Inbox summary across all embodiments at this position. Used for the
 * Position Description when SEE is on a position (no qualifier).
 */
export async function getInboxSummary(nodeId) {
  if (!nodeId) return {};
  const node = await Node.findById(nodeId).select(`metadata.${INBOX_NS}`).lean();
  if (!node) return {};
  const inbox = readMetaPath(node, [INBOX_NS]);
  if (!inbox || typeof inbox !== "object") return {};
  const out = {};
  for (const [embodiment, bucket] of Object.entries(inbox)) {
    if (!Array.isArray(bucket)) continue;
    out[embodiment] = {
      total:      bucket.length,
      unconsumed: bucket.filter((e) => !e.consumed).length,
      recent:     bucket.slice(-3),
    };
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

// Mongoose lean() returns metadata as a plain object whose entries may be
// nested Maps depending on driver version. Resolve a path traversal that
// handles both shapes.
function readMetaPath(node, path) {
  if (!node) return undefined;
  let cursor = node.metadata;
  for (const key of path) {
    if (cursor instanceof Map) {
      cursor = cursor.get(key);
    } else if (cursor && typeof cursor === "object") {
      cursor = cursor[key];
    } else {
      return undefined;
    }
    if (cursor === undefined || cursor === null) return undefined;
  }
  return cursor;
}
