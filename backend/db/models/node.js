import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const NodeSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  name: { type: String, required: true },
  type: { type: String, default: null },
  prestige: { type: Number, default: 0 },
  globalValues: { type: Map, of: Number, default: {} },
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
    },
  ],
  scripts: {
    type: [
      {
        _id: false,
        name: { type: String, required: true },
        script: { type: String, required: true },
      },
    ],
    default: [],
  },
  children: [{ type: String, ref: "Node" }],
  parent: { type: String, ref: "Node", default: null },

  rootOwner: { type: String, ref: "User", default: null }, //if null it is not a root
  contributors: [{ type: String, ref: "User" }], // Users who can contribute to this node from here on and have access to it
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

//update parent values from children when values are modified
NodeSchema.methods.updateGlobalValues = async function () {
  const Node = mongoose.model("Node");

  const localValues = new Map();
  this.versions.forEach((version) => {
    version.values.forEach((value, key) => {
      localValues.set(key, (localValues.get(key) || 0) + value);
    });
  });

  const children = await Node.find({ parent: this._id });
  const childValues = new Map();
  for (const child of children) {
    child.globalValues.forEach((value, key) => {
      childValues.set(key, (childValues.get(key) || 0) + value);
    });
  }

  const newGlobalValues = new Map(localValues);
  childValues.forEach((value, key) => {
    newGlobalValues.set(key, (newGlobalValues.get(key) || 0) + value);
  });

  const previousGlobalValues = this.globalValues || new Map();
  this.globalValues = newGlobalValues;

  const netChanges = new Map();
  newGlobalValues.forEach((value, key) => {
    const previousValue = previousGlobalValues.get(key) || 0;
    const diff = value - previousValue;
    if (diff !== 0) {
      netChanges.set(key, diff);
    }
  });
  previousGlobalValues.forEach((value, key) => {
    if (!newGlobalValues.has(key)) {
      netChanges.set(key, -value);
    }
  });

  let currentNetChanges = netChanges;
  let currentNode = this;

  while (currentNode.parent) {
    const parentNode = await Node.findById(currentNode.parent);

    if (!parentNode) {
      console.error(`Parent node not found for node: ${currentNode._id}`);
      break;
    }

    const newParentValues = new Map(parentNode.globalValues || new Map());
    currentNetChanges.forEach((change, key) => {
      const previousValue = newParentValues.get(key) || 0;
      const newValue = previousValue + change;

      if (newValue === 0) {
        newParentValues.delete(key);
      } else {
        newParentValues.set(key, newValue);
      }
    });

    parentNode.globalValues = newParentValues;
    await parentNode.save();


    // Prepare the changes for the next parent
    currentNode = parentNode;
  }
};
NodeSchema.pre("save", async function (next) {
  if (this.isModified("versions")) {
    await this.updateGlobalValues();
  }
  next();
});

NodeSchema.methods.deleteWithChildrenBottomUp = async function () {
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
        await parentNode.updateGlobalValues();

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
