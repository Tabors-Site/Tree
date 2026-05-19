// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// MCP client lifecycle.
//
// Outbound MCP connections — what the AI runtime uses when an LLM tool
// call resolves to an MCP server. Lives in seed/llm/ because the
// connection cache is per-conversation LLM-stack state.
//
// Each conversation gets one MCP client. The cache key — `cacheKey` —
// identifies the conversation:
//
//   - Being-to-being conversations key on `ibpAddress` (the canonical
//     stance::stance IBP Address). Every reach in the same IBP Address
//     shares one MCP client — web tab and CLI talking to the same
//     Ruler at /MyTree use one client under the single-context being
//     model.
//
//   - Stanceless background pipelines (internal cognition without a
//     being-to-being framing — compress, scout, intent, dreams, etc.)
//     key on their internal-session-key (`pipeline:ephemeral:<uuid>`,
//     `pipeline:tree:<rootId>:<purpose>`). Same string the rest of the
//     pipeline uses.
//
// The Map stores strings → MCP clients; it doesn't care which flavor.
// Callers pick the right key for their context.
//
// Cleanup: periodic stale sweep + explicit closeMCPClient on pipeline
// teardown. Socket disconnect is NOT a close trigger — other sockets
// for the same being may still be in the conversation under the
// shared ibpAddress cache key. The being-room broadcast model
// ([[project_ibp_summon_unified_event]]) keeps every reach in sync;
// MCP clients live until the stale sweep reaps them or a pipeline
// owner calls closeMCPClient explicitly.

import log from "../core/log.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";

// ─────────────────────────────────────────────────────────────────────────
// CLIENT MAP
// ─────────────────────────────────────────────────────────────────────────

// cacheKey -> MCP Client instance
export const mcpClients = new Map();

// cacheKey -> jwtToken (separate from SDK client to avoid mutating it)
const clientTokens = new Map();

// cacheKey -> timestamp of last use
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

export async function connectToMCP(serverUrl, cacheKey, jwtToken) {
  // Reuse existing client if token matches
  const existing = mcpClients.get(cacheKey);
  if (existing && clientTokens.get(cacheKey) === jwtToken) {
    clientLastUsed.set(cacheKey, Date.now());
    return existing;
  }

  // Close stale client if token changed
  if (existing) {
    await closeMCPClient(cacheKey);
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

  log.verbose("MCP", `Connecting MCP client for ${cacheKey}...`);

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

  log.verbose("MCP", `MCP client connected for ${cacheKey}`);

  mcpClients.set(cacheKey, client);
  clientTokens.set(cacheKey, jwtToken);
  clientLastUsed.set(cacheKey, Date.now());
  return client;
}

// ─────────────────────────────────────────────────────────────────────────
// CLOSE
// ─────────────────────────────────────────────────────────────────────────

export async function closeMCPClient(cacheKey) {
  const client = mcpClients.get(cacheKey);
  mcpClients.delete(cacheKey);
  clientTokens.delete(cacheKey);
  clientLastUsed.delete(cacheKey);

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
    log.debug("MCP", `Closed MCP client for ${cacheKey}`);
  } catch (err) {
    log.warn("MCP", `Error closing MCP client for ${cacheKey}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY
// ─────────────────────────────────────────────────────────────────────────

export function getMCPClient(cacheKey) {
  const client = mcpClients.get(cacheKey);
  if (client) clientLastUsed.set(cacheKey, Date.now());
  return client || null;
}

// ─────────────────────────────────────────────────────────────────────────
// PERIODIC SWEEP: close clients that haven't been used in 1 hour.
// Safety net for violent disconnects where the cleanup handler never fires.
// ─────────────────────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  let swept = 0;
  for (const [cacheKey, lastUsed] of clientLastUsed) {
    if (now - lastUsed > mcpStaleMs()) {
      closeMCPClient(cacheKey).catch(() => {});
      swept++;
    }
  }
  if (swept > 0) {
    log.debug("MCP", `Swept ${swept} stale MCP client(s) (${mcpClients.size} remaining)`);
  }
}, 15 * 60 * 1000).unref(); // every 15 minutes

export { MCP_SERVER_URL };
