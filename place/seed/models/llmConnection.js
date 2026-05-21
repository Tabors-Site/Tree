// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// LlmConnection. A being's LLM endpoint, remembered.
//
// I am model-agnostic. Every place brings its own LLMs and every
// being can carry their own connections; the kernel only needs the
// endpoint, model name, and an optional API key to talk to anything
// that speaks the OpenAI-compatible shape. This row is one such
// configuration on a being's behalf.
//
// Referenced by Being.llmDefault, Space.llmDefault, and per-slot
// assignments under qualities. The resolution chain in
// seed/cognition/llmClient.js walks space-tree → being → place to
// pick which connection drives any given LLM call.
//
// What this schema fixes:
//
//   owner       `beingId` — connections belong to a being, never
//               float free
//   identity    `name` — a human-readable label for the being's UI
//   endpoint    `baseUrl` — the OpenAI-compatible API base
//   secret      `encryptedApiKey` — optional; local LLMs (Ollama,
//               llama.cpp) often need no auth. When present, the
//               key is AES-256-CBC encrypted by
//               seed/cognition/connections.js; the plaintext never
//               persists.
//   model       `model` — the model name the endpoint expects
//   usage       `lastUsedAt` — for housekeeping and operator views
//
// SSRF defense lives in connections.js: baseUrl is validated against
// blocked hosts / IPs at creation and at request time. Hosts in the
// place's `allowedLlmDomains` list bypass the private-IP block — the
// explicit opt-in for LAN-hosted LLMs. `maxConnectionsPerUser` (place
// config) caps how many a being can hold.

const LlmConnection = mongoose.model("LlmConnection", LlmConnectionSchema, "customllmconnections");
export default LlmConnection;
