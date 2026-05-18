// TreeOS Seed . AGPL-3.0 . https://treeos.ai
//
// Did — the persistent log of IBP DO emissions. Past tense: a Did is a thing
// that was done.
//
// One row per executed action: a being did something at a position. The
// schema mirrors the DO envelope. `beingId` is the actor (envelope identity),
// `nodeId` is the target position, `action` is the action name, and the
// sub-shapes (statusEdited, editName, editType, artifactAction, updateChild,
// updateParent, branchLifecycle) carry typed payloads for kernel-named
// actions. Extension-defined actions stash their payload in `extensionData`.
//
// Pairs with Summon ↔ SUMMON: SUMMON emits Summon records that bind beingIn/beingOut;
// DO emits Did records that record who-did-what-where. Together they make
// the kernel-recorded activity surface queryable end to end.
//
// Replaces the older Contribution model. `wasAi` is gone — derive from
// `Being.findById(beingId).operatingMode === "ai"` when needed.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const DidSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  beingId: { type: String, ref: "Being", required: true },
  nodeId: { type: String, ref: "Node" },
  summonId: { type: String, ref: "Summon" },
  sessionId: { type: String, index: true },

  // Action type (DO action name)
  action: { type: String, required: true },

  // Date
  date: { type: Date, default: Date.now },

  // ── Core action data (protocol-level operations, only the relevant one is set) ──
  statusEdited: { type: String },
  editName: { type: { oldName: String, newName: String, _id: false } },
  editType: { type: { oldType: String, newType: String, _id: false } },
  artifactAction: { type: { action: { type: String, enum: ["add", "remove", "edit"] }, artifactId: { type: String, ref: "Artifact" }, content: String, _id: false } },
  updateChild: { type: { action: { type: String, enum: ["added", "removed"] }, childId: { type: String, ref: "Node" }, _id: false } },
  updateParent: { type: { oldParentId: { type: String, ref: "Node" }, newParentId: { type: String, ref: "Node" }, _id: false } },
  branchLifecycle: { type: { action: { type: String, enum: ["retired", "revived", "revivedAsRoot"] }, fromParentId: { type: String, ref: "Node" }, toParentId: { type: String, ref: "Node" }, _id: false } },

  // Canopy federation
  wasRemote: { type: Boolean, default: false },
  homeLand: { type: String },

  // Extension data (Mixed, any extension can attach metadata via ...rest params)
  extensionData: { type: mongoose.Schema.Types.Mixed },
});

// Query indexes
DidSchema.index({ beingId: 1, date: -1 }); // a being's action history
DidSchema.index({ nodeId: 1, date: -1 });  // a node's action history
DidSchema.index({ summonId: 1 }, { sparse: true }); // finalizeSummon: Did.find({ summonId })

// Retention: kernel deletes Did rows older than didRetentionDays (default 365, 0 = forever)

const Did = mongoose.model("Did", DidSchema, "dids");
export default Did;
