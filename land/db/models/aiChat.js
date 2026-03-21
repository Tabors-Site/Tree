import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const AIChatSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },

  // -----------------------------------
  // Who owns the AI session
  // -----------------------------------
  userId: {
    type: String,
    ref: "User",
    required: true,
    index: true,
  },

  // -----------------------------------
  // Session grouping (links the full chain)
  // -----------------------------------
  sessionId: {
    type: String,
    required: true,
    index: true,
  },

  // -----------------------------------
  // Chain position (order within session)
  // -----------------------------------
  chainIndex: {
    type: Number,
    default: 0,
  },

  // -----------------------------------
  // Links steps back to their root chat (chainIndex 0)
  // Root records set this to their own _id
  // -----------------------------------
  rootChatId: {
    type: String,
    default: null,
    index: true,
  },

  // -----------------------------------
  // Start message
  // -----------------------------------
  startMessage: {
    content: {
      type: String,
      required: true,
    },

    // "user" = human typed it
    // "api"  = external API call
    // "orchestrator" = orchestrator generated this call
    // "script" = automated trigger from note/script
    source: {
      type: String,
      enum: ["user", "api", "orchestrator", "background", "script", "system", "gateway"],
      default: "user",
      required: true,
    },

    time: {
      type: Date,
      default: Date.now,
      required: true,
    },

    _id: false,
  },

  // -----------------------------------
  // End message from AI
  // -----------------------------------
  endMessage: {
    content: {
      type: String,
      default: null,
    },
    time: {
      type: Date,
      default: null,
    },
    stopped: {
      type: Boolean,
      default: false,
    },
    _id: false,
  },

  // -----------------------------------
  // AI Context (which mode handled this)
  // -----------------------------------
  aiContext: {
    path: {
      type: String,
      default: "home:default",
      index: true,
    },

    layers: {
      type: [String],
      default: ["home", "default"],
    },

    _id: false,
  },

  // -----------------------------------
  // Tree orchestrator context (only in tree mode)
  // Tracks where navigation landed and plan metadata
  // -----------------------------------
  treeContext: {
    // The node navigator resolved to for this step
    targetNodeId: {
      type: String,
      ref: "Node",
    },
    targetNodeName: String,
    targetPath: String,

    // Plan step metadata
    planStepIndex: Number,
    planTotalSteps: Number,
    directive: String,

    // Execution result
    stepResult: {
      type: String,
      enum: ["success", "failed", "skipped", "pending"],
    },
    resultDetail: String,

    _id: false,
  },

  // -----------------------------------
  // LLM provider info
  // -----------------------------------
  llmProvider: {
    isCustom: {
      type: Boolean,
      default: false,
    },
    model: {
      type: String,
      default: null,
    },
    connectionId: {
      type: String,
      ref: "CustomLlmConnection",
      default: null,
    },
    _id: false,
  },

  // -----------------------------------
  // Contributions made during this call
  // -----------------------------------
  contributions: [
    {
      type: String,
      ref: "Contribution",
    },
  ],
});

// Query all steps in a chain
AIChatSchema.index({ sessionId: 1, chainIndex: 1 });

// Query by target node (sparse — most home-mode chats lack this field)
AIChatSchema.index({ "treeContext.targetNodeId": 1 }, { sparse: true });

const AIChat = mongoose.model("AIChat", AIChatSchema);

export default AIChat;
