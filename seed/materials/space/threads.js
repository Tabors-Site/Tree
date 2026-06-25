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
//   - SEE can return it. `see("<story>/./threads/<id>")` returns the
//     thread's descriptor; `see("<story>/./threads")` returns the
//     live forest. Coordination becomes inspectable.
//
// A thread is read-only. There is no severing: a call is a fact, a
// response is a fact, and an appended fact is never unmade. If a being
// wants to stop coordinating, that decision is its own next act on the
// reel, not a mutation of the chain that came before.
//
// Nothing here is persisted as new storage. A thread is a derived
// projection: the data lives in Act records (one row per wake-
// and-act) and in inbox entries (per-being qualities under a known
// namespace). This file is the read-side view over both, plus the
// addressing helpers the verb router uses to recognize a thread
// target.
//
// The "id" of a thread is its rootCorrelation. Stable across the
// whole chain by construction (every reply inherits it).

import {
  attachActFacts,
  getActsByCorrelation,
} from "../../past/act/actChain.js";
import { HEAVEN_SPACE } from "./heavenSpaces.js";

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
 * The space _id of the threads place heaven space on this story. Cached
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
 *   live      — at least one Act in this chain is unfinished (no endMessage
 *               object: the seal never pressed its closing face, e.g. a cross-
 *               story attempt awaiting its response fact)
 *   complete  — every Act in this chain was sealed (carries an endMessage
 *               object; the chain ran to completion). Seal presence, NOT a
 *               timestamp and NOT prose presence: a verb-act seals with
 *               endMessage.content == null and still counts complete.
 *
 * @param {string} rootCorrelation
 * @returns {Promise<object|null>}
 */
export async function describeThread(rootCorrelation) {
  if (!rootCorrelation) return null;
  // The whole chain that descends from this root. The old .select() narrowed
  // columns as a read optimization; the curated read returns full act docs and
  // the consumers below read exactly the same fields off them.
  const summons = getActsByCorrelation(rootCorrelation);
  if (!summons.length) {
    // A thread can exist in the ThreadsProjection (the cross-cutting
    // fold updated it from a call Fact) before any moment has
    // sealed an Act. listLiveThreads will surface it; the projection
    // is the source of truth for "open thread, no acts yet". Fall back
    // so the descriptor still resolves instead of 404-ing on a thread
    // the catalog just listed.
    const { ThreadsProjection } = await import(
      "../../past/projections/threads/threadsProjectionFold.js"
    );
    const proj = await ThreadsProjection.findById(rootCorrelation).lean();
    if (!proj) return null;
    return {
      id: rootCorrelation,
      state: "pending",
      depth: 0,
      liveCount: 0,
      completeCount: 0,
      participants: Array.isArray(proj.participants) ? proj.participants : [],
      parentThread: proj.parentThread || null,
      rootStartedAt: proj.startedAt || proj.createdAt || null,
      lastAct: proj.lastAct || null,
      pending: true,
    };
  }

  const participants = new Set();
  let live = 0;
  let complete = 0;
  let lastActOrd = null;   // the chain's newest act, by ordinal (the order)
  let lastAt = null;       // that act's inert seal-time witness (display only)
  for (const s of summons) {
    if (s.through) participants.add(String(s.through));
    if (s.to) participants.add(String(s.to));
    // Complete = the act was SEALED (its closing face exists). Seal presence,
    // never a timestamp: a verb-act seals with content == null and is complete.
    if (s.endMessage != null) complete++;
    else live++;
    // Newest act tracked by the append ordinal (act.ord), never a clock.
    const o = Number(s.ord);
    if (Number.isFinite(o) && (lastActOrd == null || o > lastActOrd)) {
      lastActOrd = o;
      lastAt = s.at || null;
    }
  }

  const state = live > 0 ? "live" : "complete";

  // Tree shape: parent thread (if this chain branched off another).
  // The root Act is the one whose _id == rootCorrelation, or the
  // first by time if convention drifted. parentThread is the
  // canonical lineage pointer — auto-stamped when assign opens a
  // moment for a being acting under thread A who emits a fresh
  // top-level SUMMON.
  // Oldest-first by the append ordinal (the chain order, never a clock).
  const sortedAsc = [...summons].sort((a, b) => {
    const oa = Number(a.ord);
    const ob = Number(b.ord);
    const na = Number.isFinite(oa) ? oa : Infinity;
    const nb = Number.isFinite(ob) ? ob : Infinity;
    if (na !== nb) return na - nb;
    return String(a._id).localeCompare(String(b._id));
  });
  const rootStamp =
    summons.find((s) => String(s._id) === String(rootCorrelation)) ||
    sortedAsc[0];
  const parentThread = rootStamp?.parentThread || null;

  return {
    id: rootCorrelation,
    state,
    depth: summons.length,
    liveCount: live,
    completeCount: complete,
    participants: [...participants],
    parentThread,
    // Root's ordinal is the chain-start position (order); its `at` is the inert
    // display witness. Surface the witness for display continuity.
    rootStartedAt: rootStamp?.at || null,
    rootStartedOrd: Number.isFinite(Number(rootStamp?.ord)) ? Number(rootStamp.ord) : null,
    // Newest act's inert seal-time witness (display only); ordering is by ord.
    lastAct: lastAt,
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
    _id: String(s._id),
    through: s.through ? String(s.through) : null,
    to: s.to ? String(s.to) : null,
    activeAble: s.activeAble || null,
    ibpAddress: s.ibpAddress || null,
    inReplyTo: s.inReplyTo || null,
    parentThread: s.parentThread || null,
    priority: s.priority || null,
    startMessage: s.startMessage || null,
    endMessage: s.endMessage || null,
    // The act's append ordinal (the order) + its inert seal-time witness
    // (display only). The act keeps exactly one wall-clock field, `at`.
    ord: Number.isFinite(Number(s.ord)) ? Number(s.ord) : null,
    at: s.at || null,
  };
}

/**
 * List live threads on this story, optionally filtered. Cheap when
 * none, capped by `limit`. Each item is a minimal preview; callers
 * walk to describeThread for the full descriptor.
 *
 * Filters (all optional, AND-combined; all pushed down to the
 * aggregation $match so the projection scales):
 *
 *   being     — beingId of a participant (matches through OR to).
 *               Pass with or without leading "@".
 *   able      — activeAble the participant wore on the Act.
 *   position  — spaceId fragment; matches threads whose ibpAddress
 *               includes this position (substring match).
 *   stance    — full stance string (place/path@being); exact match.
 *   priority  — HUMAN | GATEWAY | INTERACTIVE | BACKGROUND.
 *
 * Filters are row-level. A thread "matches" if any of its Act rows
 * match the filter; the projection groups by rootCorrelation after
 * filtering. So `being=@me&able=planner` returns "threads where I had
 * at least one Act as planner."
 */
export async function listLiveThreads({
  limit = 100,
  being = null,
  able = null, // intentionally unused; ThreadsProjection
  position = null, //   carries no per-Act-row metadata.
  stance = null, //   Cross-cutting projection is recipient-
  priority = null, //   participant-keyed only. (Future: extend
} = {}) {
  //   if filtering by able/stance/priority is needed.)
  // Route through the ThreadsProjection (Bucket 3 Option D, 2026-05-23).
  // The legacy per-SEE Act aggregation retired; the cross-cutting fold
  // maintains this projection from call Facts + Act seals.
  const { ThreadsProjection } = await import(
    "../../past/projections/threads/threadsProjectionFold.js"
  );
  const match = {};
  if (being) {
    match.participants = String(being).replace(/^@/, "");
  }
  void able;
  void position;
  void stance;
  void priority;

  // Most-recently-active first by the clock-free append ordinal (highest ord =
  // latest fact/seal that touched the thread), never a wall-clock. The doctrine:
  // order by sequence/lineage, not a timestamp. lastAct is carried back only as
  // an inert display witness.
  const rows = await ThreadsProjection.find(match)
    .sort({ ord: -1 })
    .limit(Math.max(1, Math.min(limit, 500)))
    .lean();
  return rows.map((r) => ({ id: r._id, ord: r.ord ?? null, lastAct: r.lastAct }));
}
