import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const UnderstandingRunSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },

  // real root node of the run
  rootNodeId: {
    type: String,
    ref: "Node",
    required: true,
  },

  // perspective for this run
  perspective: {
    type: String,
    default: "general",
    index: true,
  },

  /**
   * Map:
   * realNodeId -> understandingNodeId
   */
  nodeMap: {
    type: Map,
    of: String,
    default: {},
  },
  maxDepth: {
    type: Number,
    index: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("UnderstandingRun", UnderstandingRunSchema);
