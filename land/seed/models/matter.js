// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Matter — a thing inside a Space.
//
// Matter is the kernel's "stuff that occupies a position" primitive.
// Space is the position itself (the place where things happen).
// Matter is what sits in that place. Beings are the agentive subset of
// substrate that can act on either. See seed/philosophy/.
//
// The axis is origin, not type. Origin captures what system the
// underlying representation comes from. It determines fetching,
// storage, synchronization, addressing, and transfer.
//
//   ibp        — TreeOS native. content is a string (text) or null
//                (metadata-only object). Always in sync; TreeOS owns it.
//   filesystem — Bridges to a file on disk. content is { path, size,
//                mimeType }. Bytes live outside TreeOS.
//   web        — Bridges to a URL. content is { url, fetchedAt?, cache? }.
//                Live content lives on the web.
//   cross-land — Bridges to Matter on another TreeOS land.
//                content is { land, matterRef }. Matter lives in the
//                other land.
//
// Future origins (git, database, stream, service) plug in as new
// bridging patterns. Schema does not change; origin enum extends and
// renderers / fetchers handle the new origin. See origins.js for the
// canonical enum and seed/matter/matters.js for CRUD.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { MATTER_ORIGIN } from "../matter/origins.js";

const MatterSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },

  // Which Space this Matter lives in. Required: Matter does not exist
  // outside a position. DELETED sentinel marks soft-deleted Matter.
  spaceId: { type: String, ref: "Space", required: true },

  // Who wrote this Matter. Required: every Matter has an author.
  // DELETED sentinel marks soft-deleted Matter.
  beingId: { type: String, ref: "Being", required: true },

  // Human-readable identifier. Used by set-name and by filesystem-
  // origin mirroring (the file's name). Optional — pure-metadata
  // Matter may not need one. Capped at the same length as Space.name.
  name: { type: String, default: null },

  // ── Matter tree ──
  // Matter forms a recursive tree (the third tree in the substrate,
  // alongside Spaces and Beings). Root Matter at a Space carries
  // parentMatterId: null; descendants chain through parentMatterId.
  // Enables filesystem-origin folder-and-file structures, recursive
  // emission/step hierarchies for governing, etc. See
  // [[project_substrate_as_universal_workspace]].
  parentMatterId: { type: String, ref: "Matter", default: null, index: true },
  children:       [{ type: String, ref: "Matter" }],

  // What system the underlying representation comes from. See
  // origins.js MATTER_ORIGIN. Required — origin determines fetching,
  // sync mode, and addressing, so callers cannot create Matter whose
  // handling is ambiguous.
  origin: {
    type: String,
    enum: Object.values(MATTER_ORIGIN),
    default: MATTER_ORIGIN.IBP,
    required: true,
  },

  // Content shape varies by origin (see origins.js). Optional so Matter
  // can be a pure metadata-only object (origin "ibp" with no content).
  content: { type: mongoose.Schema.Types.Mixed, default: null },

  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map(),
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Extensions tag Matter via metadata, each in its own namespace.
// maxMatterPerSpace (land config, default 1000) checked in createMatter
// before write. Retention: kernel soft-deletes Matter when its spaceId
// is set to the DELETED sentinel.

MatterSchema.index({ spaceId: 1, createdAt: -1 });
MatterSchema.index({ beingId: 1, createdAt: -1 });
MatterSchema.index({ origin: 1 });

MatterSchema.pre("save", function (next) {
  if (!this.isNew) this.updatedAt = new Date();
  next();
});

const Matter = mongoose.model("Matter", MatterSchema, "matters");
export default Matter;
