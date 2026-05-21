// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Did . the persistent log of IBP verb emissions. Past tense: a Did
// is a thing that was done.
//
// One row per audited action. Generic over the operation registry:
// `verb` names which verb emitted the row (do | be); `action` carries
// the operation name; `target` names what was acted on (space, matter,
// being, land, stance). Inputs land in `params`, outputs in `result`.
//
// Tracked by default for every DO and BE call. Operations opt out via
// `spec.skipAudit: true`; in-process callers can pass `opts.skipAudit`
// for kernel-trusted batches.
//
// Paired with Summon: Summon records bind beingIn / beingOut (the
// wake-and-act); Did records record who-did-what-where. Together they
// make every kernel-recorded action queryable end to end.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const DidSchema = new mongoose.Schema({
  _id:  { type: String, default: uuidv4 },
  date: { type: Date,   default: Date.now },

  // Actor. Always required. SEED_BEING is the sentinel for pre-being
  // scaffold flows (server boot, migrations, first-time-boot writes).
  beingId: { type: String, ref: "Being", required: true },

  // Which verb emitted this row. DO covers operations; BE covers
  // identity actions (register / claim / release / switch and any
  // be-being's honoredOperations). SUMMON and SEE write no Dids by
  // design: SEE is observation (not doing); SUMMON is delivery to a
  // being's inbox, and the actions that being performs in response
  // are themselves DO / BE rows carrying summonId for correlation.
  // The Summon record (model: summon.js) is the audit row for the
  // delivery itself.
  verb:   { type: String, enum: ["do", "be"], default: "do", index: true },

  // The operation or sub-event name. Operations register a `didAction`
  // (defaults to the operation name); helpers can write their own
  // kebab-case event names ("edit-name", "child-added", "branch-retired").
  action: { type: String, required: true },

  // What was acted on. `kind` discriminates the substrate primitive;
  // `id` carries its identifier. May be absent for actions that have no
  // single positional target (multi-being ops, land-level config).
  target: {
    kind: { type: String, enum: ["space", "matter", "being", "land", "stance"] },
    id:   { type: String },
    _id:  false,
  },

  // Free-form input and output payloads. Capped at logDid write time
  // (see seed/space/dids.js); oversized values are clipped and the
  // `truncated` flag is set.
  params:    { type: mongoose.Schema.Types.Mixed, default: null },
  result:    { type: mongoose.Schema.Types.Mixed, default: null },
  truncated: { type: Boolean, default: false },

  // Correlation. summonId binds the row to a wake; sessionId binds it
  // to a transport session (WS chat, CLI run, HTTP request).
  summonId:  { type: String, ref: "Summon", default: null },
  sessionId: { type: String, default: null, index: true },

  // Federation provenance. Set when the originating verb arrived from
  // another land via canopy.
  homeLand:  { type: String, default: null },
  wasRemote: { type: Boolean, default: false },
});

DidSchema.index({ beingId: 1, date: -1 });                            // a being's action history
DidSchema.index({ "target.kind": 1, "target.id": 1, date: -1 }, { sparse: true }); // a target's action history
DidSchema.index({ summonId: 1 }, { sparse: true });                   // chain / activity lookup
DidSchema.index({ verb: 1, action: 1, date: -1 });                    // "every register, newest first"

// Retention: kernel sweeps Did rows older than didRetentionDays
// (land config, default 365; 0 disables sweep).

const Did = mongoose.model("Did", DidSchema, "dids");
export default Did;
