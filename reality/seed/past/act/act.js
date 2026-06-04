// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Act. One moment a being committed, recorded on the being's
// act-chain.
//
// SUMMON is the verb — one being calling another into a moment.
// The Act is the noun the moment leaves behind. An Act opens at
// beat 1 (assign), gets pressed at beat 3 (momentum), and seals
// at beat 4 (stamped). The row is the record of that one moment,
// end to end.
//
// "The sealed act is the act" — there is no separate Stamp noun.
// Stamp survives only as the machine (the press), the verb (to
// stamp / beat 4 / stamped.js), and the act of sealing. The thing
// on the reel is an Act.
//
// Reply chains form the graph these Acts make. `inReplyTo` points
// at the Act whose moment requested this one — parent in the
// reply tree. `rootCorrelation` propagates through a whole chain
// (Ruler → Planner → Contractor → Worker) so I can walk it for
// cancellation and group it for conversation views. A thread
// between two beings at one position is the set of Acts sharing
// one `ibpAddress`, the canonical sorted stance pair.
//
// I do not store tool calls or substrate writes inside this row.
// Whatever the being did during the moment — every DO, every BE
// — deposits a Fact carrying this Act's id. "What happened inside
// this moment?" is Fact.find({ actId }).

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const ActSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },

  beingIn:  { type: String, ref: "Being", required: true, index: true },
  beingOut: { type: String, ref: "Being", default: null, index: true },

  ibpAddress: { type: String, default: null, index: true },
  activeRole: { type: String, default: null, index: true },

  inboxMessageId: { type: String, default: null, index: true },

  inReplyTo:       { type: String, default: null, index: true },
  rootCorrelation: { type: String, default: null, index: true },

  // Back-reference to the be:summon fact's correlation that this
  // moment answered. SUMMON now stamps a be:summon Fact on the
  // summoner's reel (single-writer: never on the recipient's), and
  // the cross-cutting fold maintains InboxProjection from those
  // facts. The scheduler picks an open InboxProjection row, hands
  // the correlation to the moment via this `answers` field, and
  // the seal commits the Act with it set. On seal, the cross-
  // cutting fold sees Act-with-answers and evicts the matching
  // InboxProjection row — that is the closure event. Not a reply-
  // message; just the moment that took the summon, sealing. A being
  // who summons B to "clean room 3" gets closure when B's moment
  // seals, regardless of whether B sends any reply text.
  // (Bucket 3 Option D, 2026-05-23.)
  answers: { type: String, default: null, index: true },

  // When a being acting under thread A emits a fresh top-level SUMMON
  // (one with no `inReplyTo`), the new SUMMON starts thread B. This
  // field records that B was spawned from A. The seed stamps it at
  // emit time from the asker's current rootCorrelation (scheduler
  // knows it via getCurrentRootCorrelation). Walks: B → A → ... give
  // the cross-thread lineage SEE on `./threads/<id>` surfaces as
  // `parentThread`. The ancestor-severance check on intake pickup
  // walks this same chain to decide whether a spawned thread should
  // still run when its parent's been cut.
  parentThread: { type: String, default: null, index: true },

  receivedAt: { type: Date, default: null },
  stampedAt:  { type: Date, default: null },

  startMessage: {
    // Mixed because SUMMON content is whatever the receiving role
    // expects. Humans send text strings. Scripted beings receive
    // structured payloads (e.g. drummer tick: `{ event, drumMatterId,
    // gridSpaceId }`). The Act records what was said in whichever
    // shape the protocol carried.
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    source:  { type: String, default: "user" },
    _id: false,
  },

  endMessage: {
    content: { type: String, default: null },
    stopped: { type: Boolean, default: false },
    time:    { type: Date, default: null },
    _id: false,
  },

  // Set by the cut handler when a thread (this Act's rootCorrelation)
  // is severed via SUMMON to ./threads/<id>. Distinct from
  // endMessage.stopped (which means the role halted its loop):
  // severedAt records that the line was cut from outside. The
  // scheduler skips intake entries whose rootCorrelation appears
  // severed and the run loop drops out.
  severedAt: { type: Date, default: null, index: true },

  // Queue ordering hint. The scheduler picks by priority (HUMAN
  // first, then GATEWAY, INTERACTIVE, BACKGROUND). The cut handler
  // also reads it: HUMAN-priority cuts go out-of-band and fire
  // AbortSignal; lower priorities queue.
  priority: {
    type: String,
    enum: ["HUMAN", "GATEWAY", "INTERACTIVE", "BACKGROUND"],
    default: "INTERACTIVE",
  },

  // The bounded record of the face this act was committed under:
  // orientation, role, what was seen at the position (space +
  // occupants by name/id/kind), and the canDo/canSummon/canBe
  // lists the cognition had at that moment. Captured uniformly
  // across LLM, scripted, and human-inhabited cognitions so the
  // act-chain never carries half-records. Read only by turned
  // folds (half/inward); the forward path never reads it. Stored
  // at defensive caps (10KB per field, 1000-entry lists) to keep
  // pathological cases bounded; render-time clamps (1000 chars,
  // 64 entries) are applied separately by prompt builders. The
  // chain is the truth; this is a bounded record of the face;
  // full face reconstruction goes through the chain, not here.
  facadeSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
});

// All Acts under one chain (rootCorrelation walk).
ActSchema.index({ rootCorrelation: 1, stampedAt: 1 }, { sparse: true });
// Per-Being newest-first activity.
ActSchema.index({ beingIn: 1, stampedAt: -1 });
ActSchema.index({ beingOut: 1, stampedAt: -1 });
// Conversation between two Beings.
ActSchema.index({ beingIn: 1, beingOut: 1, stampedAt: -1 }, { sparse: true });
// "Every time beingOut acted in activeRole" — audit query.
ActSchema.index({ beingOut: 1, activeRole: 1, stampedAt: -1 }, { sparse: true });
// All Acts at one IBPA (the thread).
ActSchema.index({ ibpAddress: 1, stampedAt: -1 }, { sparse: true });
// Retention sweep cursor.
ActSchema.index({ stampedAt: 1 });

const Act = mongoose.model("Act", ActSchema, "acts");
export default Act;
