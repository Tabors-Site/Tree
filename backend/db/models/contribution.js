import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const ContributionSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  userId: {
    type: String,
    ref: "User",
    required: true,
  },
  nodeId: {
    type: String,
    ref: "Node",
    required: true,
  },
  action: {
    type: String,
    enum: [
      "create",
      "editStatus",
      "editValue",
      "prestige",
      "trade",
      "delete",
      "invite",
      "editSchedule",
      "editGoal",
      "transaction",
      "note",
      "updateParent",
      "editScript",
      "executeScript",
      "updateChildNode",
      "editNameNode",
      "rawIdea",
    ],
    required: true,
  },
  statusEdited: {
    type: String,
    enum: ["completed", "active", "trimmed", "divider"],
  },
  valueEdited: {
    type: Map,
    of: Number,
  },
  tradeId: {
    type: String,
    ref: "Transaction",
  },

  inviteAction: {
    type: {
      action: {
        type: String,
        enum: [
          "invite",
          "acceptInvite",
          "denyInvite",
          "removeContributor",
          "switchOwner",
        ],
      },
      receivingId: {
        type: String,
        ref: "User",
      },
      _id: false,
    },
  },

  scheduleEdited: {
    type: {
      date: {
        type: Date,
      },
      reeffectTime: {
        type: Number,
      },
      _id: false,
    },
  },

  goalEdited: {
    type: Map,
    of: Number,
  },

  noteAction: {
    type: {
      action: { type: String, enum: ["add", "remove"], default: null },
      noteId: { type: String, ref: "Note", default: null },
      _id: false,
    },
  },

  updateParent: {
    type: {
      oldParentId: { type: String, ref: "Node", default: null },
      newParentId: { type: String, ref: "Node", default: null },
      _id: false,
    },
  },
  rawIdeaAction: {
    type: {
      action: {
        type: String,
        enum: ["add", "delete", "placed"],
        required: true,
      },
      rawIdeaId: {
        type: String,
        ref: "RawIdea",
        required: true,
      },
      targetNodeId: {
        type: String,
        ref: "Node",
        default: null,
      },
      noteId: {
        type: String,
        ref: "Note",
        default: null,
      },
      _id: false,
    },
  },

  editScript: {
    type: {
      scriptName: { type: String, default: null },
      contents: { type: String, default: null },
      _id: false,
    },
  },
  executeScript: {
    type: {
      scriptName: { type: String, default: null },
      logs: {
        type: [String],
        default: [],
      },
      success: {
        type: Boolean,
        default: null,
      },
      error: {
        type: String,
        default: null,
      },
      _id: false,
    },
  },

  updateChildNode: {
    type: {
      action: { type: String, enum: ["added", "removed"], default: null },
      childId: { type: String, ref: "Node", default: null },
      _id: false,
    },
  },

  editNameNode: {
    type: {
      oldName: { type: String, default: null },
      newName: { type: String, default: null },
      _id: false,
    },
  },

  nodeVersion: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

const Contribution = mongoose.model("Contribution", ContributionSchema);

export default Contribution;
