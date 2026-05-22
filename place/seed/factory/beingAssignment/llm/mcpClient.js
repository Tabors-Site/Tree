// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The being's hand reaching outside the assembled frame. When the
// being, mid-moment, calls a tool, that reach goes here. I open
// or reuse an MCP connection and hand it back to runTurn. The
// cache lives in cognition because each entry is per-presence
// machinery, not transport.
//
// One MCP client per presence lane. The cache key names the lane:
//
//   Being-to-being. Key is the IBP Address (canonical
//   stance::stance). Every reach in that presence shares one
//   client — a web tab and a CLI standing at the same Ruler at
//   /MyTree share one client because they're the same lane of
//   moments.
//
//   Stanceless internal cognition. Lanes with no being-to-being
//   framing (compression, scout, dreams) key on the internal
//   pipeline string: `pipeline:ephemeral:<uuid>` /
//   `pipeline:tree:<rootId>:<purpose>`.
//
// The Map stores strings → MCP clients; it doesn't care which
// shape the key takes. Callers pick the right one for context.
//
// Cleanup happens two ways. A periodic stale sweep walks the
// last-used timestamps, and pipeline teardown calls
// closeMCPClient explicitly. Socket disconnect is NOT a close
// trigger — other reaches into the same presence may still be
// using the connection under the shared key.

import log from "../../../system/log.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_SERVER_URL =
  process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";

// ─────────────────────────────────────────────────────────────────────────
// CLIENT MAP
// ─────────────────────────────────────────────────────────────────────────

// cacheKey -> MCP Client instance
export const mcpClients = new Map();

// cacheKey -> jwtToken (separate from SDK client to avoid mutating it)
const clientTokens = new Map();

// cacheKey -> timestamp of last use
const clientLastUsed = new Map();

import { getPlaceConfigValue } from "../../../placeConfig.js";

function MAX_MCP_CLIENTS() {
  return Math.max(
    100,
    Math.min(Number(getPlaceConfigValue("maxMcpClients")) || 5000, 50000),
  );
}
const MCP_CLOSE_TIMEOUT_MS = 5000; // safety ceiling, not configurable

// Configurable via place config, read at use time
function mcpConnectTimeout() {
  return Number(getPlaceConfigValue("mcpConnectTimeout")) || 10000;
}
function mcpStaleMs() {
  return Number(getPlaceConfigValue("mcpStaleTimeout")) || 3600000;
}

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
    let oldestId = null,
      oldestTime = Infinity;
    for (const [id, ts] of clientLastUsed) {
      if (ts < oldestTime) {
        oldestTime = ts;
        oldestId = id;
      }
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
        setTimeout(
          () => reject(new Error("MCP connect timed out")),
          mcpConnectTimeout(),
        ),
      ),
    ]);
  } catch (err) {
    // Clean up the transport on failure
    try {
      if (transport.close) await transport.close();
    } catch {}
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
    const closePromise =
      typeof client.close === "function"
        ? client.close()
        : client.transport?.close
          ? client.transport.close()
          : Promise.resolve();

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

setInterval(
  () => {
    const now = Date.now();
    let swept = 0;
    for (const [cacheKey, lastUsed] of clientLastUsed) {
      if (now - lastUsed > mcpStaleMs()) {
        closeMCPClient(cacheKey).catch(() => {});
        swept++;
      }
    }
    if (swept > 0) {
      log.debug(
        "MCP",
        `Swept ${swept} stale MCP client(s) (${mcpClients.size} remaining)`,
      );
    }
  },
  15 * 60 * 1000,
).unref(); // every 15 minutes

export { MCP_SERVER_URL };
