const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

// Define the Contribution schema
const ContributionSchema = new mongoose.Schema({
  _id: {
    type: String, 
    default: uuidv4,
  },
  userId: {
    type: String,
    ref: "User",
    required: true, // Reference to the user contributing
  },
  nodeId: {
    type: String,
    ref: "Node",
    required: true, // Reference to the node being contributed to
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
      "transaction"
    ],
    required: true, 
  },
  statusEdited: {
    type: String,
    enum: ["completed", "active", "trimmed", "divider"],
    default: null,
  },
  valueEdited: {
    type: Map,
    of: Number,
    default: null,
  },
  tradeId: {
    type: String,
    ref: "Transaction",
    default: null,
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
        default: null,
      },
      receivingId: {
        type: String,
        ref: "User", // Reference to the user receiving the invite
        default: null, 
      },
    },
    default: null, 
  },
  scheduleEdited: {
    type: {
      date: {
        type: Date,
        default: null, 
      },
      reeffectTime: {
        type: Number,
        default: null, 
      },
    },
    default: null, 
  },
  goalEdited: {
    type: Map,
    of: Number,
    default: null,
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

module.exports = Contribution;
