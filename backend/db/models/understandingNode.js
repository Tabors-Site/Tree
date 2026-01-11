import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const PerspectiveStateSchema = new mongoose.Schema(
  {
    understandingRunId: {
      type: String,
      required: true,
      index: true,
    },

    perspective: {
      type: String,
      required: true,
    },

    encoding: {
      type: String,
      required: true,
    },

    currentLayer: {
      type: Number,
      required: true,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const UnderstandingNodeSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },

  realNodeId: {
    type: String,
    ref: "Node",
    unique: true,
    index: true,
  },

  parent: {
    type: String,
    ref: "UnderstandingNode",
    default: null,
  },

  children: {
    type: [String],
    ref: "UnderstandingNode",
    default: [],
  },

  // 🔑 distance from run root
  depthFromRoot: {
    type: Number,
    required: true,
    index: true,
  },

  // 🔑 max depth below this node
  subtreeHeight: {
    type: Number,
    required: true,
    index: true,
  },

  // 🔑 earliest layer where children may merge
  mergeLayer: {
    type: Number,
    required: true,
    index: true,
  },

  perspectiveStates: {
    type: Map,
    of: PerspectiveStateSchema,
    default: {},
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const UnderstandingNode = mongoose.model(
  "UnderstandingNode",
  UnderstandingNodeSchema
);
export default UnderstandingNode;
