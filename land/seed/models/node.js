// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { NODE_STATUS, SYSTEM_ROLE, DELETED } from "../protocol.js";

const NodeSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  name: { type: String, required: true },
  type: { type: String, default: null },
  status: { type: String, default: NODE_STATUS.ACTIVE },
  dateCreated: { type: Date, default: Date.now },
  // Core LLM assignment: tree-wide default. Extension slots live in metadata.
  llmDefault: { type: String, ref: "LlmConnection", default: null },
  children: [{ type: String, ref: "Node" }],
  parent: { type: String, ref: "Node", default: null },

  rootOwner: { type: String, ref: "User", default: null }, // set = this is a tree root. null = not a root.
  contributors: [{ type: String, ref: "User" }], // write access. Capped at 500 per node in ownership.js.

  // Tree visibility (core protocol, used by Canopy federation)
  visibility: {
    type: String,
    enum: ["private", "public"],
    default: "private",
  },

  // Land system nodes. If systemRole is set, node is a system node.
  systemRole: {
    type: String,
    enum: [null, ...Object.values(SYSTEM_ROLE)],
    default: null,
  },
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
});

// No virtuals. Extension data lives in metadata. Callers use getExtMeta/setExtMeta.
// Ownership and contributor mutations live in seed/tree/ownership.js (uses resolveTreeAccess).

// Node deletion is soft-delete only (parent set to DELETED in treeManagement.js).
// The deleted-revive extension can bring them back. No hard delete on nodes.

NodeSchema.index({ parent: 1 });
NodeSchema.index({ rootOwner: 1 });
NodeSchema.index({ systemRole: 1 }, { sparse: true });

// At most one plan-type child per scope. The "plan governs work at a
// scope, branches live as siblings under that scope" rule depends on
// every walk-up primitive resolving to a SINGLE plan; two plan-type
// children at the same parent splits the system across writers in
// silent ways (contracts on one plan, steps on another, half the
// readers see one, half see the other). Database-level invariant so
// even a buggy code path that bypasses ensurePlanAtScope can't violate
// it. Partial filter limits the unique constraint to type === "plan";
// other types of siblings are unaffected.
NodeSchema.index(
  { parent: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "plan" },
    name: "unique_plan_per_scope",
  },
);

const Node = mongoose.model("Node", NodeSchema);
export default Node;
