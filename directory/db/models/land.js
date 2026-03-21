import mongoose from "mongoose";

const MetadataSchema = new mongoose.Schema(
  {
    userCount: { type: Number, default: null },
    treeCount: { type: Number, default: null },
  },
  { _id: false }
);

const LandSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  domain: { type: String, required: true, unique: true },
  name: { type: String, default: "" },
  baseUrl: { type: String, required: true },
  publicKey: { type: String, required: true },
  siteUrl: { type: String, default: null },
  protocolVersion: { type: Number, default: 1 },
  status: {
    type: String,
    enum: ["active", "degraded", "unreachable", "dead"],
    default: "active",
  },
  registeredAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  lastHealthCheck: { type: Date, default: null },
  failedChecks: { type: Number, default: 0 },
  metadata: {
    type: MetadataSchema,
    default: () => ({}),
  },
});

LandSchema.index({ status: 1 });
LandSchema.index({ domain: "text", name: "text" });

const Land = mongoose.model("Land", LandSchema);

export default Land;
