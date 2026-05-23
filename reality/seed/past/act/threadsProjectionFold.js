// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ThreadsProjection fold handlers — the second cross-cutting
// projection (paired with InboxProjection). Same pattern: handlers
// registered on the fold engine at module load; each runs once per
// fact applied via dispatchCrossCutting in foldEngine.js.
//
// One handler per fact-action that affects thread state:
//
//   be:summon  → upsert row keyed by params.rootCorrelation. Add
//                summoner (fact.beingId) + recipient
//                (params.recipient) to participants. Bump lastAct.
//                If params.parentThread is set (the fact records
//                the asker spawned this thread under another live
//                root), store it so cross-thread lineage walks.
//                Set startedAt on first insert.
//
//   be:sever   → set severedAt on the matching rootCorrelation row.
//                The InboxProjection handler dropped the affected
//                open summons separately; this marks the thread
//                itself cut so SEE on .threads can render the
//                severance.
//
//   (act seal) → noteActSealOnThread(rootCorrelation) — bumps
//                lastAct. Called from stamped.js alongside
//                closeInboxOnAnswer because Act seals aren't fact
//                appends.

import ThreadsProjection from "./threadsProjection.js";
import { registerCrossCuttingHandler } from "../../present/fold/foldEngine.js";

async function handleBeSummonForThreads(fact /*, type, id*/) {
  if (fact?.verb !== "be" || fact?.action !== "summon") return;
  const params = fact.params || {};
  const root = params.rootCorrelation || params.correlation;
  if (!root) return;

  const participants = new Set();
  if (fact.beingId) participants.add(String(fact.beingId));
  if (params.recipient) participants.add(String(params.recipient));

  const lastAct = params.sentAt
    ? new Date(params.sentAt)
    : (fact.date || new Date());

  await ThreadsProjection.updateOne(
    { _id: root },
    {
      $set: {
        lastAct,
        ...(params.parentThread ? { parentThread: String(params.parentThread) } : {}),
      },
      $setOnInsert: {
        _id:       root,
        startedAt: lastAct,
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
  if (fact?.verb !== "be" || fact?.action !== "sever") return;
  const root = fact.params?.rootCorrelation;
  if (!root) return;
  await ThreadsProjection.updateOne(
    { _id: root },
    { $set: { severedAt: fact.date || new Date() } },
  );
}

registerCrossCuttingHandler(handleBeSummonForThreads);
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
    { $set: { lastAct: at } },
  );
}
