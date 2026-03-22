import crypto from "node:crypto";
import mongoose from "mongoose";

const PublicTreeSchema = new mongoose.Schema({
  _id: { type: String, default: () => crypto.randomUUID() },
  rootId: { type: String, required: true },
  landId: { type: String, required: true },
  landDomain: { type: String, required: true },
  name: { type: String, default: "" },
  description: { type: String, default: "" },
  ownerUsername: { type: String, default: "" },
  tags: { type: [String], default: [] },
  nodeCount: { type: Number, default: 0 },
  queryAvailable: { type: Boolean, default: false },
  lastUpdated: { type: Date, default: Date.now },
  indexedAt: { type: Date, default: Date.now },
});

PublicTreeSchema.index({ rootId: 1, landDomain: 1 }, { unique: true });
PublicTreeSchema.index({ name: "text", description: "text", tags: "text" });

const PublicTree = mongoose.model("PublicTree", PublicTreeSchema);

export default PublicTree;
