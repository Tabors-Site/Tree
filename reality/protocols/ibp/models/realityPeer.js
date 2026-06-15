import mongoose from "mongoose";
import { randomUUID as uuidv4 } from "node:crypto";

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

const RealityPeerSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },
  domain: { type: String, required: true, unique: true },
  baseUrl: { type: String, default: null }, // full URL with protocol, e.g. https://my-place.com or http://localhost:3001
  realityId: { type: String, required: true },
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
  // Strict envelope mode. When true, every cross-reality envelope from
  // this peer must carry the acting being's own verified signature; the
  // unsigned-advisory floor (peer-reality vouch alone) is refused. Turn
  // on for peers known to run a signing seed.
  requireSignedEnvelopes: { type: Boolean, default: false },
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

RealityPeerSchema.index({ status: 1 });

const RealityPeer = mongoose.model("RealityPeer", RealityPeerSchema);

export default RealityPeer;
