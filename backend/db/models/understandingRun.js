import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const RunNodeTopologySchema = new mongoose.Schema(
  {
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

    depthFromRoot: {
      type: Number,
      required: true,
    },

    subtreeHeight: {
      type: Number,
      required: true,
    },

    mergeLayer: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
);

const UnderstandingRunSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },

  // real root node
  rootNodeId: {
    type: String,
    ref: "Node",
    required: true,
  },

  perspective: {
    type: String,
    default: "general",
  },

  /**
   * realNodeId -> understandingNodeId
   */
  nodeMap: {
    type: Map,
    of: String,
  },
  pendingMerge: {
    type: Object,
    default: null,
  },

  /**
   * understandingNodeId -> topology
   */
  topology: {
    type: Map,
    of: RunNodeTopologySchema,
    default: {},
  },

  maxDepth: {
    type: Number,
    index: true,
  },
  userId: {
    type: String,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("UnderstandingRun", UnderstandingRunSchema);
