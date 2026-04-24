// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// ws/mcp.js
// MCP client lifecycle management.
// Each ai-chat session key (see seed/llm/sessionKeys.js) gets one MCP
// client. Clients are reused across messages within the same session.
// Cleanup happens on socket disconnect, session end, or periodic sweep.

import log from "../log.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";

// ─────────────────────────────────────────────────────────────────────────
// CLIENT MAP
// ─────────────────────────────────────────────────────────────────────────

// aiSessionKey -> MCP Client instance
export const mcpClients = new Map();

// aiSessionKey -> jwtToken (separate from SDK client to avoid mutating it)
const clientTokens = new Map();

// aiSessionKey -> timestamp of last use
const clientLastUsed = new Map();

import { getLandConfigValue } from "../landConfig.js";

function MAX_MCP_CLIENTS() { return Math.max(100, Math.min(Number(getLandConfigValue("maxMcpClients")) || 5000, 50000)); }
const MCP_CLOSE_TIMEOUT_MS = 5000; // safety ceiling, not configurable

// Configurable via land config, read at use time
function mcpConnectTimeout() { return Number(getLandConfigValue("mcpConnectTimeout")) || 10000; }
function mcpStaleMs() { return Number(getLandConfigValue("mcpStaleTimeout")) || 3600000; }

// ─────────────────────────────────────────────────────────────────────────
// CONNECT
// ─────────────────────────────────────────────────────────────────────────

export async function connectToMCP(serverUrl, aiSessionKey, jwtToken) {
  // Reuse existing client if token matches
  const existing = mcpClients.get(aiSessionKey);
  if (existing && clientTokens.get(aiSessionKey) === jwtToken) {
    clientLastUsed.set(aiSessionKey, Date.now());
    return existing;
  }

  // Close stale client if token changed
  if (existing) {
    await closeMCPClient(aiSessionKey);
  }

  // Cap: evict oldest client if at limit
  if (mcpClients.size >= MAX_MCP_CLIENTS()) {
    let oldestId = null, oldestTime = Infinity;
    for (const [id, ts] of clientLastUsed) {
      if (ts < oldestTime) { oldestTime = ts; oldestId = id; }
    }
    if (oldestId) {
      log.debug("MCP", `Evicting oldest MCP client: ${oldestId}`);
      await closeMCPClient(oldestId);
    }
  }

  log.verbose("MCP", `Connecting MCP client for ${aiSessionKey}...`);

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: {
      headers: {
        "x-internal-token": jwtToken,
        "x-internal-request": "mcp",
      },
    },
  });

  const client = new Client(
    { name: "tree-chat-client", version: "1.0.0" },
    { capabilities: { sampling: {} } },
  );

  // Connect with timeout. If the MCP server is unreachable, fail fast
  // instead of blocking the conversation loop indefinitely.
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("MCP connect timed out")), mcpConnectTimeout())
      ),
    ]);
  } catch (err) {
    // Clean up the transport on failure
    try { if (transport.close) await transport.close(); } catch {}
    throw new Error(`MCP connection failed: ${err.message}`);
  }

  log.verbose("MCP", `MCP client connected for ${aiSessionKey}`);

  mcpClients.set(aiSessionKey, client);
  clientTokens.set(aiSessionKey, jwtToken);
  clientLastUsed.set(aiSessionKey, Date.now());
  return client;
}

// ─────────────────────────────────────────────────────────────────────────
// CLOSE
// ─────────────────────────────────────────────────────────────────────────

export async function closeMCPClient(aiSessionKey) {
  const client = mcpClients.get(aiSessionKey);
  mcpClients.delete(aiSessionKey);
  clientTokens.delete(aiSessionKey);
  clientLastUsed.delete(aiSessionKey);

  if (!client) return;

  try {
    // Close with timeout. Broken transports can hang on close.
    const closePromise = typeof client.close === "function"
      ? client.close()
      : (client.transport?.close ? client.transport.close() : Promise.resolve());

    await Promise.race([
      closePromise,
      new Promise((resolve) => setTimeout(resolve, MCP_CLOSE_TIMEOUT_MS)),
    ]);
    log.debug("MCP", `Closed MCP client for ${aiSessionKey}`);
  } catch (err) {
    log.warn("MCP", `Error closing MCP client for ${aiSessionKey}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY
// ─────────────────────────────────────────────────────────────────────────

export function getMCPClient(aiSessionKey) {
  const client = mcpClients.get(aiSessionKey);
  if (client) clientLastUsed.set(aiSessionKey, Date.now());
  return client || null;
}

// ─────────────────────────────────────────────────────────────────────────
// PERIODIC SWEEP: close clients that haven't been used in 1 hour.
// Safety net for violent disconnects where the cleanup handler never fires.
// ─────────────────────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  let swept = 0;
  for (const [aiSessionKey, lastUsed] of clientLastUsed) {
    if (now - lastUsed > mcpStaleMs()) {
      closeMCPClient(aiSessionKey).catch(() => {});
      swept++;
    }
  }
  if (swept > 0) {
    log.debug("MCP", `Swept ${swept} stale MCP client(s) (${mcpClients.size} remaining)`);
  }
}, 15 * 60 * 1000).unref(); // every 15 minutes

export { MCP_SERVER_URL };
