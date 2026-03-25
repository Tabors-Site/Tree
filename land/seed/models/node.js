// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const NodeSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  name: { type: String, required: true },
  type: { type: String, default: null },
  status: { type: String, default: "active" },
  dateCreated: { type: Date, default: Date.now },
  // Core LLM assignment: tree-wide default. Extension slots live in metadata.
  llmDefault: { type: String, ref: "LlmConnection", default: null },
  children: [{ type: String, ref: "Node" }],
  parent: { type: String, ref: "Node", default: null },

  rootOwner: { type: String, ref: "User", default: null }, //if null it is not a root
  contributors: [{ type: String, ref: "User" }], // Users who can contribute to this node from here on and have access to it

  // Tree visibility (core protocol, used by Canopy federation)
  visibility: {
    type: String,
    enum: ["private", "public"],
    default: "private",
  },

  // Land system nodes. If systemRole is set, node is a system node.
  systemRole: {
    type: String,
    enum: [null, "land-root", "identity", "config", "peers", "extensions", "flow"],
    default: null,
  },
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
});

// No virtuals. Extension data lives in metadata. Callers use getExtMeta/setExtMeta.
// Ownership and contributor mutations live in seed/tree/ownership.js (uses resolveTreeAccess).

// Node deletion is soft-delete only (parent set to "deleted" in treeManagement.js).
// The deleted-revive extension can bring them back. No hard delete on nodes.

NodeSchema.index({ parent: 1 });
NodeSchema.index({ rootOwner: 1 });
NodeSchema.index({ systemRole: 1 }, { sparse: true });

const Node = mongoose.model("Node", NodeSchema);
export default Node;
