import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const ShortMemorySchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  rootId: {
    type: String,
    ref: "Node",
    required: true,
  },
  userId: {
    type: String,
    ref: "User",
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  systemResponse: {
    type: String,
    default: null,
  },
  sessionId: {
    type: String,
    default: null,
  },
  candidates: [
    {
      _id: false,
      nodeId: { type: String },
      nodePath: { type: String },
      confidence: { type: Number },
      reasoning: { type: String },
    },
  ],
  deferReason: {
    type: String,
    default: null,
  },
  classificationAxes: {
    pathConfidence: { type: Number, default: null },
    domainNovelty: { type: Number, default: null },
    relationalComplexity: { type: Number, default: null },
  },
  sourceType: {
    type: String,
    enum: ["tree-chat", "tree-place", "tree-query", "ws-tree-place", "ws-tree-query", "ws-tree-chat", "raw-idea-chat", "raw-idea-place", "gateway-telegram", "gateway-discord"],
    required: true,
  },
  sourceId: {
    type: String,
    default: null,
  },
  drainAttempts: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ["pending", "placed", "dismissed", "escalated"],
    default: "pending",
  },
  placedAt: {
    type: Date,
    default: null,
  },
  placedNodeId: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

ShortMemorySchema.index({ rootId: 1, status: 1 });
ShortMemorySchema.index({ userId: 1, status: 1 });

const ShortMemory = mongoose.model("ShortMemory", ShortMemorySchema);
export default ShortMemory;
