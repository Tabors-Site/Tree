// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// InboxProjection fold handlers — the cross-cutting projection
// builders. Registered on the fold engine at module load; each
// handler runs once per fact applied (via dispatchCrossCutting in
// foldEngine.js).
//
// Three handlers, one fact-action each. Per single-writer: the be:
// facts here land on the ACTOR'S reel (summoner / severer). The
// target on the fact is also the actor (the reel); the recipient
// for a summon lives in params.recipient. The handlers read params,
// not target, for cross-reel keys.
//
//   be:summon   → upsert InboxProjection row keyed by params.correlation.
//                 recipient = params.recipient. Fact lives on the
//                 summoner's reel (target = summoner).
//
//   be:sever    → delete InboxProjection rows whose rootCorrelation
//                 matches params.rootCorrelation. Fact lives on the
//                 severer's reel (target = severer). One fact, many
//                 rows dropped.
//
//   (act seal)  → delete InboxProjection row where _id === act.answers.
//                 The closure event: the moment that took the summon
//                 sealed. Not a reply-message — just the answering
//                 act's seal. This handler is wired separately because
//                 Act seal is not a Fact append; it fires from
//                 stamped.js when the moment seals (see Act.answers).
//
// Per FOLD.md cross-reel consistency: each handler is its own commit;
// failures self-heal on the next fold round. Handlers are idempotent
// — upsert and delete-by-key both tolerate replay.

import InboxProjection from "./inboxProjection.js";
import { registerCrossCuttingHandler } from "../../../present/beats/2-fold/foldEngine.js";

async function handleBeSummon(fact /*, type, id*/) {
  if (fact?.verb !== "be" || fact?.action !== "summon") return;
  const params = fact.params || {};
  if (!params.correlation || !params.recipient) return;

  await InboxProjection.updateOne(
    { _id: params.correlation },
    {
      $set: {
        recipient:       String(params.recipient),
        summoner:        fact.beingId ? String(fact.beingId) : null,
        sender:          params.sender || null,
        content:         params.content ?? null,
        activeRole:      params.activeRole || null,
        attachments:     params.attachments || undefined,
        priority:        params.priority || "INTERACTIVE",
        orientation:     params.orientation || "forward",
        rootCorrelation: params.rootCorrelation || params.correlation,
        inReplyTo:       params.inReplyTo || null,
        inboxSpaceId:    params.inboxSpaceId || null,
        sentAt:          params.sentAt ? new Date(params.sentAt) : (fact.date || new Date()),
      },
      $setOnInsert: { _id: params.correlation },
    },
    { upsert: true },
  );
}

async function handleBeSever(fact /*, type, id*/) {
  if (fact?.verb !== "be" || fact?.action !== "sever") return;
  const rootCorrelation = fact.params?.rootCorrelation;
  if (!rootCorrelation) return;
  await InboxProjection.deleteMany({ rootCorrelation });
}

// Register both fact-driven handlers with the fold engine. The Act-seal
// handler is invoked directly from stamped.js (see closeInboxOnAnswer
// below) because Act seals are not fact appends — Acts are their own
// primitive.
registerCrossCuttingHandler(handleBeSummon);
registerCrossCuttingHandler(handleBeSever);

/**
 * Eviction triggered by the answering Act's seal. Called from
 * stamped.js after the Act row commits with `answers: <correlation>`.
 * Idempotent: a re-seal (shouldn't happen) is a no-op on the second
 * call because the row is already gone.
 */
export async function closeInboxOnAnswer(answersCorrelation) {
  if (!answersCorrelation) return;
  await InboxProjection.deleteOne({ _id: String(answersCorrelation) });
}
