// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Threads. The lines that form between beings while work is in flight.
//
// A thread is a live tree of coordinated SUMMONs sharing one
// rootCorrelation. Today every SUMMON already inherits a
// rootCorrelation from its parent (or becomes its own when it has
// no parent); a thread is just that whole chain looked at as one
// thing. Promoting it to addressable substrate means:
//
//   - SEE can return it. `see("<reality>/./threads/<id>")` returns the
//     thread's descriptor; `see("<reality>/./threads")` returns the
//     live forest. Coordination becomes inspectable.
//
//   - SUMMON can cut it. `summon` with target = `./threads/<id>`
//     severs the thread: the seed cut handler walks every pending
//     inbox entry under that rootCorrelation and marks it severed,
//     and (when priority demands) interrupts whatever is running
//     right now. Same envelope as a normal SUMMON; the address
//     resolves to a thread instead of a being.
//
// Nothing here is persisted as new storage. A thread is a derived
// projection: the data lives in Act records (one row per wake-
// and-act) and in inbox entries (per-being qualities under a known
// namespace). This file is the read-side view over both, plus the
// addressing helpers the verb router uses to recognize a thread
// target.
//
// The "id" of a thread is its rootCorrelation. Stable across the
// whole chain by construction (every reply inherits it). When the
// root reply places or the thread is cut, the projection's state
// flips; the rows underneath remain for audit.

import Act from "../../past/act/act.js";
import { attachActFacts } from "../../past/act/actChain.js";
import Space from "./space.js";
import { HEAVEN_SPACE } from "./heavenSpaces.js";
import { I_AM } from "../being/seedBeings.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";

// ─────────────────────────────────────────────────────────────────
// Severed-roots cache
// ─────────────────────────────────────────────────────────────────
//
// In-memory Set populated by cutThread. The scheduler reads it on
// every inbox pickup via isAncestorSevered() to decide whether a
// pending entry's chain still has a live ancestor. Source of truth
// is severedAt on Act rows; the Set is a fast hit. Rebuilds
// lazily on cache misses by querying severedAt; rebuilds fully on
// process boot via primeSeveredRootsCache() (called from genesis).

const _severedRootsCache = new Set();

/**
 * Mark a rootCorrelation as severed in the in-memory cache. Called
 * by cutThread after the DB write succeeds. Idempotent.
 */
export function noteRootSevered(rootCorrelation) {
  if (!rootCorrelation) return;
  _severedRootsCache.add(String(rootCorrelation));
}

/**
 * Boot-time priming. Walks every Act with severedAt set and
 * populates the in-memory cache so cache hits work from t=0.
 * Cheap: severedAt is indexed; query touches only the severed set.
 */
export async function primeSeveredRootsCache() {
  try {
    const rows = await Act.aggregate([
      { $match: { severedAt: { $ne: null } } },
      { $group: { _id: "$rootCorrelation" } },
    ]);
    for (const r of rows) {
      if (r._id) _severedRootsCache.add(String(r._id));
    }
    return _severedRootsCache.size;
  } catch {
    return 0;
  }
}

/**
 * Is this rootCorrelation severed, or does it have a severed
 * ancestor in its parentThread chain? Used by the scheduler at
 * inbox pickup to skip orphaned entries.
 *
 * Walk is bounded by spawn depth (typically 3-5). Cache hits short-
 * circuit each level. Visited Set defends against cycles in
 * parentThread (should be impossible by construction, but defensive).
 *
 * @param {string} rootCorrelation
 * @returns {Promise<{ severed: boolean, ancestorId: string|null }>}
 */
export async function isAncestorSevered(rootCorrelation, visited = new Set()) {
  if (!rootCorrelation) return { severed: false, ancestorId: null };
  const id = String(rootCorrelation);
  if (_severedRootsCache.has(id)) return { severed: true, ancestorId: id };
  if (visited.has(id)) return { severed: false, ancestorId: null };
  visited.add(id);

  // Walk up the parentThread chain.
  const root = await Act.findById(id).select("parentThread severedAt").lean();
  if (!root) return { severed: false, ancestorId: null };
  if (root.severedAt) {
    _severedRootsCache.add(id);
    return { severed: true, ancestorId: id };
  }
  if (!root.parentThread) return { severed: false, ancestorId: null };
  return isAncestorSevered(root.parentThread, visited);
}

// ─────────────────────────────────────────────────────────────────
// Address recognition
// ─────────────────────────────────────────────────────────────────

const THREADS_SEGMENT = "threads";
const HEAVEN_SEGMENT = ".";

/**
 * Does a path string name a thread address?
 *
 *   "/./threads/<id>"  → true     (canonical: heaven / threads / id)
 *   "/threads/<id>"    → true     (shorthand without heaven prefix, accepted)
 *   "/./threads"       → false    (the listing space, not a single thread)
 *   "/threads"         → false    (shorthand listing, not a single thread)
 *
 * The path passed in is the position part of an address (already
 * stripped of @being qualifier). Both leaf-only and full-chain
 * forms are accepted, with or without the heaven "/." prefix.
 *
 * @param {string} path
 * @returns {string|null} the rootCorrelation if matched, else null
 */
export function threadIdFromPath(path) {
  if (typeof path !== "string" || !path) return null;
  let trimmed = path.replace(/^\/+/, "");
  // Strip an optional leading heaven segment so callers can pass
  // either the heaven-prefixed form or the bare leaf form.
  if (trimmed.startsWith(HEAVEN_SEGMENT + "/")) {
    trimmed = trimmed.slice(HEAVEN_SEGMENT.length + 1);
  }
  if (!trimmed.startsWith(THREADS_SEGMENT + "/")) return null;
  const tail = trimmed.slice(THREADS_SEGMENT.length + 1);
  // The rootCorrelation is the next segment. Reject empty or further
  // nested addresses; threads are flat (no children under a thread).
  if (!tail || tail.includes("/")) return null;
  return tail;
}

/**
 * The space _id of the threads place heaven space on this reality. Cached
 * after first lookup. Used by the resolver to return a stance whose
 * spaceId points at threads even though the thread itself has no
 * persistent space row.
 */
let _threadsSpaceIdCache = null;
export async function getThreadsSpaceId() {
  if (_threadsSpaceIdCache) return _threadsSpaceIdCache;
  const { findByHeavenSpace } = await import("../projections.js");
  const space = await findByHeavenSpace(HEAVEN_SPACE.THREADS, "0");
  if (!space) return null;
  _threadsSpaceIdCache = String(space.id);
  return _threadsSpaceIdCache;
}

// ─────────────────────────────────────────────────────────────────
// Thread descriptor (projection)
// ─────────────────────────────────────────────────────────────────

/**
 * Compute the descriptor for one thread. Returns null if no Act
 * row carries this rootCorrelation (the thread doesn't exist).
 *
 * State machine:
 *   live      — at least one Act in this chain is unfinished
 *               (no endMessage.time AND no severedAt)
 *   severed   — at least one Act carries severedAt and no
 *               Stamps are still live (the line was cut)
 *   complete  — every Act in this chain carries endMessage.time
 *               with no severedAt (the chain ran to completion)
 *
 * @param {string} rootCorrelation
 * @returns {Promise<object|null>}
 */
export async function describeThread(rootCorrelation) {
  if (!rootCorrelation) return null;
  const summons = await Act.find({ rootCorrelation })
    .select("_id beingIn beingOut activeRole ibpAddress inReplyTo parentThread stampedAt receivedAt endMessage severedAt priority")
    .lean();
  if (!summons.length) {
    // A thread can exist in the ThreadsProjection (the cross-cutting
    // fold updated it from a be:summon Fact) before any moment has
    // sealed an Act. listLiveThreads will surface it; the projection
    // is the source of truth for "open thread, no acts yet". Fall back
    // so the descriptor still resolves instead of 404-ing on a thread
    // the catalog just listed.
    const ThreadsProjection = (await import("../../past/projections/threads/threadsProjection.js")).default;
    const proj = await ThreadsProjection.findById(rootCorrelation).lean();
    if (!proj) return null;
    return {
      id:              rootCorrelation,
      state:           proj.severedAt ? "severed" : "pending",
      depth:           0,
      liveCount:       0,
      severedCount:    0,
      completeCount:   0,
      participants:    Array.isArray(proj.participants) ? proj.participants : [],
      parentThread:    proj.parentThread || null,
      rootStartedAt:   proj.startedAt || proj.createdAt || null,
      lastAct:         proj.lastAct || null,
      pending:         true,
    };
  }

  const participants = new Set();
  let live = 0;
  let severed = 0;
  let complete = 0;
  let lastAct = null;
  for (const s of summons) {
    if (s.beingIn)  participants.add(String(s.beingIn));
    if (s.beingOut) participants.add(String(s.beingOut));
    if (s.severedAt) severed++;
    else if (s.endMessage?.time) complete++;
    else live++;
    const t = s.endMessage?.time || s.severedAt || s.stampedAt || s.receivedAt;
    if (t && (!lastAct || t > lastAct)) lastAct = t;
  }

  let state;
  if (live > 0) state = "live";
  else if (severed > 0) state = "severed";
  else state = "complete";

  // Tree shape: parent thread (if this chain branched off another).
  // The root Act is the one whose _id == rootCorrelation, or the
  // first by time if convention drifted. parentThread is the
  // canonical lineage pointer — auto-stamped when assign opens a
  // moment for a being acting under thread A who emits a fresh
  // top-level SUMMON.
  const sortedAsc = [...summons].sort(
    (a, b) => new Date(a.stampedAt || a.receivedAt || 0) - new Date(b.stampedAt || b.receivedAt || 0),
  );
  const rootStamp =
    summons.find((s) => String(s._id) === String(rootCorrelation)) ||
    sortedAsc[0];
  const parentThread = rootStamp?.parentThread || null;

  return {
    id:              rootCorrelation,
    state,
    depth:           summons.length,
    liveCount:       live,
    severedCount:    severed,
    completeCount:   complete,
    participants:    [...participants],
    parentThread,
    rootStartedAt:   rootStamp?.stampedAt || rootStamp?.receivedAt || null,
    lastAct,
    // Surface the acts on the thread so clients can render the chain
    // without a second query. Oldest-first for natural reading order.
    // attachActFacts enriches each with a compact Fact summary so a
    // structured act (empty prose, Facts-as-content) renders as what it
    // did, not as an empty moment.
    acts: await attachActFacts(sortedAsc.map(serializeThreadAct)),
  };
}

function serializeThreadAct(s) {
  return {
    _id:             String(s._id),
    beingIn:         s.beingIn ? String(s.beingIn) : null,
    beingOut:        s.beingOut ? String(s.beingOut) : null,
    activeRole:      s.activeRole || null,
    ibpAddress:      s.ibpAddress || null,
    inReplyTo:       s.inReplyTo || null,
    parentThread:    s.parentThread || null,
    priority:        s.priority || null,
    startMessage:    s.startMessage || null,
    endMessage:      s.endMessage || null,
    receivedAt:      s.receivedAt || null,
    stampedAt:       s.stampedAt || null,
    severedAt:       s.severedAt || null,
  };
}

/**
 * List live threads on this reality, optionally filtered. Cheap when
 * none, capped by `limit`. Each item is a minimal preview; callers
 * walk to describeThread for the full descriptor.
 *
 * Filters (all optional, AND-combined; all pushed down to the
 * aggregation $match so the projection scales):
 *
 *   being     — beingId of a participant (matches beingIn OR beingOut).
 *               Pass with or without leading "@".
 *   role      — activeRole the participant wore on the Act.
 *   position  — spaceId fragment; matches threads whose ibpAddress
 *               includes this position (substring match).
 *   stance    — full stance string (place/path@being); exact match.
 *   priority  — HUMAN | GATEWAY | INTERACTIVE | BACKGROUND.
 *
 * Filters are row-level. A thread "matches" if any of its Act rows
 * match the filter; the projection groups by rootCorrelation after
 * filtering. So `being=@me&role=planner` returns "threads where I had
 * at least one Act as planner."
 */
export async function listLiveThreads({
  limit = 100,
  being = null,
  role = null,            // intentionally unused; ThreadsProjection
  position = null,        //   carries no per-Act-row metadata.
  stance = null,          //   Cross-cutting projection is recipient-
  priority = null,        //   participant-keyed only. (Future: extend
} = {}) {                 //   if filtering by role/stance/priority is needed.)
  // Route through the ThreadsProjection (Bucket 3 Option D, 2026-05-23).
  // The legacy per-SEE Act aggregation retired; the cross-cutting fold
  // maintains this projection from be:summon Facts + Act seals.
  const ThreadsProjection = (await import("../../past/projections/threads/threadsProjection.js")).default;
  const match = { severedAt: null };
  if (being) {
    match.participants = String(being).replace(/^@/, "");
  }
  void role; void position; void stance; void priority;

  const rows = await ThreadsProjection.find(match)
    .sort({ lastAct: -1 })
    .limit(Math.max(1, Math.min(limit, 500)))
    .lean();
  return rows.map((r) => ({ id: r._id, lastAct: r.lastAct }));
}

/**
 * Mark every Act in a thread's chain as severed. Idempotent:
 * Stamps that already carry severedAt are left alone; Stamps that
 * already ended (endMessage.time) are left alone. Returns the count
 * of rows newly marked.
 */
export async function markThreadSevered(rootCorrelation, now = new Date()) {
  if (!rootCorrelation) return 0;
  const result = await Act.updateMany(
    {
      rootCorrelation,
      severedAt: null,
      "endMessage.time": null,
    },
    { $set: { severedAt: now } },
  );
  return result.modifiedCount || 0;
}

// ─────────────────────────────────────────────────────────────────
// Cut handler
// ─────────────────────────────────────────────────────────────────

/**
 * Sever a thread. The seed implementation of SUMMON-to-thread.
 *
 * Authorization (participation gate): the asker must be a participant
 * in the chain. A participant is any being that appears as `beingIn`
 * or `beingOut` on a Act under this rootCorrelation. The I_AM has
 * universal authority and always passes. Stance auth gates whether
 * the asker can address `.threads` at all (broad gate); this gate
 * narrows to "this specific thread." Both run.
 *
 * Three steps after auth, in this order:
 *
 *   1. Mark every Act in the chain as severedAt (audit + state).
 *   2. Cancel pending inbox entries for every being that participated
 *      in the chain (scheduler skips cancelled entries on pickup).
 *   3. If priority demands urgency (HUMAN), interrupt anything still
 *      running under this rootCorrelation via the scheduler's
 *      abortByRootCorrelations. Lower priorities let the scheduler
 *      drop into the cancelled inbox entries naturally.
 *
 * Pure operation on existing primitives. The dependencies on the
 * inbox and scheduler are import-on-call to keep this module reachable
 * during early-boot resolver paths that don't need the cognition
 * layer.
 *
 * @param {object} params
 * @param {string} params.rootCorrelation
 * @param {string} [params.priority="INTERACTIVE"]
 * @param {string} [params.reason]
 * @param {object|null} [params.identity]  { beingId, name } of the asker.
 *   Required unless the call is seed-internal (then pass null only
 *   when you intentionally want to bypass the participation check;
 *   never bypass from extension code).
 * @returns {Promise<{ severed: number, cancelled: number, aborted: number }>}
 */
export async function cutThread({
  rootCorrelation,
  priority = "INTERACTIVE",
  reason = "thread cut",
  identity = null,
  summonCtx = null,
}) {
  if (!rootCorrelation) {
    return { severed: 0, cancelled: 0, aborted: 0 };
  }

  // ── Participation gate ──
  // I_AM always passes. Anyone else must be in the chain.
  const isIAm = identity?.name === I_AM;
  if (!isIAm) {
    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "Cut requires an authenticated asker",
      );
    }
    const askerId = String(identity.beingId);
    const participant = await Act.exists({
      rootCorrelation,
      $or: [{ beingIn: askerId }, { beingOut: askerId }],
    });
    if (!participant) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "Only a participant in this thread can cut it",
      );
    }
  }

  // 1. Audit + state on the Act rows.
  const severed = await markThreadSevered(rootCorrelation);
  // Cache the severed root so subsequent ancestor-checks short-
  // circuit without a DB walk. Always populate, even if severed===0
  // (the chain may have already been marked but the cache lost).
  noteRootSevered(rootCorrelation);

  // 2. Fact-driven sever (Bucket 3 Option D, 2026-05-23). The
  //    severer stamps one be:sever Fact on its own reel (single-
  //    writer); the cross-cutting fold in
  //    past/projections/inbox/inboxProjectionFold.js sweeps the InboxProjection
  //    rows whose rootCorrelation matches. Queued moments drop in
  //    one fold cycle; the legacy per-being intake sweep is gone.
  //    Inbox audit (the be:summon Facts themselves) is untouched —
  //    facts are the permanent arrival record.
  let cancelled = 0;
  try {
    const { emitFact } = await import("../../past/fact/facts.js");
    const InboxProjection = (await import("../../past/projections/inbox/inboxProjection.js")).default;
    const severerBeingId = isIAm ? I_AM : String(identity.beingId);
    cancelled = await InboxProjection.countDocuments({ rootCorrelation });
    await emitFact({
      verb:    "be",
      action:  "sever",
      beingId: severerBeingId,
      target:  { kind: "being", id: severerBeingId }, // severer's own reel
      params:  { rootCorrelation, reason, priority },
      actId:   summonCtx?.actId || null,
      branch:  summonCtx?.actorAct?.branch || "0",
    }, summonCtx);
    // When summonCtx is present, the be:sever Fact lives in the
    // caller's ΔF and commits at sealAct; the cross-cutting fold runs
    // post-commit and clears the InboxProjection rows then. When
    // summonCtx is null (boot/standalone), emitFact committed
    // immediately and the eager-fold already ran.
  } catch {
    // Best-effort. Severed Acts + scheduler abort still close the
    // line at the audit + runtime layers.
  }

  // 3. HUMAN-priority cuts interrupt the live task immediately;
  //    lower priorities let the scheduler drain naturally.
  let aborted = 0;
  if (priority === "HUMAN") {
    try {
      const { abortByRootCorrelations } = await import(
        "../../present/intake/scheduler.js"
      );
      aborted = abortByRootCorrelations([rootCorrelation], reason) || 0;
    } catch {
      // Scheduler unavailable (cognition not booted yet). The
      // severed Stamps + cancelled inbox still take effect on next
      // pickup; we just couldn't interrupt the live task.
    }
  }

  return { severed, cancelled, aborted };
}

// ─────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────

async function rootStampOf(actId) {
  if (!actId) return null;
  const s = await Act.findById(actId)
    .select("rootCorrelation")
    .lean();
  return s?.rootCorrelation || null;
}
