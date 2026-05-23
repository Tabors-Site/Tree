// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ThreadsProjection. The cross-cutting fold of live coordination
// chains, keyed by rootCorrelation.
//
// A thread is a tree of summons sharing one rootCorrelation. The
// Ruler/Planner/Contractor/Worker chains, a human conversation,
// any coordinated multi-being effort — each carries one root id
// that propagates through the chain via inReplyTo links.
//
// This collection is the cross-cutting projection over those
// chains — the same kind as InboxProjection and the position
// index. One row per live root, maintained by fold handlers on the
// reality's per-being reels:
//
//   `be:summon` fact (any reel) → upsert row keyed by
//      params.rootCorrelation. Add summoner + recipient to
//      participants. Record parentThread when the root is itself
//      spawned from another live root (the fact's
//      params.parentThread marks the spawn link). Bump lastAct.
//
//   `be:sever` fact (any reel) → set severedAt on the matching
//      rootCorrelation row. The InboxProjection sweep already
//      drops the open summons; here we mark the thread itself
//      severed so .threads SEE renders the cut.
//
//   (act seal) → bump lastAct when a sealed Act has non-null
//      rootCorrelation. The closure step of a moment that
//      participated in the thread. Wired from stamped.js via
//      noteActSealOnThread below.
//
// Per FOLD.md cross-reel consistency: the projection is its own
// commit and self-heals on next fold round. Handlers are
// idempotent — upsert + addToSet tolerate replay.
//
// Eviction: this projection is "live forest" — open chains and
// recently-active chains. Fully-closed chains (all summons
// answered, no recent activity) become garbage. A separate sweep
// (not yet built; placeholder TODO) will GC rows past an
// inactivity threshold. Until then rows accumulate; cheap to add
// later because the fold engine doesn't depend on the GC.

import mongoose from "mongoose";

const ThreadsProjectionSchema = new mongoose.Schema({
  // rootCorrelation — one row per chain root.
  _id: { type: String, required: true },

  participants: { type: [String], default: [] },

  // The parent rootCorrelation when this thread was spawned from
  // another live thread. Walks parentThread → ... give cross-thread
  // lineage for SEE on .threads.
  parentThread: { type: String, default: null, index: true },

  lastAct:    { type: Date, default: null, index: true },
  startedAt:  { type: Date, default: null },
  severedAt:  { type: Date, default: null, index: true },
}, { timestamps: true });

// SEE on `<reality>/.threads` lists live threads sorted by recency.
ThreadsProjectionSchema.index({ lastAct: -1 });
// Per-participant query — "what threads is this being in?"
ThreadsProjectionSchema.index({ participants: 1, lastAct: -1 });

const ThreadsProjection = mongoose.model(
  "ThreadsProjection",
  ThreadsProjectionSchema,
  "threads_projection",
);

export default ThreadsProjection;
