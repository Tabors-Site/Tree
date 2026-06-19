// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// InboxProjection fold handlers — the cross-cutting projection
// builders. Registered on the fold engine at module load; each
// handler runs once per fact applied (via dispatchCrossCutting in
// foldEngine.js).
//
// Three handlers, one fact-act each. Since the 2026-06-03
// retarget, the summon fact lands on the RECIPIENT's reel
// (of = recipient, right stance, like DO) with doer = summoner;
// the recipient is read from fact.of. Summon facts are
// figure-inert — the being reducer folds no summon act; this
// cross-cutting handler is their only consumer.
//
//   summon      → upsert InboxProjection row keyed by params.correlation.
//                 recipient = fact.of.id (the reel it lives on).
//
//   be:sever    → delete InboxProjection rows whose rootCorrelation
//                 matches params.rootCorrelation. Fact lives on the
//                 severer's reel (of = severer). One fact, many
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

import InboxProjection, { priorityRankOf } from "./inboxProjection.js";
import { registerCrossCuttingHandler } from "../../../present/stamper/2-fold/foldEngine.js";
import { assertHistoryOrThrow } from "../../../materials/projections.js";

async function handleCall(fact /*, type, id*/) {
  if (fact?.verb !== "call") return;
  const params = fact.params || {};
  // Recipient is the fact's object (right stance); summoner is
  // through (the actor). Renamed from be:summon (which carried
  // recipient in params and of=summoner) on 2026-06-03.
  const recipient = fact?.of?.kind === "being" && fact?.of?.id
    ? String(fact.of.id)
    : null;
  if (!params.correlation || !recipient) return;

  // Answered-guard. If an Act already answers this correlation, the
  // summon was consumed — re-upserting would resurrect the row and
  // the scheduler would re-execute it. The live-arrival path never
  // hits this (the answering Act can't exist before the summon fact
  // commits); it protects replay paths (a lagging slot catching up,
  // a deliberate recovery rebuild) from double execution. One
  // indexed exists-check on Act.answers.
  const { default: Act } = await import("../../act/act.js");
  const answered = await Act.exists({ answers: String(params.correlation) });
  if (answered) return;

  await InboxProjection.updateOne(
    { _id: params.correlation },
    {
      $set: {
        recipient,
        summoner:        fact.through ? String(fact.through) : null,
        sender:          params.sender || null,
        content:         params.content ?? null,
        activeRole:      params.activeRole || null,
        attachments:     params.attachments || undefined,
        intent:          params.intent || null,
        priority:        params.priority || "INTERACTIVE",
        priorityRank:    priorityRankOf(params.priority || "INTERACTIVE"),
        orientation:     params.orientation || "forward",
        rootCorrelation: params.rootCorrelation || params.correlation,
        inReplyTo:       params.inReplyTo || null,
        inboxSpaceId:    params.inboxSpaceId || null,
        sentAt:          params.sentAt ? new Date(params.sentAt) : (fact.date || new Date()),
        // Branch the summon was stamped on. Single-branch by parse-time
        // gate, so the row's branch IS the fact's branch. logFact
        // refuses any fact without branch; if this read returns
        // undefined the upstream invariant broke and we want it loud.
        history:          assertHistoryOrThrow(fact.history, "inboxProjectionFold(do:summon)"),
      },
      $setOnInsert: { _id: params.correlation },
    },
    { upsert: true },
  );
}

async function handleBeSever(fact /*, type, id*/) {
  if (fact?.verb !== "be" || fact?.act !== "sever") return;
  const rootCorrelation = fact.params?.rootCorrelation;
  if (!rootCorrelation) return;
  // Scoped to the sever-fact's branch: severing a thread on one
  // branch must not evict a sibling branch's open rows (INTAKE.md's
  // "per branch isolation — never crosses"). A thread inherited
  // across a fork is severed per branch, by a sever fact on each.
  await InboxProjection.deleteMany({
    rootCorrelation,
    history: assertHistoryOrThrow(fact.history, "inboxProjectionFold(be:sever)"),
  });
}

// Register both fact-driven handlers with the fold engine. The Act-seal
// handler is invoked directly from stamped.js (see closeInboxOnAnswer
// below) because Act seals are not fact appends — Acts are their own
// primitive.
registerCrossCuttingHandler(handleCall);
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
