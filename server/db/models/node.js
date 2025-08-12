const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");


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
      prestige: { type: Number, required: true },
      values: { type: Map, of: Number, default: {} },
      status: { type: String, default: "active" },
      dateCreated: { type: Date, default: Date.now },
      schedule: { type: Date, default: null },
      reeffectTime: { type: Number, default: 0 },
      goals: { type: Map, of: Number, default: {} },
    },
  ],
  children: [{ type: String, ref: "Node" }],
  parent: { type: String, ref: "Node", default: null },

  rootOwner: { type: String, ref: "User", default: null }, //if null it is not a root
  contributors: [{ type: String, ref: "User" }], // Users who can contribute to this node from here on and have access to it
});

// Method to add contributors to a node
NodeSchema.methods.addContributor = function (userId, removerId) {
  if (!this.rootOwner)
    throw new Error("Only nodes with an rootOwner can have contributors.");
  // Check if the current user is the rootOwner
  if (this.rootOwner.toString() !== removerId) {
    throw new Error("Only the rootOwner can add contributors.");
  }
  if (!this.contributors.includes(userId)) {
    this.contributors.push(userId);
  }
};

NodeSchema.methods.removeContributor = function (userId, removerId) {
  // Check if the remover is either the rootOwner or a contributor
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

// Method to transfer rootOwnership of a node
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
  // rootOwner can always modify their nodes
  if (this.rootOwner === userId) return true;

  // Contributors can modify their assigned nodes
  if (this.contributors.includes(userId)) return true;

  // If the node has a parent, check if the parent grants modification rights
  if (this.parent) {
    const parentNode = await Node.findById(this.parent);
    return parentNode.isAllowedToModify(userId);
  }

  // Otherwise, deny modification
  return false;
}; */

//update parent values from children when values are modified
NodeSchema.methods.updateGlobalValues = async function () {
  const Node = mongoose.model("Node"); // Avoid circular dependency

  // Step 1: Aggregate values from all versions of the current node
  const localValues = new Map();
  this.versions.forEach((version) => {
    version.values.forEach((value, key) => {
      localValues.set(key, (localValues.get(key) || 0) + value);
    });
  });

  // Step 2: Include contributions from child nodes (globalValues)
  const children = await Node.find({ parent: this._id });
  const childValues = new Map();
  for (const child of children) {
    child.globalValues.forEach((value, key) => {
      childValues.set(key, (childValues.get(key) || 0) + value);
    });
  }

  // Step 3: Compute the current node's globalValues as the sum of localValues + childValues
  const newGlobalValues = new Map(localValues);
  childValues.forEach((value, key) => {
    newGlobalValues.set(key, (newGlobalValues.get(key) || 0) + value);
  });

  // Step 4: Update this node's globalValues
  const previousGlobalValues = this.globalValues || new Map();
  this.globalValues = newGlobalValues;

  // Step 5: Calculate the net difference to propagate upwards
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
      netChanges.set(key, -value); // Remove values no longer present
    }
  });

  // Step 6: Propagate changes to the parent
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

    //console.log(`Updated parent node ${parentNode._id} globalValues:`, parentNode.globalValues);

    // Prepare the changes for the next parent
    currentNode = parentNode;
  }
};
//attach the modification to happen anytime a node is saved
NodeSchema.pre("save", async function (next) {
  if (this.isModified("versions")) {
    await this.updateGlobalValues();
  }
  next();
});

NodeSchema.methods.deleteWithChildrenBottomUp = async function () {
  const Node = mongoose.model("Node");

  try {


    // Step 1: Collect all child nodes of the current node
    const children = await Node.find({ parent: this._id });

    // Step 2: Delete all child nodes (separately in a loop)
    for (const child of children) {

      await child.deleteOne();
    }

    // Step 3: Remove reference from the parent node's `children` array
    if (this.parent) {
      const parentNode = await Node.findById(this.parent);
      if (parentNode) {
    
        parentNode.children = parentNode.children.filter(
          (childId) => childId !== this._id
        );
        await parentNode.save(); // Persist the changes (removes the child reference)
      }
    }

    // Step 3: Delete the current node

    await this.deleteOne();

    // Step 4: Update global values on the parent node (after all deletions)
    if (this.parent) {
      const parentNode = await Node.findById(this.parent);
      if (parentNode) {
      
        await parentNode.updateGlobalValues();

        await parentNode.save(); // Persist the changes
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

  // Find the node being deleted
  const nodeId = this.getQuery()._id;
  const node = await Node.findById(nodeId);

  if (node) {
    // Trigger cascading collection and deletion
    //update transaction to replace with null

    await node.deleteWithChildrenBottomUp();
  }

  next(); // Proceed with the original delete operation
});

const Node = mongoose.model("Node", NodeSchema);
module.exports = Node;
