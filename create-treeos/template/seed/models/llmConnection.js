// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const LlmConnectionSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    userId: { type: String, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    baseUrl: { type: String, required: true, trim: true },
    encryptedApiKey: { type: String, required: true },
    model: { type: String, required: true, trim: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// API key encrypted with AES-256-CBC (seed/llm/connections.js).
// SSRF: baseUrl validated against blocked hosts/IPs. Admin users bypass for local LLMs.
// maxConnectionsPerUser (config, default 15) checked in addLlmConnection.
// DNS resolved and validated at both creation and request time.

const LlmConnection = mongoose.model("LlmConnection", LlmConnectionSchema, "customllmconnections");
export default LlmConnection;
