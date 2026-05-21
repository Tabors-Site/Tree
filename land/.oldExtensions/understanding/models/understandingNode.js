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
      default: "",
    },

    currentLayer: {
      type: Number,
      required: true,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },

    contributionSnapshot: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

const UnderstandingNodeSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },

  // canonical link to real node
  realNodeId: {
    type: String,
    ref: "Node",
    unique: true,
    index: true,
    required: true,
  },

  /**
   * Run-specific semantic state
   * Map<understandingRunId, PerspectiveState>
   */
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

export default mongoose.model("UnderstandingNode", UnderstandingNodeSchema);
