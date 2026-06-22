// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Matter. What fills a space.
//
// Space gives the world a where; matter gives it a what. I do not
// split matter by what it carries — text, a file, an http link, a
// doorway to another story. One row, one schema, one set of
// operations. The TYPE (types.js registry) says what the matter IS,
// which decides its content shape, where bytes live, and which DO
// ops apply:
//
//   generic — bare text (a context chunk) or qualities-only. Content
//             is a CAS ref to owned bytes, or null.
//   file    — bytes of any format. Content is a CAS ref.
//   model   — a .glb body. Content is a CAS ref.
//   http    — website content. Content is `{ url }` — the bytes live
//             on the WWW.
//   ibpa    — the inter-story portal. Content is `{ target }` — an
//             IBP address into another world.
//   source  — the seed's read-only disk mirror. Content is
//             `{ path, ... }` — bytes live in the repo checkout.
//
// (There is no separate `origin` field — where content lives is
// derivable from the type's reference shape, and a separate tag
// drifted from story the moment types landed.)
//
// Matter also forms a tree within its space (parentMatterId +
// children[]). Folder-and-file structures, recursive emission
// hierarchies, anything where one piece of content contains
// another. The schema below is closed; what an extension wants to
// say about a piece of matter goes in `qualities`.
//
// Projection schema. Same three-slot structure as Being (see
// seed/materials/being/being.js header for the canonical doctrine):
// Identity (`_id`), Figure (everything the matter reducer writes
// from the reel), Cache-control (`foldedSeq`). Fields declared below
// are for Mongoose strict-mode mechanics, not figure authority. They
// collapse into `strict: false` when verb-handler validation lands.
// Deliberately deferred, not unprincipled.

import mongoose from "mongoose";

const MatterSchema = new mongoose.Schema({
  // Content-addressed: the id is the hash of the matter's birth identity
  // (matterId.js), supplied by the fact-driven create path. No random
  // default — a matter is never minted without its derived id.
  _id: { type: String },

  // Matter does not exist outside a position. The DELETED sentinel
  // on spaceId / beingId marks soft-deleted matter.
  //
  // spaceId is a bare space-id, OR the DELETED sentinel ("deleted")
  // for soft-deleted matter (the set-matter handler validates which).
  spaceId: { type: String, required: true },
  // beingId is the creator's bare being-id (I_AM for genesis-time
  // creations) OR the DELETED sentinel for soft-deleted matter.
  beingId: { type: String, required: true },

  // Optional human-readable label. Used by set-name and by the
  // source mirror (the file's name).
  name: { type: String, default: null },

  // The matter tree at this space. Root matter has
  // parentMatterId: null; descendants chain through parentMatterId.
  parentMatterId: { type: String, ref: "Matter", default: null, index: true },
  children:       [{ type: String, ref: "Matter" }],

  // What this matter IS — its registered matter type (types.js).
  // The type decides the content shape, where the bytes live, and
  // which DO ops apply (the descriptor's actions menu, the
  // able-walk's create-matter:<type> refinement). Seed basics:
  // generic | file | model | http | ibpa | source; extensions
  // register "<ext>:<type>".
  type: { type: String, default: "generic", index: true },

  // Content. For owned bytes this is the CAS ref
  // `{ kind:"cas", hash, size, mimeType, name, encoding, preview }` —
  // the bytes themselves live in the content store
  // (matter/contentStore.js), addressed by SHA-256. Reference types
  // carry their reference shapes (http `{url}`, ibpa `{target}`,
  // source `{path,...}`). May be null for a row carrying only
  // qualities.
  content: { type: mongoose.Schema.Types.Mixed, default: null },

  // Coordinate inside spaceId. Null when the matter has no spatial
  // position (most matter most of the time). Same shape and semantics
  // as Being.coord — `{ x: Number, y: Number, z?: Number }` clamped
  // at set-matter time against the containing Space.size. Matter
  // cannot exist outside its space's bounds; the act of placing it
  // at the edge stops AT the edge.
  coord: {
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    z: { type: Number, default: null },
    _id: false,
  },

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

  // Reducer-owned timestamps. NO `default: Date.now` and NO pre-save
  // hook. Mongoose-managed defaults would fire when the reducer
  // doesn't set them and inject wall-clock values the reel never saw
  // (second-writer bug — same shape as Being's removed `timestamps: true`).
  // applyCreateMatter seeds both from fact.date on do:create; matter
  // reducer's catch-all bumps updatedAt on any mutating apply.
  createdAt: { type: Date, default: null },
  updatedAt: { type: Date, default: null },
});

MatterSchema.index({ spaceId: 1, createdAt: -1 });
MatterSchema.index({ beingId: 1, createdAt: -1 });

// Position index — what matter occupies a given space. Used by
// foldPlace to find a space's matter-occupants.
MatterSchema.index({ position: 1 }, { sparse: true });

const Matter = mongoose.model("Matter", MatterSchema, "matters");
export default Matter;
