import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const CanopyEventSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },
  targetLand: { type: String, required: true },
  type: {
    type: String,
    enum: [
      "invite_offer",
      "invite_accept",
      "invite_decline",
      "tree_update",
      "notification",
    ],
    required: true,
  },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: {
    type: String,
    enum: ["pending", "sent", "failed", "acked"],
    default: "pending",
  },
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 5 },
  lastAttemptAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

CanopyEventSchema.index({ status: 1, createdAt: 1 });
CanopyEventSchema.index({ targetLand: 1, status: 1 });
// Retention handled by kernel cleanup job (configurable via land config: canopyEventRetentionDays, 0 = forever)

const CanopyEvent = mongoose.model("CanopyEvent", CanopyEventSchema);

export default CanopyEvent;
