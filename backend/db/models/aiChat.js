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
  // Start message
  // -----------------------------------
  startMessage: {
    content: {
      type: String,
      required: true,
    },

    // ✅ FIXED: valid mongoose field
    source: {
      type: String,
      enum: ["user", "orchestrator", "subtask", "system"],
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
  // AI Context (hierarchical mode)
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
  // Contributions made during session
  // -----------------------------------
  contributions: [
    {
      type: String,
      ref: "Contribution",
    },
  ],
});

const AIChat = mongoose.model("AIChat", AIChatSchema);

export default AIChat;
