// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ThreadsProjection fold handlers — the second cross-cutting
// projection (paired with InboxProjection). Same pattern: handlers
// registered on the fold engine at module load; each runs once per
// fact applied via dispatchCrossCutting in foldEngine.js.
//
// One handler per fact-action that affects thread state:
//
//   call       → upsert row keyed by params.rootCorrelation. Add
//                summoner (fact.through) + recipient
//                (params.recipient) to participants. Bump lastAct.
//                If params.parentThread is set (the fact records
//                the asker spawned this thread under another live
//                root), store it so cross-thread lineage walks.
//                Set startedAt on first insert.
//
//   (act seal) → noteActSealOnThread(rootCorrelation) — bumps
//                lastAct. Called from stamped.js alongside
//                closeInboxOnAnswer because Act seals aren't fact
//                appends.

import { FileCollection } from "../../projStore.js";
import { registerCrossCuttingHandler } from "../../../present/stamper/2-fold/foldEngine.js";

// Cross-cutting fold of live coordination chains, keyed by
// rootCorrelation. One row per live root; the chain of call facts on
// the story's per-being reels is the record, this file-backed
// collection (one JSON file per row + a small index under
// <storeRoot>/proj/threads) is the rebuildable cache. Exported so the
// thread readers in materials/space/threads.js share the one instance.
export const ThreadsProjection = new FileCollection("threads");

async function handleSummonForThreads(fact /*, type, id*/) {
  if (fact?.verb !== "call") return;
  const params = fact.params || {};
  const root = params.rootCorrelation || params.correlation;
  if (!root) return;

  // Recipient is now the fact's object (right stance). Summoner is
  // through (the actor). Renamed from be:summon on 2026-06-03.
  const participants = new Set();
  if (fact.through) participants.add(String(fact.through));
  if (fact?.of?.kind === "being" && fact?.of?.id) {
    participants.add(String(fact.of.id));
  }

  // ORDER KEY (clock-free). The append ordinal of the latest fact that touched
  // this thread. The thread reader (materials/space/threads.js) sorts threads
  // most-recently-active-first on this, NOT on a wall-clock. Prefer the fact's
  // own ord (stamped by commitMoment when the call rides a moment); fall back to
  // params.ord (the moment-less writers thread it). $set overwrites, so the
  // newest touching fact's ord wins, which is exactly "most recently active."
  const ord = fact.ord ?? params.ord ?? null;
  // INERT display witness only. The fact's seal-time, kept so a UI can show
  // "last active at"; NEVER sorted/compared/folded (ord above is the order).
  // null when the fact has no date . no fresh new Date() is ever folded.
  const lastActWitness = fact.date ?? null;

  await ThreadsProjection.updateOne(
    { _id: root },
    {
      $set: {
        // Order key (the sort field) + its inert display witness.
        ord,
        lastAct: lastActWitness,
        updatedAt: lastActWitness,
        ...(params.parentThread ? { parentThread: String(params.parentThread) } : {}),
      },
      $setOnInsert: {
        _id:       root,
        startedAt: lastActWitness,
        createdAt: lastActWitness,
      },
      $addToSet: {
        participants: { $each: [...participants] },
      },
    },
    { upsert: true },
  );
}

registerCrossCuttingHandler(handleSummonForThreads);

/**
 * Bump the thread's lastAct when a participating Act seals. Called
 * from stamped.js after the seal commits. Idempotent — multiple
 * seals (shouldn't happen) just rewrite the same lastAct.
 *
 * Act seals are not Fact appends, so they don't flow through the
 * fold engine's per-fact dispatch. This is the explicit hook the
 * seal path calls, paired with closeInboxOnAnswer.
 *
 * The thread's ORDER key is `ord` (the clock-free append ordinal). The thread
 * reader sorts most-recently-active-first on it, so a seal must bump it to the
 * answering act's ord (the act re-activates the thread at its append position).
 * `lastAct`/`updatedAt` are inert DISPLAY witnesses only (the act's seal-time
 * `at`); never sorted/compared/folded. The seal passes no wall-clock . a fresh
 * new Date() here would be folded-then-sorted (the bug the inbox/threads sweep
 * killed). When the caller has no ord (a legacy seal), the bump is a no-op on
 * ord, leaving the thread's last fact-derived ord in place.
 *
 * @param {string|null} rootCorrelation
 * @param {{ord?:number|null, at?:Date|string|null}} [seal]  the answering act's
 *        append ordinal (the order key) and its inert seal-time witness.
 */
export async function noteActSealOnThread(rootCorrelation, seal = {}) {
  if (!rootCorrelation) return;
  const ord = seal?.ord ?? null;
  const at = seal?.at ?? null;
  const set = {};
  // Only bump the order key when the seal carried one (no synthetic fallback).
  if (ord != null) set.ord = ord;
  // Inert display witnesses (the act's own seal-time), never an ordering key.
  if (at != null) { set.lastAct = at; set.updatedAt = at; }
  if (Object.keys(set).length === 0) return;
  await ThreadsProjection.updateOne(
    { _id: String(rootCorrelation) },
    { $set: set },
  );
}
