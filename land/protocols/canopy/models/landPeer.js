import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const UptimeEntrySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    checks: { type: Number, default: 0 },
    successes: { type: Number, default: 0 },
  },
  { _id: false }
);

const RateLimitsSchema = new mongoose.Schema(
  {
    requestsPerMinute: { type: Number, default: 1000 },
    requestsPerUserPerMinute: { type: Number, default: 60 },
  },
  { _id: false }
);

const LandPeerSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },
  domain: { type: String, required: true, unique: true },
  baseUrl: { type: String, default: null }, // full URL with protocol, e.g. https://my-land.com or http://localhost:3001
  landId: { type: String, required: true },
  publicKey: { type: String, required: true },
  protocolVersion: { type: Number, default: 1 },
  seedVersion: { type: String, default: null },
  name: { type: String, default: "" },
  lastSeenAt: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["active", "degraded", "unreachable", "dead", "blocked"],
    default: "active",
  },
  consecutiveFailures: { type: Number, default: 0 },
  firstFailureAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: Date.now },
  uptimeHistory: {
    type: [UptimeEntrySchema],
    default: [],
  },
  rateLimits: {
    type: RateLimitsSchema,
    default: () => ({
      requestsPerMinute: 1000,
      requestsPerUserPerMinute: 60,
    }),
  },
  extensions: { type: [String], default: [] },
  registeredAt: { type: Date, default: Date.now },
});

LandPeerSchema.index({ status: 1 });

const LandPeer = mongoose.model("LandPeer", LandPeerSchema);

export default LandPeer;
