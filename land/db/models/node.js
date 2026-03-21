import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const NodeSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  name: { type: String, required: true },
  type: { type: String, default: null },
  prestige: { type: Number, default: 0 },
  versions: [
    {
      _id: false,
      prestige: { type: Number, required: true },
      values: { type: Map, of: Number, default: {} },
      status: { type: String, default: "active" },
      dateCreated: { type: Date, default: Date.now },
      schedule: { type: Date, default: null },
      reeffectTime: { type: Number, default: 0 },
      goals: { type: Map, of: Number, default: {} },

      wallet: {
        publicKey: { type: String, default: null },
        encryptedPrivateKey: {
          iv: String,
          tag: String,
          data: String,
        },
        createdAt: { type: Date, default: null },
      },
    },
  ],
  scripts: {
    type: [
      {
        _id: {
          type: String,
          default: uuidv4,
        },
        name: { type: String, required: true },
        script: { type: String },
      },
    ],
    default: [],
  },
  transactionPolicy: {
    type: String,
    enum: ["OWNER_ONLY", "ANYONE", "MAJORITY", "ALL"],
    default: "OWNER_ONLY",
  },
  llmAssignments: {
    placement: { type: String, ref: "CustomLlmConnection", default: null },
    understanding: { type: String, ref: "CustomLlmConnection", default: null },
    respond: { type: String, ref: "CustomLlmConnection", default: null },
    notes: { type: String, ref: "CustomLlmConnection", default: null },
    cleanup: { type: String, ref: "CustomLlmConnection", default: null },
    drain: { type: String, ref: "CustomLlmConnection", default: null },
    notification: { type: String, ref: "CustomLlmConnection", default: null },
  },
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
    enum: [null, "land-root", "identity", "config", "peers"],
    default: null,
  },
  metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
});

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
