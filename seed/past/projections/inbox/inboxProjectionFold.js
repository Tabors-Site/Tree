// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// InboxProjection fold handlers — the cross-cutting projection
// builders. Registered on the fold engine at module load; each
// handler runs once per fact applied (via dispatchCrossCutting in
// foldEngine.js).
//
// Two handlers, one fact-act each. Since the 2026-06-03
// retarget, the summon fact lands on the RECIPIENT's reel
// (of = recipient, right stance, like DO) with doer = summoner;
// the recipient is read from fact.of. Summon facts are
// figure-inert — the being reducer folds no summon act; this
// cross-cutting handler is their only consumer.
//
//   summon      → upsert InboxProjection row keyed by params.correlation.
//                 recipient = fact.of.id (the reel it lives on).
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

import { FileCollection } from "../../projStore.js";
import { registerCrossCuttingHandler } from "../../../present/stamper/2-fold/foldEngine.js";

// The cross-cutting fold of open summons per being. One row per open
// summon, keyed by correlation, indexed by recipient. The chain of call
// facts (and the act-seal closures) on the story's per-being reels is
// the record; this file-backed collection (one JSON file per row + a
// small index under <storeRoot>/proj/inbox) is the rebuildable cache.
// Exported so the inbox/intake readers share the one instance.
export const InboxProjection = new FileCollection("inbox");

// Priority → numeric rank (lower = picked first). The ONE place the
// enum-to-rank mapping lives; the fold writes priorityRank from it. The
// string enum sorts lexically to the WRONG order, so the scheduler sorts
// on this rank, never on `priority`.
export const PRIORITY_RANK = Object.freeze({
  HUMAN: 1, GATEWAY: 2, INTERACTIVE: 3, BACKGROUND: 4,
});
export function priorityRankOf(priority) {
  return PRIORITY_RANK[priority] ?? 3;
}
import { assertHistoryOrThrow } from "../../../materials/projections.js";
import { getActsByField } from "../../act/actChain.js";
import {
  isOpenQuote,
  isCloseQuote,
  quotedWordForClose,
} from "../../../present/book/quotedWord.js";

async function handleCall(fact /*, type, id*/) {
  if (fact?.verb !== "call") return;

  // A quoted word (a call typed one word at a time): the open-quote is just a bracket, no
  // delivery; the CLOSE-quote is the send (the second act below the fact). Everything else is the
  // legacy fat call (prose `call X, saying Y` -> callVerb), which still carries params.content.
  if (isOpenQuote(fact)) return;
  if (isCloseQuote(fact)) return handleQuotedWordClose(fact);

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
  // indexed exists-check on Act.answers → curated getActsByField("answers", …);
  // existence = any act carrying this correlation in its answers facet.
  const answered =
    getActsByField("answers", String(params.correlation)).length > 0;
  if (answered) return;

  await InboxProjection.updateOne(
    { _id: params.correlation },
    {
      $set: {
        recipient,
        summoner:        fact.through ? String(fact.through) : null,
        sender:          params.sender || null,
        content:         params.content ?? null,
        activeAble:      params.activeAble || null,
        attachments:     params.attachments || undefined,
        intent:          params.intent || null,
        priority:        params.priority || "INTERACTIVE",
        priorityRank:    priorityRankOf(params.priority || "INTERACTIVE"),
        orientation:     params.orientation || "forward",
        rootCorrelation: params.rootCorrelation || params.correlation,
        inReplyTo:       params.inReplyTo || null,
        inboxSpaceId:    params.inboxSpaceId || null,
        // ORDER KEY (clock-free). The fact's append ordinal is the row's FIFO
        // position: lowest ord = longest-waiting = picked first. Prefer the
        // fact's own ord (stamped by commitMoment when the summon rides a
        // moment, the SUMMON-verb path); fall back to params.ord, which the
        // moment-LESS writers (enqueueIntake transport-act, a wire summon)
        // thread as the arrival ordinal (fileStore.currentOrd) because a fact
        // stamped outside a moment carries no ord of its own. The scheduler
        // sorts on this, NEVER on sentAt. assertHistoryOrThrow guards history,
        // not ord; a row with no ord sorts last (pre-ord legacy), which is the
        // intended "oldest unknown" placement.
        ord:             fact.ord ?? params.ord ?? null,
        // INERT display witness. The summon's wall-clock, kept ONLY so a UI can
        // show "received at"; NEVER sorted, compared, or folded-as-fallback
        // (ord above is the order). fact.date is the fact's lone seal-time
        // witness; null when absent (no fresh new Date() is ever folded).
        sentAt:          fact.date ?? null,
        // History the summon was stamped on. Single-history by parse-time
        // gate, so the row's history IS the fact's history. logFact
        // refuses any fact without history; if this read returns
        // undefined the upstream invariant broke and we want it loud.
        history:          assertHistoryOrThrow(fact.history, "inboxProjectionFold(do:summon)"),
      },
      $setOnInsert: { _id: params.correlation },
    },
    { upsert: true },
  );
}

// handleQuotedWordClose . the delivery, the second act below the close-quote. A call typed one
// word at a time lives as a quoted word on the CALLER's reel (open-quote + said-words + close-
// quote, of:{being:caller}). On the close, assemble the quoted word from the caller's reel, resolve
// the recipient named on the open (params.to), materialize the inbox row carrying the assembled
// utterance (the inbox is a rebuildable delivery cache, never chain storage of a bundle), and wake
// the recipient. A recall (params.to null) delivers nothing . the close folds the caller's own
// chain back in the evaluator, not here.
async function handleQuotedWordClose(fact) {
  const correlation = fact?.params?.correlation;
  if (!correlation) return;
  // Answered-guard (same as the fat-call path): a consumed correlation never resurrects.
  if (getActsByField("answers", String(correlation)).length > 0) return;

  const callerId =
    fact?.of?.kind === "being" && fact?.of?.id ? String(fact.of.id) : null;
  if (!callerId) return;
  const history = assertHistoryOrThrow(
    fact.history,
    "inboxProjectionFold(quotedWord-close)",
  );

  // Assemble the quoted word from the caller's own BEING reel (the open + said-words + this close
  // all land on of:{being:caller}). readReel returns the reel's facts in seq order; the assembler
  // pairs the quote-words by depth and gives back the depth-zero quoted word this close terminates.
  const { readReel } = await import("../../fileStore.js");
  const reel = readReel(history, "being", callerId);
  const qw = quotedWordForClose(reel, fact);
  if (!qw) return; // malformed / no matching open . no send

  const toName = qw.open?.params?.to ?? null;
  if (!toName) return; // recall (self) . no delivery (the evaluator folds the own chain)

  const { findByName } = await import("../../../materials/projections.js");
  const slot = await findByName("being", String(toName), history);
  if (!slot) return; // the name vanished between open and close . nothing to deliver to
  const recipientId = String(slot.id);
  const inboxSpaceId = slot.state?.position || slot.state?.homeSpace || null;

  await InboxProjection.updateOne(
    { _id: correlation },
    {
      $set: {
        recipient: recipientId,
        summoner: callerId,
        sender: qw.open?.params?.from || null,
        content: qw.said, // the assembled utterance . delivery cache, not a stored bundle
        activeAble: null,
        intent: qw.open?.params?.intent || null,
        priority: "INTERACTIVE",
        priorityRank: priorityRankOf("INTERACTIVE"),
        orientation: "forward",
        rootCorrelation: correlation,
        inReplyTo: null,
        inboxSpaceId,
        // ORDER KEY (clock-free) . the close-quote fact rides a moment, so it
        // carries its own append ordinal. params.ord fallback mirrors the
        // fat-call path (a moment-less close would thread it). The scheduler
        // sorts on this, never on sentAt.
        ord: fact.ord ?? fact?.params?.ord ?? null,
        // INERT display witness only (never sorted/compared/folded). null when
        // the close fact has no date . no fresh new Date() is ever folded.
        sentAt: fact.date ?? null,
        history,
      },
      $setOnInsert: { _id: correlation },
    },
    { upsert: true },
  );

  // Wake the recipient . the row exists now (this runs post-seal in the fold), so the nudge lands
  // on a populated projection.
  try {
    const { wake } = await import("../../../present/intake/scheduler.js");
    wake(recipientId, inboxSpaceId);
  } catch {
    /* wake is best-effort; the row is already indexed for the next scheduler pass */
  }
}

// Register the fact-driven handler with the fold engine. The Act-seal
// handler is invoked directly from stamped.js (see closeInboxOnAnswer
// below) because Act seals are not fact appends — Acts are their own
// primitive.
registerCrossCuttingHandler(handleCall);

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
