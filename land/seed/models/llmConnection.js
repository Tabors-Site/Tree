// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const LlmConnectionSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    beingId: { type: String, ref: "Being", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    baseUrl: { type: String, required: true, trim: true },
    // Optional: local LLMs (Ollama, llama.cpp) often need no auth. When
    // present, encrypted with AES-256-CBC (seed/llm/connections.js).
    encryptedApiKey: { type: String, default: null },
    model: { type: String, required: true, trim: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// SSRF: baseUrl validated against blocked hosts/IPs. Hosts in the
// `allowedLlmDomains` land-config list bypass the private-IP block —
// that's the explicit opt-in for LAN-hosted LLMs.
// maxConnectionsPerUser (config, default 15) checked in addLlmConnection.
// DNS resolved and validated at both creation and request time.

const LlmConnection = mongoose.model("LlmConnection", LlmConnectionSchema, "customllmconnections");
export default LlmConnection;
