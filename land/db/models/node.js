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
  llmDefault: { type: String, ref: "CustomLlmConnection", default: null },
  children: [{ type: String, ref: "Node" }],
  parent: { type: String, ref: "Node", default: null },

  rootOwner: { type: String, ref: "User", default: null }, //if null it is not a root
  contributors: [{ type: String, ref: "User" }], // Users who can contribute to this node from here on and have access to it

  // Canopy: tree visibility for public discovery
  visibility: {
    type: String,
    enum: ["private", "public"],
    default: "private",
  },

  // Tree Dream — daily maintenance cycle (only meaningful on root nodes)
  dreamTime: { type: String, default: null }, // "HH:MM" format, e.g. "03:00"
  lastDreamAt: { type: Date, default: null },

  // Land system nodes (Land root, .identity, .config, .peers)
  isSystem: { type: Boolean, default: false },
  systemRole: {
    type: String,
    enum: [null, "land-root", "identity", "config", "peers", "extensions"],
    default: null,
  },
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
});

// Virtual: reconstructs llmAssignments from llmDefault + metadata.llm.slots
// Extensions register slots in metadata.llm.slots (e.g. understanding, cleanup, drain)
// Core only stores the default. This virtual lets existing code read llmAssignments unchanged.
NodeSchema.virtual("llmAssignments")
  .get(function () {
    const meta = this.metadata instanceof Map ? this.metadata.get("llm") : this.metadata?.llm;
    const slots = meta?.slots || {};
    return { default: this.llmDefault, ...slots };
  })
  .set(function (v) {
    if (v.default !== undefined) this.llmDefault = v.default;
    // Store non-default slots in metadata
    const slots = {};
    for (const [key, val] of Object.entries(v)) {
      if (key !== "default") slots[key] = val;
    }
    if (Object.keys(slots).length > 0) {
      if (!this.metadata) this.metadata = new Map();
      const existing = this.metadata instanceof Map ? this.metadata.get("llm") || {} : this.metadata?.llm || {};
      existing.slots = { ...existing.slots, ...slots };
      if (this.metadata instanceof Map) {
        this.metadata.set("llm", existing);
      } else {
        this.metadata.llm = existing;
      }
      if (this.markModified) this.markModified("metadata");
    }
  });

NodeSchema.set("toJSON", { virtuals: true });
NodeSchema.set("toObject", { virtuals: true });

NodeSchema.methods.addContributor = function (userId, removerId) {
  if (!this.rootOwner)
    throw new Error("Only nodes with an rootOwner can have contributors.");

  if (this.rootOwner.toString() !== removerId) {
    throw new Error("Only the rootOwner can add contributors.");
  }
  if (!this.contributors.includes(userId)) {
    this.contributors.push(userId);
  }
};

NodeSchema.methods.removeContributor = function (userId, removerId) {
  if (
    this.rootOwner.toString() !== removerId &&
    !this.contributors.includes(removerId)
  ) {
    throw new Error(
      "Only the rootOwner or a contributor can remove contributors."
    );
  }
  this.contributors = this.contributors.filter(
    (contributor) => contributor !== userId
  );
};

NodeSchema.methods.transferOwnership = function (newOwnerId, removerId) {
  if (this.rootOwner.toString() !== removerId) {
    throw new Error("Only the rootOwner can transfer ownershup.");
  }
  if (!this.rootOwner) throw new Error("Node does not have an owner.");
  this.rootOwner = newOwnerId;
};

/*

// Method to check if the current user is allowed to modify a node (including child nodes)
NodeSchema.methods.isAllowedToModify = async function (userId) {
  if (this.rootOwner === userId) return true;

  if (this.contributors.includes(userId)) return true;

  if (this.parent) {
    const parentNode = await Node.findById(this.parent);
    return parentNode.isAllowedToModify(userId);
  }

  return false;
}; */

NodeSchema.methods.deleteWithChildrenBottomUp = async function () {
  if (this.isSystem) {
    throw new Error("System nodes cannot be deleted");
  }
  const Node = mongoose.model("Node");

  try {
    const children = await Node.find({ parent: this._id });

    for (const child of children) {
      await child.deleteOne();
    }

    if (this.parent) {
      const parentNode = await Node.findById(this.parent);
      if (parentNode) {
        parentNode.children = parentNode.children.filter(
          (childId) => childId !== this._id
        );
        await parentNode.save(); // persist the changes (removes the child reference)
      }
    }

    await this.deleteOne();

    if (this.parent) {
      const parentNode = await Node.findById(this.parent);
      if (parentNode) {
        await parentNode.save();
      }
    }
  } catch (error) {
    console.error(
      `Error in deleteWithChildrenBottomUp for node ${this._id}:`,
      error
    );
    throw error;
  }
};

//attach the delete script whenever a node is deleted
NodeSchema.pre("findOneAndDelete", async function (next) {
  const Node = mongoose.model("Node");

  const nodeId = this.getQuery()._id;
  const node = await Node.findById(nodeId);

  if (node) {
    await node.deleteWithChildrenBottomUp();
  }

  next();
});

const Node = mongoose.model("Node", NodeSchema);
export default Node;
