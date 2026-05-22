// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Stamp. One moment a being had, recorded onto the reel.
//
// SUMMON is the verb — one being calling another into a moment.
// Stamp is the noun the verb produces. A Stamp begins life
// un-pressed (queued in the receiver's inbox), gets pressed when
// the stamper's momentum runs the moment, and seals when stamped
// writes its endMessage. The row is the record of that one
// moment, end to end.
//
// Reply chains form the graph these stamps make. `inReplyTo`
// points at the Stamp whose moment requested this one — parent in
// the reply tree. `rootCorrelation` propagates through a whole
// chain (Ruler → Planner → Contractor → Worker) so I can walk it
// for cancellation and group it for conversation views. A thread
// between two beings at one position is the set of Stamps sharing
// one `ibpAddress`, the canonical sorted stance pair I compute in
// seed/factory/stamper/stamped/stampIBPAddress.js.
//
// I do not store tool calls or substrate writes inside this row.
// Whatever the summoned being then does during the moment — every
// DO, every BE — stamps as a Fact carrying this Stamp's id.
// "What happened inside this moment?" is Fact.find({ stampId }).

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const StampSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },

  beingIn:  { type: String, ref: "Being", required: true, index: true },
  beingOut: { type: String, ref: "Being", default: null, index: true },

  ibpAddress: { type: String, default: null, index: true },
  activeRole: { type: String, default: null, index: true },

  inboxMessageId: { type: String, default: null, index: true },

  inReplyTo:       { type: String, default: null, index: true },
  rootCorrelation: { type: String, default: null, index: true },

  // When a being acting under thread A emits a fresh top-level SUMMON
  // (one with no `inReplyTo`), the new SUMMON starts thread B. This
  // field records that B was spawned from A. The kernel stamps it at
  // emit time from the asker's current rootCorrelation (scheduler
  // knows it via getCurrentRootCorrelation). Walks: B → A → ... give
  // the cross-thread lineage SEE on `.threads/<id>` surfaces as
  // `parentThread`. The ancestor-severance check on inbox pickup
  // walks this same chain to decide whether a spawned thread should
  // still run when its parent's been cut.
  parentThread:    { type: String, default: null, index: true },

  receivedAt: { type: Date, default: null },
  stampedAt: { type: Date, default: null },

  startMessage: {
    content: { type: String, required: true },
    source:  { type: String, default: "user" },
    _id: false,
  },

  endMessage: {
    content: { type: String, default: null },
    stopped: { type: Boolean, default: false },
    time:    { type: Date, default: null },
    _id: false,
  },

  // Set by the cut handler when a thread (this Stamp's
  // rootCorrelation) is severed via SUMMON to .threads/<id>.
  // Distinct from endMessage.stopped (which means the role itself
  // halted its loop): severedAt records that the line was cut from
  // outside. The scheduler skips inbox entries whose rootCorrelation
  // appears severed and the run loop drops out.
  severedAt: { type: Date, default: null, index: true },

  // Queue ordering hint. The kernel scheduler picks by priority
  // (HUMAN first, then GATEWAY, INTERACTIVE, BACKGROUND). The cut
  // handler also reads it: HUMAN-priority cuts go out-of-band and
  // fire AbortSignal; lower priorities queue.
  priority: {
    type: String,
    enum: ["HUMAN", "GATEWAY", "INTERACTIVE", "BACKGROUND"],
    default: "INTERACTIVE",
  },

  llmProvider: {
    model:        { type: String, default: null },
    connectionId: { type: String, ref: "LlmConnection", default: null },
    _id: false,
  },
});

// All Stamps under one chain (rootCorrelation walk).
StampSchema.index({ rootCorrelation: 1, stampedAt: 1 }, { sparse: true });
// Per-Being newest-first activity.
StampSchema.index({ beingIn: 1, stampedAt: -1 });
StampSchema.index({ beingOut: 1, stampedAt: -1 });
// Conversation between two Beings.
StampSchema.index({ beingIn: 1, beingOut: 1, stampedAt: -1 }, { sparse: true });
// "Every time beingOut acted in activeRole" — audit query.
StampSchema.index({ beingOut: 1, activeRole: 1, stampedAt: -1 }, { sparse: true });
// All Stamps at one IBPA (the thread).
StampSchema.index({ ibpAddress: 1, stampedAt: -1 }, { sparse: true });
// Retention sweep cursor.
StampSchema.index({ stampedAt: 1 });

const Stamp = mongoose.model("Stamp", StampSchema, "stamps");
export default Stamp;
