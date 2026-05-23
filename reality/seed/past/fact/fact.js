// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Fact. A thing a being stamps in the Factory — one recorded change
// to matter, space, or being.
//
// `factum` (Latin, "a thing done"). It is not a thing true. A single
// fact is small but settled. A chain of facts, folded, is Truth.
// The first fact is the I-Am; the place grows from there in reels.
// There is no global Now everyone reads from — each being is the
// momentum of its own chain, framing its own moment.
//
// The trail of Facts attached to a being IS the being. The Being row
// in MongoDB is where the trail hangs; the trail itself, every Fact
// the being has emitted, is the identity. Without acts the being is
// potential; with them the being is something that has unfolded.
// See [seed/philosophy/MATERIALS.md](../philosophy/MATERIALS.md) "And the beings are
// the acts."
//
// I stamp a Fact for two of my four verbs: DO and BE. SEE is
// observation, not doing — no row. SUMMON is delivery to an inbox,
// not a substrate act — the Act model is the audit row for that
// delivery, and whatever the summoned being then does in response
// is itself a DO or BE Fact carrying its actId. "What happened
// inside this summon?" is Fact.find({ actId }).
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

  // Per-reel monotonic seq, allocated atomically at append time. The
  // fold sorts by seq, never by date (clock skew can invert order).
  // Only set when target.kind ∈ {being,space,matter} AND target.id is
  // present — those are the reel-bearing aggregates. Place-level and
  // target-less facts carry seq:null and stay outside the fold model
  // for now. See [seed/present/STAMPER.md](../factory/stamper/STAMPER.md).
  seq: { type: Number, default: null },

  // Free-form input and output payloads. Capped at logFact write time;
  // oversized values are clipped and `truncated` is set.
  params:    { type: mongoose.Schema.Types.Mixed, default: null },
  result:    { type: mongoose.Schema.Types.Mixed, default: null },
  truncated: { type: Boolean, default: false },

  // Correlation. actId binds the Fact to a wake; sessionId binds
  // it to a transport session (WS, CLI, HTTP).
  actId:  { type: String, ref: "Act", default: null },
  sessionId: { type: String, default: null, index: true },

  // Federation provenance. Set when the verb call arrived from
  // another reality via canopy.
  homeReality:  { type: String, default: null },
  wasRemote: { type: Boolean, default: false },
});

FactSchema.index({ beingId: 1, date: -1 });                                          // a being's reel
FactSchema.index({ "target.kind": 1, "target.id": 1, date: -1 }, { sparse: true }); // a target's reel (date-ordered, legacy)
FactSchema.index({ "target.kind": 1, "target.id": 1, seq: 1 }, {                     // a target's reel (seq-ordered, fold path)
  partialFilterExpression: { seq: { $type: "number" } },
});
FactSchema.index({ "target.kind": 1, "target.id": 1, seq: 1 }, {                     // per-reel uniqueness backstop
  unique: true,
  partialFilterExpression: { seq: { $type: "number" } },
  name: "target_seq_unique",
});
FactSchema.index({ actId: 1 }, { sparse: true });                                 // facts within a summon
FactSchema.index({ verb: 1, action: 1, date: -1 });                                  // "every register, newest first"

const Fact = mongoose.model("Fact", FactSchema, "facts");
export default Fact;
