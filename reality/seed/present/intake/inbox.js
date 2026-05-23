// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Inbox. A being's per-position mailbox of received SUMMONs.
// Append-only audit log of what arrived; the UI surfaces it,
// humans read it to decide when to answer. Stored under
// `qualities.inbox.<beingId>` on the Space document. I treat the
// `inbox` namespace as reserved: nothing writes it through DO
// set-qualities — only this file's primitives, and only the SUMMON
// verb reaches them.
//
// Inbox is not intake. The two are different storages with
// different jobs:
//
//   inbox  — mailbox. Append-only. Every SUMMON to a being
//            writes a record here regardless of cognition type.
//            Humans answer in their own time; LLM/scripted beings
//            use it as the audit log of "what was received."
//            No consumed/cancelled state — these records are the
//            permanent fact of arrival.
//
//   intake — factory run-feed ([intake.js](intake.js)). What the
//            scheduler drains. Carries consumed/cancelled state
//            because intake entries are work, and work has
//            lifecycle. Two trigger-kinds: "summon" (auto-created
//            from inbox writes for beings whose role declares
//            triggerOn:["message"]) and "transport-act" (the
//            being acted from their own transport, no SUMMON
//            envelope).
//
// Tracing a thread walks SUMMON → inbox record → intake entry →
// Act record → IBP Address.
//
// Entry shape:
//   {
//     from, content, correlation, inReplyTo?, attachments?, sentAt,
//     priority,        // lower = higher precedence (kept for intake mirror)
//     rootCorrelation, // originating chain, propagates through replies
//     activeRole,      // null resolves to beingOut.defaultRole
//   }
//
// Atomic against the Space document — $push appends; nothing
// mutates the bucket in place.

import { randomUUID } from "crypto";
import Space from "../../materials/space/space.js";

const INBOX_NS = "inbox";

// Conservative default for HUMAN priority. Lower number = higher
// precedence — kept on the inbox record so it mirrors what the
// scheduler will see on the matching intake entry.
const DEFAULT_PRIORITY = 1;

/**
 * Append a SUMMON record to a being's mailbox at this position.
 *
 * @param {string} spaceId
 * @param {string} beingId   the receiver Being's _id
 * @param {object} message   SUMMON envelope payload (from, content, correlation, ...)
 * @returns {Promise<{ messageId, sentAt }>}
 */
export async function appendToInbox(spaceId, beingId, message) {
  if (!spaceId) throw new Error("appendToInbox requires spaceId");
  if (!beingId) throw new Error("appendToInbox requires beingId");
  if (!message || typeof message !== "object")
    throw new Error("appendToInbox requires a message object");

  const sentAt    = message.sentAt    || new Date().toISOString();
  const messageId = message.correlation || randomUUID();
  // rootCorrelation defaults to this message's own correlation. Root
  // SUMMONs (no rootCorrelation supplied) ARE their own root.
  const rootCorrelation = message.rootCorrelation || messageId;
  const priority = Number.isFinite(message.priority)
    ? Number(message.priority)
    : DEFAULT_PRIORITY;

  const entry = {
    from:            message.from || null,
    content:         message.content ?? null,
    correlation:     messageId,
    rootCorrelation,
    priority,
    activeRole:      message.activeRole || null,
    inReplyTo:       message.inReplyTo  || null,
    attachments:     Array.isArray(message.attachments) ? message.attachments : [],
    sentAt,
  };

  await Space.updateOne(
    { _id: spaceId },
    { $push: { [`qualities.${INBOX_NS}.${beingId}`]: entry } },
  );

  return { messageId, sentAt };
}

/**
 * Read a being's mailbox at this position.
 *
 * @param {string} spaceId
 * @param {string} beingId
 * @param {object} [options]
 * @param {string} [options.since]  ISO8601; only entries with sentAt >= since
 * @param {number} [options.limit]  cap on entries returned
 * @returns {Promise<Array<object>>}
 */
export async function readInbox(spaceId, beingId, options = {}) {
  if (!spaceId || !beingId) return [];
  const space = await Space.findById(spaceId)
    .select(`qualities.${INBOX_NS}.${beingId}`)
    .lean();
  if (!space) return [];

  const bucket = readMetaPath(space, [INBOX_NS, beingId]);
  if (!Array.isArray(bucket)) return [];

  let entries = bucket;
  if (options.since) entries = entries.filter((e) => e.sentAt >= options.since);
  if (typeof options.limit === "number") entries = entries.slice(0, options.limit);
  return entries;
}

/**
 * Mailbox summary across every being at this position. Used by the
 * Position Descriptor when SEE lands on a position (no qualifier).
 * Returned object is keyed by beingId; the descriptor joins with
 * Being lookups for human-readable display.
 */
export async function getInboxSummary(spaceId) {
  if (!spaceId) return {};
  const space = await Space.findById(spaceId)
    .select(`qualities.${INBOX_NS}`)
    .lean();
  if (!space) return {};
  const inbox = readMetaPath(space, [INBOX_NS]);
  if (!inbox || typeof inbox !== "object") return {};
  const out = {};
  const entries = inbox instanceof Map ? inbox.entries() : Object.entries(inbox);
  for (const [beingId, bucket] of entries) {
    if (!Array.isArray(bucket)) continue;
    out[beingId] = {
      total:  bucket.length,
      recent: bucket.slice(-3),
    };
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function readMetaPath(space, path) {
  if (!space) return undefined;
  let cursor = space.qualities;
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
