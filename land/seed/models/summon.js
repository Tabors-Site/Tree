// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Summon. One wake-and-act between two beings.
//
// When a SUMMON verb lands at a being's inbox, that being wakes,
// their role runs once — one LLM call for an llm-mode being, one
// code dispatch for scripted, one notification for a human — and
// they produce one output. This row is the audit of that wake.
// The verb SUMMON does the delivery; the noun Summon is what got
// delivered and what came back.
//
// Conversation is the graph these rows form. `inReplyTo` points at
// the Summon that dispatched this one — parent in the reply tree.
// `rootCorrelation` propagates through a whole chain (Ruler →
// Planner → Contractor → Worker) so I can walk it for cancellation
// and group it for conversation views. A thread between two beings
// at one position is the set of Summons sharing one `ibpAddress`,
// the canonical sorted stance pair I compute in
// seed/cognition/summonAddress.js.
//
// I do not store tool calls or substrate writes inside this row.
// Whatever the summoned being then does in response — every DO,
// every BE — lands as a Did with this Summon's id. "What happened
// during this summon?" is Did.find({ summonId }).

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const SummonSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },

  beingIn:  { type: String, ref: "Being", required: true, index: true },
  beingOut: { type: String, ref: "Being", default: null, index: true },

  ibpAddress: { type: String, default: null, index: true },
  activeRole: { type: String, default: null, index: true },

  inboxMessageId: { type: String, default: null, index: true },

  inReplyTo:       { type: String, default: null, index: true },
  rootCorrelation: { type: String, default: null, index: true },

  receivedAt: { type: Date, default: null },
  summonedAt: { type: Date, default: null },

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

  llmProvider: {
    model:        { type: String, default: null },
    connectionId: { type: String, ref: "LlmConnection", default: null },
    _id: false,
  },
});

// All Summons under one chain (rootCorrelation walk).
SummonSchema.index({ rootCorrelation: 1, summonedAt: 1 }, { sparse: true });
// Per-Being newest-first activity.
SummonSchema.index({ beingIn: 1, summonedAt: -1 });
SummonSchema.index({ beingOut: 1, summonedAt: -1 });
// Conversation between two Beings.
SummonSchema.index({ beingIn: 1, beingOut: 1, summonedAt: -1 }, { sparse: true });
// "Every time beingOut acted in activeRole" — audit query.
SummonSchema.index({ beingOut: 1, activeRole: 1, summonedAt: -1 }, { sparse: true });
// All Summons at one IBPA (the thread).
SummonSchema.index({ ibpAddress: 1, summonedAt: -1 }, { sparse: true });
// Retention sweep cursor.
SummonSchema.index({ summonedAt: 1 });

const Summon = mongoose.model("Summon", SummonSchema, "summons");
export default Summon;
