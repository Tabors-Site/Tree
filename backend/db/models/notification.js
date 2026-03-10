import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const NotificationSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },

  userId: {
    type: String,
    ref: "User",
    required: true,
  },

  rootId: {
    type: String,
    ref: "Node",
    required: true,
  },

  type: {
    type: String,
    enum: ["dream-summary", "dream-thought"],
    required: true,
  },

  title: {
    type: String,
    required: true,
  },

  content: {
    type: String,
    required: true,
  },

  dreamSessionIds: [String],

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

NotificationSchema.index({ userId: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", NotificationSchema);
export default Notification;
