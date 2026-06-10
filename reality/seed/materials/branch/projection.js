// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Projection. The unified per-branch projection cache.
//
// Doctrine (locked with Tabor 2026-06-03):
//   1. Main is just-another-branch with no parent. Branch is a
//      first-class dimension of every projection lookup.
//   2. Names are per-branch identifiers; identity is `_id`. IBP
//      `#<branch>` disambiguates.
//   3. Branches inherit parent state lazily. Modifications shadow main
//      for in-branch queries.
//   4. Reducers are branch-blind. The substrate handles branch routing
//      around them.
//
// During Phase 2/3 of the projection unification this collection holds
// only NON-MAIN projections; main's slots continue to live on the
// Being/Space/Matter rows. The unified API in seed/materials/projections.js
// hides which storage backs which branch from callers.
//
// In Phase 4 the storage migration backfills every existing Being /
// Space / Matter row into this collection with branch="0" and the API's
// main path swings over. After that, every projection regardless of
// branch lives here.

import mongoose from "mongoose";

const ProjectionSchema = new mongoose.Schema({
  // Composite key. `<branch>:<type>:<id>` mirrors the ReelHead key
  // convention so both branched caches share a mental model.
  _id:        { type: String },

  branch:     { type: String, required: true, index: true },
  type:       { type: String, required: true, enum: ["being", "space", "matter"] },
  id:         { type: String, required: true },

  // Reducer output. Mixed because reducers determine which fields live
  // here — same shape they write today on Being/Space/Matter rows.
  state:      { type: mongoose.Schema.Types.Mixed, default: {} },

  // Highest fact-seq this branch has folded for this reel. Read by the
  // fold engine to decide whether the cache is fresh and to bound the
  // tail-read on hot fold.
  foldedSeq:  { type: Number, default: null },

  // Reducer-derived position. Sparse-indexed below for findByPosition.
  position:   { type: String, default: null },

  // Released-in-branch marker. Distinct from "row doesn't exist" — a
  // tombstone says "this aggregate WAS visible in this branch but was
  // explicitly released here." findByPosition and findByName filter
  // these out; loadProjection returns them so callers can render
  // "gone-in-this-branch" cleanly.
  tombstoned: { type: Boolean, default: false },
});

// Primary lookup is via _id (composite key) — no extra index needed.
// Branch + position serves findByPosition.
ProjectionSchema.index(
  { branch: 1, position: 1 },
  { sparse: true },
);

// Name uniqueness PER-BRANCH. Tombstoned slots are excluded via partial
// filter so a being's name becomes available again after it's released
// in that branch. Same-name beings in different branches are allowed by
// construction (the index key includes branch).
//
// The tombstone exclusion is EQUALITY on false, not `$ne: true` —
// Mongo partial indexes don't support $not/$ne and the index silently
// never built with that spec (so per-branch name uniqueness was never
// actually enforced). Equality is safe because every write path sets
// the field explicitly: initProjection lands tombstoned:false on every
// slot, tombstoneProjection flips it true (leaving the index, freeing
// the name), and the schema defaults false.
ProjectionSchema.index(
  { branch: 1, type: 1, "state.name": 1 },
  {
    unique: true,
    partialFilterExpression: {
      "state.name": { $exists: true, $type: "string" },
      tombstoned:   false,
    },
  },
);

// Lineage queries: "give me children of being X in branch B."
// state.parentBeingId is a bare being-id; findByParent / countByParent
// filter on it directly.
ProjectionSchema.index(
  { branch: 1, type: 1, "state.parentBeingId": 1 },
  { sparse: true },
);

// Lineage queries for spaces: "give me children of space X in branch B."
ProjectionSchema.index(
  { branch: 1, type: 1, "state.parent": 1 },
  { sparse: true },
);

// Lineage queries for matter: "give me children of matter X in branch B."
ProjectionSchema.index(
  { branch: 1, type: 1, "state.parentMatterId": 1 },
  { sparse: true },
);

// Matter-in-space queries: "give me matters at space X in branch B."
// state.spaceId is a bare space-id (or the DELETED sentinel for soft-
// deleted matter; live-matter queries filter sentinels out via
// tombstoned).
ProjectionSchema.index(
  { branch: 1, type: 1, "state.spaceId": 1 },
  { sparse: true },
);

// Catalog: "list every being / space / matter in branch B."
ProjectionSchema.index({ branch: 1, type: 1 });

const Projection = mongoose.model(
  "Projection",
  ProjectionSchema,
  "projections",
);

export default Projection;

// Composite key helper. Mirrors reelKey(branch, type, id) from
// seed/past/reel/reelHeads.js so both caches use the same convention.
export function projectionKey(branch, type, id) {
  return `${branch}:${type}:${id}`;
}
