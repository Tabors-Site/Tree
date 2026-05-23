// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The queue of pending moments for a being at a position. An entry
// here is a moment that has been requested but not yet had — the
// frame waiting to be assembled, the inference waiting to be run,
// the being waiting to be. Per being, per position, stored under
// `qualities.inbox.<beingId>` on the Space document. I treat the
// `inbox` namespace as reserved: nothing writes it through DO
// set-qualities, only the primitives in this file, and only SUMMON
// reaches those primitives.
//
// Three layers I want to keep straight:
//
//   IBP Address — protocol-level addressing (sender stance,
//                 receiver stance).
//   Stamp      — the stamped record. The moment has been; this is
//                 its frame on the reel.
//   Inbox       — the queue of pending moments. A request waiting
//                 for the scheduler to pull it down the line.
//
// An inbox entry is the moment-request before it becomes a stamped
// Stamp. Once the role's summon() runs the moment (assembling the frame and
// running the being's inference), the entry is marked consumed and
// points at the resulting stampId. Tracing a thread walks SUMMON
// → inbox entry → Stamp record → IBP Address.
//
// Entry shape:
//   {
//     from, content, correlation, inReplyTo?, attachments?, sentAt,
//     priority:        number   (lower wins; scheduler picks lowest first)
//     rootCorrelation: string   (originating chain, propagates through replies)
//     activeRole:      string|null  (the role the receiver acts in
//                                    for this moment; null resolves
//                                    to beingOut.defaultRole)
//     consumed:        boolean,
//     cancelledAt:     ISO8601|null  (cancelByRootCorrelation stamps this;
//                                     scheduler skips cancelled entries —
//                                     the moment never happens)
//     consumedAt?:     ISO8601,
//     stampedAt?:     ISO8601,
//     responseId?:     <correlation of the response, if any>,
//     stampId?:       <id of the Stamp record this moment became>,
//   }
//
// Operations are atomic against the Space document. No
// read-modify-write races: $push appends, $set updates individual
// flags by array index.
//
// I key by beingId rather than role. Multiple beings of the same
// role at one position legitimately have separate inboxes; the role
// name doesn't unique-identify a being.

import { randomUUID } from "crypto";
import Space from "../../models/space.js";

const INBOX_NS = "inbox";

// Priority field: lower number = picked first by scheduler.
// Kept here as a local fallback so callers that don't pass priority still
// get a deterministic, conservative HUMAN default.
const DEFAULT_PRIORITY = 1;

// Place-level cap on pending inbox entries. Pairs with maxRunTurns
// (active LLM turns) to bound the rate of change a place can hold:
// the inbox is the "pending work" backlog, runTurn is the "in
// progress" set. When the backlog hits MAX_INBOX, appendToInbox
// throws and the SUMMON caller decides whether to retry. Counter is
// in-memory and starts at 0 on boot; entries that survived a
// restart aren't reflected until reseed on first consume, which is
// fine — the cap is a rate-of-change guard, not a hard quota.
let MAX_INBOX = 5000;
let _pendingInboxCount = 0;
export function setMaxInbox(n) {
  if (Number.isFinite(n) && n > 0) {
    MAX_INBOX = Math.max(100, Math.min(Math.floor(n), 1_000_000));
  }
}
export function getPendingInboxCount() {
  return _pendingInboxCount;
}

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

  // Place-level backlog gate. Cap-and-reject: the caller decides
  // whether to retry. The counter increments on append, decrements
  // on markInboxConsumed.
  if (_pendingInboxCount >= MAX_INBOX) {
    throw new Error(
      `Inbox cap reached: ${MAX_INBOX} pending entries place-wide. ` +
        `Raise maxInbox in .config or wait for backlog to drain.`,
    );
  }

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
    stampedAt: null,
    consumedAt: null,
    responseId: null,
    stampId: null,
  };

  // Atomic $push to the per-being bucket. Mongo creates the path if it
  // does not yet exist on the qualities Map.
  await Space.updateOne(
    { _id: spaceId },
    { $push: { [`qualities.${INBOX_NS}.${beingId}`]: entry } },
  );

  _pendingInboxCount++;

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
 * @param {string}   [opts.stampId]     id of the Chat record this message was
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
  let stampId = null;
  if (typeof opts === "string") {
    responseId = opts;
  } else if (opts && typeof opts === "object") {
    responseId = opts.responseId ?? null;
    stampId = opts.stampId ?? null;
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
    if (stampId) updates[`${base}.stampId`] = stampId;
    consumed++;
  });

  if (consumed === 0) return { consumed: 0 };
  await Space.updateOne({ _id: spaceId }, { $set: updates });
  _pendingInboxCount = Math.max(0, _pendingInboxCount - consumed);
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

  // First pass: select the best entry by priority among non-consumed,
  // non-cancelled candidates. Cheap, fully in-memory.
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

  // Ancestor-severance check. A live entry whose rootCorrelation
  // has a severed ancestor in the parentThread chain is an orphan:
  // its parent line has been cut and there's no one upstream to
  // receive its reply. Mark it severedByAncestor and skip. We do
  // the check after the pick, not during, so the cheap in-memory
  // loop runs without async overhead on every candidate; only the
  // chosen entry pays the (typically cached) ancestor lookup. If
  // it's orphaned, recurse to pick the next candidate.
  const entry = bucket[bestIdx];
  if (entry.rootCorrelation) {
    const { isAncestorSevered } = await import("../../place/space/threads.js");
    const check = await isAncestorSevered(entry.rootCorrelation);
    if (check.severed) {
      // Stamp the orphan reason on this entry and recurse for the next.
      const now = new Date().toISOString();
      await Space.updateOne(
        { _id: spaceId },
        { $set: {
            [`qualities.${INBOX_NS}.${beingId}.${bestIdx}.cancelledAt`]: now,
            [`qualities.${INBOX_NS}.${beingId}.${bestIdx}.severedByAncestor`]: check.ancestorId,
          } },
      );
      return pickNextEntry(spaceId, beingId);
    }
  }

  return { entry, index: bestIdx };
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
  _pendingInboxCount = Math.max(0, _pendingInboxCount - correlations.length);
  return { cancelled: correlations.length, correlations };
}

/**
 * Stamp the moment the scheduler picked an entry up (informational —
 * the scheduler can compare stampedAt vs consumedAt to spot crashes
 * where a Stamp opened but didn't finish). Idempotent: a second call
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
  const stampedAt = new Date().toISOString();
  await Space.updateOne(
    { _id: spaceId },
    {
      $set: {
        [`qualities.${INBOX_NS}.${beingId}.${index}.stampedAt`]: stampedAt,
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
