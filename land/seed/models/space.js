// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Space — a position in the substrate. Spaces nest as a tree
// (parent + children). Every other primitive (Being, Matter, Did,
// Summon) attaches to a Space; the substrate's structural layer is
// just the Space tree.
//
// Twelve fields total. Anything an extension wants to attach lives in
// metadata, namespaced by extension. See [[project_substrate_as_universal_workspace]].

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { SEED_SPACE, DELETED } from "../space/seedSpaces.js";

const SpaceSchema = new mongoose.Schema({
  _id:  { type: String, default: uuidv4 },
  name: { type: String, required: true },
  type: { type: String, default: null },
  dateCreated: { type: Date, default: Date.now },

  // Tree-wide default LLM. Extension slots live in metadata.
  llmDefault: { type: String, ref: "LlmConnection", default: null },

  parent:   { type: String, ref: "Space", default: null },
  children: [{ type: String, ref: "Space" }],

  // rootOwner non-null → this Space is a tree root. Owner-only writes
  // (rename, move, delete). null → not a root; resolveSpaceAccess walks
  // up to find the owner. Contributors get write access at any depth;
  // capped at 500 per Space in space/ownership.js.
  rootOwner:    { type: String, ref: "Being", default: null },
  contributors: [{ type: String, ref: "Being" }],

  // Seed-managed Space marker. Non-null values identify positions the
  // kernel plants and owns (.identity, .config, .source, etc.). User-
  // created Spaces have seedSpace: null. See seed/space/seedSpaces.js.
  seedSpace: {
    type: String,
    enum: [null, ...Object.values(SEED_SPACE)],
    default: null,
  },

  // Extension data, namespaced. Each extension writes to its own key
  // via setExtMeta. The kernel never writes outside reserved namespaces
  // (extensions, llm, permissions, beings, cascade, etc.).
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
});

// Soft-delete only. Space deletion sets parent = DELETED in
// space/spaceManagement.js; the deleted-revive extension can bring
// Spaces back. The kernel never hard-deletes a Space.

SpaceSchema.index({ parent: 1 });
SpaceSchema.index({ rootOwner: 1 });
SpaceSchema.index({ seedSpace: 1 }, { sparse: true });

// Public-Space listing. A Space is public iff its layer-2 authorize
// walk finds a wildcard SEE rule on the Space itself. Sparse so
// private Spaces (no rule) don't bloat the index.
SpaceSchema.index({ "metadata.permissions.see.*": 1 }, { sparse: true });

// At most one plan-type child per scope. The "plan governs work at a
// scope, branches live as siblings under that scope" rule depends on
// every walk-up resolving to a single plan; two plan-type children at
// the same parent splits the system across writers in silent ways.
// Database-level invariant — even a buggy code path that bypasses
// ensurePlanAtScope cannot violate it. partialFilterExpression limits
// the constraint to type === "plan"; other sibling types are unaffected.
SpaceSchema.index(
  { parent: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "plan" },
    name: "unique_plan_per_scope",
  },
);

const Space = mongoose.model("Space", SpaceSchema);
export default Space;
