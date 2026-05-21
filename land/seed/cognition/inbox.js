// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Inbox primitives.
//
// The inbox is a per-being-per-position quality, stored under
// `qualities.inbox.<beingId>` on the Space document. The kernel treats
// `inbox` as a reserved namespace: it cannot be written through DO
// set-meta (see actions/set-meta.js), only through these primitives,
// which SUMMON uses.
//
// **Layering.** The inbox is *delivery infrastructure*, not conversation
// history. Three distinct layers:
//
//   1. IBP Address — protocol-level addressing (sender / receiver stances).
//   2. Summons — first-class exchange records. Conversation history. Stored
//      with ibpAddress, beingIn, beingOut, content.
//   3. Inbox — the delivery queue at a position. Pending SUMMON messages
//      before they get processed into Summons.
//
// An inbox entry is a *message in flight*. Once a being's summoning runs,
// the message is processed into one or more Summon records; the inbox entry
// is marked consumed and points at the resulting `summonId`. Trace from
// incoming SUMMON → resulting summon record → IBP Address using these references.
//
// Each inbox entry:
//   {
//     from, content, correlation, inReplyTo?, attachments?, sentAt,
//     priority:    number   (LLM_PRIORITY-compatible: lower = higher precedence)
//     rootCorrelation: string  (originating user message correlation, propagated through reply chains)
//     activeRole: string | null  (the role the receiver should act in for this
//                                 summon; resolves to beingOut.defaultRole when null.
//                                 Lets one being act in different roles per summon —
//                                 see project-identity-durable-role-composable.)
//     consumed:    boolean,
//     cancelledAt: ISO8601 | null  (set by cancelByRootCorrelation; scheduler skips cancelled entries)
//     consumedAt?: ISO8601,
//     summonedAt?: ISO8601,
//     responseId?: <correlation id of the response, if any>,
//     summonId?:   <id of the Summon record this message was processed into>,
//   }
//
// Operations are atomic against the Space document. No read-modify-write
// races: $push appends and $set updates individual flags by array index.
//
// **Keying.** Keyed by beingId (the canonical Being._id) rather than role
// type. Multiple beings of the same role at one position legitimately
// have separate inboxes; the role name doesn't unique-identify a being.

import { randomUUID } from "crypto";
import Space from "../models/space.js";

const INBOX_NS = "inbox";

// Priority defaults track LLM_PRIORITY (lower number = higher precedence).
// Kept here as a local fallback so callers that don't pass priority still
// get a deterministic, conservative HUMAN default.
const DEFAULT_PRIORITY = 1;

/**
 * Append a message to a being's inbox at this position.
 *
 * @param {string} spaceId
 * @param {string} beingId   the receiver Being's _id
 * @param {object} message   SUMMON envelope payload (from, content, correlation, ...)
 *                           Optional new fields:
 *                             priority:        number, lower = higher precedence
 *                             rootCorrelation: string, originating message id
 * @returns {Promise<{ messageId, sentAt }>}
 */
export async function appendToInbox(spaceId, beingId, message) {
  if (!spaceId) throw new Error("appendToInbox requires spaceId");
  if (!beingId) throw new Error("appendToInbox requires beingId");
  if (!message || typeof message !== "object")
    throw new Error("appendToInbox requires a message object");

  const sentAt = message.sentAt || new Date().toISOString();
  const messageId = message.correlation || randomUUID();
  // rootCorrelation defaults to this message's own correlation. Reply
  // chains propagate the originator's correlation by passing it through
  // explicitly; root SUMMONs (no rootCorrelation supplied) ARE their
  // own root, which keeps cancelByRootCorrelation symmetric for both
  // standalone messages and chain heads.
  const rootCorrelation = message.rootCorrelation || messageId;
  const priority = Number.isFinite(message.priority)
    ? Number(message.priority)
    : DEFAULT_PRIORITY;

  const entry = {
    from: message.from || null,
    content: message.content ?? null,
    correlation: messageId,
    rootCorrelation,
    priority,
    activeRole: message.activeRole || null,
    inReplyTo: message.inReplyTo || null,
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    sentAt,
    consumed: false,
    cancelledAt: null,
    summonedAt: null,
    consumedAt: null,
    responseId: null,
    summonId: null,
  };

  // Atomic $push to the per-being bucket. Mongo creates the path if it
  // does not yet exist on the qualities Map.
  await Space.updateOne(
    { _id: spaceId },
    { $push: { [`qualities.${INBOX_NS}.${beingId}`]: entry } },
  );

  return { messageId, sentAt };
}

/**
 * Read a being's inbox at this position.
 *
 * @param {string} spaceId
 * @param {string} beingId
 * @param {object} [options]
 * @param {string} [options.since]      ISO8601; only entries with sentAt >= since
 * @param {boolean} [options.unconsumed] only entries with consumed=false
 * @param {number} [options.limit]      cap on entries returned
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
  if (options.unconsumed) entries = entries.filter((e) => !e.consumed);
  if (options.since) entries = entries.filter((e) => e.sentAt >= options.since);
  if (typeof options.limit === "number")
    entries = entries.slice(0, options.limit);
  return entries;
}

/**
 * Mark messages as consumed after a summoning processes them.
 *
 * @param {string}   spaceId
 * @param {string}   beingId
 * @param {string[]} correlationIds   ids of entries being consumed
 * @param {object}   [opts]
 * @param {string}   [opts.responseId] correlation id of the response, if any
 * @param {string}   [opts.summonId]     id of the Chat record this message was
 *                                     processed into (the inbox entry now
 *                                     points at conversation history).
 *
 * Back-compat: a plain string fourth arg is interpreted as `responseId`
 * so older callers keep working during the rollout.
 *
 * @returns {Promise<{ consumed: number }>}
 */
export async function markInboxConsumed(
  spaceId,
  beingId,
  correlationIds,
  opts = {},
) {
  if (
    !spaceId ||
    !beingId ||
    !Array.isArray(correlationIds) ||
    correlationIds.length === 0
  ) {
    return { consumed: 0 };
  }
  let responseId = null;
  let summonId = null;
  if (typeof opts === "string") {
    responseId = opts;
  } else if (opts && typeof opts === "object") {
    responseId = opts.responseId ?? null;
    summonId = opts.summonId ?? null;
  }

  const consumedAt = new Date().toISOString();
  const space = await Space.findById(spaceId)
    .select(`qualities.${INBOX_NS}.${beingId}`)
    .lean();
  const bucket = readMetaPath(space, [INBOX_NS, beingId]);
  if (!Array.isArray(bucket)) return { consumed: 0 };

  const idSet = new Set(correlationIds);
  const updates = {};
  let consumed = 0;
  bucket.forEach((entry, i) => {
    if (!idSet.has(entry.correlation) || entry.consumed) return;
    const base = `qualities.${INBOX_NS}.${beingId}.${i}`;
    updates[`${base}.consumed`] = true;
    updates[`${base}.consumedAt`] = consumedAt;
    if (responseId) updates[`${base}.responseId`] = responseId;
    if (summonId) updates[`${base}.summonId`] = summonId;
    consumed++;
  });

  if (consumed === 0) return { consumed: 0 };
  await Space.updateOne({ _id: spaceId }, { $set: updates });
  return { consumed };
}

/**
 * Pick the next entry the scheduler should process for this being.
 * Highest priority first (lowest number wins); ties break to oldest
 * (lowest array index, which is the earliest $push). Skips entries
 * already consumed or cancelled.
 *
 * Returns `null` when the inbox has nothing actionable.
 *
 * @param {string} spaceId
 * @param {string} beingId
 * @returns {Promise<null | { entry: object, index: number }>}
 */
export async function pickNextEntry(spaceId, beingId) {
  if (!spaceId || !beingId) return null;
  const space = await Space.findById(spaceId)
    .select(`qualities.${INBOX_NS}.${beingId}`)
    .lean();
  const bucket = readMetaPath(space, [INBOX_NS, beingId]);
  if (!Array.isArray(bucket) || bucket.length === 0) return null;

  let bestIdx = -1;
  let bestPriority = Number.POSITIVE_INFINITY;
  for (let i = 0; i < bucket.length; i++) {
    const e = bucket[i];
    if (!e || e.consumed || e.cancelledAt) continue;
    const p = Number.isFinite(e.priority)
      ? Number(e.priority)
      : DEFAULT_PRIORITY;
    // Strictly less-than keeps the earliest array index (oldest) on ties.
    if (p < bestPriority) {
      bestPriority = p;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  return { entry: bucket[bestIdx], index: bestIdx };
}

/**
 * Mark every pending (non-consumed, non-cancelled) entry whose
 * rootCorrelation matches as cancelled. Used by role templates that
 * decide to cancel downstream work after receiving a cancel SUMMON,
 * and by system cleanup paths.
 *
 * Returns the count of entries cancelled.
 *
 * @param {string} spaceId
 * @param {string} beingId
 * @param {string} rootCorrelation
 * @returns {Promise<{ cancelled: number, correlations: string[] }>}
 */
export async function cancelByRootCorrelation(
  spaceId,
  beingId,
  rootCorrelation,
) {
  if (!spaceId || !beingId || !rootCorrelation) {
    return { cancelled: 0, correlations: [] };
  }
  const space = await Space.findById(spaceId)
    .select(`qualities.${INBOX_NS}.${beingId}`)
    .lean();
  const bucket = readMetaPath(space, [INBOX_NS, beingId]);
  if (!Array.isArray(bucket)) return { cancelled: 0, correlations: [] };

  const cancelledAt = new Date().toISOString();
  const updates = {};
  const correlations = [];
  bucket.forEach((entry, i) => {
    if (!entry || entry.consumed || entry.cancelledAt) return;
    if (entry.rootCorrelation !== rootCorrelation) return;
    updates[`qualities.${INBOX_NS}.${beingId}.${i}.cancelledAt`] = cancelledAt;
    correlations.push(entry.correlation);
  });
  if (correlations.length === 0) return { cancelled: 0, correlations: [] };
  await Space.updateOne({ _id: spaceId }, { $set: updates });
  return { cancelled: correlations.length, correlations };
}

/**
 * Stamp the moment the scheduler picked an entry up (informational —
 * the scheduler can compare summonedAt vs consumedAt to spot crashes
 * where a Summon started but didn't finish). Idempotent: a second call
 * leaves the first timestamp in place.
 *
 * Index is required because correlation lookup would race with concurrent
 * appends; the scheduler already knows the index from pickNextEntry.
 *
 * @param {string} spaceId
 * @param {string} beingId
 * @param {number} index    array index returned by pickNextEntry
 */
export async function markSummoned(spaceId, beingId, index) {
  if (!spaceId || !beingId || !Number.isInteger(index) || index < 0) return;
  const summonedAt = new Date().toISOString();
  await Space.updateOne(
    { _id: spaceId },
    {
      $set: {
        [`qualities.${INBOX_NS}.${beingId}.${index}.summonedAt`]: summonedAt,
      },
    },
  );
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
export async function getInboxSummary(spaceId) {
  if (!spaceId) return {};
  const space = await Space.findById(spaceId)
    .select(`qualities.${INBOX_NS}`)
    .lean();
  if (!space) return {};
  const inbox = readMetaPath(space, [INBOX_NS]);
  if (!inbox || typeof inbox !== "object") return {};
  const out = {};
  const entries =
    inbox instanceof Map ? inbox.entries() : Object.entries(inbox);
  for (const [beingId, bucket] of entries) {
    if (!Array.isArray(bucket)) continue;
    // Derive queue state from inbox entries alone. The first unconsumed
    // message is the "active" conversation in the queue; later unconsumed
    // messages are senders waiting in line. When all are consumed, the
    // being is idle from the inbox's perspective — an active chainstep
    // may still be in progress; that's reconciled at the descriptor layer.
    const unconsumed = bucket.filter((e) => !e.consumed);
    const activeFrom = unconsumed[0]?.from || null;
    const pendingFrom = unconsumed.slice(1).map((e) => e.from || null);
    out[beingId] = {
      total: bucket.length,
      unconsumed: unconsumed.length,
      recent: bucket.slice(-3),
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

// Mongoose lean() returns qualities as a plain object whose entries may be
// nested Maps depending on driver version. Resolve a path traversal that
// handles both shapes.
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
