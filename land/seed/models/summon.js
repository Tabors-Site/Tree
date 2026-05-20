// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Summon — the record of one being's invocation.
//
// One Being processes one inbox entry through one summoning (one LLM
// call for llm-mode, one code dispatch for scripted-mode) producing
// one output. "Summoning" is the verb; a `Summon` is the record of
// one wake-and-act. The kernel's IBP-aligned record surface:
//
//   DO emits        → Did records      (what was done; tool calls are Dids)
//   SUMMON arrives  → Inbox entries    (delivery queue)
//   Summoning fires → Summon records   (one Being's wake)
//   Matter writes   → Matter records   (things at a position)
//
// Conversation is the graph of Summons joined by `inReplyTo` and
// `rootCorrelation`. A thread between two Beings is the set of Summons
// sharing an `ibpAddress`. A chain (Ruler → Planner → Contractor) is
// the reply tree under one `rootCorrelation`. Tool calls during a
// Summon are Dids keyed by `summonId`, not in-document arrays.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const SummonSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },

  // Asker — who initiated this summoning.
  beingIn: { type: String, ref: "Being", required: true, index: true },

  // Responder — who is being summoned.
  beingOut: { type: String, ref: "Being", default: null, index: true },

  // Canonical sorted stance::stance for this Summon's conversation
  // context. See seed/ibp/addressStorage.js.
  ibpAddress: { type: String, default: null, index: true },

  // The role the responder was acting in for this Summon. Sourced from
  // envelope.activeRole when the sender specified one, else from
  // beingOut.defaultRole. Identity is durable; role composes per summon.
  activeRole: { type: String, default: null, index: true },

  // The inbox entry this Summon consumed. Lets the inbox view link
  // task → wake → result without a join hack.
  inboxMessageId: { type: String, default: null, index: true },

  // Reply linkage. inReplyTo points at the Summon that dispatched this
  // one (parent in the reply graph). rootCorrelation propagates through
  // the whole chain — the originating envelope's correlation id.
  // Cancellation walks rootCorrelation; conversation grouping reads it.
  inReplyTo:       { type: String, default: null, index: true },
  rootCorrelation: { type: String, default: null, index: true },

  // Inbox queue time vs scheduler-dispatched time.
  receivedAt: { type: Date, default: null },
  summonedAt: { type: Date, default: null },

  // What the asker said.
  startMessage: {
    content: { type: String, required: true },
    source:  { type: String, default: "user" },
    _id: false,
  },

  // What the responder produced (or stopped state).
  endMessage: {
    content: { type: String, default: null },
    stopped: { type: Boolean, default: false },
    time:    { type: Date, default: null },
    _id: false,
  },

  // LLM provider info for llm-mode summonings. References the
  // LlmConnection used for this summon.
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
