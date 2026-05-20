// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// LlmConnection — a Being's stored LLM endpoint configuration.
// Referenced by Being.llmDefault, Space.llmDefault, and per-slot
// metadata via the LLM resolution chain (Space → Being → land
// defaults). See seed/cognition/connections.js for CRUD + the
// AES-256-CBC encryption of the api key.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const LlmConnectionSchema = new mongoose.Schema(
  {
    _id:     { type: String, default: uuidv4 },
    beingId: { type: String, ref: "Being", required: true, index: true },
    name:    { type: String, required: true, trim: true, maxlength: 100 },
    baseUrl: { type: String, required: true, trim: true },

    // Local LLMs (Ollama, llama.cpp) often need no auth. When present,
    // encrypted with AES-256-CBC in seed/cognition/connections.js; the
    // plaintext never persists.
    encryptedApiKey: { type: String, default: null },

    model:      { type: String, required: true, trim: true },
    lastUsedAt: { type: Date,   default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

// SSRF defense: baseUrl validated against blocked hosts / IPs at
// creation and at request time. Hosts in the land config's
// `allowedLlmDomains` list bypass the private-IP block — the explicit
// opt-in for LAN-hosted LLMs. maxConnectionsPerUser (land config,
// default 15) checked in addLlmConnection.

const LlmConnection = mongoose.model("LlmConnection", LlmConnectionSchema, "customllmconnections");
export default LlmConnection;
