// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Space. The is, and the glue.
//
// Space is what I formed first. Without it nothing else can be
// anywhere — every primitive in my world hangs off a Space. Beings
// live at one. Matter sits in one. Facts target one. Summons place
// at one. The whole world reduces to a tree of Spaces with things
// hanging off the branches.
//
// I plant the place root at boot; everything else descends from it.
// Being-created spaces fill out the tree underneath; the nine place
// heaven spaces (`.identity`, `.config`, and the rest) sit as my own
// working memory exposed as substrate. The schema below is closed.
// Anything an extension wants to attach to a space lives in
// `qualities`, written through qualities.space.setQuality.
//
// Projection schema. Same three-slot structure as Being (see
// seed/materials/being/being.js header for the canonical doctrine):
// Identity (`_id`), Figure (everything the space reducer writes from
// the reel), Cache-control (`foldedSeq`). Fields declared below are
// for Mongoose strict-mode mechanics, not figure authority. They
// collapse into `strict: false` when verb-handler validation lands.
// Deliberately deferred, not unprincipled.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { HEAVEN_SPACE } from "./heavenSpaces.js";

const SpaceSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  name: { type: String, required: true },
  type: { type: String, default: null },

  // Reducer-owned. NO `default: Date.now` — applyCreateSpace seeds
  // this from fact.date on do:create. A schema default would inject
  // wall-clock on inserts where the reducer didn't set it
  // (second-writer bug — same shape as Being's removed `timestamps`).
  dateCreated: { type: Date, default: null },

  // Connection uuid key into the owning being's qualities.llmConnections.
  llmDefault: { type: String, default: null },

  parent: { type: String, ref: "Space", default: null },
  // children[] retired (2026-05-23). The parent-side cache is gone;
  // `parent` on each child is the single source of truth for the
  // relation. listSpaceChildren / findByPosition query the parent
  // index. The position index ({position: 1}, sparse) below is what
  // foldPlace uses for the cross-reel weave at a space.

  // The position's structural owner — the ONE base-axiom authority
  // class. Owner of a space implicitly has authority over it +
  // descendants without any role grant. Every other authority shape
  // (editor, auditor, ...) is an operator-authored ROLE under
  // RolesAreAuth — defined in qualities.roles and granted via
  // do:grant-role.
  owner: { type: String, ref: "Being", default: null },

  // Non-null marks one of the spaces I plant at boot. The enum
  // values are in seed/materials/space/heavenSpaces.js.
  heavenSpace: {
    type: String,
    enum: [null, ...Object.values(HEAVEN_SPACE)],
    default: null,
  },

  // The space's coordinate bounding box. Null when the space is
  // unbounded (most spaces). When set, the shape is
  // `{ x: Number, y: Number, z?: Number }` — half-open: a valid
  // coordinate `c` for a being inside this space satisfies
  // `0 <= c.axis < size.axis` on each axis present.
  //
  // The seed reads this field at set-being-coord time to clamp a
  // being's coord against the space they're in. A space with no
  // size enforces no bounds; the being can be at any coordinate.
  size: {
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    z: { type: Number, default: null },
    _id: false,
  },

  // The space's coord WITHIN its parent space. The sibling of `size`:
  // `size` is "how big am I inside myself"; `coord` is "where do I
  // sit in my parent." Shape `{ x, y, z? }`, clamped against the
  // parent's size at write time the same way Being.coord is clamped.
  //
  // createSpace assigns a random coord inside the parent's size when
  // the caller doesn't pass one and the parent has a size. The portal
  // reads this at the parent's SEE to position the child tree on the
  // grid (instead of the hash-derived ring it was falling back to).
  // The unified `move` op writes here for space targets, same as it
  // does for matter.
  coord: {
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    z: { type: Number, default: null },
    _id: false,
  },

  qualities: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },

  // Projection cache markers. Per FOLD.md / STAMPER.md, the Space row
  // is a cache of the fold over this space's reel — not the source of
  // truth. `foldedSeq` is the highest fact-seq the fold has applied
  // here. `position` is reducer output; for a Space, it's the parent
  // space (same as `parent` for a real space, null for the root).
  // Compare-and-set on foldedSeq during fold writes prevents marker
  // regression when concurrent folds race.
  foldedSeq: { type: Number, default: null },
  position:  { type: String, default: null },
});

// Soft-delete only. Deleting a Space sets `parent = DELETED`
// (see seed/materials/space/spaces.js). I never hard-delete.

SpaceSchema.index({ parent: 1 });
// owner-by-class index. members.owner is a singleton list, so
// indexing it lets reverse lookups ("which spaces does this being
// own?") run as a constant-time index hit instead of a tree scan.
SpaceSchema.index({ owner: 1 }, { sparse: true });
SpaceSchema.index({ heavenSpace: 1 }, { sparse: true });

// Database-level invariant for any tree where at most one plan-type
// child is allowed per parent. partialFilterExpression limits the
// constraint to type === "plan"; other sibling types are unaffected.
SpaceSchema.index(
  { "parent": 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "plan" },
    name: "unique_plan_per_scope",
  },
);

// Position index — what spaces occupy a given parent. Used by
// foldPlace to find a space's child-space occupants.
SpaceSchema.index({ position: 1 }, { sparse: true });

const Space = mongoose.model("Space", SpaceSchema);
export default Space;
