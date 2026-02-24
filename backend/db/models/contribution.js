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
  },
  wasAi: {
    type: Boolean,
    default: false,
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
      "branchLifecycle",
      "understanding",

      "purchase",
    ],
    required: true,
  },
  energyUsed: {
    type: Number,
    //required: true,
    min: 0,
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
      action: { type: String, enum: ["add", "remove", "edit"], default: null },
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
        enum: ["add", "delete", "placed", "aiStarted", "aiFailed"],
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
      scriptId: {
        type: String,
        required: true,
      },
      contents: { type: String, default: null },
      _id: false,
    },
  },
  executeScript: {
    type: {
      scriptId: {
        type: String,
        required: true,
      },
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
  branchLifecycle: {
    type: {
      action: {
        type: String,
        enum: ["retired", "revived", "revivedAsRoot"],
        required: true,
      },
      fromParentId: {
        type: String,
        ref: "Node",
      },
      toParentId: {
        type: String,
        ref: "Node",
      },
      _id: false,
    },
  },
  transactionMeta: {
    type: {
      /** What happened globally */
      event: {
        type: String,
        enum: [
          // lifecycle
          "created",
          "approved",
          "denied",
          "execution_started",
          "succeeded",
          "failed",

          // ✅ policy / system resolution
          "accepted_by_policy",
          "rejected_by_policy",
        ],
        required: true,
      },

      /** This contribution’s point of view */
      side: {
        type: String,
        enum: ["A", "B"],
        required: true,
      },

      /** How this node participated in the event */
      role: {
        type: String,
        enum: [
          // human roles
          "proposer",
          "approver",
          "denier",
          "sender",
          "receiver",
          "counterparty",

          // ✅ system-generated
          "system",
        ],
        required: true,
      },

      /** The other node (if any) */
      counterpartyNodeId: {
        type: String,
        ref: "Node",
        default: null,
      },

      /** Versions involved */
      versionSelf: {
        type: Number,
        required: true,
        min: 0,
      },

      versionCounterparty: {
        type: Number,
        min: 0,
        default: null,
      },

      /** Value deltas from THIS node’s perspective */
      valuesSent: {
        type: Map,
        of: Number,
      },

      valuesReceived: {
        type: Map,
        of: Number,
      },

      /** Failure diagnostics (only for failed) */
      failureReason: {
        type: String,
      },

      /** Who caused this event (important for approvals / denials) */
      actorUserId: {
        type: String,
        ref: "User",
        required: true,
      },

      _id: false,
    },
  },
  purchaseMeta: {
    type: {
      /* ===============================
        STRIPE IDENTITY (IDEMPOTENCY)
      =============================== */

      stripeSessionId: {
        type: String,
      },

      paymentIntentId: {
        type: String,
        default: null,
      },

      stripeEventId: {
        type: String,
        default: null,
      },

      /* ===============================
        PURCHASE SNAPSHOT
      =============================== */

      plan: {
        type: String,
        enum: ["basic", "standard", "premium", null],
        default: null,
      },

      energyAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalCents: {
        type: Number,
        default: 0,
        min: 0,
      },

      currency: {
        type: String,
        default: "usd",
      },

      _id: false,
    },
  },
  understandingMeta: {
    type: {
      stage: {
        type: String,
        enum: ["createRun", "processStep"],
        required: true,
      },

      understandingRunId: {
        type: String,
        ref: "UnderstandingRun",
        required: true,
      },

      // optional depending on stage
      understandingNodeId: {
        type: String,
        ref: "UnderstandingNode",
      },
      rootNodeId: { type: String, ref: "Node" },

      nodeCount: { type: Number }, // for createRun
      layer: { type: Number }, // for processStep
      mode: { type: String, enum: ["leaf", "merge"] },

      perspective: { type: String },
    },

    _id: false,
  },
});

const Contribution = mongoose.model("Contribution", ContributionSchema);

export default Contribution;
