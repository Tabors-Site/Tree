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
//   - SEE can return it. `see("<place>/.threads/<id>")` returns the
//     thread's descriptor; `see("<place>/.threads")` returns the
//     live forest. Coordination becomes inspectable.
//
//   - SUMMON can cut it. `summon` with target = `.threads/<id>`
//     severs the thread: the kernel cut handler walks every pending
//     inbox entry under that rootCorrelation and marks it severed,
//     and (when priority demands) interrupts whatever is running
//     right now. Same envelope as a normal SUMMON; the address
//     resolves to a thread instead of a being.
//
// Nothing here is persisted as new storage. A thread is a derived
// projection: the data lives in Summon records (one row per wake-
// and-act) and in inbox entries (per-being qualities under a known
// namespace). This file is the read-side view over both, plus the
// addressing helpers the verb router uses to recognize a thread
// target.
//
// The "id" of a thread is its rootCorrelation. Stable across the
// whole chain by construction (every reply inherits it). When the
// root reply places or the thread is cut, the projection's state
// flips; the rows underneath remain for audit.

import Summon from "../../models/summon.js";
import Space from "../../models/space.js";
import { SEED_SPACE } from "./seedSpaces.js";
import { I_AM } from "../being/seedBeings.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";

// ─────────────────────────────────────────────────────────────────
// Severed-roots cache
// ─────────────────────────────────────────────────────────────────
//
// In-memory Set populated by cutThread. The scheduler reads it on
// every inbox pickup via isAncestorSevered() to decide whether a
// pending entry's chain still has a live ancestor. Source of truth
// is severedAt on Summon rows; the Set is a fast hit. Rebuilds
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
 * Boot-time priming. Walks every Summon with severedAt set and
 * populates the in-memory cache so cache hits work from t=0.
 * Cheap: severedAt is indexed; query touches only the severed set.
 */
export async function primeSeveredRootsCache() {
  try {
    const rows = await Summon.aggregate([
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
  const root = await Summon.findById(id).select("parentThread severedAt").lean();
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

const THREADS_SEGMENT = ".threads";

/**
 * Does a path string name a thread address?
 *
 *   "/.threads/<id>"  → true
 *   "/.threads"       → false (the listing space, not a single thread)
 *
 * The path passed in is the position part of an address (already
 * stripped of @being qualifier). Both leaf-only and full-chain
 * forms are accepted.
 *
 * @param {string} path
 * @returns {string|null} the rootCorrelation if matched, else null
 */
export function threadIdFromPath(path) {
  if (typeof path !== "string" || !path) return null;
  // Accept either /.threads/<id> or .threads/<id>.
  const trimmed = path.replace(/^\/+/, "");
  if (!trimmed.startsWith(THREADS_SEGMENT + "/")) return null;
  const tail = trimmed.slice(THREADS_SEGMENT.length + 1);
  // The rootCorrelation is the next segment. Reject empty or further
  // nested addresses; threads are flat (no children under a thread).
  if (!tail || tail.includes("/")) return null;
  return tail;
}

/**
 * The space _id of the .threads place seed space on this place. Cached
 * after first lookup. Used by the resolver to return a stance whose
 * spaceId points at .threads even though the thread itself has no
 * persistent space row.
 */
let _threadsSpaceIdCache = null;
export async function getThreadsSpaceId() {
  if (_threadsSpaceIdCache) return _threadsSpaceIdCache;
  const space = await Space.findOne({ seedSpace: SEED_SPACE.THREADS })
    .select("_id")
    .lean();
  if (!space) return null;
  _threadsSpaceIdCache = String(space._id);
  return _threadsSpaceIdCache;
}

// ─────────────────────────────────────────────────────────────────
// Thread descriptor (projection)
// ─────────────────────────────────────────────────────────────────

/**
 * Compute the descriptor for one thread. Returns null if no Summon
 * row carries this rootCorrelation (the thread doesn't exist).
 *
 * State machine:
 *   live      — at least one Summon in this chain is unfinished
 *               (no endMessage.time AND no severedAt)
 *   severed   — at least one Summon carries severedAt and no
 *               Summons are still live (the line was cut)
 *   complete  — every Summon in this chain carries endMessage.time
 *               with no severedAt (the chain ran to completion)
 *
 * @param {string} rootCorrelation
 * @returns {Promise<object|null>}
 */
export async function describeThread(rootCorrelation) {
  if (!rootCorrelation) return null;
  const summons = await Summon.find({ rootCorrelation })
    .select("_id beingIn beingOut activeRole ibpAddress inReplyTo parentThread summonedAt receivedAt endMessage severedAt priority")
    .lean();
  if (!summons.length) return null;

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
    const t = s.endMessage?.time || s.severedAt || s.summonedAt || s.receivedAt;
    if (t && (!lastAct || t > lastAct)) lastAct = t;
  }

  let state;
  if (live > 0) state = "live";
  else if (severed > 0) state = "severed";
  else state = "complete";

  // Tree shape: parent thread (if this chain branched off another).
  // The root Summon is the one whose _id == rootCorrelation, or the
  // first by time if convention drifted. parentThread is the
  // canonical lineage pointer — auto-stamped at startSummon when a
  // being acting under thread A emits a fresh top-level SUMMON.
  const rootSummon =
    summons.find((s) => String(s._id) === String(rootCorrelation)) ||
    summons.sort((a, b) => (a.summonedAt || 0) - (b.summonedAt || 0))[0];
  const parentThread = rootSummon?.parentThread || null;

  return {
    id:              rootCorrelation,
    state,
    depth:           summons.length,
    liveCount:       live,
    severedCount:    severed,
    completeCount:   complete,
    participants:    [...participants],
    parentThread,
    rootStartedAt:   rootSummon?.summonedAt || rootSummon?.receivedAt || null,
    lastAct,
  };
}

/**
 * List live threads on this place, optionally filtered. Cheap when
 * none, capped by `limit`. Each item is a minimal preview; callers
 * walk to describeThread for the full descriptor.
 *
 * Filters (all optional, AND-combined; all pushed down to the
 * aggregation $match so the projection scales):
 *
 *   being     — beingId of a participant (matches beingIn OR beingOut).
 *               Pass with or without leading "@".
 *   role      — activeRole the participant wore on the Summon.
 *   position  — spaceId fragment; matches threads whose ibpAddress
 *               includes this position (substring match).
 *   stance    — full stance string (place/path@being); exact match.
 *   priority  — HUMAN | GATEWAY | INTERACTIVE | BACKGROUND.
 *
 * Filters are row-level. A thread "matches" if any of its Summon rows
 * match the filter; the projection groups by rootCorrelation after
 * filtering. So `being=@me&role=planner` returns "threads where I had
 * at least one Summon as planner."
 */
export async function listLiveThreads({
  limit = 100,
  being = null,
  role = null,
  position = null,
  stance = null,
  priority = null,
} = {}) {
  const match = {
    severedAt: null,
    "endMessage.time": null,
    rootCorrelation: { $ne: null },
  };
  if (being) {
    const beingId = String(being).replace(/^@/, "");
    match.$or = [{ beingIn: beingId }, { beingOut: beingId }];
  }
  if (role)     match.activeRole = String(role);
  if (stance)   match.ibpAddress = String(stance);
  if (position) {
    // Pragmatic substring match on ibpAddress (which carries the
    // position segments). Escape regex metas so user input doesn't
    // break the match.
    const safe = String(position).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    match.ibpAddress = { $regex: safe };
  }
  if (priority) match.priority = String(priority);

  const roots = await Summon.aggregate([
    { $match: match },
    { $group: {
        _id: "$rootCorrelation",
        lastAct: { $max: "$summonedAt" },
      },
    },
    { $sort: { lastAct: -1 } },
    { $limit: Math.max(1, Math.min(limit, 500)) },
  ]);
  return roots.map((r) => ({ id: r._id, lastAct: r.lastAct }));
}

/**
 * Mark every Summon in a thread's chain as severed. Idempotent:
 * Summons that already carry severedAt are left alone; Summons that
 * already ended (endMessage.time) are left alone. Returns the count
 * of rows newly marked.
 */
export async function markThreadSevered(rootCorrelation, now = new Date()) {
  if (!rootCorrelation) return 0;
  const result = await Summon.updateMany(
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
 * Sever a thread. The kernel implementation of SUMMON-to-thread.
 *
 * Authorization (participation gate): the asker must be a participant
 * in the chain. A participant is any being that appears as `beingIn`
 * or `beingOut` on a Summon under this rootCorrelation. The I_AM has
 * universal authority and always passes. Stance auth gates whether
 * the asker can address `.threads` at all (broad gate); this gate
 * narrows to "this specific thread." Both run.
 *
 * Three steps after auth, in this order:
 *
 *   1. Mark every Summon in the chain as severedAt (audit + state).
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
 *   Required unless the call is kernel-internal (then pass null only
 *   when you intentionally want to bypass the participation check;
 *   never bypass from extension code).
 * @returns {Promise<{ severed: number, cancelled: number, aborted: number }>}
 */
export async function cutThread({
  rootCorrelation,
  priority = "INTERACTIVE",
  reason = "thread cut",
  identity = null,
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
    const participant = await Summon.exists({
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

  // 1. Audit + state on the Summon rows.
  const severed = await markThreadSevered(rootCorrelation);
  // Cache the severed root so subsequent ancestor-checks short-
  // circuit without a DB walk. Always populate, even if severed===0
  // (the chain may have already been marked but the cache lost).
  noteRootSevered(rootCorrelation);

  // 2. Inbox sweep across every being that received a Summon under
  //    this chain. Each Summon row tells us (beingIn, spaceId) via
  //    the receiver's homeSpace or the spaceId derived from
  //    ibpAddress. We use the receiver's currentSpace as a pragmatic
  //    proxy for "where their inbox lives at the moment of cut."
  let cancelled = 0;
  try {
    const Being = (await import("../../models/being.js")).default;
    const { cancelByRootCorrelation } = await import(
      "../../factory/inbox.js"
    );

    const distinctReceivers = await Summon.aggregate([
      { $match: { rootCorrelation, beingIn: { $ne: null } } },
      { $group: { _id: "$beingIn" } },
    ]);

    for (const r of distinctReceivers) {
      const beingId = String(r._id);
      const being = await Being.findById(beingId)
        .select("currentSpace homeSpace")
        .lean();
      const spaceId = String(being?.currentSpace || being?.homeSpace || "");
      if (!spaceId) continue;
      const result = await cancelByRootCorrelation(
        spaceId,
        beingId,
        rootCorrelation,
      );
      cancelled += result?.cancelled || 0;
    }
  } catch {
    // Inbox sweep is best-effort. Severed Summons + scheduler abort
    // still close the line at the audit + runtime layers.
  }

  // 3. HUMAN-priority cuts interrupt the live task immediately;
  //    lower priorities let the scheduler drain naturally.
  let aborted = 0;
  if (priority === "HUMAN") {
    try {
      const { abortByRootCorrelations } = await import(
        "../../factory/scheduler.js"
      );
      aborted = abortByRootCorrelations([rootCorrelation], reason) || 0;
    } catch {
      // Scheduler unavailable (cognition not booted yet). The
      // severed Summons + cancelled inbox still take effect on next
      // pickup; we just couldn't interrupt the live task.
    }
  }

  return { severed, cancelled, aborted };
}

// ─────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────

async function rootSummonOf(summonId) {
  if (!summonId) return null;
  const s = await Summon.findById(summonId)
    .select("rootCorrelation")
    .lean();
  return s?.rootCorrelation || null;
}
