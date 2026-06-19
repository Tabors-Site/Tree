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
//   be:sever   → set severedAt on the matching rootCorrelation row.
//                The InboxProjection handler dropped the affected
//                open summons separately; this marks the thread
//                itself cut so SEE on ./threads can render the
//                severance.
//
//   (act seal) → noteActSealOnThread(rootCorrelation) — bumps
//                lastAct. Called from stamped.js alongside
//                closeInboxOnAnswer because Act seals aren't fact
//                appends.

import ThreadsProjection from "./threadsProjection.js";
import { registerCrossCuttingHandler } from "../../../present/stamper/2-fold/foldEngine.js";

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

  const lastAct = params.sentAt
    ? new Date(params.sentAt)
    : (fact.date || new Date());

  await ThreadsProjection.updateOne(
    { _id: root },
    {
      $set: {
        lastAct,
        updatedAt: fact.date || new Date(),
        ...(params.parentThread ? { parentThread: String(params.parentThread) } : {}),
      },
      $setOnInsert: {
        _id:       root,
        startedAt: lastAct,
        createdAt: fact.date || new Date(),
        severedAt: null,
      },
      $addToSet: {
        participants: { $each: [...participants] },
      },
    },
    { upsert: true },
  );
}

async function handleBeSeverForThreads(fact /*, type, id*/) {
  if (fact?.verb !== "be" || fact?.act !== "sever") return;
  const root = fact.params?.rootCorrelation;
  if (!root) return;
  const at = fact.date || new Date();
  await ThreadsProjection.updateOne(
    { _id: root },
    { $set: { severedAt: at, updatedAt: at } },
  );
}

registerCrossCuttingHandler(handleSummonForThreads);
registerCrossCuttingHandler(handleBeSeverForThreads);

/**
 * Bump the thread's lastAct when a participating Act seals. Called
 * from stamped.js after the seal commits. Idempotent — multiple
 * seals (shouldn't happen) just rewrite the same lastAct.
 *
 * Act seals are not Fact appends, so they don't flow through the
 * fold engine's per-fact dispatch. This is the explicit hook the
 * seal path calls, paired with closeInboxOnAnswer.
 *
 * @param {string|null} rootCorrelation
 * @param {Date}        [at=new Date()]
 */
export async function noteActSealOnThread(rootCorrelation, at = new Date()) {
  if (!rootCorrelation) return;
  await ThreadsProjection.updateOne(
    { _id: String(rootCorrelation) },
    { $set: { lastAct: at, updatedAt: at } },
  );
}
