import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const ApprovalGroupSchema = new mongoose.Schema(
  {
    rootId: {
      type: String,
      ref: "Node",
      required: true,
    },

    side: {
      type: String,
      enum: ["A", "B"],
      required: true,
    },
    policy: {
      type: String,
      enum: ["OWNER_ONLY", "ANYONE", "MAJORITY", "ALL"],
      required: true,
    },

    eligibleApprovers: [
      {
        type: String,
        ref: "User",
        required: true,
      },
    ],

    requiredApprovals: {
      type: Number,
      required: true,
    },

    approvals: [
      {
        userId: { type: String, ref: "User", required: true },
        approvedAt: { type: Date, default: Date.now },
      },
    ],
    denials: [
      {
        userId: { type: String, ref: "User", required: true },
        deniedAt: { type: Date, default: Date.now },
      },
    ],

    resolved: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const TransactionSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    sideA: {
      kind: { type: String, enum: ["NODE", "OUTSIDE"], required: true },
      nodeId: {
        type: String,
        ref: "Node",
        required: function () {
          return this.sideA.kind === "NODE";
        },
      },
      sourceType: {
        type: String,
        enum: ["SOLANA"], // extend later
      },
      sourceId: String,
    },

    sideB: {
      kind: { type: String, enum: ["NODE", "OUTSIDE"], required: true },
      nodeId: {
        type: String,
        ref: "Node",
        required: function () {
          return this.sideB.kind === "NODE";
        },
      },
      sourceType: String,
      sourceId: String,
    },

    versionAIndex: Number,
    versionBIndex: Number,

    valuesTraded: {
      sideA: { type: Map, of: Number },
      sideB: { type: Map, of: Number },
    },

    approvalGroups: {
      type: [ApprovalGroupSchema],
      default: [],
    },

    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
      index: true,
    },

    executedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const Transaction = mongoose.model("Transaction", TransactionSchema);
export default Transaction;
