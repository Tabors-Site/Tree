import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const GatewayChannelSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },

    userId: {
      type: String,
      ref: "User",
      required: true,
      index: true,
    },

    rootId: {
      type: String,
      ref: "Node",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    type: {
      type: String,
      enum: ["telegram", "discord", "webapp"],
      required: true,
    },

    direction: {
      type: String,
      enum: ["input", "input-output", "output"],
      default: "output",
    },

    mode: {
      type: String,
      enum: ["read", "read-write", "write"],
      default: "write",
    },

    enabled: {
      type: Boolean,
      default: true,
    },

    config: {
      encryptedPayload: { type: String, default: null },
      displayIdentifier: { type: String, default: null },
      metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    },

    notificationTypes: {
      type: [String],
      default: ["dream-summary", "dream-thought"],
    },

    lastDispatchAt: {
      type: Date,
      default: null,
    },

    lastError: {
      type: String,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

GatewayChannelSchema.index({ rootId: 1, type: 1 });

const GatewayChannel = mongoose.model("GatewayChannel", GatewayChannelSchema);
export default GatewayChannel;
