// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Matter. What fills a space.
//
// Space gives the world a where; matter gives it a what. I do not
// split matter by what it carries — text, a file, a URL, a bridge
// to another place. One row, one schema, one set of operations. The
// `origin` field names the realm the underlying content actually
// lives in, and that decides how I fetch it, address it, and keep
// it in sync. Adding a new origin is a bridging pattern, never a
// schema change.
//
// The origins I know:
//
//   ibp        — I own the bytes. Content is a string (text) or
//                null for a row carrying only qualities.
//   filesystem — bridges to a file on disk. Content is { path, size,
//                mimeType }. Bytes live outside me; the orphan
//                sweeper retires unreferenced files.
//   web        — bridges to a URL. Content is { url, fetchedAt?,
//                cache? }. Live content lives on the web.
//   cross-place — bridges to Matter on another place. Content is
//                { place, matterRef }.
//
// Matter also forms a tree within its space (parentMatterId +
// children[]). Folder-and-file structures, recursive emission
// hierarchies, anything where one piece of content contains
// another. The schema below is closed; what an extension wants to
// say about a piece of matter goes in `qualities`.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { MATTER_ORIGIN } from "./origins.js";

const MatterSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },

  // Matter does not exist outside a position. The DELETED sentinel
  // on spaceId / beingId marks soft-deleted matter.
  spaceId: { type: String, ref: "Space", required: true },
  beingId: { type: String, ref: "Being", required: true },

  // Optional human-readable label. Used by set-name and by
  // filesystem-origin mirroring (the file's name).
  name: { type: String, default: null },

  // The matter tree at this space. Root matter has
  // parentMatterId: null; descendants chain through parentMatterId.
  parentMatterId: { type: String, ref: "Matter", default: null, index: true },
  children:       [{ type: String, ref: "Matter" }],

  // Which realm the underlying content lives in. Required — origin
  // determines fetching, sync mode, and addressing.
  origin: {
    type: String,
    enum: Object.values(MATTER_ORIGIN),
    default: MATTER_ORIGIN.IBP,
    required: true,
  },

  // Shape varies by origin (see origins.js). May be null for a row
  // carrying only qualities.
  content: { type: mongoose.Schema.Types.Mixed, default: null },

  qualities: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map(),
  },

  // Projection cache markers. Per FOLD.md / STAMPER.md, the Matter
  // row is a cache of the fold over this matter's reel — not the
  // source of truth. `foldedSeq` is the highest fact-seq applied
  // here. `position` mirrors `spaceId` once position-facts land; for
  // now reducer output stays null.
  foldedSeq: { type: Number, default: null },
  position:  { type: String, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

MatterSchema.index({ spaceId: 1, createdAt: -1 });
MatterSchema.index({ beingId: 1, createdAt: -1 });
MatterSchema.index({ origin: 1 });

// Position index — what matter occupies a given space. Used by
// foldPlace to find a space's matter-occupants.
MatterSchema.index({ position: 1 }, { sparse: true });

MatterSchema.pre("save", function (next) {
  if (!this.isNew) this.updatedAt = new Date();
  next();
});

const Matter = mongoose.model("Matter", MatterSchema, "matters");
export default Matter;
