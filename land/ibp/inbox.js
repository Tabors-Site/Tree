// TreeOS IBP — inbox primitives.
//
// The inbox is per-being-per-position metadata, stored under
// `metadata.inbox.<beingId>` on the Node document. The kernel treats
// `inbox` as a reserved namespace: it cannot be written through DO
// set-meta (see actions/set-meta.js), only through these primitives,
// which TALK uses.
//
// **Layering.** The inbox is *delivery infrastructure*, not conversation
// history. Three distinct layers:
//
//   1. Portal Address — protocol-level addressing (sender / receiver stances).
//   2. Chats — first-class exchange records. Conversation history. Stored
//      with portalAddress, beingIn, beingOut, content.
//   3. Inbox — the delivery queue at a position. Pending TALK messages
//      before they get processed into Chats.
//
// An inbox entry is a *message in flight*. Once a being's summoning runs,
// the message is processed into one or more Chat records; the inbox entry
// is marked consumed and points at the resulting `chatId`. Trace from
// incoming TALK → resulting chat → Portal Address using these references.
//
// Each inbox entry:
//   {
//     from, content, intent, correlation, inReplyTo?, attachments?, sentAt,
//     consumed:    boolean,
//     consumedAt?: ISO8601,
//     summonedAt?: ISO8601,
//     responseId?: <correlation id of the response, if any>,
//     chatId?:     <id of the Chat record this message was processed into>,
//   }
//
// Operations are atomic against the Node document. No read-modify-write
// races: $push appends and $set updates individual flags by array index.
//
// **Keying.** Keyed by beingId (the canonical Being._id) rather than role
// type. Multiple beings of the same role at one position legitimately
// have separate inboxes; the role name doesn't unique-identify a being.

import { randomUUID } from "crypto";
import Node from "../seed/models/node.js";

const INBOX_NS = "inbox";

/**
 * Append a message to a being's inbox at this position.
 *
 * @param {string} nodeId
 * @param {string} beingId   the receiver Being's _id
 * @param {object} message   TALK envelope payload (from, content, intent, ...)
 * @returns {Promise<{ messageId, sentAt }>}
 */
export async function appendToInbox(nodeId, beingId, message) {
  if (!nodeId) throw new Error("appendToInbox requires nodeId");
  if (!beingId) throw new Error("appendToInbox requires beingId");
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
    chatId:       null,
  };

  // Atomic $push to the per-being bucket. Mongo creates the path if it
  // does not yet exist on the metadata Map.
  await Node.updateOne(
    { _id: nodeId },
    { $push: { [`metadata.${INBOX_NS}.${beingId}`]: entry } },
  );

  return { messageId, sentAt };
}

/**
 * Read a being's inbox at this position.
 *
 * @param {string} nodeId
 * @param {string} beingId
 * @param {object} [options]
 * @param {string} [options.since]      ISO8601; only entries with sentAt >= since
 * @param {boolean} [options.unconsumed] only entries with consumed=false
 * @param {number} [options.limit]      cap on entries returned
 * @returns {Promise<Array<object>>}
 */
export async function readInbox(nodeId, beingId, options = {}) {
  if (!nodeId || !beingId) return [];
  const node = await Node.findById(nodeId)
    .select(`metadata.${INBOX_NS}.${beingId}`)
    .lean();
  if (!node) return [];

  const bucket = readMetaPath(node, [INBOX_NS, beingId]);
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
 * @param {string}   nodeId
 * @param {string}   beingId
 * @param {string[]} correlationIds   ids of entries being consumed
 * @param {object}   [opts]
 * @param {string}   [opts.responseId] correlation id of the response, if any
 * @param {string}   [opts.chatId]     id of the Chat record this message was
 *                                     processed into (the inbox entry now
 *                                     points at conversation history).
 *
 * Back-compat: a plain string fourth arg is interpreted as `responseId`
 * so older callers keep working during the rollout.
 *
 * @returns {Promise<{ consumed: number }>}
 */
export async function markInboxConsumed(nodeId, beingId, correlationIds, opts = {}) {
  if (!nodeId || !beingId || !Array.isArray(correlationIds) || correlationIds.length === 0) {
    return { consumed: 0 };
  }
  let responseId = null;
  let chatId = null;
  if (typeof opts === "string") {
    responseId = opts;
  } else if (opts && typeof opts === "object") {
    responseId = opts.responseId ?? null;
    chatId     = opts.chatId ?? null;
  }

  const consumedAt = new Date().toISOString();
  const node = await Node.findById(nodeId)
    .select(`metadata.${INBOX_NS}.${beingId}`)
    .lean();
  const bucket = readMetaPath(node, [INBOX_NS, beingId]);
  if (!Array.isArray(bucket)) return { consumed: 0 };

  const idSet = new Set(correlationIds);
  const updates = {};
  let consumed = 0;
  bucket.forEach((entry, i) => {
    if (!idSet.has(entry.correlation) || entry.consumed) return;
    const base = `metadata.${INBOX_NS}.${beingId}.${i}`;
    updates[`${base}.consumed`]   = true;
    updates[`${base}.consumedAt`] = consumedAt;
    if (responseId) updates[`${base}.responseId`] = responseId;
    if (chatId)     updates[`${base}.chatId`]     = chatId;
    consumed++;
  });

  if (consumed === 0) return { consumed: 0 };
  await Node.updateOne({ _id: nodeId }, { $set: updates });
  return { consumed };
}

/**
 * Get the full per-being inbox bucket. Used by descriptor builders.
 */
export async function getInboxBucket(nodeId, beingId) {
  return readInbox(nodeId, beingId, {});
}

/**
 * Inbox summary across every being at this position. Used for the Position
 * Description when SEE is on a position (no qualifier). Returned object is
 * keyed by beingId; the descriptor joins this with Being lookups when it
 * needs human-readable identifiers (username, role) for display.
 *
 * Each entry derives queue state from inbox state alone (waiting messages).
 * The descriptor layer combines this with chat-active state (in-progress
 * conversations from the Chat collection) when it builds the renderer-side
 * "busy / talking to / queue" surface.
 */
export async function getInboxSummary(nodeId) {
  if (!nodeId) return {};
  const node = await Node.findById(nodeId).select(`metadata.${INBOX_NS}`).lean();
  if (!node) return {};
  const inbox = readMetaPath(node, [INBOX_NS]);
  if (!inbox || typeof inbox !== "object") return {};
  const out = {};
  const entries = inbox instanceof Map ? inbox.entries() : Object.entries(inbox);
  for (const [beingId, bucket] of entries) {
    if (!Array.isArray(bucket)) continue;
    // Derive queue state from inbox entries alone. The first unconsumed
    // message is the "active" conversation in the queue; later unconsumed
    // messages are senders waiting in line. When all are consumed, the
    // being is idle from the inbox's perspective — an active chainstep
    // may still be in progress; that's reconciled at the descriptor layer.
    const unconsumed = bucket.filter((e) => !e.consumed);
    const activeFrom  = unconsumed[0]?.from || null;
    const pendingFrom = unconsumed.slice(1).map((e) => e.from || null);
    out[beingId] = {
      total:      bucket.length,
      unconsumed: unconsumed.length,
      recent:     bucket.slice(-3),
      activeFrom,
      pendingFrom,
      queueDepth: pendingFrom.length,
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
