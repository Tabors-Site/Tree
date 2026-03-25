import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const RemoteUserSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },
  username: { type: String, required: true },
  homeLandDomain: { type: String, required: true },
  displayName: { type: String, default: "" },
  lastSyncedAt: { type: Date, default: Date.now },
});

RemoteUserSchema.index({ homeLandDomain: 1, username: 1 }, { unique: true });

const RemoteUser = mongoose.model("RemoteUser", RemoteUserSchema);

export default RemoteUser;
