// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Branch. A divergent world that shares history with its parent up
// to a chosen branch point.
//
// Every branch traces back to main (#0). Branches form a tree:
//   #0 (main) → #1 → #1a → #1a1 → ...
//
// `path` is the canonical identifier. Per the user's address scheme
// (seed/timeline.md, "addressing"): numbers and letters alternate
// per level, segments are stable identifiers (#1 stays #1 even
// after deletion of earlier branches).
//
// `branchPoint` captures the parent's per-reel seqs at the moment
// the branch was created. A branch's first write to reel R picks up
// at branchPoint[R] + 1, so seqs across the inherited-prefix +
// divergent-tail combine into a single monotonic stream per reel.
//
// Branch metadata is doctrinally world data — when a branch is
// created, paused, or labeled, the change is a Fact on main's
// `.branches` reel. The Branch Mongo doc here is the projection
// of that fact stream, the same way Being / Space / Matter rows are
// projections of their fact chains. See seed/materials/branch/
// branchReducer.js for the reducer (future pass; not in scope for
// Pass 2 which only ships the schema + read-path awareness).

import mongoose from "mongoose";

const BranchSchema = new mongoose.Schema({
  // Path identifier. "0" for main; "1", "1a", "1a1", etc. for
  // descendants. Indexed unique. Pre-allocated by the create-branch
  // op based on the parent's existing children (next available
  // segment in the alternating-number/letter scheme).
  _id:  { type: String },          // same as `path`; one doc per branch path
  path: { type: String, required: true, unique: true, index: true },

  // Parent branch path. Null only for main ("0"). Forms the tree.
  parent: { type: String, default: null, index: true },

  // Per-reel snapshot of the parent's heads at branch creation.
  // Mongo Map<reelKey, seq> where reelKey is `<type>:<id>`. Read
  // path walks this when assembling the lineage of facts to apply:
  // facts in branch X are facts in parent's reel up to
  // branchPoint[reel] (inherited), then facts in X's storage above
  // branchPoint[reel] (divergent).
  branchPoint: { type: Map, of: Number, default: () => new Map() },

  // Authoring metadata.
  createdBy: { type: String, ref: "Being", default: null },
  createdAt: { type: Date, default: Date.now },
  label:     { type: String, default: null },

  // Pause state. While paused, every IBP verb against this branch
  // refuses with HISTORICAL_READ_ONLY's sibling code REALITY_PAUSED
  // (Pass 6.5; substrate awareness lives on the doc, the gate ships
  // when the verbs learn to read it).
  paused:   { type: Boolean, default: false, index: true },
  pausedBy: { type: String, ref: "Being", default: null },
  pausedAt: { type: Date, default: null },

  // Live world marker. Operators can promote a branch to "live"
  // (Pass 10 in the build order). Default: only main is live.
  isLive:           { type: Boolean, default: false, index: true },
  archivedBecause:  { type: String, default: null },
});

const Branch = mongoose.model("Branch", BranchSchema, "branches");
export default Branch;
