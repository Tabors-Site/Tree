// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Fact. A thing stamped by the Factory.
//
// `factum` (Latin, "a thing done"). It is not a thing true. A fact
// alone is not much, just a record of matter, space, or being. The
// end of a chain of facts is Truth. Truth is at the end of the
// chain, not at the start. One fact is small. The chain accumulates.
// Truth is what the chain becomes.
//
// The trail of Facts attached to a being IS the being. The Being row
// in MongoDB is where the trail hangs; the trail itself, every Fact
// the being has emitted, is the identity. Without acts the being is
// potential; with them the being is something that has unfolded.
// See [seed/place/PLACE.md](../place/PLACE.md) "And the beings are
// the acts."
//
// I stamp a Fact for two of my four verbs: DO and BE. SEE is
// observation, not doing — no row. SUMMON is delivery to an inbox,
// not a substrate act — the Summon model is the audit row for that
// delivery, and whatever the summoned being then does in response
// is itself a DO or BE Fact carrying its summonId. "What happened
// inside this summon?" is Fact.find({ summonId }).
//
// I attribute every Fact. The actor is the being whose stance
// emitted the act. I am the actor only when no being yet exists —
// pre-being scaffold flows (boot, migrations, first-time-boot
// writes). Once a being is on the place, the being's id is what the
// row carries.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const FactSchema = new mongoose.Schema({
  _id:  { type: String, default: uuidv4 },
  date: { type: Date,   default: Date.now },

  // The actor. I am the actor only when no being yet exists
  // (pre-being scaffold flows: server boot, migrations).
  beingId: { type: String, ref: "Being", required: true },

  // Which verb stamped the Fact. DO for operations; BE for identity
  // acts (register / claim / release / switch and any BE-being's
  // honoredOperations).
  verb:   { type: String, enum: ["do", "be"], default: "do", index: true },

  // The operation or sub-event name. Operations register a
  // `factAction` (defaults to the operation name); helpers may write
  // their own kebab-case event names.
  action: { type: String, required: true },

  // What was acted on. Optional — some acts (multi-being ops,
  // place-level config) have no single positional target.
  target: {
    kind: { type: String, enum: ["space", "matter", "being", "place", "stance"] },
    id:   { type: String },
    _id:  false,
  },

  // Free-form input and output payloads. Capped at logFact write time;
  // oversized values are clipped and `truncated` is set.
  params:    { type: mongoose.Schema.Types.Mixed, default: null },
  result:    { type: mongoose.Schema.Types.Mixed, default: null },
  truncated: { type: Boolean, default: false },

  // Correlation. summonId binds the Fact to a wake; sessionId binds
  // it to a transport session (WS, CLI, HTTP).
  summonId:  { type: String, ref: "Summon", default: null },
  sessionId: { type: String, default: null, index: true },

  // Federation provenance. Set when the verb call arrived from
  // another place via canopy.
  homePlace:  { type: String, default: null },
  wasRemote: { type: Boolean, default: false },
});

FactSchema.index({ beingId: 1, date: -1 });                                          // a being's reel
FactSchema.index({ "target.kind": 1, "target.id": 1, date: -1 }, { sparse: true }); // a target's reel
FactSchema.index({ summonId: 1 }, { sparse: true });                                 // facts within a summon
FactSchema.index({ verb: 1, action: 1, date: -1 });                                  // "every register, newest first"

const Fact = mongoose.model("Fact", FactSchema, "facts");
export default Fact;
