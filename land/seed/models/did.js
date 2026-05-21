// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Did. A thing that was done.
//
// Past tense, by design. A being is its acts; this row is one of
// those acts, recorded. The trail of Dids attached to a being IS
// the being — the row in beings.js is just where the trail hangs.
// Without acts, the being is potential; with them, the being is
// something that has unfolded. See
// [seed/land/LAND.md](../land/LAND.md) "And the beings are the
// acts."
//
// I record a Did for two of my four verbs: DO and BE. SEE is
// observation, not doing — no row. SUMMON is delivery to an inbox,
// not a substrate act — the Summon model is the audit row for that
// delivery, and whatever the summoned being then does in response
// is itself a DO or BE row carrying its summonId. "What happened
// inside this summon?" is Did.find({ summonId }).
//
// I attribute every row. The actor is the being whose stance
// emitted the act. I am the actor only when no being yet exists —
// pre-being scaffold flows (boot, migrations, first-time-boot
// writes). Once a being is on the land, the being's id is what the
// row carries.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const DidSchema = new mongoose.Schema({
  _id:  { type: String, default: uuidv4 },
  date: { type: Date,   default: Date.now },

  // The actor. I am the actor only when no being yet exists
  // (pre-being scaffold flows: server boot, migrations).
  beingId: { type: String, ref: "Being", required: true },

  // Which verb emitted the row. DO for operations; BE for identity
  // acts (register / claim / release / switch and any BE-being's
  // honoredOperations).
  verb:   { type: String, enum: ["do", "be"], default: "do", index: true },

  // The operation or sub-event name. Operations register a
  // `didAction` (defaults to the operation name); helpers may write
  // their own kebab-case event names.
  action: { type: String, required: true },

  // What was acted on. Optional — some acts (multi-being ops,
  // land-level config) have no single positional target.
  target: {
    kind: { type: String, enum: ["space", "matter", "being", "land", "stance"] },
    id:   { type: String },
    _id:  false,
  },

  // Free-form input and output payloads. Capped at logDid write time;
  // oversized values are clipped and `truncated` is set.
  params:    { type: mongoose.Schema.Types.Mixed, default: null },
  result:    { type: mongoose.Schema.Types.Mixed, default: null },
  truncated: { type: Boolean, default: false },

  // Correlation. summonId binds the row to a wake; sessionId binds
  // it to a transport session (WS, CLI, HTTP).
  summonId:  { type: String, ref: "Summon", default: null },
  sessionId: { type: String, default: null, index: true },

  // Federation provenance. Set when the verb call arrived from
  // another land via canopy.
  homeLand:  { type: String, default: null },
  wasRemote: { type: Boolean, default: false },
});

DidSchema.index({ beingId: 1, date: -1 });                            // a being's act history
DidSchema.index({ "target.kind": 1, "target.id": 1, date: -1 }, { sparse: true }); // a target's history
DidSchema.index({ summonId: 1 }, { sparse: true });                   // acts within a summon
DidSchema.index({ verb: 1, action: 1, date: -1 });                    // "every register, newest first"

const Did = mongoose.model("Did", DidSchema, "dids");
export default Did;
